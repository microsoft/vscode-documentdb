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
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import { useConfiguration } from '@microsoft/vscode-ext-react-webview';
import * as l10n from '@vscode/l10n';
import { useCallback, useContext, useEffect, useRef, useState, type JSX } from 'react';
import { type AIIndexRecommendation } from '../../../../../services/ai/types';
import { useTrpcClient } from '../../../../_integration/useTrpcClient';
import { CollectionViewContext, type QueryInsightsStreamingState } from '../../collectionViewContext';
import { type CollectionViewWebviewConfigurationType } from '../../collectionViewController';
import {
    type AnalysisCard as AnalysisCardConfig,
    type ImprovementCard as ImprovementCardConfig,
    type QueryInsightsStage3Response,
} from '../../types/queryInsights';
import { type QueryInsightsStreamEvent } from '../../types/queryInsightsStream';
import { createImprovementCardConfig } from '../../utils/createImprovementCard';
import { extractErrorCode } from '../../utils/errorCodeExtractor';
import { AnimatedCardList, FeedbackCard, FeedbackDialog, type AnimatedCardItem } from './components';
import { CountMetric } from './components/metricsRow/CountMetric';
import { MetricsRow } from './components/metricsRow/MetricsRow';
import { TimeMetric } from './components/metricsRow/TimeMetric';
import {
    GetPerformanceInsightsCard,
    ImprovementCard,
    ImprovementCardShell,
    MarkdownCard,
    MarkdownCardEx,
    TipsCard,
} from './components/optimizationCards';
import { QueryPlanSummary } from './components/queryPlanSummary';
import { GenericCell, PerformanceRatingCell, SummaryCard } from './components/summaryCard';
import './queryInsights.scss';
import './QueryInsightsTab.scss';

/**
 * Materialize a fully-formed {@link QueryInsightsStage3Response} from the
 * per-stream {@link QueryInsightsStreamingState} + the terminal `complete`
 * event. Called once on `complete` so byline / collapse / "powered by"
 * render paths that read `stage3Data` keep working unchanged.
 *
 * `recommendations` may contain `null` entries (a `recommendationStarted`
 * event with no matching `recommendation` — e.g. if the LLM produced a
 * malformed item that the parser silently skipped); those are filtered
 * out so the snapshot is dense. WI-9.
 */
function synthesizeStage3Data(
    streaming: QueryInsightsStreamingState,
    completeEvent: Extract<QueryInsightsStreamEvent, { type: 'complete' }>,
    configuration: Pick<CollectionViewWebviewConfigurationType, 'clusterId' | 'databaseName' | 'collectionName'>,
): QueryInsightsStage3Response {
    const analysisCard: AnalysisCardConfig = {
        type: 'analysis',
        content: streaming.summary?.markdown ?? l10n.t('No analysis provided.'),
    };

    const improvementCards: ImprovementCardConfig[] = streaming.recommendations
        .filter((rec): rec is AIIndexRecommendation => rec !== null)
        .map((rec, index) =>
            createImprovementCardConfig(rec, index, {
                clusterId: configuration.clusterId,
                databaseName: configuration.databaseName,
                collectionName: configuration.collectionName,
            }),
        );

    return {
        analysisCard,
        improvementCards,
        // verificationSteps is intentionally omitted — nothing in the UI
        // surfaces verification items today. See QueryInsightsStreamingState
        // for the rationale (mirrored on the reducer side).
        verificationSteps: '',
        educationalContent: streaming.educational?.markdown,
        modelId: completeEvent.modelId,
        modelFamily: completeEvent.modelFamily,
        modelDisplayName: completeEvent.modelDisplayName,
        usage: completeEvent.usage,
    };
}

