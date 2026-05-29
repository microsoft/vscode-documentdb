/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * `collectionView.queryInsights` push-style (subscription) procedures.
 *
 * Per plan D12 / the package README convention, push procedures live in a
 * sibling file separate from queries/mutations and are merged into the
 * main `queryInsightsRouter`. This keeps "things the webview calls"
 * (queries/mutations, in `queryInsightsRouter.ts`) separate from
 * "things the host pushes" (subscriptions, here).
 *
 * Export shape: a flat record of `{ procedureName: subscriptionProcedure }`
 * that the main router spreads into its own `router({ ... })` call. This
 * yields flat tRPC paths (e.g. `collectionView.queryInsights.streamStage3`)
 * without needing the (currently non-re-exported) `t.mergeRouters` helper.
 */

import { z } from 'zod';

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type QueryObject } from '../../../../commands/llmEnhancedCommands/indexAdvisorCommands';
import { ClusterSession } from '../../../../documentdb/ClusterSession';
import { buildStaticAnalysisSummary } from '../../../../documentdb/queryInsights/staticAnalysisSummary';
import { StreamingResponseParser } from '../../../../documentdb/queryInsights/streamingResponseParser';
import { ext } from '../../../../extensionVariables';
import { QueryInsightsAIService } from '../../../../services/ai/QueryInsightsAIService';
import { publicProcedureWithTelemetry, type WithTelemetry } from '../../../_integration/trpc';
import { type RouterContext } from '../collectionViewRouter';
import { type QueryInsightsStreamEvent } from '../types/queryInsightsStream';

/**
 * Throttle interval for `status` events while fragments are arriving. Each
 * arriving fragment buffers `charsReceived`/`elapsedMs`; a `status` event
 * is yielded at most every this many milliseconds. Chosen to give the
 * webview a smooth progress feel without flooding the message channel.
 */
const STATUS_EVENT_INTERVAL_MS = 250;

/**
 * **Debug-only** artificial delay applied before every yield to the
 * webview, in milliseconds. Set to a non-zero value to make the
 * progressive UI easier to observe during manual verification when the
 * LLM responds quickly (paragraphs appearing one at a time, recommendation
 * shells visible before they fill, etc.). Should be `0` in shipped code.
 *
 * Setting this to e.g. `1000` slows the stream substantially: every
 * structured event (and every throttled `status: receiving` event) waits
 * this long before being sent. Iteration over `streamHandle.fragments`
 * also pauses for this long per parser-emitted event, so the underlying
 * LLM call effectively stalls between yields too — which is what makes
 * the progressive cards visible to the eye.
 */
const DEBUG_YIELD_DELAY_MS = 10;

/**
 * Sleep helper used to insert {@link DEBUG_YIELD_DELAY_MS} before each
 * yield. A no-op fast path when the delay is `0` so shipping the change
 * has zero cost.
 */
function delayYield(): Promise<void> {
    if (DEBUG_YIELD_DELAY_MS <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve) => setTimeout(resolve, DEBUG_YIELD_DELAY_MS));
}

/**
 * One-line, low-cardinality human-readable description of a
 * {@link QueryInsightsStreamEvent} for the trace channel. Keeps the
 * per-event log lines compact so the full stream is scannable end-to-end
 * during manual verification.
 *
 * Markdown / recommendation payloads are summarised by length / index
 * only — the full content lives in the parser's reconciled snapshot if
 * deeper debugging is required.
 */
