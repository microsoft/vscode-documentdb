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
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { type JSX, useEffect, useState } from 'react';
import { useTrpcClient } from '../../../../api/webview-client/useTrpcClient';
import {
    type ImprovementCard as ImprovementCardConfig,
    type QueryInsightsStage3Response,
} from '../../types/queryInsights';
import { AnimatedCardList } from './components';
import { CountMetric } from './components/metricsRow/CountMetric';
import { MetricsRow } from './components/metricsRow/MetricsRow';
import { TimeMetric } from './components/metricsRow/TimeMetric';
import { AiCard, GetPerformanceInsightsCard, ImprovementCard, TipsCard } from './components/optimizationCards';
import { QueryPlanSummary } from './components/queryPlanSummary';
import { QuickActions } from './components/QuickActions';
import { GenericCell, PerformanceRatingCell, SummaryCard } from './components/summaryCard';
import './queryInsights.scss';
import './QueryInsightsTab.scss';

type Stage = 'IXSCAN' | 'FETCH' | 'PROJECTION' | 'SORT' | 'COLLSCAN';

interface StageDetails {
    stage: Stage;
    indexName?: string;
    keysExamined?: number;
    docsExamined?: number;
    nReturned?: number;
    indexBounds?: string;
}

export const QueryInsightsMain = (): JSX.Element => {
    // Stage management:
    // Stage 1: Initial View (cheap data + query plan from explain("queryPlanner"))
    // Stage 2: Detailed Execution Analysis (from explain("executionStats"))
    // Stage 3: AI-Powered Recommendations (opt-in)
    // See: docs/design-documents/performance-advisor.md
    const { trpcClient } = useTrpcClient();
    const [stageState, setStageState] = useState<1 | 2 | 3>(1);
    const [isLoadingAI, setIsLoadingAI] = useState(false);
    const [aiInsightsRequested, setAiInsightsRequested] = useState(false); // One-way flag: once true, stays true
    const [aiData, setAiData] = useState<QueryInsightsStage3Response | null>(null);
    const [showTipsCard, setShowTipsCard] = useState(false);
    const [isTipsCardDismissed, setIsTipsCardDismissed] = useState(false);
    const [selectedTab, setSelectedTab] = useState<Stage | null>(null);

    // Debug logging for state changes
    useEffect(() => {
        console.log('stageState changed to:', stageState);
    }, [stageState]);

    useEffect(() => {
        console.log('aiData changed:', aiData);
        if (aiData) {
            console.log('  - improvementCards count:', aiData.improvementCards.length);
            console.log('  - improvementCards:', aiData.improvementCards);
        }
    }, [aiData]);

    // Metric values
    const [executionTime, setExecutionTime] = useState<number | null>(23433235);
    const [docsReturned] = useState<number | null>(2);
    const [keysExamined, setKeysExamined] = useState<number | null>(null);
    const [docsExamined, setDocsExamined] = useState<number | null>(null);

    const performanceTips = [
        {
            title: l10n.t('Use Covered Queries'),
            description: l10n.t(
                'When all queried fields are in an index, DocumentDB can return results directly from the index without fetching documents, significantly improving performance.',
            ),
        },
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

    // Automatically start Stage 2 analysis when component mounts
    useEffect(() => {
        const timer = setTimeout(() => {
            setStageState(2);
            // Update metrics when Stage 2 starts
            setExecutionTime(2.333);
            setKeysExamined(2);
            setDocsExamined(10000);
        }, 4000);

        return () => clearTimeout(timer);
    }, []);

    const handleGetAISuggestions = () => {
        setIsLoadingAI(true);
        setAiInsightsRequested(true); // Set one-way flag to prevent button from reappearing
        setIsTipsCardDismissed(false);

        // Show tips card after 1 second (while waiting for AI)
        const tipsTimer = setTimeout(() => {
            setShowTipsCard(true);
        }, 1000);

        // Call the tRPC endpoint (8 second delay expected from AI service)
        void trpcClient.mongoClusters.collectionView.getQueryInsightsStage3
            .query()
            .then((response) => {
                console.log('AI response received:', response);
                console.log('Number of improvement cards:', response.improvementCards.length);
                console.log('Improvement cards:', response.improvementCards);

                setAiData(response as QueryInsightsStage3Response);
                setIsLoadingAI(false);
                setStageState(3);
            })
            .catch((error: unknown) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Error getting AI recommendations'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
                setIsLoadingAI(false);
            });

        return () => clearTimeout(tipsTimer);
    };

    const handleCancelAI = () => {
        setIsLoadingAI(false);
        setStageState(2);
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

    const stageDetails: Record<Stage, StageDetails> = {
        IXSCAN: {
            stage: 'IXSCAN',
            indexName: 'user_id_1',
            keysExamined: stageState >= 2 ? 2 : undefined,
            nReturned: stageState >= 2 ? 2 : undefined,
            indexBounds: 'user_id: [1234, 1234]',
        },
        FETCH: {
            stage: 'FETCH',
            docsExamined: stageState >= 2 ? 10000 : undefined,
            nReturned: stageState >= 2 ? 2 : undefined,
        },
        PROJECTION: {
            stage: 'PROJECTION',
            nReturned: stageState >= 2 ? 2 : undefined,
        },
        SORT: {
            stage: 'SORT',
            nReturned: stageState >= 2 ? 2 : undefined,
        },
        COLLSCAN: {
            stage: 'COLLSCAN',
            docsExamined: stageState >= 2 ? 10000 : undefined,
            nReturned: stageState >= 2 ? 10000 : undefined,
        },
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
                        <CountMetric label={l10n.t('Docs Examined')} value={docsExamined} />
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
                                    'Your query is performing optimally for the current dataset size. However, as data grows, consider adding an index.',
                                )}
                                recommendation={l10n.t('Recommended: Create index on user_id')}
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
                            {stageState === 3 && aiData && aiData.analysisCard && (
                                <AiCard
                                    key="analysis-card"
                                    title={l10n.t('Query Performance Analysis')}
                                    onCopy={() => {
                                        void navigator.clipboard.writeText(aiData.analysisCard.content);
                                    }}
                                >
                                    <Text size={300}>{aiData.analysisCard.content}</Text>
                                </AiCard>
                            )}

                            {/* Improvement Cards (dynamic from AI response) */}
                            {stageState === 3 &&
                                aiData &&
                                (() => {
                                    console.log('=== IMPROVEMENT CARDS RENDERING ===');
                                    console.log('stageState:', stageState);
                                    console.log('aiData:', aiData);
                                    console.log('aiData.improvementCards:', aiData.improvementCards);
                                    console.log('Number of cards to render:', aiData.improvementCards.length);

                                    if (!aiData.improvementCards || aiData.improvementCards.length === 0) {
                                        console.log('SKIPPING: no improvement cards');
                                        return null;
                                    }

                                    console.log(`RENDERING ${aiData.improvementCards.length} improvement cards...`);

                                    // Use Fragment to properly spread children
                                    return (
                                        <>
                                            {aiData.improvementCards.map(
                                                (card: ImprovementCardConfig, index: number) => {
                                                    console.log(
                                                        `Card ${index + 1}/${aiData.improvementCards.length}:`,
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
                        </AnimatedCardList>
                    </div>

                    {/* Query Plan Summary - Mobile Only */}
                    <div className="queryPlanWrapper">
                        <QueryPlanSummary
                            stageState={stageState}
                            selectedTab={selectedTab}
                            setSelectedTab={setSelectedTab}
                            stageDetails={stageDetails}
                        />
                    </div>
                </div>

                {/* Right Panel */}
                <div className="rightPanel">
                    {/* Query Efficiency Analysis */}
                    <SummaryCard title={l10n.t('Query Efficiency Analysis')}>
                        <GenericCell
                            label={l10n.t('Execution Strategy')}
                            value={stageState >= 2 ? 'COLLSCAN' : undefined}
                            placeholder="skeleton"
                        />
                        <GenericCell
                            label={l10n.t('Index Used')}
                            value={stageState >= 2 ? l10n.t('None') : undefined}
                            placeholder="skeleton"
                        />
                        <GenericCell
                            label={l10n.t('Examined/Returned Ratio')}
                            value={stageState >= 2 ? '5,000 : 1' : undefined}
                            placeholder="skeleton"
                        />
                        <GenericCell
                            label={l10n.t('In-Memory Sort')}
                            value={stageState >= 2 ? l10n.t('No') : undefined}
                            placeholder="skeleton"
                        />
                        <PerformanceRatingCell
                            label={l10n.t('Performance Rating')}
                            rating={stageState >= 2 ? 'poor' : undefined}
                            description={l10n.t('Only 0.02% of examined documents were returned')}
                            visible={stageState >= 2}
                        />
                    </SummaryCard>

                    {/* Query Plan Summary - Desktop Only */}
                    <div className="queryPlanInPanel">
                        <QueryPlanSummary
                            stageState={stageState}
                            selectedTab={selectedTab}
                            setSelectedTab={setSelectedTab}
                            stageDetails={stageDetails}
                        />
                    </div>

                    {/* Quick Actions - Desktop Only */}
                    <div className="quickActionsInPanel">
                        <QuickActions stageState={stageState} />
                    </div>
                </div>

                {/* Quick Actions - Mobile Only (appears last) */}
                <div className="quickActionsWrapper">
                    <QuickActions stageState={stageState} />
                </div>
            </div>
        </div>
    );
};
