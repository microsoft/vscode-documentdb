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
 * Family name used when asking VS Code's Language Model API for a model.
 *
 * We deliberately target the internal `copilot-utility` alias — published
 * by the Copilot extension as both `id` and `family` — because it routes
 * the request through Copilot's chat-fallback path, which:
 *
 * - does NOT consume premium request units / usage-based billing tokens,
 *   matching the behaviour documented for utility models on
 *   <https://docs.github.com/copilot/concepts/models/utility-models>; and
 * - resolves at runtime to whichever model the Copilot service currently
 *   designates for lightweight background work, so we don't need to chase
 *   model deprecations (e.g. GPT-4.1 retirement on 2026-06-01) in this
 *   extension's source.
 *
 * The list of underlying utility models (currently GPT-4o mini, GPT-4o,
 * GPT-4.1, GPT-5.4 nano) is not stable and is not part of any public API,
 * so we do NOT attempt to target those families directly — calling them by
 * name from a third-party extension would fall outside the chat-fallback
 * path and bill the user. The alias is the only target that preserves the
 * "free for the user" guarantee, and is therefore intentionally the only
 * model this service requests.
 */
const UTILITY_MODEL_FAMILY = 'copilot-utility';

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
    /**
     * Underlying model version exposed by the provider
     * (`LanguageModelChat.version`, e.g., `gpt-5.3-codex`). This is the only
     * surface that distinguishes the current backing of an opaque alias such
     * as `copilot-utility`: id and family both read `copilot-utility`, while
     * `version` reveals which model the alias resolved to today. Record this
     * in telemetry so the actual backing model is attributable per request.
     */
    modelVersion: string;
    /* Duration of the actual LLM request in milliseconds (excludes model selection overhead) */
    durationMs: number;
    /**
     * Best-effort token usage information for the request. Fields may be
     * missing if `countTokens` failed or the request was cancelled.
     */
    usage?: CopilotTokenUsage;
}

/**
 * Pull-based streaming handle returned by {@link CopilotService.streamMessage}.
 *
 * Consumers iterate {@link fragments} with `for await` to receive partial
 * text as the model produces it (matching what {@link CopilotService.sendMessage}
 * would have accumulated internally), then `await` {@link completion} to obtain
 * the same full response metadata (model id/family/display name, durationMs,
 * usage) that the buffered API returns.
 *
 * The iteration drives the underlying `LanguageModelChat.sendRequest` call —
 * a consumer that stops iterating early (e.g. by aborting the signal in
 * {@link CopilotMessageOptions}) will cause the streaming loop to exit and the
 * model call to be cancelled via the AbortSignal → CancellationToken bridge.
 *
 * @example
 * ```ts
 * const handle = CopilotService.streamMessage(messages, { signal, featureSource: 'queryInsights' });
 * for await (const fragment of handle.fragments) {
 *     // feed fragment into the incremental parser
 * }
 * const response = await handle.completion; // { text, modelId, durationMs, usage, … }
 * ```
 */
export interface CopilotStreamHandle {
    /**
     * Async iterable of text fragments in the order produced by the model.
     * Iteration of this iterable is what advances the underlying model call.
     */
    fragments: AsyncIterable<string>;
    /**
     * Resolves with the full response (including accumulated text, model
     * identity, durationMs and best-effort token usage) once {@link fragments}
     * iteration has completed. Rejects with the same kind of error
     * {@link CopilotService.sendMessage} would have thrown (e.g.
     * `UserCancelledError` on abort, or a generic error if no suitable model
     * is available).
     *
     * The promise is already chained internally to swallow the global
     * unhandled-rejection warning when consumers do not await it (e.g.,
     * because they handled cancellation via the abort signal); always await
     * it (or attach a `.catch()` of your own) to react to failures.
     */
    completion: Promise<CopilotResponse>;
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

                const selectedModel = await this.selectUtilityModel();

                if (!selectedModel) {
                    context.telemetry.properties.modelSelectionOutcome = 'no-utility-model-available';
                    throw new Error(
                        l10n.t(
                            'No suitable language model is available. Please ensure GitHub Copilot is installed and signed in with an active subscription, and that you accepted the language-model access consent prompt the first time this feature was used (you can re-trigger it by running the feature again).',
                        ),
                    );
                }

