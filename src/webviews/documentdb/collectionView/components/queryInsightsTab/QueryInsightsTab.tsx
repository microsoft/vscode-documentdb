/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Insights Tab - UI Mock Implementation
 *
 * This component demonstrates the three-stage query insights workflow:
 * - Stage 1: Initial View (query planner data)
 * - Stage 2: Detailed Execution Analysis (execution stats)
 * - Stage 3: AI-Powered Recommendations (opt-in)
 *
 * Design document: docs/design-documents/performance-advisor.md
 *
 * IMPLEMENTED FEATURES:
 * - Metrics Row (Execution Time, Documents Returned, Keys Examined, Docs Examined)
 * - Query Efficiency Analysis Card (Execution Strategy, Index Used, Ratio, Sort, Rating)
 * - Query Plan Summary (stage flow visualization)
 * - Optimization Opportunities (AI suggestion cards with animations)
 * - Performance Tips Card (dismissible educational content)
 * - Quick Actions (Export and View actions)
 * - Stage progression with loading states
 *
 * PENDING (from design doc, not yet in mock):
 * - Sharded query support (per-shard breakdown)
 * - Rejected plans count display
 * - Detailed per-stage counters
 * - Issue badges (COLLSCAN, Blocked sort, Inefficient, etc.)
 * - Integration with actual explain data
 */

import { Link, MessageBar, MessageBarBody, Skeleton, SkeletonItem, Text, tokens } from '@fluentui/react-components';
import { ChatMailRegular, InfoRegular, SparkleRegular, WarningRegular } from '@fluentui/react-icons';
import { CollapseRelaxed, Fade } from '@fluentui/react-motion-components-preview';
import { useConfiguration } from '@microsoft/vscode-ext-react-webview';
import * as l10n from '@vscode/l10n';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useTrpcClient } from '../../../../_integration/useTrpcClient';
import { CollectionViewContext } from '../../collectionViewContext';
import { type CollectionViewWebviewConfigurationType } from '../../collectionViewController';
import {
    applyStage3Event,
    cancelStage3,
    failStage3,
    stage1Failed,
    stage1Succeeded,
    stage2Failed,
    stage2Succeeded,
    startStage1Load,
    startStage3Load,
} from '../../queryInsightsReducer';
import { createImprovementCardConfig } from '../../utils/createImprovementCard';
import { extractErrorCode } from '../../utils/errorCodeExtractor';
import { CardStack, FeedbackCard, FeedbackDialog, type CardStackItem } from './components';
import { CountMetric } from './components/metricsRow/CountMetric';
import { MetricsRow } from './components/metricsRow/MetricsRow';
import { TimeMetric } from './components/metricsRow/TimeMetric';
import {
    GetPerformanceInsightsCard,
    ImprovementCard,
    ImprovementCardShell,
    MarkdownCard,
    MarkdownCardEx,
    Stage3AnalyzingCard,
} from './components/optimizationCards';
import { QueryPlanSummary } from './components/queryPlanSummary';
import { GenericCell, PerformanceRatingCell, SummaryCard } from './components/summaryCard';
import './queryInsights.scss';
import './QueryInsightsTab.scss';

