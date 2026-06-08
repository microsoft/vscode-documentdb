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
 * via {@link callWithTelemetryAndErrorHandling}. Keys mirror the ones
 * the (now-deleted) buffered `getQueryInsightsStage3` procedure used to
 * record onto `ctx.telemetry` 1:1 (plan §7), so the new event is a
 * drop-in source for any telemetry query that targeted the old keys.
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
     * The streaming Stage 3 entry point (and, since cleanup #2, the
     * only Stage 3 entry point). Yields a sequence of
     * {@link QueryInsightsStreamEvent}s:
     *  - `status` with `phase: 'connecting'` once setup begins,
     *  - `status` with `phase: 'submitted'` once the LLM request has been
     *    dispatched and we begin awaiting the first token,
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
     *    streams),
     *  - a single terminal `complete` event carrying model + token
     *    metadata (sourced from {@link streamHandle.completion}, which
     *    runs the canonical full parse and adds those fields).
     *
     * The per-recommendation UI transform is deliberately NOT applied
     * here — the subscription speaks in domain terms only (plan D7).
     * The webview owns the card-component choice via
     * `utils/createImprovementCard.ts` (WI-9).
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
                //
                // Delivery guarantees (for future maintainers — see PR #711):
                //  - Cancel button / panel close / regenerate mid-stream →
                //    `finally` runs, event is built synchronously and
                //    queued to App Insights. **Reaches the wire.**
                //  - User closes VS Code normally → extension host receives
                //    shutdown signal; telemetry batch flushes during the
                //    grace window. **Usually reaches the wire.**
                //  - Force-quit / OS kill / extension host crash → batched
                //    events lost. **May not reach the wire.**
                // Acceptable for our analytics use case; do NOT promote
                // to at-least-once semantics without first deciding on a
                // backing store + dedupe key.
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
                    if (abortController.signal.aborted) {
                        return;
                    }
                    yield connectingEvent;
                }

                // Build the same queryContext + staticAnalysisSummary that
                // the (now-deleted) buffered Stage 3 procedure used to build.
                // Kept structurally identical so the dedicated completion
                // telemetry (§7) records the same shape of inputs.
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

                // The request has now been dispatched to the model. Surface a
                // `submitted` status so the slim analyzer card can switch off
                // "Connecting…" and start its live elapsed-time counter while
                // we await the model's first token — the longest, output-less
                // part of the wait ("the model is thinking"). Without this the
                // card would sit on "Connecting…" for the entire
                // time-to-first-token gap and read as frozen.
                {
                    const submittedEvent: QueryInsightsStreamEvent = {
                        type: 'status',
                        phase: 'submitted',
                        elapsedMs: elapsed(),
                        charsReceived: 0,
                    };
                    if (abortController.signal.aborted) {
                        return;
                    }
                    yield submittedEvent;
                }

                let charsReceived = 0;
                let lastStatusYieldAt = 0;
                const parser = new StreamingResponseParser();

                // ── Section lifecycle timestamps (elapsed-ms) for
                //    tracing and telemetry. Each is set once on the first
                //    occurrence of the matching event type. ──
                let summaryStartedAt: number | undefined;
                let summaryCompletedAt: number | undefined;
                let educationalStartedAt: number | undefined;
                let educationalCompletedAt: number | undefined;
                let firstRecStartedAt: number | undefined;
                let lastRecCompletedAt: number | undefined;

                for await (const fragment of streamHandle.fragments) {
                    if (abortController.signal.aborted) {
                        return;
                    }
                    charsReceived += fragment.length;

                    // Feed the parser and yield each structured event in
                    // stream order. Structured events are emitted ahead of
                    // the coarse `status: receiving` event for the same
                    // fragment so progressive UI gets first-priority data.
                    const parserEvents = parser.feed(fragment);
                    for (const event of parserEvents) {
                        if (abortController.signal.aborted) {
                            return;
                        }

                        // ── Section lifecycle tracing (committable) ──
                        if (event.type === 'summary') {
                            if (summaryStartedAt === undefined) {
                                summaryStartedAt = elapsed();
                                ext.outputChannel.trace(
                                    `[Query Insights Stage 3 stream] Analysis started streaming at ${summaryStartedAt}ms (requestKey: ${requestKey})`,
                                );
                            }
                            if (event.complete) {
                                summaryCompletedAt = elapsed();
                                ext.outputChannel.trace(
                                    `[Query Insights Stage 3 stream] Analysis ended streaming at ${summaryCompletedAt}ms (requestKey: ${requestKey})`,
                                );
                            }
                        } else if (event.type === 'educational') {
                            if (educationalStartedAt === undefined) {
                                educationalStartedAt = elapsed();
                                ext.outputChannel.trace(
                                    `[Query Insights Stage 3 stream] Educational started streaming at ${educationalStartedAt}ms (requestKey: ${requestKey})`,
                                );
                            }
                            if (event.complete) {
                                educationalCompletedAt = elapsed();
                                ext.outputChannel.trace(
                                    `[Query Insights Stage 3 stream] Educational ended streaming at ${educationalCompletedAt}ms (requestKey: ${requestKey})`,
                                );
                            }
                        } else if (event.type === 'recommendationStarted') {
                            if (firstRecStartedAt === undefined) {
                                firstRecStartedAt = elapsed();
                            }
                            ext.outputChannel.trace(
                                `[Query Insights Stage 3 stream] Card #${event.index} started streaming at ${elapsed()}ms (requestKey: ${requestKey})`,
                            );
                        } else if (event.type === 'recommendation') {
                            lastRecCompletedAt = elapsed();
                            ext.outputChannel.trace(
                                `[Query Insights Stage 3 stream] Card #${event.index} ended streaming at ${elapsed()}ms (requestKey: ${requestKey})`,
                            );
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
                // `complete: true` for a value still open at end-of-stream).
                const finalize = parser.finalize();
                for (const event of finalize.events) {
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

                // Section-level timing measurements so we can see where
                // wall-clock time is spent during the stream.
                if (summaryStartedAt !== undefined) {
                    completionTelemetry.measurements.summaryStartMs = summaryStartedAt;
                }
                if (summaryCompletedAt !== undefined) {
                    completionTelemetry.measurements.summaryEndMs = summaryCompletedAt;
                    if (summaryStartedAt !== undefined) {
                        completionTelemetry.measurements.summaryDurationMs = summaryCompletedAt - summaryStartedAt;
                    }
                }
                if (firstRecStartedAt !== undefined) {
                    completionTelemetry.measurements.firstRecStartMs = firstRecStartedAt;
                }
                if (lastRecCompletedAt !== undefined) {
                    completionTelemetry.measurements.lastRecEndMs = lastRecCompletedAt;
                    if (firstRecStartedAt !== undefined) {
                        completionTelemetry.measurements.recStreamingDurationMs =
                            lastRecCompletedAt - firstRecStartedAt;
                    }
                }
                if (educationalStartedAt !== undefined) {
                    completionTelemetry.measurements.educationalStartMs = educationalStartedAt;
                }
                if (educationalCompletedAt !== undefined) {
                    completionTelemetry.measurements.educationalEndMs = educationalCompletedAt;
                    if (educationalStartedAt !== undefined) {
                        completionTelemetry.measurements.educationalDurationMs =
                            educationalCompletedAt - educationalStartedAt;
                    }
                }
                // Gap between the last recommendation completing and the
                // terminal `complete` event — this is the "tail latency"
                // the user perceives as the AI card lingering.
                if (lastRecCompletedAt !== undefined) {
                    completionTelemetry.measurements.postRecGapMs = elapsed() - lastRecCompletedAt;
                }

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
