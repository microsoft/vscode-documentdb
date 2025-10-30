/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Label,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Skeleton,
    SkeletonItem,
    Text,
    tokens,
} from '@fluentui/react-components';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { type JSX, useEffect, useState } from 'react';
import { AnimatedCardList } from './components';
import { CountMetric } from './components/metricsRow/CountMetric';
import { MetricsRow } from './components/metricsRow/MetricsRow';
import { TimeMetric } from './components/metricsRow/TimeMetric';
import { AiCard, GetPerformanceInsightsCard, TipsCard } from './components/optimizationCards';
import { QueryPlanSummary } from './components/QueryPlanSummary';
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
    const [stageState, setStageState] = useState<1 | 2 | 3>(1);
    const [isLoadingAI, setIsLoadingAI] = useState(false);
    const [aiInsightsRequested, setAiInsightsRequested] = useState(false); // One-way flag: once true, stays true
    const [showSuggestion1, setShowSuggestion1] = useState(false);
    const [showSuggestion2, setShowSuggestion2] = useState(false);
    const [showSuggestion3, setShowSuggestion3] = useState(false);
    const [showTipsCard, setShowTipsCard] = useState(false);
    const [isTipsCardDismissed, setIsTipsCardDismissed] = useState(false);
    const [selectedTab, setSelectedTab] = useState<Stage | null>(null);

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

    // Automatically start stage 2 analysis when component mounts
    useEffect(() => {
        const timer = setTimeout(() => {
            setStageState(2);
            // Update metrics when stage 2 starts
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
        // Show tips card after 5 seconds
        const tipsTimer = setTimeout(() => {
            setShowTipsCard(true);
        }, 1000);

        setTimeout(() => {
            setIsLoadingAI(false);
            setStageState(3);
            // Stagger suggestion animations with 1s delay for each
            setTimeout(() => setShowSuggestion1(true), 1000);
            setTimeout(() => setShowSuggestion2(true), 2000);
            setTimeout(() => setShowSuggestion3(true), 3000);
        }, 5000);

        return () => clearTimeout(tipsTimer);
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

                        {/* Skeleton - shown only in stage 1 */}
                        {stageState === 1 && (
                            <Skeleton className="cardSpacing">
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ width: '60%' }} />
                            </Skeleton>
                        )}

                        {/* GetPerformanceInsightsCard with CollapseRelaxed animation
                            Note: Wrapped in div for proper ref forwarding to motion component.
                            cardSpacing class is applied to avoid layout shifts - when CollapseRelaxed
                            collapses content to 0 height, CSS gap would still create spacing. */}
                        <CollapseRelaxed visible={stageState === 2}>
                            <div className="cardSpacing">
                                <GetPerformanceInsightsCard
                                    bodyText={l10n.t(
                                        'Your query is performing optimally for the current dataset size. However, as data grows, consider adding an index.',
                                    )}
                                    recommendation={l10n.t('Recommended: Create index on user_id')}
                                    isLoading={isLoadingAI || aiInsightsRequested}
                                    onGetInsights={handleGetAISuggestions}
                                    onLearnMore={() => {
                                        /* TODO: Implement learn more functionality */
                                    }}
                                    onCancel={() => {
                                        setIsLoadingAI(false);
                                        setStageState(2);
                                    }}
                                />
                            </div>
                        </CollapseRelaxed>

                        {/* AnimatedCardList for AI suggestions and tips */}
                        <AnimatedCardList>
                            {stageState === 3 && showSuggestion1 && (
                                <AiCard
                                    key="create-index"
                                    title={l10n.t('Create Index')}
                                    titleChildren={
                                        <Badge appearance="tint" shape="rounded" color="danger" size="small">
                                            {l10n.t('HIGH PRIORITY')}
                                        </Badge>
                                    }
                                    onCopy={() => {
                                        /* TODO: Implement copy functionality */
                                    }}
                                >
                                    <Text
                                        size={300}
                                        style={{
                                            display: 'block',
                                            marginBottom: '12px',
                                        }}
                                    >
                                        {l10n.t(
                                            'The query performs a COLLSCAN examining 10,000 documents to return only 2, indicating poor selectivity without an index.',
                                        )}
                                    </Text>
                                    <div style={{ marginBottom: '12px' }}>
                                        <Label size="small">{l10n.t('Recommended Index')}</Label>
                                        <div style={{ marginTop: '4px' }}>
                                            <Popover
                                                positioning="below-start"
                                                withArrow
                                                openOnHover
                                                mouseLeaveDelay={0}
                                            >
                                                <PopoverTrigger disableButtonEnhancement>
                                                    <Button appearance="secondary" size="small">
                                                        {'{ user_id: 1 }'}
                                                    </Button>
                                                </PopoverTrigger>
                                                <PopoverSurface style={{ padding: '16px', maxWidth: '400px' }}>
                                                    <Text
                                                        size={300}
                                                        weight="semibold"
                                                        style={{ display: 'block', marginBottom: '8px' }}
                                                    >
                                                        {l10n.t('Index Details')}
                                                    </Text>
                                                    <Text size={200}>
                                                        {l10n.t(
                                                            'An index on user_id would allow direct lookup of matching documents.',
                                                        )}
                                                    </Text>
                                                </PopoverSurface>
                                            </Popover>
                                        </div>
                                    </div>
                                    <Text
                                        size={200}
                                        style={{
                                            color: tokens.colorNeutralForeground3,
                                            display: 'block',
                                            marginBottom: '12px',
                                        }}
                                    >
                                        {l10n.t(
                                            'Risks: Additional write and storage overhead for maintaining a new index.',
                                        )}
                                    </Text>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <Button appearance="primary" size="small">
                                            {l10n.t('Apply')}
                                        </Button>
                                        <Button appearance="subtle" size="small">
                                            {l10n.t('Learn More')}
                                        </Button>
                                    </div>
                                </AiCard>
                            )}

                            {stageState === 3 && showSuggestion2 && (
                                <AiCard
                                    key="no-index-changes"
                                    title={l10n.t('No Index Changes Recommended')}
                                    onCopy={() => {
                                        /* TODO: Implement copy functionality */
                                    }}
                                >
                                    <Text size={300} style={{ display: 'block', marginBottom: '8px' }}>
                                        {l10n.t(
                                            'The query performs a COLLSCAN examining 50 documents to return 28 (boolean filter selectivity ~56%). A boolean field with over half the collection matching offers low selectivity, so an index on flag alone would not significantly reduce I/O.',
                                        )}
                                    </Text>
                                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                        {l10n.t(
                                            'Execution time is already only 0.02 ms on a 50-document collection, so optimization benefit is negligible.',
                                        )}
                                    </Text>
                                </AiCard>
                            )}

                            {stageState === 3 && showSuggestion3 && (
                                <AiCard
                                    key="execution-plan"
                                    title={l10n.t('Understanding Your Query Execution Plan')}
                                    onCopy={() => {
                                        /* TODO: Implement copy functionality */
                                    }}
                                >
                                    <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                                        {l10n.t(
                                            'Your current query uses a COLLSCAN (collection scan) strategy, which means MongoDB examines all 10,000 documents in the collection to find the 2 matching documents. This is highly inefficient with a selectivity of only 0.02%.',
                                        )}
                                    </Text>
                                    <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                                        {l10n.t(
                                            'With the recommended index on user_id, the execution plan would change to:',
                                        )}
                                    </Text>
                                    <div
                                        style={{
                                            padding: '12px',
                                            backgroundColor: tokens.colorNeutralBackground2,
                                            borderRadius: tokens.borderRadiusMedium,
                                            marginBottom: '12px',
                                        }}
                                    >
                                        <Text
                                            size={300}
                                            style={{
                                                display: 'block',
                                                fontFamily: 'monospace',
                                                marginBottom: '4px',
                                            }}
                                        >
                                            <strong>IXSCAN</strong> {l10n.t('(Index Scan on user_id)')}
                                        </Text>
                                        <Text
                                            size={200}
                                            style={{
                                                display: 'block',
                                                color: tokens.colorNeutralForeground3,
                                                marginLeft: '16px',
                                                marginBottom: '8px',
                                            }}
                                        >
                                            {l10n.t(
                                                'Scan the index to find matching user_id values (~2 index entries)',
                                            )}
                                        </Text>
                                        <Text
                                            size={300}
                                            style={{
                                                display: 'block',
                                                fontFamily: 'monospace',
                                                marginBottom: '4px',
                                            }}
                                        >
                                            <strong>FETCH</strong> {l10n.t('(Document Retrieval)')}
                                        </Text>
                                        <Text
                                            size={200}
                                            style={{
                                                display: 'block',
                                                color: tokens.colorNeutralForeground3,
                                                marginLeft: '16px',
                                                marginBottom: '8px',
                                            }}
                                        >
                                            {l10n.t('Retrieve only the matching documents (~2 documents)')}
                                        </Text>
                                        <Text
                                            size={300}
                                            style={{
                                                display: 'block',
                                                fontFamily: 'monospace',
                                                marginBottom: '4px',
                                            }}
                                        >
                                            <strong>PROJECTION</strong> {l10n.t('(Field Selection)')}
                                        </Text>
                                        <Text
                                            size={200}
                                            style={{
                                                display: 'block',
                                                color: tokens.colorNeutralForeground3,
                                                marginLeft: '16px',
                                            }}
                                        >
                                            {l10n.t('Return only the requested fields')}
                                        </Text>
                                    </div>
                                </AiCard>
                            )}

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
