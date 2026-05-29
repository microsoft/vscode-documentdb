/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { formatTokenCount } from '../utils/formatTokenCount';

/**
 * Identifies which extension feature is calling `CopilotService` so we can
 * disambiguate shared telemetry events (e.g., `copilot.sendMessage`) by
 * source. Add a new value here when introducing a new AI-backed feature.
 */
export type CopilotFeatureSource = 'queryInsights' | 'queryGeneration';

/**
 * Options for sending a message to the language model
 */
export interface CopilotMessageOptions {
    /**
     * Preferred model **family** (`LanguageModelChat.family`, e.g.
     * `'gpt-4.1'`). We key the preference chain on family rather than id
     * because `LanguageModelChat.id` is documented as opaque and can change
     * between Copilot extension versions (or include date-stamped suffixes
     * like `copilot-gpt-4o-mini-2024-07-18`), whereas `family` is the
     * well-known stable name that survives id churn.
     *
     * If the requested family is not available, the service falls back to
     * {@link fallbackFamilies} in order.
     */
    preferredFamily?: string;

    /** Ordered list of fallback model families. See {@link preferredFamily}. */
    fallbackFamilies?: string[];

    /* AbortSignal for cancellation support */
    signal?: AbortSignal;

    /* Model-specific options (e.g., reasoning_effort for GPT-5 class models) */
    modelOptions?: { [name: string]: unknown };

    /**
     * Identifies the calling feature so the shared `copilot.sendMessage`
     * telemetry event can be filtered/grouped by source. Required for any
     * call that should be attributable in analytics.
     */
    featureSource?: CopilotFeatureSource;
}

/**
 * Token-usage metrics for a Copilot request.
 *
 * The VS Code Language Model API does not expose token counts on responses,
 * so we compute them client-side via `LanguageModelChat.countTokens(...)`.
 * All fields are optional because token counting can fail (e.g., when the
 * model rejects the count request, or when the request is cancelled mid-flight)
 * and we never want to fail the user-facing flow because telemetry is
 * unavailable.
 */
export interface CopilotTokenUsage {
    /** Total token count across all input messages (prompt). */
    promptTokens?: number;
    /** Token count of the assistant's full streamed response. */
    responseTokens?: number;
    /** Sum of `promptTokens` and `responseTokens` when both are known. */
    totalTokens?: number;
    /** The selected model's advertised input context window (`maxInputTokens`). */
    maxInputTokens?: number;
    /** `promptTokens / maxInputTokens * 100`, rounded to one decimal place. */
    promptUtilizationPct?: number;
}

/**
 * Response from the Copilot service
 */
export interface CopilotResponse {
    /* The generated text response */
    text: string;
    /**
     * Stable opaque identifier of the selected model (`LanguageModelChat.id`,
     * e.g., `copilot-gpt-4o`). Use this for telemetry and for comparisons that
     * must round-trip to the VS Code Language Model API. Never render directly
     * in UI — use {@link modelDisplayName} for display.
     */
    modelId: string;
    /**
     * Well-known family of the selected model (`LanguageModelChat.family`,
     * e.g., `gpt-4o`). This is the documented stable name used in API
     * selectors. Use this for warning checks against the preferred-model
     * constant.
     */
    modelFamily: string;
    /**
     * Human-readable display name of the selected model
     * (`LanguageModelChat.name`, e.g., `GPT-4o`). Render this in UI bylines.
     * Falls back to {@link modelId} when `name` is empty.
     */
    modelDisplayName: string;
    /* Duration of the actual LLM request in milliseconds (excludes model selection overhead) */
    durationMs: number;
    /**
     * Best-effort token usage information for the request. Fields may be
     * missing if `countTokens` failed or the request was cancelled.
     */
    usage?: CopilotTokenUsage;
}

/**
 * Service for interacting with GitHub Copilot's LLM
 */
