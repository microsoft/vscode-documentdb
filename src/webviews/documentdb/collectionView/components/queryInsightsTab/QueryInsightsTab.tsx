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
import { SparkleRegular, WarningRegular } from '@fluentui/react-icons';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { useContext, useEffect, useState, type JSX } from 'react';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import { CollectionViewContext } from '../../collectionViewContext';
import { type ImprovementCard as ImprovementCardConfig } from '../../types/queryInsights';
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
    const setQueryInsightsStateHelper = (
        updater:
            | typeof currentContext.queryInsights
            | ((prev: typeof currentContext.queryInsights) => typeof currentContext.queryInsights),
    ): void => {
        setCurrentContext((prev) => ({
            ...prev,
            queryInsights: typeof updater === 'function' ? updater(prev.queryInsights) : updater,
        }));
    };

    /**
     * Use the explicit stage from state instead of deriving it
     */
    const currentStage = queryInsightsState.currentStage;

    const [showTipsCard, setShowTipsCard] = useState(false);
    const [isTipsCardDismissed, setIsTipsCardDismissed] = useState(false);
    const [showErrorCard, setShowErrorCard] = useState(false);

    // Debug logging for tips card visibility
    useEffect(() => {
        console.trace('[TipsCard] State changed:', { showTipsCard, isTipsCardDismissed });
    }, [showTipsCard, isTipsCardDismissed]);

    /**
     * Stage transition helper - handles moving between stages and cleaning up state
     * Rules:
     * - Can transition from 1 → 2 → 3
     * - Can transition from any stage back to 1 (query re-run)
     * - When transitioning to stage 1, clear all data from stages 2 and 3
     * - When transitioning to stage 2, clear data from stage 3
     * - Reset UI-specific flags when transitioning to new phases
     */
    const transitionToStage = (phase: 1 | 2 | 3, status: 'loading' | 'success' | 'error' | 'cancelled'): void => {
        console.trace(`🔄 Stage transition: ${currentStage.phase}/${currentStage.status} → ${phase}/${status}`);

        setQueryInsightsStateHelper((prev) => {
            const newState = { ...prev };

            // Update current stage
            newState.currentStage = { phase, status };

            // Reset dependent stages when going back to earlier phases
            if (phase === 1) {
                // Reset everything when starting fresh
                newState.stage2Data = null;
                newState.stage2Error = null;
                newState.stage2Promise = null;

                newState.stage3Data = null;
                newState.stage3Error = null;
                newState.stage3Promise = null;
                newState.stage3RequestKey = null;

                // Reset UI flags
                setShowTipsCard(false);
                setIsTipsCardDismissed(false);
                setShowErrorCard(false);
            } else if (phase === 2 && status === 'loading') {
                // When entering stage 2 loading, clear stage 3 data only
                newState.stage3Data = null;
                newState.stage3Error = null;
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
    };

    // Stage 1: Load when needed (on mount or after query re-run when tab is active)
    // When a query is re-run, the queryInsights state is reset in CollectionView.tsx
    // This effect needs to re-trigger to start loading the new data
    // IMPORTANT: Wait for query execution to complete (isLoading=false) before fetching insights
    useEffect(() => {
        console.trace('[Stage 1 Effect] Triggered with:', {
            isLoading: currentContext.isLoading,
            phase: currentStage.phase,
            status: currentStage.status,
            hasStage1Data: !!queryInsightsState.stage1Data,
            hasStage1Promise: !!queryInsightsState.stage1Promise,
        });

        if (
            !currentContext.isLoading &&
            currentStage.phase === 1 &&
            currentStage.status === 'loading' &&
            !queryInsightsState.stage1Data &&
            !queryInsightsState.stage1Promise
        ) {
            console.trace('[Stage 1 Effect] 🚀 Starting Stage 1 data fetch');
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
                    void trpcClient.common.displayErrorMessage.mutate({
                        message: l10n.t('Failed to load query insights'),
                        modal: false,
                        cause: error instanceof Error ? error.message : String(error),
                    });
                    setQueryInsightsStateHelper((prev) => ({
                        ...prev,
                        stage1Error: error instanceof Error ? error.message : String(error),
                        stage1Promise: null,
                    }));
                    transitionToStage(1, 'error');
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
                    void trpcClient.common.displayErrorMessage.mutate({
                        message: l10n.t('Failed to load detailed execution analysis'),
                        modal: false,
                        cause: error instanceof Error ? error.message : String(error),
                    });
                    setQueryInsightsStateHelper((prev) => ({
                        ...prev,
                        stage2Error: error instanceof Error ? error.message : String(error),
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

    // Derived metric values from Stage 1 and Stage 2 data
    // Use server-side execution time from stage2 (executionStats) when available, otherwise use stage1 (client-measured)
    const executionTime =
        queryInsightsState.stage2Data?.executionTimeMs ?? queryInsightsState.stage1Data?.executionTime ?? null;
    const docsReturned = queryInsightsState.stage2Data?.documentsReturned ?? null;
    const keysExamined = queryInsightsState.stage2Data?.totalKeysExamined ?? null;
    const docsExamined = queryInsightsState.stage2Data?.totalDocsExamined ?? null;

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
        console.trace(`🚀 Starting new AI request with key: ${requestKey}`);

        // Set request key in queryInsights context
        setQueryInsightsStateHelper((prev) => {
            if (prev.stage3RequestKey) {
                console.trace(`  Superseding previous request key: ${prev.stage3RequestKey}`);
            }
            return { ...prev, stage3RequestKey: requestKey };
        });

        // Call the tRPC endpoint (10+ second delay expected from AI service)
        const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage3
            .query({ requestKey })
            .then((response) => {
                console.trace(`AI response received for request key: ${requestKey}`);
                console.trace('Number of improvement cards:', response.improvementCards.length);
                console.trace('Improvement cards:', response.improvementCards);

                // Only update state if this request is still the current one
                let wasAccepted = false;
                setQueryInsightsStateHelper((prev) => {
                    if (prev.stage3RequestKey !== requestKey) {
                        console.warn(
                            `🚫 REJECTED stale AI response - Request key mismatch:`,
                            `\n  Received: ${requestKey}`,
                            `\n  Expected: ${prev.stage3RequestKey}`,
                            `\n  Reason: Request was cancelled or superseded by a newer request`,
                        );
                        return prev;
                    }
                    console.trace(`✅ ACCEPTED AI response for request key: ${requestKey}`);
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
                // Only update state if this request is still the current one
                let wasAccepted = false;
                setQueryInsightsStateHelper((prev) => {
                    if (prev.stage3RequestKey !== requestKey) {
                        console.warn(
                            `🚫 REJECTED stale AI error - Request key mismatch:`,
                            `\n  Received: ${requestKey}`,
                            `\n  Expected: ${prev.stage3RequestKey}`,
                            `\n  Reason: Request was cancelled or superseded by a newer request`,
                        );
                        return prev;
                    }
                    console.trace(`✅ ACCEPTED AI error for request key: ${requestKey}`);
                    wasAccepted = true;
                    return {
                        ...prev,
                        stage3Error: error instanceof Error ? error.message : String(error),
                        stage3Promise: null,
                        stage3RequestKey: null,
                    };
                });

                // Only transition to error if the error was accepted
                if (wasAccepted) {
                    transitionToStage(3, 'error');
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
        setQueryInsightsStateHelper((prev) => {
            if (prev.stage3RequestKey) {
                console.trace(`❌ Cancelling AI request with key: ${prev.stage3RequestKey}`);
            }
            return {
                ...prev,
                stage3Promise: null,
                stage3RequestKey: null,
            };
        });

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
        console.trace('[AnimatedCardList] ✅ Adding Analysis Card to array');
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
        console.trace('[AnimatedCardList] ✅ Adding Error Card to array');
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
        console.trace('=== IMPROVEMENT CARDS BUILDING ===');
        console.trace('Number of cards to add:', queryInsightsState.stage3Data.improvementCards.length);

        queryInsightsState.stage3Data.improvementCards.forEach((card: ImprovementCardConfig, index: number) => {
            console.trace(`Card ${index + 1}:`, card.cardId, 'actionId:', card.primaryButton?.actionId);

            // If any button exists, render ImprovementCard; otherwise render MarkdownCard
            if (card.primaryButton || card.secondaryButton) {
                console.trace(
                    `  -> Adding ImprovementCard (primary: ${card.primaryButton?.actionId}, secondary: ${card.secondaryButton?.actionId})`,
                );
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
                console.trace(`  -> Adding MarkdownCard (no buttons)`);
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
        console.trace('[AnimatedCardList] ✅ Adding Educational Card to array');
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
        console.trace('[AnimatedCardList] ✅ Adding Performance Tips Card to array');
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

                        {/* Skeleton - shown only in Stage 1 */}
                        {currentStage.phase === 1 && (
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
                                errorMessage={queryInsightsState.stage3Error ?? undefined}
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
                            value={queryInsightsState.stage2Data?.efficiencyAnalysis.executionStrategy}
                            placeholder="skeleton"
                        />
                        <GenericCell
                            label={l10n.t('Index Used')}
                            value={
                                queryInsightsState.stage2Data?.efficiencyAnalysis.indexUsed ||
                                (queryInsightsState.stage2Data ? l10n.t('None') : undefined)
                            }
                            placeholder="skeleton"
                        />
                        <GenericCell
                            label={l10n.t('Examined-to-Returned Ratio')}
                            value={queryInsightsState.stage2Data?.efficiencyAnalysis.examinedReturnedRatio}
                            placeholder="skeleton"
                        />
                        <GenericCell
                            label={l10n.t('In-Memory Sort')}
                            value={
                                queryInsightsState.stage2Data?.efficiencyAnalysis.hasInMemorySort
                                    ? l10n.t('Yes')
                                    : queryInsightsState.stage2Data
                                      ? l10n.t('No')
                                      : undefined
                            }
                            placeholder="skeleton"
                        />
                        <PerformanceRatingCell
                            label={l10n.t('Performance Rating')}
                            rating={queryInsightsState.stage2Data?.efficiencyAnalysis.performanceRating.score}
                            diagnostics={
                                queryInsightsState.stage2Data?.efficiencyAnalysis.performanceRating.diagnostics
                            }
                            visible={!!queryInsightsState.stage2Data}
                        />
                    </SummaryCard>

                    {/* Query Plan Summary */}
                    <QueryPlanSummary
                        stage1Data={queryInsightsState.stage1Data}
                        stage2Data={queryInsightsState.stage2Data}
                        stage1Loading={currentStage.phase === 1 && !queryInsightsState.stage1Data}
                        stage2Loading={currentStage.phase >= 2 && !queryInsightsState.stage2Data}
                    />

                    {/* Quick Actions */}
                    {/* <QuickActions stageState={stageState} /> */}
                </div>
            </div>
        </div>
    );
};
