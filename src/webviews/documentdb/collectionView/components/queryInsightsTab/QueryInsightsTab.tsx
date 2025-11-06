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
import { BrainSparkleRegular, WarningRegular } from '@fluentui/react-icons';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { type JSX, useContext, useEffect, useState } from 'react';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import { CollectionViewContext } from '../../collectionViewContext';
import {
    type ImprovementCard as ImprovementCardConfig,
    type QueryInsightsStage3Response,
} from '../../types/queryInsights';
import { AnimatedCardList } from './components';
import { CountMetric } from './components/metricsRow/CountMetric';
import { MetricsRow } from './components/metricsRow/MetricsRow';
import { TimeMetric } from './components/metricsRow/TimeMetric';
import {
    AiCard,
    GetPerformanceInsightsCard,
    ImprovementCard,
    MarkdownCard,
    TipsCard,
} from './components/optimizationCards';
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
     *   setCurrentContext(prev => ({ ...prev, queryInsights: { ...prev.queryInsights, stage1Loading: true } }))
     *
     * You can write:
     *   setQueryInsightsStateHelper(prev => ({ ...prev, stage1Loading: true }))
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
     * Visual stage state based on actual data availability OR error state.
     * We progress to the next stage even if there's an error, so users can see what failed.
     * Stage 1: Default state, waiting for or showing Stage 1 data
     * Stage 2: Stage 1 completed (success or error), Stage 2 in progress or completed
     * Stage 3: Stage 2 completed (success or error), Stage 3 in progress or completed
     */
    const stageState: 1 | 2 | 3 =
        queryInsightsState.stage3Data || queryInsightsState.stage3Error
            ? 3
            : queryInsightsState.stage2Data || queryInsightsState.stage2Error
              ? 2
              : 1;

    const [isLoadingAI, setIsLoadingAI] = useState(false);
    const [aiInsightsRequested, setAiInsightsRequested] = useState(false); // One-way flag: once true, stays true
    const [showTipsCard, setShowTipsCard] = useState(false);
    const [isTipsCardDismissed, setIsTipsCardDismissed] = useState(false);
    const [showErrorCard, setShowErrorCard] = useState(false);

    // Stage 1: Load when needed (on mount or after query re-run when tab is active)
    // When a query is re-run, the queryInsights state is reset in CollectionView.tsx
    // This effect needs to re-trigger to start loading the new data
    // IMPORTANT: Wait for query execution to complete (isLoading=false) before fetching insights
    useEffect(() => {
        if (
            !currentContext.isLoading &&
            !queryInsightsState.stage1Data &&
            !queryInsightsState.stage1Loading &&
            !queryInsightsState.stage1Promise
        ) {
            setQueryInsightsStateHelper((prev) => ({ ...prev, stage1Loading: true }));

            // Query parameters are now retrieved from ClusterSession - no need to pass them
            const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage1
                .query()
                .then((data) => {
                    setQueryInsightsStateHelper((prev) => ({
                        ...prev,
                        stage1Data: data,
                        stage1Loading: false,
                        stage1Promise: null,
                    }));
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
                        stage1Loading: false,
                        stage1Promise: null,
                    }));
                    throw error;
                });

            setQueryInsightsStateHelper((prev) => ({ ...prev, stage1Promise: promise }));
        }
    }, [
        currentContext.isLoading,
        queryInsightsState.stage1Data,
        queryInsightsState.stage1Loading,
        queryInsightsState.stage1Promise,
    ]);

    // Stage 2: Auto-start after Stage 1 completes
    useEffect(() => {
        if (
            queryInsightsState.stage1Data &&
            !queryInsightsState.stage2Data &&
            !queryInsightsState.stage2Loading &&
            !queryInsightsState.stage2Promise
        ) {
            setQueryInsightsStateHelper((prev) => ({ ...prev, stage2Loading: true }));

            // Query parameters are now retrieved from ClusterSession - no need to pass them
            const promise = trpcClient.mongoClusters.collectionView.getQueryInsightsStage2
                .query()
                .then((data) => {
                    setQueryInsightsStateHelper((prev) => ({
                        ...prev,
                        stage2Data: data,
                        stage2Loading: false,
                        stage2Promise: null,
                    }));
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
                        stage2Loading: false,
                        stage2Promise: null,
                    }));
                    throw error;
                });

            setQueryInsightsStateHelper((prev) => ({ ...prev, stage2Promise: promise }));
        }
    }, [queryInsightsState.stage1Data]);

    // Debug logging for state changes
    useEffect(() => {
        console.log('stageState changed to:', stageState);
    }, [stageState]);

    useEffect(() => {
        console.log('stage3Data changed:', queryInsightsState.stage3Data);
        if (queryInsightsState.stage3Data) {
            console.log('  - improvementCards count:', queryInsightsState.stage3Data.improvementCards.length);
            console.log('  - improvementCards:', queryInsightsState.stage3Data.improvementCards);
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
        setIsLoadingAI(true);
        setAiInsightsRequested(true); // Set one-way flag to prevent button from reappearing
        setIsTipsCardDismissed(false);

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

        // Call the tRPC endpoint (10+ second delay expected from AI service)
        void trpcClient.mongoClusters.collectionView.getQueryInsightsStage3
            .query()
            .then((response) => {
                console.log('AI response received:', response);
                console.log('Number of improvement cards:', response.improvementCards.length);
                console.log('Improvement cards:', response.improvementCards);

                setQueryInsightsStateHelper((prev) => ({
                    ...prev,
                    stage3Data: response as QueryInsightsStage3Response,
                }));
                setIsLoadingAI(false);
            })
            .catch((error: unknown) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error getting AI recommendations'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
                setIsLoadingAI(false);
            });

        return () => clearTimeout(timer);
    };

    const handleCancelAI = () => {
        setIsLoadingAI(false);
        setAiInsightsRequested(false); // Allow requesting again after cancel
    };

    const handlePrimaryAction = (actionId: string, payload: unknown) => {
        void trpcClient.mongoClusters.collectionView.executeRecommendation
            .mutate({ actionId, payload })
            .then((result) => {
                if (result.success && result.message) {
                    // TODO: Show success message to user
                    console.log('Success:', result.message);
                }
            })
            .catch((error: unknown) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error executing recommendation'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    };

    const handleSecondaryAction = (actionId: string, payload: unknown) => {
        void trpcClient.mongoClusters.collectionView.executeRecommendation
            .mutate({ actionId, payload })
            .then((result) => {
                if (result.success && result.message) {
                    console.log('Success:', result.message);
                }
            })
            .catch((error: unknown) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error executing action'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    };

    const handleDismissTips = () => {
        setIsTipsCardDismissed(true);
        setShowTipsCard(false);
    };

    return (
        <div className="container">
            {/* Content Area */}
            <div className="contentArea">
                {/* Left Panel */}
                <div className="leftPanel">
                    {/* Metrics Row */}
                    <MetricsRow>
                        <TimeMetric label={l10n.t('Execution Time')} valueMs={executionTime} />
                        <CountMetric label={l10n.t('Documents Returned')} value={docsReturned} />
                        <CountMetric label={l10n.t('Keys Examined')} value={keysExamined} />
                        <CountMetric label={l10n.t('Documents Examined')} value={docsExamined} />
                    </MetricsRow>

                    {/* Optimization Opportunities */}
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <Text size={400} weight="semibold" className="cardSpacing" style={{ display: 'block' }}>
                            {l10n.t('Optimization Opportunities')}
                        </Text>

                        {/* Skeleton - shown only in Stage 1 */}
                        {stageState === 1 && (
                            <Skeleton className="cardSpacing">
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ width: '60%' }} />
                            </Skeleton>
                        )}

                        {/* GetPerformanceInsightsCard with CollapseRelaxed animation
                            Note: Component supports ref forwarding and applies its own spacing via className. */}
                        <CollapseRelaxed visible={stageState === 2}>
                            <GetPerformanceInsightsCard
                                className="cardSpacing"
                                bodyText={l10n.t(
                                    'Get personalized recommendations to optimize your query performance. AI will analyze your cluster configuration, index usage, execution plan, and more to suggest specific improvements.',
                                )}
                                isLoading={isLoadingAI || aiInsightsRequested}
                                onGetInsights={handleGetAISuggestions}
                                onLearnMore={() => {
                                    /* TODO: Implement learn more functionality */
                                }}
                                onCancel={handleCancelAI}
                            />
                        </CollapseRelaxed>

                        {/* AnimatedCardList for AI suggestions and tips */}
                        <AnimatedCardList>
                            {/* Analysis Card (if AI data available) */}
                            {stageState === 3 &&
                                queryInsightsState.stage3Data &&
                                queryInsightsState.stage3Data.analysisCard && (
                                    <AiCard
                                        key="analysis-card"
                                        title={l10n.t('Query Performance Analysis')}
                                        onCopy={() => {
                                            void navigator.clipboard.writeText(
                                                queryInsightsState.stage3Data?.analysisCard.content ?? '',
                                            );
                                        }}
                                    >
                                        <Text size={300}>{queryInsightsState.stage3Data?.analysisCard.content}</Text>
                                    </AiCard>
                                )}

                            {/* Error Card - shown when query execution failed */}
                            {showErrorCard && queryInsightsState.stage2Data?.concerns && (
                                <MarkdownCard
                                    key="query-execution-error"
                                    title={l10n.t('Query Execution Failed')}
                                    icon={<WarningRegular />}
                                    content={
                                        queryInsightsState.stage2Data.concerns.join('\n\n') +
                                        '\n\n---\n\n' +
                                        '**Resolving this execution error should take precedence over performance optimization.** ' +
                                        'AI analysis will still run to provide additional insights, but focus on fixing the error first.'
                                    }
                                    onCopy={() => {
                                        void navigator.clipboard.writeText(
                                            queryInsightsState.stage2Data?.concerns?.join('\n\n') ?? '',
                                        );
                                    }}
                                />
                            )}

                            {/* Improvement Cards (dynamic from AI response) */}
                            {stageState === 3 &&
                                queryInsightsState.stage3Data &&
                                (() => {
                                    console.log('=== IMPROVEMENT CARDS RENDERING ===');
                                    console.log('stageState:', stageState);
                                    console.log('queryInsightsState.stage3Data:', queryInsightsState.stage3Data);
                                    console.log(
                                        'queryInsightsState.stage3Data.improvementCards:',
                                        queryInsightsState.stage3Data.improvementCards,
                                    );
                                    console.log(
                                        'Number of cards to render:',
                                        queryInsightsState.stage3Data.improvementCards.length,
                                    );

                                    if (
                                        !queryInsightsState.stage3Data.improvementCards ||
                                        queryInsightsState.stage3Data.improvementCards.length === 0
                                    ) {
                                        console.log('SKIPPING: no improvement cards');
                                        return null;
                                    }

                                    console.log(
                                        `RENDERING ${queryInsightsState.stage3Data.improvementCards.length} improvement cards...`,
                                    );

                                    // Use Fragment to properly spread children
                                    return (
                                        <>
                                            {queryInsightsState.stage3Data?.improvementCards.map(
                                                (card: ImprovementCardConfig, index: number) => {
                                                    console.log(
                                                        `Card ${index + 1}/${queryInsightsState.stage3Data?.improvementCards.length}:`,
                                                        card.cardId,
                                                        'actionId:',
                                                        card.primaryButton.actionId,
                                                    );

                                                    // For cards with actionable recommendations (create, drop, modify), use ImprovementCard
                                                    if (
                                                        card.primaryButton.actionId === 'createIndex' ||
                                                        card.primaryButton.actionId === 'dropIndex' ||
                                                        card.primaryButton.actionId === 'modifyIndex'
                                                    ) {
                                                        console.log(
                                                            `  -> Rendering as ImprovementCard (actionId: ${card.primaryButton.actionId})`,
                                                        );
                                                        return (
                                                            <ImprovementCard
                                                                key={card.cardId}
                                                                config={card}
                                                                onPrimaryAction={handlePrimaryAction}
                                                                onSecondaryAction={handleSecondaryAction}
                                                                onCopy={() => {
                                                                    void navigator.clipboard.writeText(
                                                                        card.mongoShellCommand,
                                                                    );
                                                                }}
                                                            />
                                                        );
                                                    }

                                                    // For informational cards (no action), use AiCard with simplified content
                                                    console.log(
                                                        `  -> Rendering as AiCard (actionId: ${card.primaryButton.actionId})`,
                                                    );
                                                    return (
                                                        <AiCard
                                                            key={card.cardId || `card-${index}`}
                                                            title={card.title}
                                                            onCopy={() => {
                                                                void navigator.clipboard.writeText(card.description);
                                                            }}
                                                        >
                                                            <Text size={300}>{card.description}</Text>
                                                        </AiCard>
                                                    );
                                                },
                                            )}
                                        </>
                                    );
                                })()}

                            {/* Performance Tips Card */}
                            {showTipsCard && !isTipsCardDismissed && (
                                <TipsCard
                                    key="performance-tips"
                                    title={l10n.t('DocumentDB Performance Tips')}
                                    tips={performanceTips}
                                    onDismiss={handleDismissTips}
                                />
                            )}

                            {/* Educational Markdown Card - Understanding Query Execution */}
                            {stageState === 3 &&
                                queryInsightsState.stage3Data &&
                                queryInsightsState.stage3Data.educationalContent && (
                                    <MarkdownCard
                                        key="understanding-execution"
                                        icon={<BrainSparkleRegular />}
                                        title={l10n.t('Understanding Your Query Execution Plan')}
                                        content={queryInsightsState.stage3Data.educationalContent}
                                        onCopy={() => {
                                            void navigator.clipboard.writeText(
                                                queryInsightsState.stage3Data?.educationalContent ?? '',
                                            );
                                        }}
                                    />
                                )}
                        </AnimatedCardList>
                    </div>

                    {/* Query Plan Summary - Mobile Only */}
                    <div className="queryPlanWrapper">
                        <QueryPlanSummary
                            stage1Data={queryInsightsState.stage1Data}
                            stage2Data={queryInsightsState.stage2Data}
                            stage1Loading={stageState === 1 && !queryInsightsState.stage1Data}
                            stage2Loading={stageState >= 2 && !queryInsightsState.stage2Data}
                        />
                    </div>
                </div>

                {/* Right Panel */}
                <div className="rightPanel">
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

                    {/* Query Plan Summary - Desktop Only */}
                    <div className="queryPlanInPanel">
                        <QueryPlanSummary
                            stage1Data={queryInsightsState.stage1Data}
                            stage2Data={queryInsightsState.stage2Data}
                            stage1Loading={stageState === 1 && !queryInsightsState.stage1Data}
                            stage2Loading={stageState >= 2 && !queryInsightsState.stage2Data}
                        />
                    </div>

                    {/* Quick Actions - Desktop Only */}
                    {/* <div className="quickActionsInPanel">
                        <QuickActions stageState={stageState} />
                    </div> */}
                </div>

                {/* Quick Actions - Mobile Only (appears last) */}
                {/* <div className="quickActionsWrapper">
                    <QuickActions stageState={stageState} />
                </div> */}
            </div>
        </div>
    );
};