                context.telemetry.properties.modelId = selectedModel.id;
                context.telemetry.properties.modelFamily = selectedModel.family;
                context.telemetry.properties.modelName = selectedModel.name || '(unnamed)';
                context.telemetry.properties.modelVersion = selectedModel.version || '(unknown)';
                if (typeof selectedModel.maxInputTokens === 'number') {
                    context.telemetry.measurements.modelMaxInputTokens = selectedModel.maxInputTokens;
                }
                context.telemetry.properties.modelSelectionOutcome = 'utility-model';

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
                        modelVersion: selectedModel.version || '(unknown)',
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
     * Streaming variant of {@link sendMessage} that exposes the LLM response
     * as a pull-based `AsyncIterable<string>` of fragments. See
     * {@link CopilotStreamHandle} for the consumer contract and rationale.
     *
     * Identical telemetry to {@link sendMessage} is emitted on completion
     * (model selection chain, model id/family, featureSource, token usage,
     * etc.) under the `copilot.streamMessage` event. The buffering API and
     * the streaming API share the same {@link streamToModel} primitive, so
     * the two paths cannot drift apart.
     *
     * The producer runs in the background as soon as this method is called.
     * Consumers must iterate {@link CopilotStreamHandle.fragments} promptly
     * (or abort via {@link CopilotMessageOptions.signal}) — fragments are
     * buffered until they are consumed.
     */
    static streamMessage(
        messages: vscode.LanguageModelChatMessage[],
        options?: CopilotMessageOptions,
    ): CopilotStreamHandle {
        const channel = new FragmentChannel();

        let resolveCompletion!: (response: CopilotResponse) => void;
        let rejectCompletion!: (error: unknown) => void;
        const completion = new Promise<CopilotResponse>((resolve, reject) => {
            resolveCompletion = resolve;
            rejectCompletion = reject;
        });
        // Prevent a global unhandled-rejection warning when consumers only
        // observe completion via the abort signal and never await this
        // promise. Real consumers are expected to attach their own handler.
        completion.catch(() => {
            /* swallow: consumer chose not to observe */
        });

        // Fire-and-forget producer; all error paths are captured by the
        // telemetry wrapper or surfaced through `rejectCompletion` below.
        void this.runStream(messages, options, channel, resolveCompletion, rejectCompletion);

        return {
            fragments: channel,
            completion,
        };
    }