export class CopilotService {
    /**
     * Sends a message to the Copilot LLM and returns the response
     *
     * @param messages - Array of chat messages to send to the model
     * @param options - Options for the request
     * @returns The response from the model
     * @throws Error if no suitable model is available or if the user cancels
     */
    static async sendMessage(
        messages: vscode.LanguageModelChatMessage[],
        options?: CopilotMessageOptions,
    ): Promise<CopilotResponse> {
        const result = await callWithTelemetryAndErrorHandling(
            'vscode-documentdb.copilot.sendMessage',
            async (context: IActionContext) => {
                // Tag the shared `copilot.sendMessage` event with the calling
                // feature so analytics can split telemetry by source. Default
                // to 'unknown' if the caller forgot to set it (caught in PR
                // review rather than at runtime).
                context.telemetry.properties.featureSource = options?.featureSource ?? 'unknown';

                // Get all available models from VS Code
                const availableModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });

                const preferredFamilies = this.getPreferredFamilies(options);
                const selectedModel = this.selectBestModel(availableModels, preferredFamilies);

                // Capture the selection chain to telemetry for offline analysis
                // (e.g., monitoring how often each fallback level is hit in production).
                context.telemetry.properties.modelPreferenceChain = preferredFamilies.join(',') || '(none)';
                // Use families (well-known names) rather than opaque ids, dedupe,
                // and cap to keep the property within downstream size limits — long
                // id strings like `copilot-gpt-4o-mini-2024-07-18` repeated across
                // 10+ models can blow past telemetry property caps and get
                // truncated, hiding the very data the field is meant to expose.
                const MAX_MODELS_REPORTED = 8;
                const availableFamilies = Array.from(new Set(availableModels.map((m) => m.family))).sort();
                const reportedFamilies = availableFamilies.slice(0, MAX_MODELS_REPORTED);
                const truncatedCount = availableFamilies.length - reportedFamilies.length;
                context.telemetry.properties.modelsAvailable =
                    truncatedCount > 0
                        ? `${reportedFamilies.join(',')},+${truncatedCount}-more`
                        : reportedFamilies.join(',');
                context.telemetry.measurements.modelsAvailableCount = availableModels.length;

                if (!selectedModel) {
                    context.telemetry.properties.modelSelectionOutcome = 'no-models-available';
                    throw new Error(
                        l10n.t(
                            'No suitable language model is available. Please ensure GitHub Copilot is installed and signed in with an active subscription, and that you accepted the language-model access consent prompt the first time this feature was used (you can re-trigger it by running the feature again).',
                        ),
                    );
                }

                context.telemetry.properties.modelId = selectedModel.id;
                context.telemetry.properties.modelFamily = selectedModel.family;
                context.telemetry.properties.modelSelectionOutcome = preferredFamilies.includes(selectedModel.family)
                    ? 'preferred-match'
                    : 'first-available-fallback';

                try {
                    const response = await this.sendToModel(selectedModel, messages, options);

                    // Surface usage metrics to telemetry alongside the response so
                    // downstream events (e.g., Query Insights Stage 3) can correlate
                    // disclosure shown in the UI with the underlying token usage.
                    if (response.usage) {
                        const { promptTokens, responseTokens, totalTokens, maxInputTokens, promptUtilizationPct } =
                            response.usage;
                        if (promptTokens !== undefined) {
                            context.telemetry.measurements.promptTokens = promptTokens;
                        }
                        if (responseTokens !== undefined) {
                            context.telemetry.measurements.responseTokens = responseTokens;
                        }
                        if (totalTokens !== undefined) {
                            context.telemetry.measurements.totalTokens = totalTokens;
                        }
                        if (maxInputTokens !== undefined) {
                            context.telemetry.measurements.maxInputTokens = maxInputTokens;
                        }
                        if (promptUtilizationPct !== undefined) {
                            context.telemetry.measurements.promptUtilizationPct = promptUtilizationPct;
                        }
                    }

                    return {
                        text: response.text,
                        modelId: selectedModel.id,
                        modelFamily: selectedModel.family,
                        modelDisplayName: selectedModel.name || selectedModel.id,
                        durationMs: response.durationMs,
                        usage: response.usage,
                    };
                } catch (error) {
                    if (error instanceof UserCancelledError) {
                        throw error;
                    }
                    context.telemetry.properties.llmError = 'llmGenerateResponseCallFailed';
                    throw error;
                }
            },
        );

        if (!result) {
            // If signal was aborted, propagate cancellation silently
            if (options?.signal?.aborted) {
                throw new UserCancelledError('AbortSignal');
            }
            throw new Error(l10n.t('Failed to get response from language model'));
        }

        return result;
    }

    /**
     * Builds the ordered list of preferred model families.
     */
    private static getPreferredFamilies(options?: CopilotMessageOptions): string[] {
        const families: string[] = [];

        if (options?.preferredFamily) {
            families.push(options.preferredFamily);
        }

        if (options?.fallbackFamilies && options.fallbackFamilies.length > 0) {
            families.push(...options.fallbackFamilies);
        }

        return families;
    }

    /**
     * Selects the best available model based on preference order.
     *
     * **Matching is performed by `LanguageModelChat.family`** — the
     * documented stable well-known name (`gpt-4.1`, `gpt-4o`, …) —
     * not by `LanguageModelChat.id`. The id is documented as opaque and
     * may change between Copilot extension versions (or carry
     * date-stamped suffixes like `copilot-gpt-4o-mini-2024-07-18`); the
     * family is the surface we expect to outlive id churn. Internal
     * aliases like `copilot-utility` are published by the Copilot
     * extension with the alias string used as **both** id and family,
     * so they also match the family-based selector without needing a
     * special id-fallback path.
     *
     * Emits a structured trace of the selection chain to the output channel so
     * users (and support) can see, per request, which families were requested,
     * which were accepted, and which were rejected because they were not
     * available from the Copilot vendor.
     *
     * @param availableModels - All available models from VS Code
     * @param preferredFamilies - Ordered list of preferred model families
     * @returns The best matching model, or the first available model if no matches
     */
    private static selectBestModel(
        availableModels: vscode.LanguageModelChat[],
        preferredFamilies: string[],
    ): vscode.LanguageModelChat | undefined {
        const availableSummary = availableModels.map((m) => `${m.family} (${m.id})`);
        ext.outputChannel.trace(
            l10n.t('[Copilot] Available models from VS Code: {0}', JSON.stringify(availableSummary)),
        );
        ext.outputChannel.trace(
            l10n.t('[Copilot] Model family preference chain: {0}', JSON.stringify(preferredFamilies)),
        );

        if (availableModels.length === 0) {
            // Nothing the caller could possibly use — flag this clearly in the
            // trace so users debugging "AI insights unavailable" see the root cause.
            ext.outputChannel.warn(
                l10n.t('[Copilot] No language models available from vendor "copilot". Aborting selection.'),
            );
            return undefined;
        }

        // Walk the preference chain in order, matching on `family`; log
        // accepted/rejected per entry so the full decision path is visible in
        // the trace stream.
        for (const preferredFamily of preferredFamilies) {
            const matchingModel = availableModels.find((m) => m.family === preferredFamily);
            if (matchingModel) {
                ext.outputChannel.trace(
                    l10n.t(
                        '[Copilot] Requested family "{0}" → accepted (matched id: {1})',
                        preferredFamily,
                        matchingModel.id,
                    ),
                );
                ext.outputChannel.trace(l10n.t('[Copilot] Selected model: {0}', matchingModel.id));
                return matchingModel;
            }
            ext.outputChannel.trace(
                l10n.t(
                    '[Copilot] Requested family "{0}" → rejected (no available model in this family)',
                    preferredFamily,
                ),
            );
        }

        // No preference matched but models are available — fall back to the
        // first one Copilot returned so the feature degrades gracefully.
        const fallback = availableModels[0];
        if (preferredFamilies.length === 0) {
            ext.outputChannel.trace(
                l10n.t('[Copilot] No family preferences supplied; using first available: {0}', fallback.id),
            );
        } else {
            ext.outputChannel.trace(
                l10n.t('[Copilot] No preferred family matched; falling back to first available: {0}', fallback.id),
            );
        }
        ext.outputChannel.trace(l10n.t('[Copilot] Selected model: {0}', fallback.id));
        return fallback;
    }

    /**
     * Sends messages to a specific model and collects the response
     */
    private static async sendToModel(
        model: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        options?: CopilotMessageOptions,
    ): Promise<{ text: string; durationMs: number; usage?: CopilotTokenUsage }> {
        const signal = options?.signal;

        // If already aborted, throw immediately
        if (signal?.aborted) {
            throw new UserCancelledError('AbortSignal');
        }

        // Bridge AbortSignal → vscode.CancellationToken so the LLM API can stop streaming
        const cts = new vscode.CancellationTokenSource();
        const onAbort = () => cts.cancel();
        signal?.addEventListener('abort', onAbort);

        try {
            // Diagnostic: dump what the runtime actually exposes on the selected
            // model so we can later inspect whether richer metadata becomes
            // available without taking a dependency on the proposed pricing API.
            this.dumpModelMetadata(model);

            // GitHub copilot LLM API currently doesn't support temperature or maxTokens in
            // LanguageModelChatRequestOptions, but we keep them here for potential future use
            const requestOptions: vscode.LanguageModelChatRequestOptions = {
                ...(options?.modelOptions ? { modelOptions: options.modelOptions } : {}),
            };

            const requestStart = Date.now();
            const chatResponse = await model.sendRequest(messages, requestOptions, cts.token);

            // Collect the streaming response, checking for cancellation between chunks
            let fullResponse = '';
            for await (const fragment of chatResponse.text) {
                if (signal?.aborted) {
                    break;
                }
                fullResponse += fragment;
            }
            const durationMs = Date.now() - requestStart;

            if (signal?.aborted) {
                ext.outputChannel.trace(l10n.t('[Copilot] Call cancelled during streaming'));
                throw new UserCancelledError('AbortSignal');
            }

            // Compute best-effort token usage. countTokens is asynchronous and may
            // reject (e.g., if the model rejects the count request); we never want
            // a telemetry failure to break the user-facing flow, so each step is
            // wrapped in its own try/catch and falls back to `undefined`.
            const usage = await this.measureTokenUsage(model, messages, fullResponse);

            // Trace token usage in compact form so the output channel stays scannable.
            // The numeric measurements are still emitted to telemetry verbatim.
            ext.outputChannel.trace(
                l10n.t(
                    '[Copilot] Tokens: prompt={0}, response={1}, total={2}, context={3}, utilization={4}%',
                    usage.promptTokens !== undefined ? formatTokenCount(usage.promptTokens) : '?',
                    usage.responseTokens !== undefined ? formatTokenCount(usage.responseTokens) : '?',
                    usage.totalTokens !== undefined ? formatTokenCount(usage.totalTokens) : '?',
                    usage.maxInputTokens !== undefined ? formatTokenCount(usage.maxInputTokens) : '?',
                    usage.promptUtilizationPct !== undefined ? usage.promptUtilizationPct.toString() : '?',
                ),
            );

            return { text: fullResponse, durationMs, usage };
        } finally {
            signal?.removeEventListener('abort', onAbort);
            cts.dispose();
        }
    }

    /**
     * Computes best-effort token counts for the prompt and response.
     *
     * The VS Code Language Model API does not return token usage on responses,
     * so we ask the model to count tokens client-side via `countTokens`. Both
     * the prompt and the response counts are issued in parallel to minimise
     * latency, and any failure is logged and degraded to `undefined` instead
     * of bubbling up to the caller.
     */
    private static async measureTokenUsage(
        model: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        responseText: string,
    ): Promise<CopilotTokenUsage> {
        const maxInputTokens = typeof model.maxInputTokens === 'number' ? model.maxInputTokens : undefined;

        const countSafely = async (input: string | vscode.LanguageModelChatMessage): Promise<number | undefined> => {
            try {
                return await model.countTokens(input);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.trace(
                    l10n.t('[Copilot] countTokens failed; usage metric will be omitted: {0}', errorMessage),
                );
                return undefined;
            }
        };

        // Count prompt tokens per-message in parallel, then sum. If any single
        // message count fails the total is still useful as a lower bound, but
        // we err on the side of reporting `undefined` to avoid skewed metrics.
        const [perMessageCounts, responseTokens] = await Promise.all([
            Promise.all(messages.map((m) => countSafely(m))),
            responseText.length > 0 ? countSafely(responseText) : Promise.resolve<number | undefined>(0),
        ]);

        let promptTokens: number | undefined;
        if (perMessageCounts.every((c) => typeof c === 'number')) {
            promptTokens = perMessageCounts.reduce<number>((sum, c) => sum + (c as number), 0);
        }

        const totalTokens =
            promptTokens !== undefined && responseTokens !== undefined ? promptTokens + responseTokens : undefined;

        let promptUtilizationPct: number | undefined;
        if (promptTokens !== undefined && maxInputTokens && maxInputTokens > 0) {
            promptUtilizationPct = Math.round((promptTokens / maxInputTokens) * 1000) / 10;
        }

        return { promptTokens, responseTokens, totalTokens, maxInputTokens, promptUtilizationPct };
    }

    /**
     * Checks if LLMs are available
     *
     * @returns true if at least one model is available
     */
    static async isAvailable(): Promise<boolean> {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        return models.length > 0;
    }

    /**
     * Dumps the selected model's stable metadata (and any other own enumerable
     * properties present at runtime) to the trace stream.
     *
     * Pricing and cost-per-token fields live on the proposed
     * `languageModelPricing` API and are intentionally **not** consumed here —
     * the extension stays on stable VS Code APIs. This dump is purely a
     * diagnostic so we can observe what the runtime exposes today (and tell
     * when richer information becomes available on stable in the future)
     * without depending on it.
     *
     * Memoised by model id within a single extension host process — the
     * metadata is static for a given id, so we only need to emit it the first
     * time we encounter that model, not on every Copilot request.
     */
    private static readonly dumpedModelIds = new Set<string>();

    private static dumpModelMetadata(model: vscode.LanguageModelChat): void {
        if (this.dumpedModelIds.has(model.id)) {
            return;
        }
        this.dumpedModelIds.add(model.id);

        // 1) Known stable fields. Safe to log verbatim.
        const stable = {
            id: model.id,
            vendor: model.vendor,
            family: model.family,
            version: model.version,
            name: model.name,
            maxInputTokens: model.maxInputTokens,
        };
        ext.outputChannel.trace(l10n.t('[Copilot] Selected model metadata: {0}', JSON.stringify(stable)));

        // 2) Best-effort runtime introspection. We never read pricing or other
        // proposed-API fields by name; we only enumerate whatever the host
        // happens to expose and skip methods. This is observation only.
        try {
            const own: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(model as unknown as Record<string, unknown>)) {
                if (typeof value === 'function') {
                    continue;
                }
                own[key] = value;
            }
            const ownJson = JSON.stringify(own);
            // Only log if the runtime actually exposed extra fields beyond the
            // ones we already covered, to keep the trace stream tidy.
            if (ownJson && ownJson !== '{}') {
                ext.outputChannel.trace(l10n.t('[Copilot] Selected model own enumerable properties: {0}', ownJson));
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.trace(l10n.t('[Copilot] Could not enumerate model own properties: {0}', errorMessage));
        }
    }
}
