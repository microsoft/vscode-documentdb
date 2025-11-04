/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Card,
    Label,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    Skeleton,
    SkeletonItem,
    Spinner,
    Text,
    tokens,
} from '@fluentui/react-components';
import {
    ChevronLeftRegular,
    ChevronRightRegular,
    CopyRegular,
    DismissRegular,
    LightbulbRegular,
    SparkleRegular,
} from '@fluentui/react-icons';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { type JSX, useEffect, useState } from 'react';
import { MetricsRow } from './components/MetricsRow';
import { QueryEfficiencyAnalysis } from './components/QueryEfficiencyAnalysis';
import { QueryPlanSummary } from './components/QueryPlanSummary';
import { QuickActions } from './components/QuickActions';
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

export const QueryInsightsMainMock = (): JSX.Element => {
    const [stageState, setStageState] = useState<1 | 2 | 3>(1);
    const [isLoadingAI, setIsLoadingAI] = useState(false);
    const [showSuggestion1, setShowSuggestion1] = useState(false);
    const [showSuggestion2, setShowSuggestion2] = useState(false);
    const [showSuggestion3, setShowSuggestion3] = useState(false);
    const [showTipsCard, setShowTipsCard] = useState(false);
    const [currentTipIndex, setCurrentTipIndex] = useState(0);
    const [isTipsCardDismissed, setIsTipsCardDismissed] = useState(false);
    const [selectedTab, setSelectedTab] = useState<Stage | null>(null);

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
        }, 5000);

        return () => clearTimeout(timer);
    }, []);

    const handleGetAISuggestions = () => {
        setIsLoadingAI(true);
        setIsTipsCardDismissed(false);
        // Show tips card after 5 seconds
        const tipsTimer = setTimeout(() => {
            setShowTipsCard(true);
        }, 5000);

        setTimeout(() => {
            setIsLoadingAI(false);
            setStageState(3);
            // Stagger suggestion animations with 1s delay for each
            setTimeout(() => setShowSuggestion1(true), 1000);
            setTimeout(() => setShowSuggestion2(true), 2000);
            setTimeout(() => setShowSuggestion3(true), 3000);
        }, 20000);

        return () => clearTimeout(tipsTimer);
    };

    const handleNextTip = () => {
        setCurrentTipIndex((prev) => (prev + 1) % performanceTips.length);
    };

    const handlePreviousTip = () => {
        setCurrentTipIndex((prev) => (prev - 1 + performanceTips.length) % performanceTips.length);
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
                {/* Metrics Row - Mobile Only (appears first) */}
                <div className="metricsWrapper">
                    <MetricsRow stageState={stageState} />
                </div>

                {/* Left Panel */}
                <div className="leftPanel">
                    {/* Metrics Row - Desktop Only */}
                    <div className="metricsInPanel">
                        <MetricsRow stageState={stageState} />
                    </div>

                    {/* Optimization Opportunities */}
                    <div>
                        <Text
                            weight="semibold"
                            size={400}
                            className="optimizationTitle"
                            style={{ marginBottom: '12px', display: 'block' }}
                        >
                            {l10n.t('Optimization Opportunities')}
                        </Text>

                        {stageState < 2 ? (
                            <Skeleton>
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ width: '60%' }} />
                            </Skeleton>
                        ) : (
                            <CollapseRelaxed visible={stageState === 2}>
                                <Card
                                    style={{
                                        padding: '20px',
                                        backgroundColor: tokens.colorBrandBackground2,
                                        border: `1px solid ${tokens.colorBrandStroke1}`,
                                        marginBottom: '12px',
                                    }}
                                >
                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        <SparkleRegular
                                            fontSize={40}
                                            style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <Text
                                                weight="semibold"
                                                size={500}
                                                style={{ display: 'block', marginBottom: '8px' }}
                                            >
                                                {l10n.t('AI Performance Insights')}
                                            </Text>
                                            <Text size={300} style={{ display: 'block', marginBottom: '16px' }}>
                                                {l10n.t(
                                                    'Your query is performing optimally for the current dataset size. However, as data grows, consider adding an index.',
                                                )}
                                            </Text>
                                            <Text
                                                size={400}
                                                weight="semibold"
                                                style={{ display: 'block', marginBottom: '16px' }}
                                            >
                                                {l10n.t('Recommended: Create index on user_id')}
                                            </Text>
                                            {!isLoadingAI ? (
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                                    <Button
                                                        appearance="primary"
                                                        icon={<SparkleRegular />}
                                                        onClick={handleGetAISuggestions}
                                                    >
                                                        {l10n.t('Get AI Performance Insights')}
                                                    </Button>
                                                    <Button appearance="secondary">
                                                        {l10n.t('Learn more about AI Performance Insights')}
                                                    </Button>
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                    <Spinner size="small" />
                                                    <Text size={300}>{l10n.t('AI is analyzing...')}</Text>
                                                    <Button
                                                        appearance="subtle"
                                                        size="small"
                                                        onClick={() => {
                                                            setIsLoadingAI(false);
                                                            setStageState(2);
                                                        }}
                                                    >
                                                        {l10n.t('Cancel')}
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            </CollapseRelaxed>
                        )}

                        {stageState === 3 && (
                            <>
                                {/* Suggestion Card: Create Index */}
                                <CollapseRelaxed visible={showSuggestion1}>
                                    <Card style={{ padding: '16px', marginBottom: '12px' }}>
                                        <div style={{ display: 'flex', gap: '16px' }}>
                                            <SparkleRegular
                                                fontSize={32}
                                                style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }}
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'flex-start',
                                                        marginBottom: '12px',
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            marginBottom: '8px',
                                                        }}
                                                    >
                                                        <Text weight="semibold" size={400}>
                                                            {l10n.t('Create Index')}
                                                        </Text>
                                                        <Badge
                                                            appearance="tint"
                                                            shape="rounded"
                                                            color="danger"
                                                            size="small"
                                                        >
                                                            {l10n.t('HIGH PRIORITY')}
                                                        </Badge>
                                                    </div>
                                                    <Button appearance="subtle" icon={<CopyRegular />} size="small" />
                                                </div>
                                                <Text
                                                    size={300}
                                                    style={{
                                                        display: 'block',
                                                        marginTop: '12px',
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
                                                            <PopoverSurface
                                                                style={{ padding: '16px', maxWidth: '400px' }}
                                                            >
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
                                            </div>
                                        </div>
                                    </Card>
                                </CollapseRelaxed>

                                {/* No Recommendations Mock */}
                                <CollapseRelaxed visible={showSuggestion2}>
                                    <Card style={{ padding: '16px', marginBottom: '12px' }}>
                                        <div style={{ display: 'flex', gap: '16px' }}>
                                            <SparkleRegular
                                                fontSize={32}
                                                style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }}
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'flex-start',
                                                        marginBottom: '12px',
                                                    }}
                                                >
                                                    <div style={{ flex: 1 }}>
                                                        <Text
                                                            weight="semibold"
                                                            size={200}
                                                            style={{
                                                                display: 'block',
                                                                marginBottom: '4px',
                                                                color: tokens.colorNeutralForeground3,
                                                            }}
                                                        >
                                                            {l10n.t(
                                                                'NO RECOMMENDATIONS MOCK (FOR LOW-SELECTIVITY QUERIES)',
                                                            )}
                                                        </Text>
                                                        <Text
                                                            weight="semibold"
                                                            size={400}
                                                            style={{ display: 'block', marginBottom: '12px' }}
                                                        >
                                                            {l10n.t('No Index Changes Recommended')}
                                                        </Text>
                                                    </div>
                                                    <Button appearance="subtle" icon={<CopyRegular />} size="small" />
                                                </div>
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
                                            </div>
                                        </div>
                                    </Card>
                                </CollapseRelaxed>

                                {/* Execution Plan Explanation Card */}
                                <CollapseRelaxed visible={showSuggestion3}>
                                    <Card style={{ padding: '16px', marginBottom: '12px' }}>
                                        <div style={{ display: 'flex', gap: '16px' }}>
                                            <div style={{ flexShrink: 0 }}>
                                                <SparkleRegular
                                                    style={{
                                                        fontSize: '32px',
                                                        color: tokens.colorBrandForeground1,
                                                    }}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'flex-start',
                                                        marginBottom: '12px',
                                                    }}
                                                >
                                                    <Text
                                                        weight="semibold"
                                                        size={400}
                                                        style={{ display: 'block', marginBottom: '12px' }}
                                                    >
                                                        {l10n.t('Understanding Your Query Execution Plan')}
                                                    </Text>
                                                    <Button appearance="subtle" icon={<CopyRegular />} size="small" />
                                                </div>
                                                <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                                                    {l10n.t(
                                                        'Your current query uses a COLLSCAN (collection scan) strategy, which means DocumentDB examines all 10,000 documents in the collection to find the 2 matching documents. This is highly inefficient with a selectivity of only 0.02%.',
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
                                                <Text
                                                    size={300}
                                                    style={{
                                                        display: 'block',
                                                        color: tokens.colorBrandForeground1,
                                                        fontWeight: 600,
                                                    }}
                                                >
                                                    {l10n.t(
                                                        'Result: Examine ~2 documents instead of 10,000 — a 5,000x improvement in efficiency!',
                                                    )}
                                                </Text>
                                            </div>
                                        </div>
                                    </Card>
                                </CollapseRelaxed>
                            </>
                        )}

                        {/* Performance Tips Carousel - Always Last */}
                        {showTipsCard && !isTipsCardDismissed && (
                            <CollapseRelaxed visible>
                                <Card style={{ padding: '16px', marginBottom: '12px' }}>
                                    <div style={{ display: 'flex', gap: '16px' }}>
                                        <LightbulbRegular
                                            fontSize={32}
                                            style={{ color: tokens.colorPaletteYellowForeground1, flexShrink: 0 }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'flex-start',
                                                    marginBottom: '12px',
                                                }}
                                            >
                                                <Text weight="semibold" size={400}>
                                                    {l10n.t('DocumentDB Performance Tips')}
                                                </Text>
                                                <div style={{ display: 'flex', gap: '4px' }}>
                                                    <Button appearance="subtle" icon={<CopyRegular />} size="small" />
                                                    <Button
                                                        appearance="subtle"
                                                        icon={<ChevronLeftRegular />}
                                                        size="small"
                                                        onClick={handlePreviousTip}
                                                        disabled={currentTipIndex === 0}
                                                    />
                                                    <Button
                                                        appearance="subtle"
                                                        icon={<ChevronRightRegular />}
                                                        size="small"
                                                        onClick={handleNextTip}
                                                        disabled={currentTipIndex === performanceTips.length - 1}
                                                    />
                                                    <Button
                                                        appearance="subtle"
                                                        icon={<DismissRegular />}
                                                        size="small"
                                                        onClick={handleDismissTips}
                                                    />
                                                </div>
                                            </div>
                                            <Text
                                                weight="semibold"
                                                size={300}
                                                style={{ display: 'block', marginBottom: '8px' }}
                                            >
                                                {performanceTips[currentTipIndex].title}
                                            </Text>
                                            <Text size={300}>{performanceTips[currentTipIndex].description}</Text>
                                        </div>
                                    </div>
                                </Card>
                            </CollapseRelaxed>
                        )}
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
                    <QueryEfficiencyAnalysis stageState={stageState} />

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