function describeEvent(event: QueryInsightsStreamEvent): string {
    switch (event.type) {
        case 'status':
            return `status(phase=${event.phase}, chars=${event.charsReceived ?? 0})`;
        case 'summary':
            return `summary(complete=${event.complete}, len=${event.markdown.length})`;
        case 'educational':
            return `educational(complete=${event.complete}, len=${event.markdown.length})`;
        case 'recommendationStarted':
            return `recommendationStarted(index=${event.index})`;
        case 'recommendation':
            return `recommendation(index=${event.index}, action=${event.recommendation.action}, indexName=${event.recommendation.indexName})`;
        case 'verification':
            return `verification(items=${event.items.length})`;
        case 'complete':
            return `complete(modelDisplayName=${event.modelDisplayName ?? 'unknown'}, modelFamily=${event.modelFamily ?? 'unknown'}, totalTokens=${event.usage?.totalTokens ?? 'n/a'})`;
        default:
            return 'unknown';
    }
}

/**
 * Truncate + sanitise a raw LLM fragment for the trace channel. Replaces
 * newlines / tabs with their literal escapes so each fragment fits on one
 * log line, and caps the preview at a fixed width to keep the channel
 * scannable. Used by the per-fragment trace inside the subscription to
 * surface the LLM's actual chunking (helps debug whether the parser's
 * paragraph-boundary detection is granular enough).
 */
function previewFragment(fragment: string): string {
    const MAX = 80;
    const escaped = fragment.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
    if (escaped.length <= MAX) {
        return JSON.stringify(escaped);
    }
    return JSON.stringify(escaped.slice(0, MAX) + '…');
}

/**
 * Dedicated telemetry event name for the Stage 3 streaming subscription.
 *
 * Per plan §7 / WI-10, the auto rpc event
 * (`documentDB.rpc.subscription.collectionView.queryInsights.streamStage3`)
 * still fires but — because `trpcToTelemetry` wraps `opts.next()` which
 * for a subscription resolves at generator-creation time — carries ~0
 * duration and no custom measurements. This dedicated event is the
 * canonical source of all Stage 3 telemetry for the streaming path and
 * carries every key the buffered procedure's rpc event used to carry,
 * plus an explicit `durationMs` (wall-clock from request to terminal
 * yield) and an `aborted` flag.
 */
const STAGE3_COMPLETION_EVENT = 'documentDB.queryInsights.stage3.completed';

/**
 * Accumulator for the dedicated completion event. Populated during
 * iteration and flushed once on subscription unwind (success or abort)
 * via {@link callWithTelemetryAndErrorHandling}. Keys mirror those
 * recorded onto the buffered `getQueryInsightsStage3` procedure's
 * `ctx.telemetry` 1:1 (plan §7), so the new event is a drop-in source
 * for any telemetry query that targeted the old keys.
 */
interface CompletionTelemetry {
    properties: Record<string, string>;
    measurements: Record<string, number>;
}

function newCompletionTelemetry(): CompletionTelemetry {
    return { properties: {}, measurements: {} };
}

/**
 * Record of push-style (subscription) procedures contributed by
 * `queryInsightsEventsRouter`. Spread into `queryInsightsRouter` so the
 * webview-visible paths stay flat (e.g.
 * `collectionView.queryInsights.streamStage3`).
 */
