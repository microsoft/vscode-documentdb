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

import { Skeleton, SkeletonItem, Text } from '@fluentui/react-components';
import { ChatMailRegular, SparkleRegular, WarningRegular } from '@fluentui/react-icons';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { useCallback, useContext, useEffect, useState, type JSX } from 'react';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import { CollectionViewContext } from '../../collectionViewContext';
import { type ImprovementCard as ImprovementCardConfig } from '../../types/queryInsights';
import { extractErrorCode } from '../../utils/errorCodeExtractor';
import { AnimatedCardList, type AnimatedCardItem } from './components';
import { CountMetric } from './components/metricsRow/CountMetric';
import { MetricsRow } from './components/metricsRow/MetricsRow';
import { TimeMetric } from './components/metricsRow/TimeMetric';
import { GetPerformanceInsightsCard, ImprovementCard, MarkdownCard, TipsCard } from './components/optimizationCards';
import { QueryPlanSummary } from './components/queryPlanSummary';
import { GenericCell, PerformanceRatingCell, SummaryCard } from './components/summaryCard';
import './queryInsights.scss';
import './QueryInsightsTab.scss';

export const QueryInsightsMain = (): JSX.Element => {
    // Stage management:
    // Stage 1: Initial View (cheap data + query plan from explain("queryPlanner"))
    // Stage 2: Detailed Execution Analysis (from explain("executionStats"))
    // Stage 3: AI-Powered Recommendations (opt-in)
    // See: docs/design-documents/performance-advisor.md

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
                    newState.stage3Promise = null;
                    newState.stage3RequestKey = null;

                    // Reset UI flags
                    setShowTipsCard(false);
                    setIsTipsCardDismissed(false);
                    setShowErrorCard(false);
                } else if (phase === 2 && status === 'loading') {
                    // When entering stage 2 loading, clear stage 3 data only
                    newState.stage3Data = null;
                    newState.stage3ErrorMessage = null;
                    newState.stage3ErrorCode = null;
                    newState.stage3Promise = null;
                    newState.stage3RequestKey = null;

                    // Don't reset UI flags here - they should persist for the same query session
                    // They will be reset by phase 1 or phase 3 loading transitions
                } else if (phase === 3 && status === 'loading') {
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
            const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage1
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

            // Query parameters are now retrieved from ClusterSession - no need to pass them
            const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage2
                .query()
                .then((data) => {
                    setQueryInsightsStateHelper((prev) => ({
                        ...prev,
                        stage2Data: data,
                        stage2Promise: null,
                    }));
                    transitionToStage(2, 'success');
                    return data;
                })
                .catch((error) => {
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

    const handleGetAISuggestions = () => {
        // Transition to Stage 3 loading (this will reset UI flags)
        transitionToStage(3, 'loading');

        // Check if Stage 2 has query execution errors
        const hasExecutionError =
            queryInsightsState.stage2Data?.concerns &&
            queryInsightsState.stage2Data.concerns.some((concern) => concern.includes('Query Execution Failed'));

        // Show appropriate card after 1 second delay
        const timer = setTimeout(() => {
            if (hasExecutionError) {
                setShowErrorCard(true);
            } else {
                setShowTipsCard(true);
            }
        }, 1000);

        // Generate a unique request key to track if this request is still valid when it returns
        const requestKey = crypto.randomUUID();

        // Set request key in queryInsights context
        setQueryInsightsStateHelper((prev) => ({
            ...prev,
            stage3RequestKey: requestKey,
        }));

        // Call the tRPC endpoint (10+ second delay expected from AI service)
        const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage3
            .query({ requestKey })
            .then((response) => {
                // Only update state if this request is still the current one
                let wasAccepted = false;
                setQueryInsightsStateHelper((prev) => {
                    if (prev.stage3RequestKey !== requestKey) {
                        // Request was cancelled or superseded by a newer request
                        return prev;
                    }
                    wasAccepted = true;
                    return {
                        ...prev,
                        stage3Data: response,
                        stage3Promise: null,
                        stage3RequestKey: null,
                    };
                });

                // Only transition to success if the response was accepted
                if (wasAccepted) {
                    transitionToStage(3, 'success');
                }
                return response;
            })
            .catch((error: unknown) => {
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorCode = extractErrorCode(error);

                // Only update state if this request is still the current one
                let wasAccepted = false;
                setQueryInsightsStateHelper((prev) => {
                    if (prev.stage3RequestKey !== requestKey) {
                        // Request was cancelled or superseded by a newer request
                        return prev;
                    }
                    wasAccepted = true;
                    return {
                        ...prev,
                        stage3ErrorMessage: errorMessage,
                        stage3ErrorCode: errorCode,
                        stage3Promise: null,
                        stage3RequestKey: null,
                    };
                });

                // Only transition to error and display message if the error was accepted
                if (wasAccepted) {
                    transitionToStage(3, 'error');
                    displayStageError(3, errorMessage);
                }
                // Return undefined to satisfy TypeScript without creating unhandled rejection
                return undefined as never;
            });

        setQueryInsightsStateHelper((prev) => ({
            ...prev,
            stage3Promise: promise,
        }));

        return () => clearTimeout(timer);
    };

    const handleCancelAI = () => {
        // Cancel the loading state and clear the request key
        // When the promise eventually returns, it will check the key and ignore the result
        setQueryInsightsStateHelper((prev) => ({
            ...prev,
            stage3Promise: null,
            stage3RequestKey: null,
        }));

        // Transition to Stage 3 cancelled state
        transitionToStage(3, 'cancelled');
    };

    /**
     * MOCK VERSION: Client-side mock for AI suggestions with 5-second delay
     * This simulates the AI request without calling the backend
     */
    const handlePrimaryAction = async (
        actionId: string,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> => {
        return await trpcClient.mongoClusters.collectionView.executeQueryInsightsAction.mutate({
            actionId,
            payload,
        });
    };

    const handleSecondaryAction = async (
        actionId: string,
        payload: unknown,
    ): Promise<{ success: boolean; message?: string }> => {
        return await trpcClient.mongoClusters.collectionView.executeQueryInsightsAction.mutate({
            actionId,
            payload,
        });
    };

    const handleDismissTips = () => {
        setIsTipsCardDismissed(true);
        setShowTipsCard(false);
    };

    // Build the cards array for animated presence
    const insightCards: AnimatedCardItem[] = [];

    // Include requestKey in card keys to force remount on regeneration
    const keyPrefix = queryInsightsState.stage3RequestKey ? `${queryInsightsState.stage3RequestKey}-` : '';

    // Analysis Card (if AI data available)
    if (currentStage.phase === 3 && queryInsightsState.stage3Data?.analysisCard) {
        insightCards.push({
            key: `${keyPrefix}analysis-card`,
            component: (
                <MarkdownCard
                    icon={<SparkleRegular />}
                    title={l10n.t('Query Performance Analysis')}
                    content={queryInsightsState.stage3Data.analysisCard.content}
                    onCopy={() => {
                        void navigator.clipboard.writeText(queryInsightsState.stage3Data?.analysisCard.content ?? '');
                    }}
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
                    onCopy={() => {
                        void navigator.clipboard.writeText(queryInsightsState.stage2Data?.concerns?.join('\n\n') ?? '');
                    }}
                />
            ),
        });
    }

    // Improvement Cards (dynamic from AI response)
    if (currentStage.phase === 3 && queryInsightsState.stage3Data?.improvementCards) {
        queryInsightsState.stage3Data.improvementCards.forEach((card: ImprovementCardConfig, index: number) => {
            // If any button exists, render ImprovementCard; otherwise render MarkdownCard
            if (card.primaryButton || card.secondaryButton) {
                insightCards.push({
                    key: `${keyPrefix}${card.cardId}`,
                    component: (
                        <ImprovementCard
                            config={card}
                            onPrimaryAction={handlePrimaryAction}
                            onSecondaryAction={handleSecondaryAction}
                            onCopy={() => {
                                void navigator.clipboard.writeText(card.mongoShellCommand);
                            }}
                        />
                    ),
                });
            } else {
                // For informational cards (no buttons), use MarkdownCard
                insightCards.push({
                    key: `${keyPrefix}${card.cardId || `card-${index}`}`,
                    component: (
                        <MarkdownCard
                            icon={<SparkleRegular />}
                            title={card.title}
                            content={card.description}
                            onCopy={() => {
                                void navigator.clipboard.writeText(card.description);
                            }}
                        />
                    ),
                });
            }
        });
    }

    // Educational Markdown Card - Understanding Query Execution
    if (currentStage.phase === 3 && queryInsightsState.stage3Data?.educationalContent) {
        insightCards.push({
            key: `${keyPrefix}understanding-execution`,
            component: (
                <MarkdownCard
                    icon={<SparkleRegular />}
                    title={l10n.t('Understanding Your Query Execution Plan')}
                    content={queryInsightsState.stage3Data.educationalContent}
                    onCopy={() => {
                        void navigator.clipboard.writeText(queryInsightsState.stage3Data?.educationalContent ?? '');
                    }}
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
                            <MarkdownCard
                                title={l10n.t('Query Insights Not Available')}
                                icon={<ChatMailRegular />}
                                showAiDisclaimer={false}
                                content={l10n.t(
                                    '**Query Insights for Azure Cosmos DB for MongoDB (RU) Accounts**\n\n' +
                                        'This feature is currently not enabled for RU-based accounts. We recognize that these accounts have unique performance characteristics, and standard optimization patterns from other DocumentDB environments may not be applicable.\n\n' +
                                        'To ensure our recommendations are accurate and genuinely helpful, a specific analysis tailored to the Request Unit (RU) model is required. For this reason, we have disabled the feature for this account type.\n\n' +
                                        '---\n\n' +
                                        '**Interested in performance tooling for RU?**\n\n' +
                                        "We are gathering feedback to shape future tools. If you'd like to share your experience with query optimization on RU accounts or participate in design discussions, your input is highly valuable.\n\n" +
                                        "Feel free to [**start a discussion on GitHub**](https://github.com/microsoft/vscode-documentdb/discussions) or reach out to us directly. We'd love to hear from you!",
                                )}
                            />
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

                        {/* GetPerformanceInsightsCard with CollapseRelaxed animation
                            Shown in Stage 2 when AI insights haven't been requested yet, or when there's an error.
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
                                onLearnMore={() => {
                                    void trpcClient.common.openUrl.mutate({
                                        url: 'https://learn.microsoft.com/azure/documentdb/index-advisor',
                                    });
                                }}
                                onCancel={handleCancelAI}
                            />
                        </CollapseRelaxed>

                        {/* AnimatedCardList for AI suggestions and tips */}
                        <AnimatedCardList items={insightCards} exitDuration={300} />
                    </div>
                </div>

                {/* Right Column: Efficiency Analysis, Query Plan, Quick Actions */}
                <div className="rightColumn">
                    {/* Query Efficiency Analysis */}
                    <SummaryCard title={l10n.t('Query Efficiency Analysis')}>
                        <GenericCell
                            label={l10n.t('Execution Strategy')}
                            value={getCellValue(
                                () => queryInsightsState.stage2Data?.efficiencyAnalysis.executionStrategy,
                            )}
                            loadingPlaceholder="skeleton"
                        />
                        <GenericCell
                            label={l10n.t('Index Used')}
                            value={getCellValue(
                                () => queryInsightsState.stage2Data?.efficiencyAnalysis.indexUsed,
                                l10n.t('None'),
                            )}
                            loadingPlaceholder="skeleton"
                        />
                        <GenericCell
                            label={l10n.t('Examined-to-Returned Ratio')}
                            value={getCellValue(
                                () => queryInsightsState.stage2Data?.efficiencyAnalysis.examinedReturnedRatio,
                            )}
                            loadingPlaceholder="skeleton"
                        />
                        <GenericCell
                            label={l10n.t('In-Memory Sort')}
                            value={getCellValue(() =>
                                queryInsightsState.stage2Data?.efficiencyAnalysis.hasInMemorySort
                                    ? l10n.t('Yes')
                                    : l10n.t('No'),
                            )}
                            loadingPlaceholder="skeleton"
                        />
                        <PerformanceRatingCell
                            label={l10n.t('Performance Rating')}
                            rating={
                                hasMetricsError || showMetricsSkeleton
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

                    {/* Quick Actions */}
                    {/* <QuickActions stageState={stageState} /> */}
                </div>
            </div>
        </div>
    );
};