    /**
     * Background producer for {@link streamMessage}. Performs model
     * selection inside a single `callWithTelemetryAndErrorHandling` wrapper
     * (mirroring {@link sendMessage}), runs {@link streamToModel} pushing
     * each fragment into {@link channel}, and resolves/rejects the caller's
     * completion deferred when the operation ends.
     */
    private static async runStream(
        messages: vscode.LanguageModelChatMessage[],
        options: CopilotMessageOptions | undefined,
        channel: FragmentChannel,
        resolveCompletion: (response: CopilotResponse) => void,
        rejectCompletion: (error: unknown) => void,
    ): Promise<void> {
        try {
            const result = await callWithTelemetryAndErrorHandling(
                'vscode-documentdb.copilot.streamMessage',
                async (context: IActionContext) => {
                    // Tag the shared `copilot.streamMessage` event with the
                    // calling feature so analytics can split telemetry by source.
                    context.telemetry.properties.featureSource = options?.featureSource ?? 'unknown';

                    const selectedModel = await this.selectUtilityModel();

                    if (!selectedModel) {
                        context.telemetry.properties.modelSelectionOutcome = 'no-utility-model-available';
                        throw new Error(
                            l10n.t(
                                'No suitable language model is available. Please ensure GitHub Copilot is installed and signed in with an active subscription, and that you accepted the language-model access consent prompt the first time this feature was used (you can re-trigger it by running the feature again).',
                            ),
                        );
                    }

                    context.telemetry.properties.modelId = selectedModel.id;
                    context.telemetry.properties.modelFamily = selectedModel.family;
                    context.telemetry.properties.modelName = selectedModel.name || '(unnamed)';
                    context.telemetry.properties.modelVersion = selectedModel.version || '(unknown)';
                    if (typeof selectedModel.maxInputTokens === 'number') {
                        context.telemetry.measurements.modelMaxInputTokens = selectedModel.maxInputTokens;
                    }
                    context.telemetry.properties.modelSelectionOutcome = 'utility-model';

                    try {
                        const response = await this.streamToModel(selectedModel, messages, options, (fragment) =>
                            channel.push(fragment),
                        );

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
                            modelVersion: selectedModel.version || '(unknown)',
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
                if (options?.signal?.aborted) {
                    throw new UserCancelledError('AbortSignal');
                }
                throw new Error(l10n.t('Failed to get response from language model'));
            }

            channel.close();
            resolveCompletion(result);
        } catch (error) {
            channel.close(error);
            rejectCompletion(error);
        }
    }

    /**
     * Builds a compact, human-readable one-line summary of a model's stable
     * identity fields for the trace stream. Unlike {@link dumpModelMetadata}
     * (which is memoised and only fires once per model id), this is emitted on
     * every selection so each request's trace shows exactly which model — by
     * display name, family and id — handled it.
     */
    private static formatModelDetails(model: vscode.LanguageModelChat): string {
        return l10n.t(
            'name="{0}", family={1}, id={2}, version={3}',
            model.name || '(unnamed)',
            model.family,
            model.id,
            model.version,
        );
    }

    /**
     * Resolves the Copilot **utility** model.
     *
     * We always ask for {@link UTILITY_MODEL_FAMILY} (`copilot-utility`) — the
     * Copilot extension's documented alias for the chat-fallback path — and
     * never fall back to billed picker models. If the alias is unavailable
     * (e.g. the Copilot extension is not installed, the user is signed out,
     * or the consent prompt has not been accepted) the caller is responsible
     * for surfacing the failure; we never silently degrade onto a model that
     * would consume the user's premium request budget.
     *
     * Returns `undefined` when no model is available so the caller can map
     * that to its own user-facing error.
     */
    private static async selectUtilityModel(): Promise<vscode.LanguageModelChat | undefined> {
        const matches = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: UTILITY_MODEL_FAMILY,
        });

        if (matches.length === 0) {
            ext.outputChannel.warn(
                l10n.t(
                    '[Copilot] Utility model "{0}" is not available from vendor "copilot". Aborting request to avoid charging the user for a billed picker model.',
                    UTILITY_MODEL_FAMILY,
                ),
            );
            return undefined;
        }

        const selected = matches[0];
        ext.outputChannel.trace(l10n.t('[Copilot] Selected utility model: {0}', this.formatModelDetails(selected)));
        return selected;
    }

    /**
     * Sends messages to a specific model and collects the response
     */
    private static async sendToModel(
        model: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        options?: CopilotMessageOptions,
    ): Promise<{ text: string; durationMs: number; usage?: CopilotTokenUsage }> {
        // Delegate to the streaming primitive with a no-op fragment sink. This
        // keeps a single implementation of the model-iteration + token-counting
        // pipeline so the buffered and streamed paths cannot drift apart.
        return this.streamToModel(model, messages, options, () => {
            /* no-op: buffered API only needs the final text */
        });
    }

