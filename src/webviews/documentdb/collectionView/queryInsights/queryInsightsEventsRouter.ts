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

            try {
                ext.outputChannel.trace(
                    l10n.t('[Query Insights Stage 3 stream] Started for {db}.{collection} (requestKey: {key})', {
                        db: databaseName,
                        collection: collectionName,
                        key: requestKey,
                    }),
                );

                yield {
                    type: 'status',
                    phase: 'connecting',
                    elapsedMs: elapsed(),
                    charsReceived: 0,
                };

                // Build the same queryContext + staticAnalysisSummary that
                // the buffered `getQueryInsightsStage3` builds today. The
                // logic is intentionally a near-duplicate; WI-8 will refactor
                // to share a single helper once the incremental parser is in.
                const session: ClusterSession = ClusterSession.getSession(sessionId);
                const parsedQueryParams = session.getCurrentFindQueryParamsWithObjects();
                const queryObject: QueryObject = {
                    filter: parsedQueryParams.filterObj,
                    sort: parsedQueryParams.sortObj,
                    projection: parsedQueryParams.projectionObj,
                    skip: parsedQueryParams.skip,
                    limit: parsedQueryParams.limit,
                };

                const cachedExecutionPlan = session.getRawExplainOutput(databaseName, collectionName);

                let staticAnalysisSummary: string | undefined;
                const stage2Cache = session.getStage2Response();
                if (stage2Cache?.response) {
                    try {
                        staticAnalysisSummary = buildStaticAnalysisSummary(
                            stage2Cache.response,
                            stage2Cache.totalCollectionDocs,
                        );
                    } catch (error) {
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

                    // Feed the parser and yield each structured event in
                    // stream order. Structured events are emitted ahead of
                    // the coarse `status: receiving` event for the same
                    // fragment so progressive UI gets first-priority data.
                    const parserEvents = parser.feed(fragment);
                    for (const event of parserEvents) {
                        if (abortController.signal.aborted) {
                            return;
                        }
                        yield event;
                    }

                    const now = elapsed();
                    if (now - lastStatusYieldAt >= STATUS_EVENT_INTERVAL_MS) {
                        lastStatusYieldAt = now;
                        yield {
                            type: 'status',
                            phase: 'receiving',
                            elapsedMs: now,
                            charsReceived,
                        };
                    }
                }

                if (abortController.signal.aborted) {
                    return;
                }

                yield {
                    type: 'status',
                    phase: 'parsing',
                    elapsedMs: elapsed(),
                    charsReceived,
                };

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
                    if (abortController.signal.aborted) {
                        return;
                    }
                    yield event;
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

                yield {
                    type: 'complete',
                    modelDisplayName: aiResponse.modelDisplayName,
                    modelId: aiResponse.modelId,
                    modelFamily: aiResponse.modelFamily,
                    usage: aiResponse.usage,
                };
            } finally {
                myCtx.signal?.removeEventListener('abort', onCtxAbort);
                abortController.abort();
            }
        }),
};