export const QueryInsightsMain = (): JSX.Element => {
    // Stage management:
    // Stage 1: Initial View (cheap data + query plan from explain("queryPlanner"))
    // Stage 2: Detailed Execution Analysis (from explain("executionStats"))
    // Stage 3: AI-Powered Recommendations (opt-in)
    // See: docs/design-documents/performance-advisor.md

    /**
     * Use the configuration object to access the data passed to the webview at its creation.
     */
    const configuration = useConfiguration<CollectionViewWebviewConfigurationType>();

    const { trpcClient } = useTrpcClient();
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);
    const { queryInsights: queryInsightsState } = currentContext;

    /**
     * Helper to update queryInsights state within the CollectionViewContext.
     * Mimics React's setState API with support for both direct values and updater functions.
     *
     * Instead of writing:
     *   setCurrentContext(prev => ({ ...prev, queryInsights: { ...prev.queryInsights, stage1Data: data } }))
     *
     * You can write:
     *   setQueryInsightsStateHelper(prev => ({ ...prev, stage1Data: data }))
     */
    const setQueryInsightsStateHelper = useCallback(
        (
            updater:
                | typeof currentContext.queryInsights
                | ((prev: typeof currentContext.queryInsights) => typeof currentContext.queryInsights),
        ): void => {
            setCurrentContext((prev) => ({
                ...prev,
                queryInsights: typeof updater === 'function' ? updater(prev.queryInsights) : updater,
            }));
        },
        [setCurrentContext],
    );

    /**
     * Use the explicit stage from state instead of deriving it
     */
    const currentStage = queryInsightsState.currentStage;

    const [showTipsCard, setShowTipsCard] = useState(false);
    const [isTipsCardDismissed, setIsTipsCardDismissed] = useState(false);
    const [showErrorCard, setShowErrorCard] = useState(false);

    // Subscription handle for the in-flight Stage 3 streaming subscription
    // (collectionView.queryInsights.streamStage3). Calling `unsubscribe()`
    // sends `subscription.stop` to the host, which both aborts the
    // per-operation `AbortController` and calls `iterator.return()` on the
    // procedure's async generator — so the underlying LLM call is cancelled
    // in lock step. See packages/vscode-ext-react-webview README.
    const stage3SubscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

    // Timer ref for the delayed tips/error card shown during Stage 3 loading
    const stage3TipsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Feedback dialog state
    const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
    const [feedbackSentiment, setFeedbackSentiment] = useState<'positive' | 'negative'>('positive');

    useEffect(() => {
        return () => {
            if (stage3TipsTimerRef.current !== null) {
                clearTimeout(stage3TipsTimerRef.current);
                stage3TipsTimerRef.current = null;
            }
            if (stage3SubscriptionRef.current) {
                stage3SubscriptionRef.current.unsubscribe();
                stage3SubscriptionRef.current = null;
            }
        };
    }, []);

    /**
     * Display error message to user for the given stage
     * Only displays once per error state to avoid duplicate toasts
     * Uses the setState updater function to read fresh state and update atomically
     */
    const displayStageError = useCallback(
        (stage: 1 | 2 | 3, errorMessage: string): void => {
            const errorKey = `stage${stage}-${errorMessage}`;

            // Use updater function to check and update state atomically with fresh data
            let shouldDisplay = false;
            setQueryInsightsStateHelper((prev) => {
                if (prev.displayedErrors.includes(errorKey)) {
                    return prev; // Already displayed this error
                }
                shouldDisplay = true;
                return {
                    ...prev,
                    displayedErrors: [...prev.displayedErrors, errorKey],
                };
            });

            if (!shouldDisplay) {
                return;
            }

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
        [trpcClient, setQueryInsightsStateHelper],
    );

    /**
     * Stage transition helper - handles moving between stages and cleaning up state
     * Rules:
     * - Can transition from 1 → 2 → 3
     * - Can transition from any stage back to 1 (query re-run)
     * - When transitioning to stage 1, clear all data from stages 2 and 3
     * - When transitioning to stage 2, clear data from stage 3
     * - Reset UI-specific flags when transitioning to new phases
     */
    const transitionToStage = useCallback(
        (phase: 1 | 2 | 3, status: 'loading' | 'success' | 'error' | 'cancelled'): void => {
            console.log(`[Query Insights] Stage ${currentStage.phase}/${currentStage.status} → ${phase}/${status}`);

            setQueryInsightsStateHelper((prev) => {
                // Clear displayed errors tracking when entering loading state
                // This allows error toasts to be shown again if the same error occurs on retry
                const shouldClearErrors = status === 'loading';
                const newState = {
                    ...prev,
                    displayedErrors: shouldClearErrors ? [] : prev.displayedErrors,
                };

                // Update current stage
                newState.currentStage = { phase, status };

                // Reset dependent stages when going back to earlier phases
                if (phase === 1) {
                    // Reset everything when starting fresh
                    newState.stage2Data = null;
                    newState.stage2ErrorMessage = null;
                    newState.stage2ErrorCode = null;
                    newState.stage2Promise = null;

                    newState.stage3Data = null;
                    newState.stage3ErrorMessage = null;
                    newState.stage3ErrorCode = null;
                    newState.stage3RequestKey = null;
                    newState.stage3Streaming = null;

                    // Reset UI flags
                    setShowTipsCard(false);
                    setIsTipsCardDismissed(false);
                    setShowErrorCard(false);
                } else if (phase === 2 && status === 'loading') {
                    // When entering stage 2 loading, clear stage 3 data only
                    newState.stage3Data = null;
                    newState.stage3ErrorMessage = null;
                    newState.stage3ErrorCode = null;
                    newState.stage3RequestKey = null;
                    newState.stage3Streaming = null;

                    // Don't reset UI flags here - they should persist for the same query session
                    // They will be reset by phase 1 or phase 3 loading transitions
                } else if (phase === 3 && status === 'loading') {
                    // Starting a new Stage-3 request: clear any leftover
                    // streaming snapshot from a previous run so the
                    // progressive render path starts from a clean slate.
                    newState.stage3Data = null;
                    newState.stage3Streaming = null;
                    // Reset UI flags when starting new AI request
                    setShowTipsCard(false);
                    setIsTipsCardDismissed(false);
                    setShowErrorCard(false);
                }

                return newState;
            });
        },
        [currentStage.phase, currentStage.status, setQueryInsightsStateHelper],
    );

    // Stage 1: Load when needed (fallback for when prefetch didn't run or when tab is already active)
    //
    // This effect serves multiple purposes:
    // 1. **Fallback for prefetch failures**: If the background prefetch in CollectionView.tsx fails,
    //    this ensures data loads when user switches to Query Insights tab
    // 2. **Query Insights tab already active**: If user is already on this tab when they run a query,
    //    the prefetch won't help - we need to fetch here
    // 3. **Cold start**: First time opening the tab with no prior query execution
    //
    // Protection against redundant fetch:
    // - Prefetch now sets currentStage.status to 'success' or 'error' when complete
    // - This effect only runs when status === 'loading' (initial state after query execution)
    // - If prefetch succeeded: stage1Data exists → this effect won't run
    // - If prefetch failed: currentStage.status === 'error' → this effect won't run
    // - Only runs when: status === 'loading' AND no data AND no in-flight promise
    //
    // IMPORTANT: Wait for query execution to complete (isLoading=false) before fetching insights
    useEffect(() => {
        if (
            !currentContext.isLoading &&
            currentStage.phase === 1 &&
            currentStage.status === 'loading' &&
            !queryInsightsState.stage1Data &&
            !queryInsightsState.stage1Promise
        ) {
            // Query parameters are now retrieved from ClusterSession - no need to pass them
            const promise = trpcClient.mongoClusters.collectionView.queryInsights.getQueryInsightsStage1
                .query()
                .then((data) => {
                    setQueryInsightsStateHelper((prev) => ({
                        ...prev,
                        stage1Data: data,
                        stage1Promise: null,
                    }));
                    transitionToStage(1, 'success');
                    return data;
                })
                .catch((error) => {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const errorCode = extractErrorCode(error);

                    setQueryInsightsStateHelper((prev) => ({
                        ...prev,
                        stage1ErrorMessage: errorMessage,
                        stage1ErrorCode: errorCode,
                        stage1Promise: null,
                    }));
                    transitionToStage(1, 'error');
                    // Display error message since user is actively on this tab
                    displayStageError(1, errorMessage);
                    // Return undefined to satisfy TypeScript without creating unhandled rejection
                    return undefined as never;
                });

            setQueryInsightsStateHelper((prev) => ({ ...prev, stage1Promise: promise }));
        }
    }, [
        currentContext.isLoading,
        currentStage.phase,
        currentStage.status,
        queryInsightsState.stage1Data,
        queryInsightsState.stage1Promise,
        trpcClient,
        setQueryInsightsStateHelper,
        transitionToStage,
        displayStageError,
    ]);

    // Display errors when user switches to Query Insights tab or when error state changes
    // This handles both mount (switching to tab with existing error) and updates (new errors)
    useEffect(() => {
        if (currentStage.status === 'error') {
            // Display error for the current stage
            // Skip displaying error dialog for RU platform - we show a friendly card instead
            if (currentStage.phase === 1 && queryInsightsState.stage1ErrorMessage) {
                if (queryInsightsState.stage1ErrorCode !== 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU') {
                    displayStageError(1, queryInsightsState.stage1ErrorMessage);
                }
            } else if (currentStage.phase === 2 && queryInsightsState.stage2ErrorMessage) {
                displayStageError(2, queryInsightsState.stage2ErrorMessage);
            } else if (currentStage.phase === 3 && queryInsightsState.stage3ErrorMessage) {
                displayStageError(3, queryInsightsState.stage3ErrorMessage);
            }
        }
    }, [
        currentStage.status,
        currentStage.phase,
        queryInsightsState.stage1ErrorMessage,
        queryInsightsState.stage1ErrorCode,
        queryInsightsState.stage2ErrorMessage,
        queryInsightsState.stage2ErrorCode,
        queryInsightsState.stage3ErrorMessage,
        queryInsightsState.stage3ErrorCode,
        displayStageError,
    ]);

    // Stage 2: Auto-start after Stage 1 completes successfully
    useEffect(() => {
        if (
            currentStage.phase === 1 &&
            currentStage.status === 'success' &&
            queryInsightsState.stage1Data &&
            !queryInsightsState.stage2Data &&
            !queryInsightsState.stage2Promise
        ) {
            // Transition to Stage 2 loading
            transitionToStage(2, 'loading');

            // Track start time to ensure minimum duration for better UX
            const startTime = performance.now();

            // Query parameters are now retrieved from ClusterSession - no need to pass them
            const promise = trpcClient.mongoClusters.collectionView.queryInsights.getQueryInsightsStage2
                .query()
                .then(async (data) => {
                    // Ensure minimum execution time for better UX (avoid jarring instant transitions)
                    const elapsedTime = performance.now() - startTime;
                    const minimumDuration = 1500; // 1.5 seconds
                    if (elapsedTime < minimumDuration) {
                        await new Promise((resolve) => setTimeout(resolve, minimumDuration - elapsedTime));
                    }

                    setQueryInsightsStateHelper((prev) => ({
                        ...prev,
                        stage2Data: data,
                        stage2Promise: null,
                    }));
                    transitionToStage(2, 'success');
                    return data;
                })
                .catch(async (error) => {
                    // Ensure minimum execution time for better UX (avoid jarring instant transitions)
                    const elapsedTime = performance.now() - startTime;
                    const minimumDuration = 1500; // 1.5 seconds
                    if (elapsedTime < minimumDuration) {
                        await new Promise((resolve) => setTimeout(resolve, minimumDuration - elapsedTime));
                    }

                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const errorCode = extractErrorCode(error);

                    setQueryInsightsStateHelper((prev) => ({
                        ...prev,
                        stage2ErrorMessage: errorMessage,
                        stage2ErrorCode: errorCode,
                        stage2Promise: null,
                    }));
                    transitionToStage(2, 'error');
                    // Return undefined to satisfy TypeScript without creating unhandled rejection
                    return undefined as never;
                });

            setQueryInsightsStateHelper((prev) => ({ ...prev, stage2Promise: promise }));
        }
    }, [
        currentStage.phase,
        currentStage.status,
        queryInsightsState.stage1Data,
        queryInsightsState.stage2Data,
        queryInsightsState.stage2Promise,
        trpcClient,
        setQueryInsightsStateHelper,
        transitionToStage,
        displayStageError,
    ]);

    // Debug logging for state changes
    useEffect(() => {
        console.trace('currentStage changed to:', currentStage);
    }, [currentStage]);

    useEffect(() => {
        console.trace('stage3Data changed:', queryInsightsState.stage3Data);
        if (queryInsightsState.stage3Data) {
            console.trace('  - improvementCards count:', queryInsightsState.stage3Data.improvementCards.length);
            console.trace('  - improvementCards:', queryInsightsState.stage3Data.improvementCards);
        }
    }, [queryInsightsState.stage3Data]);

    // Derived metric values from Stage 2 data only
    // Return undefined when loading, null when in error state or no data, or the actual value
    // - undefined: Shows loading skeleton in metrics
    // - null: Shows N/A in metrics (error state, no data, or unsupported platform)
    // - number: Shows the formatted value
    //
    // Show skeleton only when Stage 1 or Stage 2 is loading (not Stage 3)
    const showMetricsSkeleton = currentStage.status === 'loading' && currentStage.phase < 3;
    // Show N/A only when Stage 1 or Stage 2 has an error (Stage 3 errors don't affect metrics)
    const hasMetricsError = currentStage.status === 'error' && currentStage.phase < 3;

    // Helper to compute metric value based on error/skeleton state
    const getMetricValue = <T,>(value: T | null | undefined): T | null | undefined => {
        return hasMetricsError ? null : showMetricsSkeleton ? undefined : (value ?? null);
    };

    // Helper to compute cell value with custom unavailable value
    const getCellValue = <T,>(
        accessor: () => T | null | undefined,
        unavailableValue: T | null = null,
    ): T | null | undefined => {
        return hasMetricsError ? null : showMetricsSkeleton ? undefined : (accessor() ?? unavailableValue);
    };

    const executionTime = getMetricValue(queryInsightsState.stage2Data?.executionTimeMs);
    const docsReturned = getMetricValue(queryInsightsState.stage2Data?.documentsReturned);
    const keysExamined = getMetricValue(queryInsightsState.stage2Data?.totalKeysExamined);
    const docsExamined = getMetricValue(queryInsightsState.stage2Data?.totalDocsExamined);
    const performanceTips = [
        {
            title: l10n.t('Optimize Index Strategy'),
            description: l10n.t(
                'Create compound indexes for queries that filter on multiple fields. Order matters: place equality filters first, then sort fields, then range filters.',
            ),
        },
        {
            title: l10n.t('Limit Returned Fields'),
            description: l10n.t(
                'Use projection to return only necessary fields. This reduces network transfer and memory usage, especially important for documents with large embedded arrays or binary data.',
            ),
        },
        {
            title: l10n.t('Monitor Index Usage'),
            description: l10n.t(
                'Regularly review index statistics to identify unused indexes. Each index adds overhead to write operations, so remove indexes that are not being utilized.',
            ),
        },
    ];

    /**
     * Documentation URL for the AI Performance Insights feature itself
     * (overview, what it does, how to use it).
     *
     * This is *distinct* from {@link utilityModelUrl}: this page describes the
     * feature, while the utility-model URL is the cost-disclosure page wired
     * to the "Learn more about the utility model used." link in the
     * cost-neutral disclosure row and to the post-response "Powered by" byline
     * area. Keeping the two URLs separate lets us update each independently.
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

    const handleGetAISuggestions = () => {
        // Transition to Stage 3 loading (this will reset UI flags)
        transitionToStage(3, 'loading');

        // Clear any pending tips/error card timer from a previous request
        if (stage3TipsTimerRef.current) {
            clearTimeout(stage3TipsTimerRef.current);
            stage3TipsTimerRef.current = null;
        }

        // Check if Stage 2 has query execution errors
        const hasExecutionError =
            queryInsightsState.stage2Data?.concerns &&
            queryInsightsState.stage2Data.concerns.some((concern) => concern.includes('Query Execution Failed'));

        // Show appropriate card after 1 second delay
        stage3TipsTimerRef.current = setTimeout(() => {
            if (hasExecutionError) {
                setShowErrorCard(true);
            } else {
                setShowTipsCard(true);
            }
        }, 1000);

        // Generate a unique request key to track if this request is still valid when it returns.
        //
        // WHY THIS GUARD MATTERS — for future maintainers:
        // tRPC subscriptions over the webview message channel are NOT
        // strictly synchronous to `unsubscribe()`. When the user clicks
        // Cancel and immediately clicks "Get AI Insights" again, the
        // sequence is roughly:
        //   1. handleCancelAI() → subscription.unsubscribe() (queues
        //      `subscription.stop` to the host).
        //   2. handleGetAISuggestions() → new subscription opens with a
        //      NEW requestKey, which we capture into `stage3RequestKey`.
        //   3. The host processes `subscription.stop` for #1 → may flush
        //      one or two trailing `onData` / `onComplete` / `onError`
        //      callbacks from the *old* subscription that were already
        //      in flight.
        // Without the requestKey check inside every state update below,
        // those late callbacks would mutate `stage3Streaming` /
        // `stage3Data` and corrupt the new request's state. The check
        // `if (prev.stage3RequestKey !== requestKey) return prev;` is
        // the single line keeping that race quiet — DO NOT REMOVE IT in
        // a refactor "because the framework promises cleanup".
        const requestKey = crypto.randomUUID();

        // Set request key in queryInsights context
        setQueryInsightsStateHelper((prev) => ({
            ...prev,
            stage3RequestKey: requestKey,
        }));

        // Stop any previous in-flight subscription before starting a new one.
        // `unsubscribe()` sends `subscription.stop` to the host, which both
        // aborts the per-operation AbortController and calls `iterator.return()`
        // on the procedure's async generator — so the underlying LLM call is
        // cancelled in lock step.
        stage3SubscriptionRef.current?.unsubscribe();

        // Subscribe to the Stage 3 streaming subscription. WI-9 wires
        // each structured event type to a slot in `stage3Streaming` (the
        // progressive state the render path reads during phase=3 /
        // status=loading) and synthesizes a full `stage3Data` snapshot on
        // the terminal `complete` event so byline / collapse code paths
        // that read `stage3Data` keep working unchanged. The requestKey
        // staleness guard around every state update silently discards
        // late callbacks from the framework's unsubscribe race (e.g. when
        // the user kicks off a fresh request before the previous one has
        // fully unwound).
        const subscription = trpcClient.mongoClusters.collectionView.queryInsights.streamStage3.subscribe(
            { requestKey },
            {
                onData(event) {
                    if (event.type === 'status') {
                        // The pre-content client-side stepper inside
                        // GetPerformanceInsightsCard already covers
                        // perceived progress; WI-10 may surface server
                        // elapsed/chars later if useful.
                        return;
                    }

                    let wasAccepted = false;
                    setQueryInsightsStateHelper((prev) => {
                        if (prev.stage3RequestKey !== requestKey) {
                            // Request was cancelled or superseded by a newer request
                            return prev;
                        }
                        wasAccepted = true;

                        const prevStreaming: QueryInsightsStreamingState = prev.stage3Streaming ?? {
                            summary: null,
                            educational: null,
                            recommendations: [],
                        };

                        switch (event.type) {
                            case 'summary':
                                return {
                                    ...prev,
                                    stage3Streaming: {
                                        ...prevStreaming,
                                        summary: { markdown: event.markdown, complete: event.complete },
                                    },
                                };
                            case 'educational':
                                return {
                                    ...prev,
                                    stage3Streaming: {
                                        ...prevStreaming,
                                        educational: { markdown: event.markdown, complete: event.complete },
                                    },
                                };
                            case 'recommendationStarted': {
                                const recs = prevStreaming.recommendations.slice();
                                while (recs.length <= event.index) {
                                    recs.push(null);
                                }
                                return {
                                    ...prev,
                                    stage3Streaming: {
                                        ...prevStreaming,
                                        recommendations: recs,
                                    },
                                };
                            }
                            case 'recommendation': {
                                const recs = prevStreaming.recommendations.slice();
                                while (recs.length <= event.index) {
                                    recs.push(null);
                                }
                                recs[event.index] = event.recommendation;
                                return {
                                    ...prev,
                                    stage3Streaming: {
                                        ...prevStreaming,
                                        recommendations: recs,
                                    },
                                };
                            }
                            case 'verification':
                                // Intentionally ignored. The parser still emits this event
                                // (the canonical `JSON.parse` always produces it on finalize),
                                // but nothing in the UI surfaces verification items today.
                                // Keeping the wire payload simplifies a future change that
                                // wants to render them without renegotiating the protocol.
                                return prev;
                            case 'complete': {
                                const synthesized = synthesizeStage3Data(prevStreaming, event, configuration);
                                return {
                                    ...prev,
                                    stage3Data: synthesized,
                                    stage3RequestKey: null,
                                };
                            }
                            default:
                                return prev;
                        }
                    });

                    // Transition to success only when the terminal event
                    // arrives for the still-current request.
                    if (event.type === 'complete' && wasAccepted) {
                        transitionToStage(3, 'success');
                    }
                },
                onError(error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const errorCode = extractErrorCode(error);

                    // Only update state if this request is still the current one.
                    // After `handleCancelAI` (or a superseding request) clears
                    // `stage3RequestKey`, any late `onError` from the framework's
                    // unsubscribe race is silently discarded by this guard.
                    let wasAccepted = false;
                    setQueryInsightsStateHelper((prev) => {
                        if (prev.stage3RequestKey !== requestKey) {
                            return prev;
                        }
                        wasAccepted = true;
                        return {
                            ...prev,
                            stage3ErrorMessage: errorMessage,
                            stage3ErrorCode: errorCode,
                            stage3RequestKey: null,
                            stage3Streaming: null,
                        };
                    });

                    if (wasAccepted) {
                        transitionToStage(3, 'error');
                        // Error display is handled by useEffect when error state changes
                    }

                    if (stage3SubscriptionRef.current === subscription) {
                        stage3SubscriptionRef.current = null;
                    }
                },
                onComplete() {
                    // Clear the ref only if it still points to this request's
                    // subscription. UI state was driven by the terminal
                    // `complete` event in onData; nothing else to do here.
                    if (stage3SubscriptionRef.current === subscription) {
                        stage3SubscriptionRef.current = null;
                    }
                },
            },
        );
        stage3SubscriptionRef.current = subscription;
    };

    const handleCancelAI = () => {
        // Clear any pending tips/error card timer to prevent stale UI after cancel
        if (stage3TipsTimerRef.current) {
            clearTimeout(stage3TipsTimerRef.current);
            stage3TipsTimerRef.current = null;
        }

        // Stop the in-flight subscription so the host stops the LLM call early.
        // `unsubscribe()` triggers `subscription.stop` → server AbortController
        // abort + `iterator.return()` on the generator.
        if (stage3SubscriptionRef.current) {
            stage3SubscriptionRef.current.unsubscribe();
            stage3SubscriptionRef.current = null;
        }

        // Cancel the loading state and clear the request key. If any onData /
        // onComplete / onError still fires from a race with unsubscribe, the
        // requestKey guard in the subscription callbacks will discard it.
        setQueryInsightsStateHelper((prev) => ({
            ...prev,
            stage3RequestKey: null,
            stage3Streaming: null,
        }));

        // Transition to Stage 3 cancelled state
        transitionToStage(3, 'cancelled');
    };

    const handlePrimaryAction = async (
        actionId: string,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> => {
        return await trpcClient.mongoClusters.collectionView.queryInsights.executeQueryInsightsAction.mutate({
            actionId,
            payload,
        });
    };

    const handleSecondaryAction = async (
        actionId: string,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> => {
        return await trpcClient.mongoClusters.collectionView.queryInsights.executeQueryInsightsAction.mutate({
            actionId,
            payload,
        });
    };

    const handleDismissTips = () => {
        setIsTipsCardDismissed(true);
        setShowTipsCard(false);
    };

    // Feedback handlers
    const handleFeedbackClick = (sentiment: 'positive' | 'negative') => {
        // Fire-and-forget event so we capture sentiment immediately when the user clicks
        void trpcClient.common.reportEvent.mutate({
            eventName: 'queryInsightsThumb',
            properties: {
                sentiment,
                source: 'feedbackThumb',
            },
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
                properties: {
                    sentiment: feedback.sentiment,
                    source: 'feedbackDialog',
                    ...reasonProperties,
                },
            });
        } catch (error) {
            console.error('Failed to send feedback:', error);
        }

        return Promise.resolve();
    };

    // Build the cards array for animated presence
    const insightCards: AnimatedCardItem[] = [];

    // Include requestKey in card keys to force remount on regeneration
    const keyPrefix = queryInsightsState.stage3RequestKey ? `${queryInsightsState.stage3RequestKey}-` : '';

    // Stage 3 render sources (post-cleanup #2 / WI-9 progressive streaming):
    //   - `streaming` carries the progressive state populated by the
    //     `streamStage3` subscription's structured events. It is the
    //     SOLE source of truth for the Stage-3 cards (analysis / shells
    //     / improvements / educational). Populated from the first event
    //     and preserved past the terminal `complete` event.
    //   - `stage3Data` is the materialised success snapshot, populated
    //     by `synthesizeStage3Data` on `complete`. The CARDS no longer
    //     read it (the old fallback was for the now-deleted buffered
    //     `getQueryInsightsStage3` path); only two consumers remain:
    //       (a) the `GetPerformanceInsightsCard` collapse condition
    //           uses `!stage3Data` as a "has succeeded at least once"
    //           sentinel so the card only collapses on terminal complete;
    //       (b) the byline / model-disclosure footer reads
    //           `stage3Data.modelDisplayName`.
    //     If you ever want to delete `stage3Data` entirely, replace (a)
    //     with a derived `hasCompletedAtLeastOnce` flag and move
    //     `modelDisplayName` onto the `complete` event slot.
    const streaming = queryInsightsState.stage3Streaming;

    // Analysis Card
    if (currentStage.phase === 3 && streaming?.summary) {
        const summarySource = streaming.summary;
        insightCards.push({
            key: `${keyPrefix}analysis-card`,
            // Mark as in-flight while streaming so AnimatedCardList
            // uses Fade (no `maxHeight`/`overflow:hidden` clipping)
            // instead of CollapseRelaxed. CollapseRelaxed measures
            // scrollHeight once at mount (when content is ~empty) and
            // then clips with overflow:hidden for 400 ms, which hides
            // most of the early streaming and makes the card appear to
            // pop from "title only" to "fully filled" in two frames.
            // Fade lets the markdown grow visibly as chunks arrive.
            inFlight: !summarySource.complete,
            component: (
                <MarkdownCard
                    icon={<SparkleRegular />}
                    title={l10n.t('Query Performance Analysis')}
                    content={summarySource.markdown}
                    inFlight={!summarySource.complete}
                    inFlightLabel={l10n.t('Analyzing…')}
                />
            ),
        });
    }

    // Error Card - shown when query execution failed
    if (showErrorCard && queryInsightsState.stage2Data?.concerns) {
        insightCards.push({
            key: `${keyPrefix}query-execution-error`,
            component: (
                <MarkdownCard
                    title={l10n.t('Query Execution Failed')}
                    icon={<WarningRegular />}
                    showAiDisclaimer={false}
                    content={
                        queryInsightsState.stage2Data.concerns.join('\n\n') +
                        '\n\n---\n\n' +
                        '**Resolving this execution error should take precedence over performance optimization.** ' +
                        'AI analysis will still run to provide additional insights, but focus on fixing the error first.'
                    }
                />
            ),
        });
    }

    // Improvement Cards (progressive: shell on `recommendationStarted`,
    // filled on `recommendation`; per D11 the shell reuses the same outer
    // Card + ArrowTrendingSparkleRegular icon as the filled card via
    // `ImprovementCardShell`, so the card's identity never changes when
    // content arrives). Uses a single stable key per index so the
    // shell-to-filled transition is in-place (no unmount/remount).
    if (currentStage.phase === 3 && streaming && streaming.recommendations.length > 0) {
        streaming.recommendations.forEach((rec, index) => {
            const key = `${keyPrefix}rec-${index}`;
            if (rec === null) {
                insightCards.push({ key, component: <ImprovementCardShell /> });
                return;
            }
            const config = createImprovementCardConfig(rec, index, {
                clusterId: configuration.clusterId,
                databaseName: configuration.databaseName,
                collectionName: configuration.collectionName,
            });
            insightCards.push({
                key,
                component: (
                    <ImprovementCard
                        config={config}
                        onPrimaryAction={handlePrimaryAction}
                        onSecondaryAction={handleSecondaryAction}
                    />
                ),
            });
        });
    }

    // Educational Markdown Card — Understanding Query Execution
    if (currentStage.phase === 3 && streaming?.educational) {
        const educationalSource = streaming.educational;
        insightCards.push({
            key: `${keyPrefix}understanding-execution`,
            // See `analysis-card` above: Fade while streaming so the
            // markdown chunks are actually visible as they arrive,
            // instead of being clipped by CollapseRelaxed's 400 ms
            // maxHeight enter animation.
            inFlight: !educationalSource.complete,
            component: (
                <MarkdownCard
                    icon={<SparkleRegular />}
                    title={l10n.t('Understanding Your Query Execution Plan')}
                    content={educationalSource.markdown}
                    inFlight={!educationalSource.complete}
                    inFlightLabel={l10n.t('Writing explanation…')}
                />
            ),
        });
    }

    // Performance Tips Card
    if (showTipsCard && !isTipsCardDismissed) {
        insightCards.push({
            key: 'performance-tips',
            component: (
                <TipsCard
                    title={l10n.t('DocumentDB Performance Tips')}
                    tips={performanceTips}
                    onDismiss={handleDismissTips}
                />
            ),
        });
    }

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
                        <Text size={400} weight="semibold" className="cardSpacing" style={{ display: 'block' }}>
                            {l10n.t('Optimization Opportunities')}
                        </Text>

                        {/* Platform-specific error card for RU clusters */}
                        {queryInsightsState.stage1ErrorCode === 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU' && (
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

                        {/* Skeleton - shown only when Stage 1 is actively loading (not in error state) */}
                        {currentStage.phase === 1 && currentStage.status === 'loading' && (
                            <Skeleton className="cardSpacing">
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ width: '60%' }} />
                            </Skeleton>
                        )}

                        {/* GetPerformanceInsightsCard with CollapseRelaxed animation.
                            Shown in Stage 2 when AI insights haven't been requested yet, or when
                            there's an error. Stays visible throughout the entire Stage 3 stream
                            (while `currentStage.status === 'loading'` the inner stepper is shown
                            via `isLoading`); collapses only once the terminal `complete` event
                            materialises `stage3Data`, so the progress indicator does not disappear
                            as soon as the first streamed card arrives.
                            Note: Component supports ref forwarding and applies its own spacing via className. */}
                        <CollapseRelaxed visible={currentStage.phase >= 2 && !queryInsightsState.stage3Data}>
                            <GetPerformanceInsightsCard
                                className="cardSpacing"
                                bodyText={
                                    queryInsightsState.stage2Data?.efficiencyAnalysis.performanceRating.score ===
                                    'excellent'
                                        ? l10n.t(
                                              'Your query is performing well. You can still use the AI-powered analysis to get a detailed explanation of the query execution, review the indexing, and explore if further optimizations are possible.',
                                          )
                                        : l10n.t(
                                              'Get personalized recommendations to optimize your query performance. AI will analyze your cluster configuration, index usage, execution plan, and more to suggest specific improvements.',
                                          )
                                }
                                isLoading={currentStage.phase === 3 && currentStage.status === 'loading'}
                                enabled={currentStage.phase >= 2 && currentStage.status !== 'loading'}
                                errorMessage={queryInsightsState.stage3ErrorMessage ?? undefined}
                                onGetInsights={handleGetAISuggestions}
                                onLearnMore={handleLearnMore}
                                onCancel={handleCancelAI}
                                onLearnMoreUtilityModel={handleLearnMoreUtilityModel}
                            />
                        </CollapseRelaxed>

                        {/* AnimatedCardList for AI suggestions and tips */}
                        <AnimatedCardList items={insightCards} exitDuration={300} />

                        {/* Post-response "Powered by" byline.
                            Mirrors the (i) + cost-neutral disclosure shown in the pre-invocation
                            card. Token usage measurements are intentionally NOT rendered here:
                            they live in the trace output channel and in telemetry only. Cost
                            (credits) is not surfaced because the stable VS Code Language Model
                            API does not expose pricing data; the extension stays on stable APIs
                            and avoids the proposed `languageModelPricing` API by design. */}
                        {currentStage.phase === 3 &&
                            currentStage.status === 'success' &&
                            queryInsightsState.stage3Data?.modelDisplayName && (
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
                                            {l10n.t(
                                                'Powered by {0} via GitHub Copilot',
                                                queryInsightsState.stage3Data.modelDisplayName,
                                            )}
                                        </Text>
                                    </div>
                                </div>
                            )}
                    </div>
                </div>

                {/* Right Column: Efficiency Analysis, Query Plan, Quick Actions */}
                <div className="rightColumn">
                    {/* Query Efficiency Analysis */}
                    <SummaryCard title={l10n.t('Query Efficiency Analysis')}>
                        <GenericCell
                            label={l10n.t('Selectivity')}
                            value={getCellValue(() => queryInsightsState.stage2Data?.efficiencyAnalysis.selectivity)}
                            nullValuePlaceholder="—"
                            loadingPlaceholder="skeleton"
                            tooltipExplanation={(() => {
                                const selectivity = queryInsightsState.stage2Data?.efficiencyAnalysis.selectivity;
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
                                () => queryInsightsState.stage2Data?.efficiencyAnalysis.indexUsed,
                                l10n.t('None (collection scan)'),
                            )}
                            loadingPlaceholder="skeleton"
                            tooltipExplanation={(() => {
                                const indexUsed = queryInsightsState.stage2Data?.efficiencyAnalysis.indexUsed;
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
                            value={getCellValue(() => queryInsightsState.stage2Data?.efficiencyAnalysis.fetchOverhead)}
                            loadingPlaceholder="skeleton"
                            tooltipExplanation={(() => {
                                const kind =
                                    queryInsightsState.stage2Data?.efficiencyAnalysis.fetchOverheadKind ??
                                    'directFetch';
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
                            value={getCellValue(() =>
                                queryInsightsState.stage2Data?.efficiencyAnalysis.hasInMemorySort
                                    ? l10n.t('Yes')
                                    : l10n.t('No'),
                            )}
                            loadingPlaceholder="skeleton"
                            tooltipExplanation={(() => {
                                const hasSort =
                                    queryInsightsState.stage2Data?.efficiencyAnalysis.hasInMemorySort ?? false;
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
                                      : queryInsightsState.stage2Data?.efficiencyAnalysis.performanceRating.score
                            }
                            diagnostics={
                                hasMetricsError || showMetricsSkeleton
                                    ? undefined
                                    : queryInsightsState.stage2Data?.efficiencyAnalysis.performanceRating.diagnostics
                            }
                            visible={!hasMetricsError && !showMetricsSkeleton && !!queryInsightsState.stage2Data}
                        />
                    </SummaryCard>

                    {/* Query Plan Summary */}
                    <QueryPlanSummary
                        stage1Data={queryInsightsState.stage1Data}
                        stage2Data={queryInsightsState.stage2Data}
                        stage1Loading={currentStage.phase === 1 && !queryInsightsState.stage1Data}
                        stage2Loading={currentStage.phase >= 2 && !queryInsightsState.stage2Data}
                        hasError={hasMetricsError}
                    />

                    {/* Feedback Card - hidden for RU accounts where Query Insights is not available */}
                    {configuration.feedbackSignalsEnabled &&
                        queryInsightsState.stage1ErrorCode !== 'QUERY_INSIGHTS_PLATFORM_NOT_SUPPORTED_RU' && (
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