export const queryInsightsEventsRoutes = {
    /**
     * Stage 3 progressive streaming subscription.
     *
     * Conceptually the streaming equivalent of `getQueryInsightsStage3`.
     * Yields a sequence of {@link QueryInsightsStreamEvent}s:
     *  - `status` with `phase: 'connecting'` once setup begins,
     *  - structured domain events fed by
     *    {@link StreamingResponseParser} as fragments arrive (`summary` /
     *    `educational` with cumulative markdown at paragraph boundaries,
     *    `recommendationStarted` / `recommendation` per improvement
     *    item),
     *  - throttled `status` with `phase: 'receiving'` interleaved while
     *    fragments are arriving (carrying `elapsedMs` + cumulative
     *    `charsReceived`),
     *  - `status` with `phase: 'parsing'` once the stream completes,
     *  - any trailing events from `parser.finalize()` (final
     *    `summary`/`educational` with `complete: true` for truncated
     *    streams, plus the `verification` event sourced from the
     *    reconciled `JSON.parse`),
     *  - a single terminal `complete` event carrying model + token
     *    metadata (sourced from {@link streamHandle.completion}, which
     *    runs the canonical full parse and adds those fields).
     *
     * The per-recommendation UI transform that the buffered
     * `getQueryInsightsStage3` does (via `transformAIResponseForUI`) is
     * deliberately NOT applied here — the subscription speaks in domain
     * terms only (plan D7), and WI-9 will move that transform into the
     * webview so it owns the card-component choice.
     *
     * Cancellation: a per-subscription `AbortController` is wired so its
     * signal aborts when either the framework signals stop (`iterator.return()`
     * propagates through this `async function*`, hitting the `finally`) or
     * the upstream `ctx.signal` aborts (forwarded via a listener). Iteration
     * checks the controller's signal between yields and forwards the same
     * signal to `getOptimizationRecommendationsStreaming`, so the underlying
     * LLM call is cancelled in lock step.
     */
    streamStage3: publicProcedureWithTelemetry
        .input(z.object({ requestKey: z.string() }))
        .subscription(async function* ({ ctx, input }): AsyncGenerator<QueryInsightsStreamEvent, void, void> {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            const { sessionId, databaseName, collectionName } = myCtx;
            const { requestKey } = input;

            const startTime = Date.now();
            const elapsed = (): number => Date.now() - startTime;

            // Mirror an AbortSignal off the subscription's `ctx.signal` so we
            // can pass it down to the streaming service and have a single
            // abort source covering both the procedure body and the LLM
            // call. The framework calls `iterator.return()` on stop/dispose
            // which propagates through this `async function*`; we abort the
            // controller in the matching `finally`.
            const abortController = new AbortController();
            const onCtxAbort = (): void => abortController.abort();
            if (myCtx.signal?.aborted) {
                abortController.abort();
            } else {
                myCtx.signal?.addEventListener('abort', onCtxAbort);
            }

            // Dedicated completion-event accumulator (WI-10 / plan §7). The
            // surrounding subscription's auto rpc event fires with ~0
            // duration and no measurements because `trpcToTelemetry` wraps
            // `opts.next()` which resolves at generator-creation time; we
            // flush this accumulator from the `finally` below so it
            // captures success, aborts, and the (rare) error path with
            // their final values + `aborted` flag + wall-clock `durationMs`.
            const completionTelemetry = newCompletionTelemetry();
            let completionFlushed = false;

            const flushCompletionEvent = (): void => {
                if (completionFlushed) return;
                completionFlushed = true;
                completionTelemetry.measurements.durationMs = elapsed();
                completionTelemetry.properties.aborted = abortController.signal.aborted ? 'true' : 'false';
                // Fire-and-forget: the streaming subscription is a push
                // path and we don't have a useful Promise to await on here
                // — errors flushing telemetry are swallowed by
                // callWithTelemetryAndErrorHandling itself.
                void callWithTelemetryAndErrorHandling(STAGE3_COMPLETION_EVENT, (telemetryCtx: IActionContext) => {
                    telemetryCtx.errorHandling.suppressDisplay = true;
                    Object.assign(telemetryCtx.telemetry.properties, completionTelemetry.properties);
                    Object.assign(telemetryCtx.telemetry.measurements, completionTelemetry.measurements);
                });
            };

            try {
                ext.outputChannel.trace(
                    l10n.t('[Query Insights Stage 3 stream] Started for {db}.{collection} (requestKey: {key})', {
                        db: databaseName,
                        collection: collectionName,
                        key: requestKey,
                    }),
                );

                {
                    const connectingEvent: QueryInsightsStreamEvent = {
                        type: 'status',
                        phase: 'connecting',
                        elapsedMs: elapsed(),
                        charsReceived: 0,
                    };
                    ext.outputChannel.trace(
                        l10n.t('[Query Insights Stage 3 stream] [+{ms}ms] yield: {desc} (requestKey: {key})', {
                            ms: elapsed().toString(),
                            desc: describeEvent(connectingEvent),
                            key: requestKey,
                        }),
                    );
                    await delayYield();
                    if (abortController.signal.aborted) {
                        return;
                    }
                    yield connectingEvent;
                }

                // Build the same queryContext + staticAnalysisSummary that
                // the buffered `getQueryInsightsStage3` builds today. The
                // logic is intentionally a near-duplicate; WI-8 will refactor
                // to share a single helper once the incremental parser is in.
                const session: ClusterSession = ClusterSession.getSession(sessionId);

                // Record the platform on the dedicated completion event so
                // it lines up with the buffered procedure's rpc event. Best
                // effort — a metadata fetch failure here must not abort
                // Stage 3 streaming (the buffered procedure has the same
                // contract).
                try {
                    const clusterMetadata = await session.getClient().getClusterMetadata();
                    completionTelemetry.properties.platform = clusterMetadata?.domainInfo_api ?? 'unknown';
                } catch {
                    completionTelemetry.properties.platform = 'unknown';
                }

                const parsedQueryParams = session.getCurrentFindQueryParamsWithObjects();
                const queryObject: QueryObject = {
                    filter: parsedQueryParams.filterObj,
                    sort: parsedQueryParams.sortObj,
                    projection: parsedQueryParams.projectionObj,
                    skip: parsedQueryParams.skip,
                    limit: parsedQueryParams.limit,
                };

                const cachedExecutionPlan = session.getRawExplainOutput(databaseName, collectionName);
                completionTelemetry.properties.hasCachedExecutionPlan = cachedExecutionPlan ? 'true' : 'false';

                let staticAnalysisSummary: string | undefined;
                const stage2Cache = session.getStage2Response();
                if (stage2Cache?.response) {
                    try {
                        staticAnalysisSummary = buildStaticAnalysisSummary(
                            stage2Cache.response,
                            stage2Cache.totalCollectionDocs,
                        );
                        completionTelemetry.properties.hasStaticAnalysisSummary = 'true';
                        completionTelemetry.measurements.staticAnalysisSummaryLength = staticAnalysisSummary.length;
                    } catch (error) {
                        completionTelemetry.properties.hasStaticAnalysisSummary = 'false';
                        completionTelemetry.properties.staticAnalysisSummaryError = 'true';
                        completionTelemetry.properties.staticAnalysisSummaryErrorKind =
                            error instanceof Error ? error.constructor.name : 'unknown';
                        // Non-critical — proceed without the summary just
                        // like the buffered procedure does.
                        ext.outputChannel.error(
                            l10n.t(
                                '[Query Insights Stage 3 stream] Failed to build static analysis summary (requestKey: {key}): {error}',
                                {
                                    key: requestKey,
                                    error: error instanceof Error ? error.message : String(error),
                                },
                            ),
                        );
                    }
                } else {
                    completionTelemetry.properties.hasStaticAnalysisSummary = 'false';
                }

                if (abortController.signal.aborted) {
                    return;
                }

                const aiService = new QueryInsightsAIService();
                const streamHandle = await aiService.getOptimizationRecommendationsStreaming(
                    sessionId,
                    queryObject,
                    databaseName,
                    collectionName,
                    cachedExecutionPlan ?? undefined,
                    abortController.signal,
                    staticAnalysisSummary,
                );

                let charsReceived = 0;
                let lastStatusYieldAt = 0;
                const parser = new StreamingResponseParser();

                for await (const fragment of streamHandle.fragments) {
                    if (abortController.signal.aborted) {
                        return;
                    }
                    charsReceived += fragment.length;

                    // Per-fragment trace to make the LLM's chunking visible
                    // in the output channel — helps decide whether the
                    // parser's paragraph-boundary detection is granular
                    // enough for what the model is actually streaming. The
                    // preview replaces newlines / tabs with their literal
                    // escapes so each fragment fits on one log line.
                    ext.outputChannel.trace(
                        l10n.t(
                            '[Query Insights Stage 3 stream] [+{ms}ms] fragment: len={len}, totalChars={total}, preview={preview} (requestKey: {key})',
                            {
                                ms: elapsed().toString(),
                                len: fragment.length.toString(),
                                total: charsReceived.toString(),
                                preview: previewFragment(fragment),
                                key: requestKey,
                            },
                        ),
                    );

                    // Feed the parser and yield each structured event in
                    // stream order. Structured events are emitted ahead of
                    // the coarse `status: receiving` event for the same
                    // fragment so progressive UI gets first-priority data.
                    const parserEvents = parser.feed(fragment);
                    for (const event of parserEvents) {
                        ext.outputChannel.trace(
                            l10n.t('[Query Insights Stage 3 stream] [+{ms}ms] yield: {desc} (requestKey: {key})', {
                                ms: elapsed().toString(),
                                desc: describeEvent(event),
                                key: requestKey,
                            }),
                        );
                        await delayYield();
                        if (abortController.signal.aborted) {
                            return;
                        }
                        yield event;
                    }

                    const now = elapsed();
                    if (now - lastStatusYieldAt >= STATUS_EVENT_INTERVAL_MS) {
                        lastStatusYieldAt = now;
                        const receivingEvent: QueryInsightsStreamEvent = {
                            type: 'status',
                            phase: 'receiving',
                            elapsedMs: now,
                            charsReceived,
                        };
                        ext.outputChannel.trace(
                            l10n.t('[Query Insights Stage 3 stream] [+{ms}ms] yield: {desc} (requestKey: {key})', {
                                ms: elapsed().toString(),
                                desc: describeEvent(receivingEvent),
                                key: requestKey,
                            }),
                        );
                        await delayYield();
                        if (abortController.signal.aborted) {
                            return;
                        }
                        yield receivingEvent;
                    }
                }

                if (abortController.signal.aborted) {
                    return;
                }

                {
                    const parsingEvent: QueryInsightsStreamEvent = {
                        type: 'status',
                        phase: 'parsing',
                        elapsedMs: elapsed(),
                        charsReceived,
                    };
                    ext.outputChannel.trace(
                        l10n.t('[Query Insights Stage 3 stream] [+{ms}ms] yield: {desc} (requestKey: {key})', {
                            ms: elapsed().toString(),
                            desc: describeEvent(parsingEvent),
                            key: requestKey,
                        }),
                    );
                    await delayYield();
                    if (abortController.signal.aborted) {
                        return;
                    }
                    yield parsingEvent;
                }

                // `streamHandle.completion` runs the canonical full
                // `JSON.parse` and adds model + usage metadata. Our parser
                // runs the same `JSON.parse` inside `finalize()` for its
                // own reconciliation, but `completion` is the source of
                // truth for the model metadata that gets surfaced in the
                // terminal `complete` event below.
                const aiResponse = await streamHandle.completion;

                if (abortController.signal.aborted) {
                    return;
                }

                // Trailing structured events the parser couldn't flush
                // mid-stream (final `summary` / `educational` with
                // `complete: true` for a value still open at end-of-stream,
                // plus the `verification` event sourced from the
                // reconciled `JSON.parse`).
                const finalize = parser.finalize();
                for (const event of finalize.events) {
                    ext.outputChannel.trace(
                        l10n.t('[Query Insights Stage 3 stream] [+{ms}ms] yield: {desc} (requestKey: {key})', {
                            ms: elapsed().toString(),
                            desc: describeEvent(event),
                            key: requestKey,
                        }),
                    );
                    await delayYield();
                    if (abortController.signal.aborted) {
                        return;
                    }
                    yield event;
                }

                // Populate the completion-event accumulator with the
                // recommendation counts + model identity + token usage so
                // the dedicated event carries the same keys the buffered
                // procedure's rpc event used to carry. Done here —
                // unconditional after the LLM call resolves — so abort
                // paths still record platform / staticAnalysisSummary*
                // /  hasCachedExecutionPlan etc., while only successful
                // runs carry the recommendation + usage numbers.
                completionTelemetry.measurements.recommendationCount = aiResponse.improvements.length;
                let actionableRecommendationCount = 0;
                let createRecommendationCount = 0;
                let dropRecommendationCount = 0;
                let modifyRecommendationCount = 0;
                for (const rec of aiResponse.improvements) {
                    switch (rec.action) {
                        case 'create':
                            actionableRecommendationCount++;
                            createRecommendationCount++;
                            break;
                        case 'drop':
                            actionableRecommendationCount++;
                            dropRecommendationCount++;
                            break;
                        case 'modify':
                            actionableRecommendationCount++;
                            modifyRecommendationCount++;
                            break;
                    }
                }
                completionTelemetry.measurements.actionableRecommendationCount = actionableRecommendationCount;
                completionTelemetry.measurements.createRecommendationCount = createRecommendationCount;
                completionTelemetry.measurements.dropRecommendationCount = dropRecommendationCount;
                completionTelemetry.measurements.modifyRecommendationCount = modifyRecommendationCount;

                if (aiResponse.modelId) {
                    completionTelemetry.properties.aiModelDisclosed = aiResponse.modelId;
                }
                if (aiResponse.modelFamily) {
                    completionTelemetry.properties.aiModelFamily = aiResponse.modelFamily;
                }

                if (aiResponse.usage) {
                    const { promptTokens, responseTokens, totalTokens, maxInputTokens, promptUtilizationPct } =
                        aiResponse.usage;
                    if (promptTokens !== undefined) {
                        completionTelemetry.measurements.promptTokens = promptTokens;
                    }
                    if (responseTokens !== undefined) {
                        completionTelemetry.measurements.responseTokens = responseTokens;
                    }
                    if (totalTokens !== undefined) {
                        completionTelemetry.measurements.totalTokens = totalTokens;
                    }
                    if (maxInputTokens !== undefined) {
                        completionTelemetry.measurements.maxInputTokens = maxInputTokens;
                    }
                    if (promptUtilizationPct !== undefined) {
                        completionTelemetry.measurements.promptUtilizationPct = promptUtilizationPct;
                    }
                }

                ext.outputChannel.trace(
                    l10n.t(
                        '[Query Insights Stage 3 stream] Completed: {count} recommendations, {chars} chars in {ms}ms (requestKey: {key})',
                        {
                            count: aiResponse.improvements.length.toString(),
                            chars: charsReceived.toString(),
                            ms: elapsed().toString(),
                            key: requestKey,
                        },
                    ),
                );

                {
                    const completeEvent: QueryInsightsStreamEvent = {
                        type: 'complete',
                        modelDisplayName: aiResponse.modelDisplayName,
                        modelId: aiResponse.modelId,
                        modelFamily: aiResponse.modelFamily,
                        usage: aiResponse.usage,
                    };
                    ext.outputChannel.trace(
                        l10n.t('[Query Insights Stage 3 stream] [+{ms}ms] yield: {desc} (requestKey: {key})', {
                            ms: elapsed().toString(),
                            desc: describeEvent(completeEvent),
                            key: requestKey,
                        }),
                    );
                    await delayYield();
                    if (abortController.signal.aborted) {
                        return;
                    }
                    yield completeEvent;
                }
            } finally {
                myCtx.signal?.removeEventListener('abort', onCtxAbort);
                abortController.abort();
                // Always emit the dedicated completion event — success,
                // abort, or the (rare) thrown-error path. The `aborted`
                // flag + `durationMs` measurement disambiguate outcomes.
                flushCompletionEvent();
            }
        }),
};
