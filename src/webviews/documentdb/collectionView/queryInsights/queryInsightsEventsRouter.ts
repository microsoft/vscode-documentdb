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
import { transformAIResponseForUI } from '../../../../documentdb/queryInsights/transformations';
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
     *  - throttled `status` with `phase: 'receiving'` while LLM fragments
     *    arrive (carrying `elapsedMs` + cumulative `charsReceived`),
     *  - `status` with `phase: 'parsing'` after the stream completes,
     *  - a final single `result` carrying the same payload
     *    {@link QueryInsightsStage3Response} the buffered procedure
     *    returns today.
     *
     * WI-5 deliberately emits only the coarse `status` / `result` subset.
     * WI-7/WI-8 will add per-domain events (`summary`, `educational`,
     * `recommendationStarted`, `recommendation`, `verification`,
     * `complete`) fed by the incremental parser.
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
            const { sessionId, clusterId, databaseName, collectionName } = myCtx;
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

                for await (const fragment of streamHandle.fragments) {
                    if (abortController.signal.aborted) {
                        return;
                    }
                    charsReceived += fragment.length;
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

                const aiRecommendations = await streamHandle.completion;
                const transformed = transformAIResponseForUI(aiRecommendations, {
                    clusterId,
                    databaseName,
                    collectionName,
                });

                if (abortController.signal.aborted) {
                    return;
                }

                ext.outputChannel.trace(
                    l10n.t(
                        '[Query Insights Stage 3 stream] Completed: {count} improvement cards generated, {chars} chars in {ms}ms (requestKey: {key})',
                        {
                            count: transformed.improvementCards.length.toString(),
                            chars: charsReceived.toString(),
                            ms: elapsed().toString(),
                            key: requestKey,
                        },
                    ),
                );

                yield {
                    type: 'result',
                    data: transformed,
                };
            } finally {
                myCtx.signal?.removeEventListener('abort', onCtxAbort);
                abortController.abort();
            }
        }),
};