    /**
     * Iterates a `LanguageModelChat` response, delivering each text fragment
     * to {@link onFragment} as it arrives while also accumulating the full
     * text for the caller. This is the single source of truth for the
     * AbortSignal → CancellationToken bridge, the per-fragment cancellation
     * check, the duration measurement and the best-effort token-usage
     * computation.
     *
     * Used directly by {@link streamMessage} (which pipes fragments into its
     * pull-based channel) and indirectly by {@link sendToModel} (which passes
     * a no-op sink and only consumes the buffered text).
     */
    private static async streamToModel(
        model: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        options: CopilotMessageOptions | undefined,
        onFragment: (fragment: string) => void,
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

            // `sendRequest` resolves once the request has been accepted and
            // dispatched to the model (after any auth/consent handshake) but
            // BEFORE the first token streams back. The VS Code Language Model
            // API exposes no finer-grained progress than this — there is no
            // "upload complete" / "model thinking" callback — so this is the
            // earliest milestone we can surface. Trace it so the often-long
            // "model is thinking" gap between request acceptance and first
            // token is visible separately from the model-selection overhead.
            const requestAcceptedMs = Date.now() - requestStart;
            ext.outputChannel.trace(
                l10n.t('[Copilot] Request accepted by model after {0}ms; awaiting first token…', requestAcceptedMs),
            );

            // Collect the streaming response, checking for cancellation between chunks
            let fullResponse = '';
            let firstTokenTraced = false;
            for await (const fragment of chatResponse.text) {
                if (signal?.aborted) {
                    break;
                }
                if (!firstTokenTraced) {
                    firstTokenTraced = true;
                    // Time-to-first-token: the headline latency users feel as
                    // "why is nothing happening yet". Report both the absolute
                    // elapsed-since-send and the delta after request acceptance
                    // so the thinking gap is isolated from dispatch overhead.
                    const firstTokenMs = Date.now() - requestStart;
                    ext.outputChannel.trace(
                        l10n.t(
                            '[Copilot] First token received {0}ms after send ({1}ms after request accepted)',
                            firstTokenMs,
                            firstTokenMs - requestAcceptedMs,
                        ),
                    );
                }
                fullResponse += fragment;
                // Surface the fragment to the streaming consumer. We do this
                // *after* accumulation so consumers see exactly what the buffered
                // response contains; any throw here will propagate and abort
                // iteration, which is the behaviour we want for backpressure.
                onFragment(fragment);
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
     * Checks whether the Copilot utility model this service exclusively
     * targets is currently available.
     *
     * Mirrors the selector used by {@link selectUtilityModel} so an
     * `isAvailable() === true` result is a strong predictor of the next
     * `sendMessage` / `streamMessage` call succeeding (rather than reporting
     * availability of any Copilot model and then failing in selection).
     */
    static async isAvailable(): Promise<boolean> {
        const models = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: UTILITY_MODEL_FAMILY,
        });
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

/**
 * Single-consumer async-iterable channel used by {@link CopilotService.streamMessage}
 * to bridge the push-style per-fragment callback from {@link CopilotService.streamToModel}
 * into the pull-style `AsyncIterable<string>` returned to webview consumers.
 *
 * Backpressure-aware in spirit: producers may call {@link push} as fast as
 * they like (matching the pace of the underlying `for await ... chatResponse.text`
 * loop, which itself respects the model's pacing). When the consumer is
 * slower, fragments are buffered in memory; this is acceptable for the
 * Query Insights Stage 3 use case where total responses fit comfortably
 * under a few hundred KB.
 *
 * Not exported: the only intended use site is inside `CopilotService`.
 */
class FragmentChannel implements AsyncIterableIterator<string> {
    private readonly buffer: string[] = [];
    private deferred: {
        resolve: (result: IteratorResult<string>) => void;
        reject: (error: unknown) => void;
    } | null = null;
    private closed = false;
    private closeError: unknown = undefined;

    push(fragment: string): void {
        if (this.closed) {
            return;
        }
        if (this.deferred) {
            const { resolve } = this.deferred;
            this.deferred = null;
            resolve({ value: fragment, done: false });
            return;
        }
        this.buffer.push(fragment);
    }

    /**
     * Mark the stream complete. Pending `next()` calls receive `{done: true}`
     * (when `error` is undefined) or reject with `error` (when provided).
     * Once closed, further calls are silently ignored.
     */
    close(error?: unknown): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.closeError = error;

        if (!this.deferred) {
            return;
        }
        const { resolve, reject } = this.deferred;
        this.deferred = null;
        if (error !== undefined) {
            reject(error);
        } else {
            resolve({ value: undefined as unknown as string, done: true });
        }
    }

    next(): Promise<IteratorResult<string>> {
        if (this.buffer.length > 0) {
            return Promise.resolve({ value: this.buffer.shift() as string, done: false });
        }
        if (this.closed) {
            if (this.closeError !== undefined) {
                // `closeError` is typed `unknown` because it originates from a
                // catch block; wrap non-Error values so we can satisfy
                // `@typescript-eslint/prefer-promise-reject-errors` without
                // dropping the original Error instance (e.g. `UserCancelledError`).
                const reason = this.closeError instanceof Error ? this.closeError : new Error(String(this.closeError));
                return Promise.reject(reason);
            }
            return Promise.resolve({ value: undefined as unknown as string, done: true });
        }
        return new Promise<IteratorResult<string>>((resolve, reject) => {
            this.deferred = { resolve, reject };
        });
    }

    /**
     * Called by `for await` when the consumer breaks out of the loop early.
     * Marks the channel done and drops any buffered fragments so memory is
     * reclaimed. The upstream model call is cancelled separately via the
     * `AbortSignal` plumbed through {@link CopilotMessageOptions}.
     */
    return(): Promise<IteratorResult<string>> {
        this.close();
        this.buffer.length = 0;
        return Promise.resolve({ value: undefined as unknown as string, done: true });
    }

    [Symbol.asyncIterator](): AsyncIterableIterator<string> {
        return this;
    }
}