export const QueryInsightsMain = (): JSX.Element => {
    // The query-insights pipeline (`pipeline` below) is a single
    // discriminated union with these kinds:
    //   idle → s1Loading → s1Error
    //                  ↓
    //                  s2Loading → s2Error
    //                          ↓
    //                          s3Idle → s3Loading → s3Success
    //                                            ↓
    //                                            s3Error / s3Cancelled
    // See `collectionViewContext.ts` for the full type definition and the
    // design rationale (one variable, one truth, cumulative carry-forward
    // of earlier-stage data). All transitions go through pure helpers in
    // `queryInsightsReducer.ts`.

    /**
     * Use the configuration object to access the data passed to the webview at its creation.
     */
    const configuration = useConfiguration<CollectionViewWebviewConfigurationType>();

    const { trpcClient } = useTrpcClient();
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);
    const pipeline = currentContext.queryInsights;

    /** Apply a pipeline transition. Wraps the global setState helper. */
    const dispatch = useCallback(
        (transition: (prev: typeof pipeline) => typeof pipeline): void => {
            setCurrentContext((prev) => ({ ...prev, queryInsights: transition(prev.queryInsights) }));
        },
        [setCurrentContext],
    );

    // ---------- Derived values --------------------------------------------
    //
    // These narrow the union once at the top so the render tree below can
    // read them without re-narrowing every time. None of them allocate.

    /** Stage 1 result (if Stage 1 has succeeded — present from `s2Loading` onward). */
    const stage1Data =
        pipeline.kind === 'idle' || pipeline.kind === 's1Loading' || pipeline.kind === 's1Error'
            ? null
            : pipeline.stage1;

    /** Stage 2 result (if Stage 2 has succeeded — present from `s3Idle` onward). */
    const stage2Data =
        pipeline.kind === 'idle' ||
        pipeline.kind === 's1Loading' ||
        pipeline.kind === 's1Error' ||
        pipeline.kind === 's2Loading' ||
        pipeline.kind === 's2Error'
            ? null
            : pipeline.stage2;

    /** Stage 1 error code (RU-platform branch). Only present when Stage 1 failed. */
    const stage1ErrorCode = pipeline.kind === 's1Error' ? pipeline.code : null;

    /** True while the AI subscription is open. */
    const isStage3Loading = pipeline.kind === 's3Loading';

    /** True from terminal `complete` until a new request / reset. */
    const isStage3Success = pipeline.kind === 's3Success';

    /** Progressive Stage 3 stream snapshot (during loading AND after success). */
    const streaming = pipeline.kind === 's3Loading' || pipeline.kind === 's3Success' ? pipeline.streaming : null;

    /** `requestKey` for keying Stage 3 cards. Carried across `s3Loading → s3Success`. */
    const stage3RequestKey =
        pipeline.kind === 's3Loading' || pipeline.kind === 's3Success' ? pipeline.requestKey : null;

    // ---------- Local-only UI state (NOT part of the pipeline) ------------
    //
    // These are presentation concerns that don't drive the lifecycle:
    //   - showErrorCard: gated by a 1s timer after the user clicks "Get AI"
    //     on top of a query that had an execution error (Stage 2's
    //     `concerns` mention "Query Execution Failed").
    //   - bylineVisible: rAF-deferred fade-in for the post-success
    //     "Powered by …" footer (Fluent <Fade> first-mount workaround).
    //   - feedbackDialogOpen / feedbackSentiment: feedback dialog.
    //   - stage3SubscriptionRef: tRPC unsubscribe handle.
    //   - stage3TipsTimerRef: the 1s timer above.
    //   - displayedErrorsRef: error-toast dedupe (see displayStageError).
    // None of these need to be in context.

    const [showErrorCard, setShowErrorCard] = useState(false);

    /**
     * Subscription handle for the in-flight Stage 3 streaming subscription
     * (`collectionView.queryInsights.streamStage3`). Calling `unsubscribe()`
     * sends `subscription.stop` to the host, which both aborts the
     * per-operation `AbortController` and calls `iterator.return()` on the
     * procedure's async generator — so the underlying LLM call is cancelled
     * in lock step. See packages/vscode-ext-react-webview README.
     */
    const stage3SubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

    /**
     * Timer ref for the delayed 'Query Execution Failed' card surfaced when
     * a Stage 3 request kicks off on top of a query that already failed at
     * Stage 2. The 1s delay lets the user notice the AI request starting
     * before the error card pops in. Reset on cancel / unmount.
     */
    const stage3TipsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    /**
     * Error-toast dedupe. VS Code's `window.showErrorMessage` (called via
     * the `displayErrorMessage` tRPC procedure) pops a notification each
     * time it is invoked, so without dedupe a single error state would
     * produce one toast on first render and another on every re-render
     * triggered by unrelated state changes. We track which error keys
     * have already been surfaced; nothing here needs to drive a render,
     * so a ref is sufficient. Cleared whenever the pipeline returns to
     * `idle` (a fresh query cycle) — see the reset effect below.
     */
    const displayedErrorsRef = useRef<Set<string>>(new Set());

    // Feedback dialog state
    const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
    const [feedbackSentiment, setFeedbackSentiment] = useState<'positive' | 'negative'>('positive');

    /**
     * Two-step visibility for the post-response "Powered by …" byline so it
     * fades in instead of popping in. The byline is gated by Stage 3
     * success + a populated `modelDisplayName`; without this two-step the
     * byline would mount with `visible={true}` and Fluent's Fade (whose
     * `appear` defaults to false) would skip the enter motion — the same
     * first-mount quirk we work around in `AnimatedCardList`. Holding the
     * Fade at `visible={false}` for one render and flipping it on the next
     * `requestAnimationFrame` gives the presence component the real
     * `false → true` transition it needs to animate.
     */
    const shouldShowByline = pipeline.kind === 's3Success' && !!pipeline.model.modelDisplayName;
    const [bylineVisible, setBylineVisible] = useState(false);
    useEffect(() => {
        // Deferred into rAF to satisfy `react-hooks/set-state-in-effect`,
        // which (correctly) forbids synchronous setState in an effect body
        // to avoid cascading renders. One frame's latency on the false flip
        // is invisible — the Fade unmounts via the surrounding conditional
        // render anyway.
        const handle = requestAnimationFrame(() => setBylineVisible(shouldShowByline));
        return () => cancelAnimationFrame(handle);
    }, [shouldShowByline]);

    useEffect(() => {
        return () => {
            if (stage3TipsTimerRef.current !== null) {
                clearTimeout(stage3TipsTimerRef.current);
                stage3TipsTimerRef.current = null;
            }
            // QueryInsightsMain is conditionally mounted by CollectionView
            // (`{selectedTab === 'tab_queryInsights' && <QueryInsightsMain />}`),
            // so leaving this tab unmounts the component. If a Stage 3
            // subscription is in flight at that moment we MUST also move
            // the pipeline out of `s3Loading`; otherwise on re-mount we'd
            // render the "AI is analyzing…" affordance forever because
            // nothing else could ever flip it.
            if (stage3SubscriptionRef.current) {
                stage3SubscriptionRef.current.unsubscribe();
                stage3SubscriptionRef.current = null;
                // `cancelStage3` is a no-op outside `s3Loading`, so this
                // is safe even if `complete` / `onError` landed first.
                dispatch(cancelStage3);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only; dispatch is stable
    }, []);

    /**
     * Display error message to user for the given stage.
     * Dedupes via `displayedErrorsRef` so the same error doesn't fire a
     * fresh VS Code notification on every re-render.
     */
    const displayStageError = useCallback(
        (stage: 1 | 2 | 3, errorMessage: string): void => {
            const errorKey = `stage${stage}-${errorMessage}`;
            if (displayedErrorsRef.current.has(errorKey)) {
                return;
            }
            displayedErrorsRef.current.add(errorKey);

            const stageNames = {
                1: l10n.t('query insights'),
                2: l10n.t('detailed execution analysis'),
                3: l10n.t('AI recommendations'),
            };

            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Failed to load {0}', stageNames[stage]),
                modal: false,
                cause: errorMessage,
            });
        },
        [trpcClient],
    );

    // ---------- Reset the error-dedupe set on a fresh query cycle ---------
    //
    // `displayedErrorsRef` suppresses duplicate notifications for the SAME
    // (stage, message) within one run. Without clearing it, an identical
    // error from a later query (e.g. after Refresh, which resets the
    // pipeline to `idle`) would be permanently swallowed. Clear it whenever
    // the pipeline returns to `idle` so each new run starts with a clean
    // dedupe set (review item M1).
    useEffect(() => {
        if (pipeline.kind === 'idle') {
            displayedErrorsRef.current.clear();
        }
    }, [pipeline.kind]);

    // ---------- Tear down Stage 3 ephemeral state on a fresh query cycle --
    //
    // `CollectionView` resets `queryInsights` to its default (pipeline →
    // `idle`) when a new/refreshed query runs, but THIS tab stays mounted, so
    // the reset only touches the reducer context — never the refs / local
    // state that live here. Mirror the reset by tearing those down when the
    // pipeline returns to `idle` (review items M2 + M3, fixed in one effect
    // because they share the same trigger and teardown):
    //   - M2: unsubscribe the in-flight `streamStage3`, so the old LLM stream
    //     is actually cancelled instead of running invisibly after the user
    //     has lost the Cancel affordance.
    //   - M3: clear the delayed error-card timer and hide the local
    //     'Query Execution Failed' card.
    useEffect(() => {
        if (pipeline.kind !== 'idle') {
            return;
        }
        if (stage3SubscriptionRef.current) {
            stage3SubscriptionRef.current.unsubscribe();
            stage3SubscriptionRef.current = null;
        }
        if (stage3TipsTimerRef.current) {
            clearTimeout(stage3TipsTimerRef.current);
            stage3TipsTimerRef.current = null;
        }
        setShowErrorCard(false);
    }, [pipeline.kind]);

    // ---------- Stage 1 fallback fetch ------------------------------------
    //
    // Multiple entry points kick off Stage 1:
    //   1. Prefetch in CollectionView (background; runs right after a query
    //      is executed, before the user even sees the Query Insights tab).
    //   2. This effect (fallback; runs when the user is already on the tab
    //      and the prefetch hasn't started yet, or the tab is opened cold).
    // They dedupe by checking `pipeline.kind === 'idle'` — the FIRST one to
    // call `startStage1Load` flips the union to `s1Loading`; the second
    // observes `s1Loading` here and short-circuits.
    //
    // IMPORTANT: wait for query execution (isLoading=false) before fetching.
    useEffect(() => {
        if (!currentContext.isLoading && pipeline.kind === 'idle') {
            dispatch(startStage1Load);
            void trpcClient.mongoClusters.collectionView.queryInsights.getQueryInsightsStage1
                .query()
                .then((data) => {
                    dispatch((prev) => stage1Succeeded(prev, data));
                })
                .catch((error) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const errorCode = extractErrorCode(error);
                    dispatch((prev) => stage1Failed(prev, errorMessage, errorCode));
                    // Display error since user is actively on this tab.
                    displayStageError(1, errorMessage);
                });
        }
    }, [currentContext.isLoading, pipeline.kind, trpcClient, dispatch, displayStageError]);

    // ---------- Surface errors as VS Code notifications -------------------
    //
    // Fires when the pipeline lands in any of the error variants. The
    // RU-platform Stage 1 error is suppressed because we render a dedicated
    // friendly card for it instead (see render section below).
    useEffect(() => {
        if (pipeline.kind === 's1Error') {
            if (pipeline.code !== 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU') {
                displayStageError(1, pipeline.message);
            }
        } else if (pipeline.kind === 's2Error') {
            displayStageError(2, pipeline.message);
        } else if (pipeline.kind === 's3Error') {
            displayStageError(3, pipeline.message);
        }
    }, [pipeline, displayStageError]);

    // ---------- Stage 2 auto-start after Stage 1 success ------------------
    //
    // Triggered by the reducer chaining `s1Loading → s2Loading` on
    // success. This effect fires the actual fetch as soon as we observe
    // `s2Loading` and there's no active fetch already.
    //
    // Dedupe: we use a local in-flight ref because `s2Loading` is also
    // the destination state — once `dispatch(stage2Succeeded)` runs, the
    // pipeline leaves `s2Loading`, but we may have already re-rendered in
    // `s2Loading` once before that. The ref prevents the effect from
    // double-firing within that window.
    const stage2InFlightRef = useRef(false);
    useEffect(() => {
        if (pipeline.kind === 's2Loading' && !stage2InFlightRef.current) {
            stage2InFlightRef.current = true;

            // Track start time to ensure minimum duration for better UX.
            const startTime = performance.now();
            const minimumDurationMs = 1500;
            const ensureMinDuration = async (): Promise<void> => {
                const elapsed = performance.now() - startTime;
                if (elapsed < minimumDurationMs) {
                    await new Promise((resolve) => setTimeout(resolve, minimumDurationMs - elapsed));
                }
            };

            void trpcClient.mongoClusters.collectionView.queryInsights.getQueryInsightsStage2
                .query()
                .then(async (data) => {
                    await ensureMinDuration();
                    dispatch((prev) => stage2Succeeded(prev, data));
                })
                .catch(async (error) => {
                    await ensureMinDuration();
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const errorCode = extractErrorCode(error);
                    dispatch((prev) => stage2Failed(prev, errorMessage, errorCode));
                })
                .finally(() => {
                    stage2InFlightRef.current = false;
                });
        }
    }, [pipeline.kind, trpcClient, dispatch]);

    // Debug logging for pipeline state changes
    useEffect(() => {
        console.trace('[QueryInsights] pipeline:', pipeline.kind, pipeline);
    }, [pipeline]);

    // ---------- Derived metric display state ------------------------------
    //
    // Metrics row + efficiency grid:
    //   - undefined: shows loading skeleton
    //   - null     : shows N/A (error or unsupported platform)
    //   - value    : the formatted value
    //
    // Skeleton while Stage 1 or Stage 2 is loading (NOT during Stage 3).
    // N/A only on Stage 1 / Stage 2 errors (Stage 3 errors don't affect metrics).
    const showMetricsSkeleton = pipeline.kind === 's1Loading' || pipeline.kind === 's2Loading';
    const hasMetricsError = pipeline.kind === 's1Error' || pipeline.kind === 's2Error';

    // Value resolution for metric/summary cells. The result drives the cell's
    // placeholder logic (see MetricBase): `null` → "N/A" (unavailable), `undefined`
    // → loading skeleton, any other value → displayed as-is.
    //
    //   - hasMetricsError      → null      (Stage 1/2 failed; data is unavailable)
    //   - skeleton OR no Stage 2 yet → undefined (still computing; show skeleton)
    //   - Stage 2 complete     → the value (or `unavailableValue`/null when absent)
    //
    // Gating on `stage2Data` is what prevents cells from rendering a misleading
    // default (e.g. "None (collection scan)" or "No") before Stage 2 has produced
    // real values.
    const getMetricValue = <T,>(value: T | null | undefined): T | null | undefined => {
        if (hasMetricsError) {
            return null;
        }
        if (showMetricsSkeleton || !stage2Data) {
            return undefined;
        }
        return value ?? null;
    };

    const getCellValue = <T,>(
        accessor: (stage2: NonNullable<typeof stage2Data>) => T | null | undefined,
        unavailableValue: T | null = null,
    ): T | null | undefined => {
        if (hasMetricsError) {
            return null;
        }
        if (showMetricsSkeleton || !stage2Data) {
            return undefined;
        }
        return accessor(stage2Data) ?? unavailableValue;
    };

    const executionTime = getMetricValue(stage2Data?.executionTimeMs);
    const docsReturned = getMetricValue(stage2Data?.documentsReturned);
    const keysExamined = getMetricValue(stage2Data?.totalKeysExamined);
    const docsExamined = getMetricValue(stage2Data?.totalDocsExamined);

    /**
     * Documentation URL for the AI Performance Insights feature itself
     * (overview, what it does, how to use it).
     *
     * Distinct from {@link utilityModelUrl}: this page describes the
     * feature, while the utility-model URL is the cost-disclosure page wired
     * to the "Learn more about the utility model used." link in the
     * cost-neutral disclosure row and to the post-response "Powered by"
     * byline area. Keeping the two URLs separate lets us update each
     * independently.
     */
    const aiInsightsDocsUrl = 'https://learn.microsoft.com/azure/documentdb/index-advisor';
    // aka.ms slug for the utility-model docs — register at https://aka.ms/admin before shipping
    const utilityModelUrl = 'https://aka.ms/vscode-documentdb-copilot-utility-model';

    const handleLearnMore = useCallback((): void => {
        void trpcClient.common.openUrl.mutate({ url: aiInsightsDocsUrl });
    }, [trpcClient]);

    const handleLearnMoreUtilityModel = useCallback((): void => {
        void trpcClient.common.openUrl.mutate({ url: utilityModelUrl });
    }, [trpcClient]);

    const handleGetAISuggestions = (): void => {
        // PRECONDITION (review item M8): this handler only ever runs from the
        // "Get AI Performance Insights" button, which is rendered solely in the
        // `s3Idle` state (and the retry affordances in `s3Error` / `s3Cancelled`)
        // — exactly the states from which `startStage3Load` is a legal
        // transition. So in practice the dispatch below always advances to
        // `s3Loading` and the subscription that follows is never opened against a
        // no-op'd transition. The unconditional subscribe is therefore safe; and
        // even in the theoretical case where the reducer no-ops (e.g. a future
        // caller invokes this mid-stream), the `requestKey` staleness guard in
        // `applyStage3Event` / `failStage3` discards every callback from the
        // orphaned subscription, so the worst case is a wasted request — not a
        // corrupt state. Kept as a documented invariant rather than adding a
        // redundant runtime guard.
        //
        // Mint the staleness token and transition to `s3Loading` in one
        // commit. The reducer is a no-op if the current state isn't
        // `s3Idle` / `s3Error` / `s3Cancelled`, so this is safe even
        // against a double-click while a previous request is still
        // settling.
        const requestKey = crypto.randomUUID();
        dispatch((prev) => startStage3Load(prev, requestKey));

        // Clear any pending error-card timer from a previous request.
        if (stage3TipsTimerRef.current) {
            clearTimeout(stage3TipsTimerRef.current);
            stage3TipsTimerRef.current = null;
        }

        // If Stage 2 detected a query execution error, surface a dedicated
        // 'Query Execution Failed' card after a 1s delay so the user
        // notices the AI request kicked off first.
        const hasExecutionError = !!stage2Data?.concerns?.some((concern) => concern.includes('Query Execution Failed'));
        if (hasExecutionError) {
            stage3TipsTimerRef.current = setTimeout(() => setShowErrorCard(true), 1000);
        }

        // WHY THE requestKey STALENESS GUARD MATTERS — for future maintainers:
        // tRPC subscriptions over the webview message channel are NOT
        // strictly synchronous to `unsubscribe()`. When the user clicks
        // Cancel and immediately clicks "Get AI Insights" again, the
        // sequence is roughly:
        //   1. handleCancelAI() → subscription.unsubscribe() (queues
        //      `subscription.stop` to the host).
        //   2. handleGetAISuggestions() → new subscription opens with a
        //      NEW requestKey, which `startStage3Load` mints above.
        //   3. The host processes `subscription.stop` for #1 → may flush
        //      one or two trailing `onData` / `onError` / `onComplete`
        //      callbacks from the *old* subscription that were already
        //      in flight.
        // The reducer's requestKey check inside `applyStage3Event` and
        // `failStage3` silently discards those late callbacks. DO NOT
        // remove that guard "because the framework promises cleanup".

        // Stop any previous in-flight subscription before starting a new one.
        // `unsubscribe()` sends `subscription.stop` to the host, which both
        // aborts the per-operation AbortController and calls `iterator.return()`
        // on the procedure's async generator — so the LLM call is cancelled
        // in lock step.
        stage3SubscriptionRef.current?.unsubscribe();

        const subscription = trpcClient.mongoClusters.collectionView.queryInsights.streamStage3.subscribe(
            { requestKey },
            {
                onData(event) {
                    dispatch((prev) => applyStage3Event(prev, requestKey, event));
                },
                onError(error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const errorCode = extractErrorCode(error);
                    dispatch((prev) => failStage3(prev, requestKey, errorMessage, errorCode));
                    if (stage3SubscriptionRef.current === subscription) {
                        stage3SubscriptionRef.current = null;
                    }
                },
                onComplete() {
                    // UI state was driven by the terminal `complete` event
                    // in onData; nothing else to do here.
                    if (stage3SubscriptionRef.current === subscription) {
                        stage3SubscriptionRef.current = null;
                    }
                },
            },
        );
        stage3SubscriptionRef.current = subscription;
    };

    const handleCancelAI = (): void => {
        if (stage3TipsTimerRef.current) {
            clearTimeout(stage3TipsTimerRef.current);
            stage3TipsTimerRef.current = null;
        }
        if (stage3SubscriptionRef.current) {
            stage3SubscriptionRef.current.unsubscribe();
            stage3SubscriptionRef.current = null;
        }
        // `cancelStage3` is a no-op outside `s3Loading` (the reducer guards
        // it), so this is safe even against double-cancel.
        dispatch(cancelStage3);
        setShowErrorCard(false);
    };

    const handlePrimaryAction = useCallback(
        async (actionId: string, payload: unknown): Promise<{ success: boolean; message?: string }> => {
            return await trpcClient.mongoClusters.collectionView.queryInsights.executeQueryInsightsAction.mutate({
                actionId,
                payload,
            });
        },
        [],
    );

    const handleSecondaryAction = useCallback(
        async (actionId: string, payload: unknown): Promise<{ success: boolean; message?: string }> => {
            return await trpcClient.mongoClusters.collectionView.queryInsights.executeQueryInsightsAction.mutate({
                actionId,
                payload,
            });
        },
        [],
    );

    // Feedback handlers
    const handleFeedbackClick = (sentiment: 'positive' | 'negative'): void => {
        void trpcClient.common.reportEvent.mutate({
            eventName: 'queryInsightsThumb',
            properties: { sentiment, source: 'feedbackThumb' },
        });
        setFeedbackSentiment(sentiment);
        setFeedbackDialogOpen(true);
    };

    const handleFeedbackSubmit = (feedback: {
        sentiment: 'positive' | 'negative';
        selectedReasons: string[];
    }): Promise<void> => {
        try {
            const reasonProperties = feedback.selectedReasons.reduce(
                (acc, reason) => {
                    acc[reason] = 'true';
                    return acc;
                },
                {} as Record<string, string>,
            );

            void trpcClient.common.reportEvent.mutate({
                eventName: 'queryInsightsFeedback',
                properties: { sentiment: feedback.sentiment, source: 'feedbackDialog', ...reasonProperties },
            });
        } catch (error) {
            console.error('Failed to send feedback:', error);
        }

        return Promise.resolve();
    };

    // ---------- Build the animated card list ------------------------------
    // Memoized so the array keeps a stable reference across renders when none
    // of its inputs change. Without this, a fresh array on every render forces
    // CardStack's `lastNonEmpty` snapshot to re-set each render — harmless but
    // wasteful churn (review item M5/C1).
    //
    // LOAD-BEARING (F10): CardStack uses the store-derived-state pattern
    // (in-render setState guarded by `items !== lastNonEmpty`) for its exit-
    // animation snapshot. That guard relies on `insightCards` being
    // reference-stable across no-op renders. Removing this `useMemo` (or
    // weakening its dependency list) would reintroduce one extra commit per
    // unrelated render — see CardStack.tsx for the other half of the
    // contract. Keep them in sync.
    const insightCards: CardStackItem[] = useMemo<CardStackItem[]>(() => {
        const cards: CardStackItem[] = [];

        // Include requestKey in card keys to force remount on regeneration.
        const keyPrefix = stage3RequestKey ? `${stage3RequestKey}-` : '';

        // Stage 3 cards (analysis, recommendations, educational) all key off
        // the single fact "we are in a Stage 3 lifecycle that has any content
        // to show". That's true while loading and through the success window.
        const stage3CardsActive = isStage3Loading || isStage3Success;

        // Analysis Card — pre-reserves its slot at canonical top position the
        // moment Stage 3 loading starts (before any event arrives), then swaps
        // the placeholder for the streaming content in place. Disappears on
        // cancel/error (both leave `streaming === null`).
        //
        // While LOADING we always pre-reserve the slot (placeholder). Once the
        // stream has SUCCEEDED we only keep the card if it actually carries
        // content — otherwise a stream that never emitted an `analysis` field
        // would leave an empty card stuck on its in-flight "Analyzing…" label
        // (review item H2).
        if (stage3CardsActive) {
            const summarySource = streaming?.summary;
            const hasSummaryContent = (summarySource?.markdown.length ?? 0) > 0;
            if (isStage3Loading || hasSummaryContent) {
                cards.push({
                    key: `${keyPrefix}analysis-card`,
                    // AI content cards use Fade for enter AND leave. These cards grow
                    // (stream/expand) after mount, so a height-collapse animation —
                    // which measures `scrollHeight` once at mount — would clip the
                    // later content. `motion: 'fade'` is opacity-only and never clips.
                    motion: 'fade',
                    component: (
                        <MarkdownCard
                            icon={<SparkleRegular />}
                            title={l10n.t('Query Performance Analysis')}
                            content={summarySource?.markdown ?? ''}
                            inFlight={!summarySource?.complete}
                            inFlightLabel={l10n.t('Analyzing…')}
                        />
                    ),
                });
            }
        }

        // Error Card — shown when query execution failed (gated by 1s timer
        // after Stage 3 click; see `handleGetAISuggestions`).
        if (showErrorCard && stage2Data?.concerns) {
            cards.push({
                key: `${keyPrefix}query-execution-error`,
                motion: 'fade',
                component: (
                    <MarkdownCard
                        title={l10n.t('Query Execution Failed')}
                        icon={<WarningRegular />}
                        showAiDisclaimer={false}
                        content={
                            stage2Data.concerns.join('\n\n') +
                            '\n\n---\n\n' +
                            '**Resolving this execution error should take precedence over performance optimization.** ' +
                            'AI analysis will still run to provide additional insights, but focus on fixing the error first.'
                        }
                    />
                ),
            });
        }

        // Recommendation Cards — three rendering modes (mutually exclusive):
        //   1. Pending placeholder      — Stage 3 loading, no rec events yet.
        //   2. Progressive shells/cards — `recommendationStarted` event(s) arrived.
        //   3. Empty-state              — `complete` landed with zero recs.
        if (stage3CardsActive) {
            const hasStartedRecs = (streaming?.recommendations.length ?? 0) > 0;
            // "Stream completed with zero recommendations" — terminal `complete`
            // event landed (kind === 's3Success') with no items.
            const completedWithNoRecs = isStage3Success && (streaming?.recommendations.length ?? 0) === 0;

            if (hasStartedRecs) {
                // Mode 2 — `streaming` is guaranteed non-null when `hasStartedRecs`.
                streaming!.recommendations.forEach((rec, index) => {
                    const key = `${keyPrefix}rec-${index}`;
                    if (rec === null) {
                        cards.push({ key, motion: 'fade', component: <ImprovementCardShell /> });
                        return;
                    }
                    const config = createImprovementCardConfig(rec, index, {
                        clusterId: configuration.clusterId,
                        databaseName: configuration.databaseName,
                        collectionName: configuration.collectionName,
                    });
                    cards.push({
                        key,
                        motion: 'fade',
                        component: (
                            <ImprovementCard
                                config={config}
                                onPrimaryAction={handlePrimaryAction}
                                onSecondaryAction={handleSecondaryAction}
                            />
                        ),
                    });
                });
            } else if (completedWithNoRecs) {
                // Mode 3 — same React key (`rec-0`) and same component
                // (ImprovementCardShell) as Mode 1, with `mode='empty'` so the
                // swap is in place (icon, title, body change but the card frame
                // stays put).
                cards.push({
                    key: `${keyPrefix}rec-0`,
                    motion: 'fade',
                    component: <ImprovementCardShell mode="empty" />,
                });
            } else {
                // Mode 1 — same key as the first filled shell so Mode 2 swaps
                // in place when the first event arrives.
                cards.push({
                    key: `${keyPrefix}rec-0`,
                    motion: 'fade',
                    component: <ImprovementCardShell />,
                });
            }
        }

        // Educational Markdown Card — same pre-reserve pattern as Analysis Card,
        // including the H2 success-window content guard: pre-reserve while
        // loading, but once succeeded only keep the card if it has content so a
        // missing `educationalContent` field can't strand an empty card on its
        // "Explaining…" label.
        if (stage3CardsActive) {
            const educationalSource = streaming?.educational;
            const hasEducationalContent = (educationalSource?.markdown.length ?? 0) > 0;
            if (isStage3Loading || hasEducationalContent) {
                cards.push({
                    key: `${keyPrefix}understanding-execution`,
                    // AI content card — Fade enter/leave (grows while streaming).
                    motion: 'fade',
                    component: (
                        <MarkdownCard
                            icon={<SparkleRegular />}
                            title={l10n.t('Understanding Your Query Execution Plan')}
                            content={educationalSource?.markdown ?? ''}
                            inFlight={!educationalSource?.complete}
                            inFlightLabel={l10n.t('Explaining…')}
                        />
                    ),
                });
            }
        }

        return cards;
    }, [
        stage3RequestKey,
        isStage3Loading,
        isStage3Success,
        streaming,
        showErrorCard,
        stage2Data,
        configuration,
        handlePrimaryAction,
        handleSecondaryAction,
    ]);

    return (
        <div className="container">
            {/* Content Area - Flexbox two-column layout */}
            <div className="contentArea">
                {/* Left Column: Metrics and Optimization */}
                <div className="leftColumn">
                    {/* Metrics Row */}
                    <MetricsRow>
                        <TimeMetric
                            label={l10n.t('Execution Time')}
                            valueMs={executionTime}
                            tooltipExplanation={l10n.t('Total time taken to execute the query on the server')}
                        />
                        <CountMetric
                            label={l10n.t('Documents Returned')}
                            value={docsReturned}
                            tooltipExplanation={l10n.t('Number of documents returned by the query')}
                        />
                        <CountMetric
                            label={l10n.t('Keys Examined')}
                            value={keysExamined}
                            tooltipExplanation={l10n.t(
                                'Number of index keys scanned during query execution. Lower is better.',
                            )}
                        />
                        <CountMetric
                            label={l10n.t('Documents Examined')}
                            value={docsExamined}
                            tooltipExplanation={l10n.t(
                                'Number of documents scanned to find matching results. Should be close to documents returned for optimal performance.',
                            )}
                        />
                    </MetricsRow>

                    {/* Optimization Opportunities */}
                    <div className="optimizationSection">
                        {/* Section title */}
                        <Text size={400} weight="semibold" className="cardSpacing" style={{ display: 'block' }}>
                            {l10n.t('Optimization Opportunities')}
                        </Text>

                        {/* Platform-specific error card for RU clusters */}
                        {stage1ErrorCode === 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU' && (
                            <MarkdownCardEx
                                title={l10n.t('Query Insights Not Available')}
                                icon={<ChatMailRegular />}
                                showAiDisclaimer={false}
                                content={l10n.t(
                                    'This feature is currently not enabled for RU-based accounts. We recognize that these accounts have unique performance characteristics, and standard optimization patterns from other DocumentDB environments may not be applicable.\n\n' +
                                        'To ensure our recommendations are accurate and genuinely helpful, a specific analysis tailored to the Request Unit (RU) model is required. For this reason, we have disabled the feature for this account type.\n\n' +
                                        '---\n\n' +
                                        '**Interested in performance tooling for RU?**\n\n' +
                                        "We are gathering feedback to shape future tools. If you'd like to share your experience with query optimization on RU accounts or participate in design discussions, your input is highly valuable.\n\n" +
                                        "Feel free to [**start a discussion on GitHub**](https://github.com/microsoft/vscode-documentdb/discussions) or reach out to us directly. We'd love to hear from you!",
                                )}
                            >
                                <MessageBar intent="warning" style={{ marginBottom: '12px' }}>
                                    <MessageBarBody>
                                        {l10n.t(
                                            'Query Insights is not available for Azure Cosmos DB for MongoDB (RU) accounts.',
                                        )}
                                    </MessageBarBody>
                                </MessageBar>
                            </MarkdownCardEx>
                        )}

                        {/* Skeleton — shown only while Stage 1 is loading. */}
                        {pipeline.kind === 's1Loading' && (
                            <Skeleton className="cardSpacing">
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ width: '60%' }} />
                            </Skeleton>
                        )}

                        {/* Stage 3 affordance — ONE persistent CollapseRelaxed
                            wrapper whose inner content swaps between the
                            request card and the slim analyzer card based on
                            `isStage3Loading`. This is deliberately a single
                            wrapper, NOT one-per-card.

                            Why a single persistent wrapper is the reliable
                            shape: a presence node plays its exit reliably only
                            when it has been stably "entered" first. The wrapper
                            below enters ONCE when the affordance area first
                            appears (`s2Loading`/`s3Idle`), stays continuously
                            visible while the inner card swaps request→analyzer
                            (no presence transition happens during the swap — so
                            nothing can race), and exits ONCE at `s3Success`. At
                            that point `sizeExitAtom` measures the element's
                            CURRENT `scrollHeight` (the slim analyzer height), so
                            the collapse is smooth.

                            The earlier two-wrapper version made the analyzer its
                            own `unmountOnExit` wrapper that mounted directly into
                            the visible state at `s3Loading` and had to exit one
                            render later at `s3Success`. A presence node that
                            mounts-already-visible (default `appear=false`) and
                            must immediately exit has no clean entered reference
                            and frequently drops its exit — leaving the analyzer
                            stuck on screen. It also overlapped the request card
                            for ~400 ms on click. Both symptoms are gone with the
                            single wrapper.

                            The flash-on-`{2,'success'}` bug noted historically
                            is also structurally impossible here: Stage 2 success
                            has its own discriminated `kind` (`s3Idle`), distinct
                            from `s3Success`.

                            Why collapse and not Fade: this wrapper now holds the
                            slim analyzer card on the way out, and Fade would
                            keep that height through the opacity transition,
                            jumping the layout when `unmountOnExit` finally tears
                            the element down. The height collapse keeps the
                            cards below gliding up smoothly.

                            Trade-off: the request→analyzer swap is an instant
                            height change (tall → slim) rather than an animated
                            one, because CollapseRelaxed only animates on a
                            `visible` toggle, not on inner content change. This
                            is the intentionally-deprioritized "middle"
                            transition; the enter and exit (which matter most)
                            are both animated. */}
                        <CollapseRelaxed
                            visible={
                                pipeline.kind === 's2Loading' ||
                                pipeline.kind === 's2Error' ||
                                pipeline.kind === 's3Idle' ||
                                pipeline.kind === 's3Loading' ||
                                pipeline.kind === 's3Error' ||
                                pipeline.kind === 's3Cancelled'
                            }
                            unmountOnExit
                        >
                            {/* Stable single child so the presence wrapper keeps
                                one continuous element identity (and a clean
                                entered reference) across the inner swap.

                                FUTURE RESEARCH — animating the request→analyzer
                                swap (the "middle" transition). Today the swap is
                                an instant height jump because the OUTER
                                CollapseRelaxed only animates on a `visible`
                                toggle, and we deliberately keep it visible across
                                the swap so the enter/exit stay reliable. To make
                                the swap itself animate, the height change has to
                                be driven from INSIDE this stable child, without
                                toggling the outer wrapper. Options, roughly in
                                increasing effort:
                                  1. Crossfade only (cheap): wrap each branch in
                                     <Fade> with absolute positioning so they
                                     overlap during the swap. Smooths opacity but
                                     NOT height — the container still jumps. Low
                                     value on its own given the large height delta
                                     (tall request card → slim analyzer).
                                  2. Animate this child's own height: give this
                                     <div> a measured `maxHeight`/`height`
                                     transition (e.g. a ResizeObserver or
                                     react-motion size atom scoped to the child)
                                     so request→analyzer eases between the two
                                     measured heights while the outer wrapper
                                     stays put. This is the real fix for the jump;
                                     watch for clipping of the analyzer's spinner
                                     row mid-transition (overflow:hidden during
                                     the height tween).
                                  3. A dedicated swap presence component: a small
                                     createPresenceComponent that takes the
                                     OUTGOING and INCOMING nodes and animates
                                     height+opacity between them in one motion
                                     (similar in spirit to AnimatedCardList's
                                     manual enter/exit bookkeeping, but for an
                                     in-place 1↔1 replace rather than a list).
                                     Most polished, most code; only pursue if the
                                     instant jump tests poorly with users.
                                Keep the constraint in mind: whatever is chosen
                                must NOT toggle the outer wrapper's `visible`,
                                or the stuck-exit race this fix removed comes
                                back. Prototype against `prefers-reduced-motion`
                                too — the jump is acceptable (arguably preferable)
                                in that mode. */}
                            <div>
                                {/* Show the analyzer during BOTH `s3Loading` and
                                    `s3Success`. At `s3Success` the wrapper's
                                    `visible` has flipped to false, so it is
                                    collapsing out — and we want the content that
                                    collapses away to be the analyzer, not the
                                    request card. Gating this branch on
                                    `isStage3Loading` alone made the request card
                                    render for the duration of the exit collapse,
                                    which read as a brief flash of "Get AI
                                    analysis" content right before it animated
                                    away. Including `isStage3Success` keeps the
                                    analyzer on screen through the exit and also
                                    makes the "measures the slim analyzer height"
                                    claim above actually hold. */}
                                {isStage3Loading || isStage3Success ? (
                                    <Stage3AnalyzingCard
                                        onCancel={handleCancelAI}
                                        phase={streaming?.phase}
                                        canCancel={isStage3Loading}
                                    />
                                ) : (
                                    <GetPerformanceInsightsCard
                                        className="cardSpacing"
                                        bodyText={
                                            stage2Data?.efficiencyAnalysis.performanceRating.score === 'excellent'
                                                ? l10n.t(
                                                      'Your query is performing well. You can still use the AI-powered analysis to get a detailed explanation of the query execution, review the indexing, and explore if further optimizations are possible.',
                                                  )
                                                : l10n.t(
                                                      'Get personalized recommendations to optimize your query performance. AI will analyze your cluster configuration, index usage, execution plan, and more to suggest specific improvements.',
                                                  )
                                        }
                                        // `isLoading` drives the in-card spinner
                                        // only. The analyzer card owns the
                                        // loading visuals now, so this branch
                                        // (rendered only when NOT loading) keeps
                                        // it false.
                                        isLoading={false}
                                        enabled={
                                            pipeline.kind === 's3Idle' ||
                                            pipeline.kind === 's3Error' ||
                                            pipeline.kind === 's3Cancelled'
                                        }
                                        errorMessage={pipeline.kind === 's3Error' ? pipeline.message : undefined}
                                        onGetInsights={handleGetAISuggestions}
                                        onLearnMore={handleLearnMore}
                                        onCancel={handleCancelAI}
                                        onLearnMoreUtilityModel={handleLearnMoreUtilityModel}
                                    />
                                )}
                            </div>
                        </CollapseRelaxed>

                        {/* CardStack for AI suggestions and tips. Every insight card is
                            pushed with `motion: 'fade'` because these cards stream and grow
                            after mount (MarkdownCard, ImprovementCardShell); CardStack's
                            default Collapse measures `scrollHeight` once at enter and would
                            clip late-arriving content. See per-item `motion` opt-out on
                            CardStackItem.

                            `visible` is driven by "is there anything to show" so the outer
                            wrapper performs a group fade-out when Stage 3 clears
                            (cancel / reset / error). Without this the cards would simply
                            unmount on the React commit that removes them from `items`,
                            which reads as an abrupt disappearance. */}
                        <CardStack items={insightCards} visible={insightCards.length > 0} />

                        {/* Post-response "Powered by" byline.
                            Mirrors the (i) + cost-neutral disclosure shown in the pre-invocation
                            card. Token usage measurements are intentionally NOT rendered here:
                            they live in the trace output channel and in telemetry only. Cost
                            (credits) is not surfaced because the stable VS Code Language Model
                            API does not expose pricing data; the extension stays on stable APIs
                            and avoids the proposed `languageModelPricing` API by design.

                            Wrapped in `Fade` so it slides in over the same window the
                            GetPerformanceInsightsCard above is collapsing out — without the
                            wrap the byline used to pop in on the same React commit as the
                            collapse started, which read as two unrelated motions stacked on
                            top of each other. The `bylineVisible` state up top handles the
                            two-step `false → true` flip Fluent needs to actually animate
                            (see `pendingEnter` in AnimatedCardList for the same pattern). */}
                        {shouldShowByline && (
                            <Fade visible={bylineVisible}>
                                <div
                                    className="cardSpacing"
                                    style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: '6px',
                                        color: tokens.colorNeutralForeground3,
                                    }}
                                >
                                    <InfoRegular aria-hidden="true" style={{ flexShrink: 0, marginTop: '2px' }} />
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                            {l10n.t('No additional cost for most GitHub Copilot subscribers.')}{' '}
                                            <Link
                                                appearance="subtle"
                                                onClick={handleLearnMoreUtilityModel}
                                                inline
                                                style={{
                                                    fontSize: tokens.fontSizeBase200,
                                                    lineHeight: tokens.lineHeightBase200,
                                                }}
                                            >
                                                {l10n.t('Learn more about the utility model used.')}
                                            </Link>
                                        </Text>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                            {(() => {
                                                // Guaranteed `s3Success` by `shouldShowByline`
                                                // (see useEffect above); the non-null assertion
                                                // keeps l10n.t's string-only overload happy.
                                                const modelName =
                                                    pipeline.kind === 's3Success'
                                                        ? pipeline.model.modelDisplayName!
                                                        : '';
                                                const durationMs =
                                                    pipeline.kind === 's3Success'
                                                        ? pipeline.model.durationMs
                                                        : undefined;
                                                if (durationMs !== undefined) {
                                                    const seconds = (durationMs / 1000).toFixed(1);
                                                    return l10n.t(
                                                        'Powered by {0} via GitHub Copilot · {1}s',
                                                        modelName,
                                                        seconds,
                                                    );
                                                }
                                                return l10n.t('Powered by {0} via GitHub Copilot', modelName);
                                            })()}
                                        </Text>
                                    </div>
                                </div>
                            </Fade>
                        )}
                    </div>
                </div>

                {/* Right Column: Efficiency Analysis, Query Plan, Quick Actions */}
                <div className="rightColumn">
                    {/* Query Efficiency Analysis */}
                    <SummaryCard title={l10n.t('Query Efficiency Analysis')}>
                        <GenericCell
                            label={l10n.t('Selectivity')}
                            value={getCellValue((stage2) => stage2.efficiencyAnalysis.selectivity)}
                            loadingPlaceholder="skeleton"
                            tooltipExplanation={(() => {
                                const selectivity = stage2Data?.efficiencyAnalysis.selectivity;
                                if (!selectivity) {
                                    return l10n.t(
                                        'The percentage of your collection this query returns. Could not be determined for this query.',
                                    );
                                }
                                const pct = parseFloat(selectivity);
                                if (pct < 1) {
                                    return l10n.t(
                                        'This query returns {0} of your collection.\n\nThis is highly selective: only a small fraction of documents pass the filter. The database does minimal work to produce results.',
                                        selectivity,
                                    );
                                } else if (pct < 20) {
                                    return l10n.t(
                                        'This query returns {0} of your collection.\n\nThis is a reasonable level of selectivity. The filter narrows results to a manageable portion of the data.',
                                        selectivity,
                                    );
                                } else {
                                    return l10n.t(
                                        'This query returns {0} of your collection.\n\nThis is a broad query that returns a large portion of the data. Consider adding more specific filters to narrow the results.',
                                        selectivity,
                                    );
                                }
                            })()}
                        />
                        <GenericCell
                            label={l10n.t('Index Used')}
                            value={getCellValue(
                                (stage2) => stage2.efficiencyAnalysis.indexUsed,
                                l10n.t('None (collection scan)'),
                            )}
                            loadingPlaceholder="skeleton"
                            tooltipExplanation={(() => {
                                const indexUsed = stage2Data?.efficiencyAnalysis.indexUsed;
                                if (indexUsed) {
                                    return l10n.t(
                                        'The name of the index used to look up matching documents.\n\nThe database used this index to locate matching documents directly, without scanning the entire collection.',
                                    );
                                }
                                return l10n.t(
                                    'No index was used for this query.\n\nThe database scanned every document in the collection to find matches. Adding an index on the filtered fields would allow the database to locate documents directly.',
                                );
                            })()}
                        />
                        <GenericCell
                            label={l10n.t('Fetch Overhead')}
                            value={getCellValue((stage2) => stage2.efficiencyAnalysis.fetchOverhead)}
                            loadingPlaceholder="skeleton"
                            tooltipExplanation={(() => {
                                const kind = stage2Data?.efficiencyAnalysis.fetchOverheadKind ?? 'directFetch';
                                if (kind === 'covered') {
                                    return l10n.t(
                                        'The database retrieved your documents using a covered query.\n\nAll the data your query needs was already stored in the index. The database did not need to load the actual documents, making this the most efficient retrieval method.',
                                    );
                                } else if (kind === 'collectionScan') {
                                    return l10n.t(
                                        'The database retrieved your documents using a collection scan.\n\nEvery document was read sequentially because no supporting index was available. This is the slowest retrieval method for filtered queries.',
                                    );
                                } else if (kind === 'multikey') {
                                    return l10n.t(
                                        'The database retrieved your documents through a multikey index.\n\nAn index on an array field was used. Each array element creates a separate index entry, so the database examined more index keys than documents. This is expected for array indexes but adds overhead.',
                                    );
                                } else if (kind === 'noMatches') {
                                    return l10n.t(
                                        'The query returned no documents.\n\nNo document fetching was needed because no documents matched the filter criteria.',
                                    );
                                }
                                // Default: "Direct fetch"
                                return l10n.t(
                                    'The database retrieved your documents using a direct fetch.\n\nThe index pointed to matching documents, which were then loaded from storage. This is the normal, efficient path.',
                                );
                            })()}
                        />
                        <GenericCell
                            label={l10n.t('In-Memory Sort')}
                            value={getCellValue((stage2) =>
                                stage2.efficiencyAnalysis.hasInMemorySort ? l10n.t('Yes') : l10n.t('No'),
                            )}
                            loadingPlaceholder="skeleton"
                            tooltipExplanation={(() => {
                                const hasSort = stage2Data?.efficiencyAnalysis.hasInMemorySort ?? false;
                                if (hasSort) {
                                    return l10n.t(
                                        'The database sorted results in memory.\n\nThis uses RAM and can fail for very large result sets. Consider adding a compound index that includes your sort fields to let the database skip this step.',
                                    );
                                }
                                return l10n.t(
                                    'The database did not sort data in memory.\n\nResults came back in the right order naturally, either from the index or because no sort was requested.',
                                );
                            })()}
                        />
                        <PerformanceRatingCell
                            label={l10n.t('Performance Rating')}
                            rating={
                                hasMetricsError
                                    ? null
                                    : showMetricsSkeleton
                                      ? undefined
                                      : stage2Data?.efficiencyAnalysis.performanceRating.score
                            }
                            diagnostics={
                                hasMetricsError || showMetricsSkeleton
                                    ? undefined
                                    : stage2Data?.efficiencyAnalysis.performanceRating.diagnostics
                            }
                            visible={!hasMetricsError && !showMetricsSkeleton && !!stage2Data}
                        />
                    </SummaryCard>

                    {/* Query Plan Summary */}
                    <QueryPlanSummary
                        stage1Data={stage1Data}
                        stage2Data={stage2Data}
                        stage1Loading={pipeline.kind === 's1Loading'}
                        stage2Loading={pipeline.kind === 's2Loading'}
                        hasError={hasMetricsError}
                    />

                    {/* Feedback Card - hidden for RU accounts where Query Insights is not available */}
                    {configuration.feedbackSignalsEnabled &&
                        stage1ErrorCode !== 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU' && (
                            <FeedbackCard onFeedback={handleFeedbackClick} />
                        )}
                </div>
            </div>

            {/* Feedback Dialog */}
            <FeedbackDialog
                open={feedbackDialogOpen}
                onClose={() => setFeedbackDialogOpen(false)}
                sentiment={feedbackSentiment}
                onSubmit={handleFeedbackSubmit}
            />
        </div>
    );
};
