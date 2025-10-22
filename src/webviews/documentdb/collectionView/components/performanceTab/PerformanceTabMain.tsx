/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Card,
    Label,
    makeStyles,
    Popover,
    PopoverSurface,
    PopoverTrigger,
    shorthands,
    Skeleton,
    SkeletonItem,
    Spinner,
    Tab,
    TabList,
    Text,
    tokens,
    Tooltip,
} from '@fluentui/react-components';
import {
    ChevronLeftRegular,
    ChevronRightRegular,
    CopyRegular,
    DismissRegular,
    DocumentArrowLeftRegular,
    EyeRegular,
    InfoRegular,
    LayerRegular,
    LightbulbRegular,
    SparkleRegular,
} from '@fluentui/react-icons';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { type JSX, useEffect, useState } from 'react';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
    },
    contentArea: {
        ...shorthands.padding('20px', '20px', '20px', '5px'),
        flex: 1,
        overflowY: 'scroll',
        overflowX: 'hidden',
        display: 'flex',
        ...shorthands.gap('20px'),
        '@media (min-width: 1200px)': {
            flexDirection: 'row',
        },
        '@media (max-width: 1199px)': {
            flexDirection: 'column',
        },
    },
    leftPanel: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('20px'),
        minHeight: 0,
        '@media (min-width: 1200px)': {
            flex: '1 1 60%',
            order: 1,
        },
        '@media (max-width: 1199px)': {
            flex: '1',
            order: 2,
        },
    },
    rightPanel: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('20px'),
        '@media (min-width: 1200px)': {
            flex: '1 1 40%',
            order: 2,
        },
        '@media (max-width: 1199px)': {
            flex: '1',
            order: 1,
        },
    },
    metricsWrapper: {
        '@media (min-width: 1200px)': {
            display: 'none',
        },
        '@media (max-width: 1199px)': {
            display: 'block',
            order: 0,
            marginBottom: '20px',
        },
    },
    quickActionsWrapper: {
        '@media (min-width: 1200px)': {
            display: 'none',
        },
        '@media (max-width: 1199px)': {
            display: 'block',
            order: 3,
        },
    },
    quickActionsInPanel: {
        '@media (min-width: 1200px)': {
            display: 'block',
        },
        '@media (max-width: 1199px)': {
            display: 'none',
        },
    },
    queryPlanWrapper: {
        '@media (min-width: 1200px)': {
            display: 'none',
        },
        '@media (max-width: 1199px)': {
            display: 'block',
        },
    },
    queryPlanInPanel: {
        '@media (min-width: 1200px)': {
            display: 'block',
        },
        '@media (max-width: 1199px)': {
            display: 'none',
        },
    },
    metricsRow: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        ...shorthands.gap('16px'),
        minWidth: 0,
    },
    metricsRowInPanel: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        ...shorthands.gap('16px'),
        minWidth: 0,
        '@media (min-width: 1200px)': {
            display: 'grid',
        },
        '@media (max-width: 1199px)': {
            display: 'none',
        },
    },
    metricCard: {
        ...shorthands.padding('16px'),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        textAlign: 'left',
        ...shorthands.gap('8px'),
    },
    metricLabel: {
        fontSize: '12px',
        fontWeight: 600,
        color: tokens.colorNeutralForeground2,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        width: '100%',
    },
    metricValue: {
        fontSize: '28px',
        fontWeight: 600,
        lineHeight: '32px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        width: '100%',
    },
    executionSummary: {
        ...shorthands.padding('16px'),
        flexShrink: 0,
    },
    summaryGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        ...shorthands.gap('16px'),
        marginTop: '12px',
    },
    summaryItem: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('4px'),
        alignItems: 'flex-start',
    },
    efficiencyIndicator: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
        ...shorthands.padding('12px'),
        ...shorthands.borderRadius('6px'),
        backgroundColor: tokens.colorNeutralBackground3,
    },
    efficiencyDot: {
        width: '12px',
        height: '12px',
        ...shorthands.borderRadius('50%'),
    },
    excellentDot: {
        backgroundColor: tokens.colorPaletteGreenBackground3,
    },
    optimizationTitle: {
        marginBottom: '12px',
        display: 'block',
    },
    aiCard: {
        ...shorthands.padding('20px'),
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.border('1px', 'solid', tokens.colorBrandStroke1),
        marginBottom: '12px',
    },
    suggestionCard: {
        ...shorthands.padding('16px'),
        marginBottom: '12px',
    },
    tipsCard: {
        ...shorthands.padding('20px'),
        marginTop: '16px',
        backgroundColor: tokens.colorNeutralBackground3,
    },
    tipsHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
    },
    tipsNavigation: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: '16px',
    },
    tipsIndicator: {
        display: 'flex',
        ...shorthands.gap('6px'),
        alignItems: 'center',
    },
    tipsDot: {
        width: '8px',
        height: '8px',
        ...shorthands.borderRadius('50%'),
        backgroundColor: tokens.colorNeutralStroke1,
    },
    tipsDotActive: {
        backgroundColor: tokens.colorBrandBackground,
    },
    suggestionHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '12px',
    },
    codePreview: {
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.padding('8px', '12px'),
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '11px',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
        overflowX: 'auto',
        marginTop: '8px',
        marginBottom: '8px',
    },
    planSection: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
    },
    popoverContent: {
        ...shorthands.padding('16px'),
        maxWidth: '400px',
    },
    detailsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        ...shorthands.gap('12px'),
        marginTop: '12px',
    },
    detailItem: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('4px'),
    },
    codeBlock: {
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.padding('8px', '12px'),
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '11px',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
        overflowX: 'auto',
        marginTop: '8px',
    },
    queryPlanContent: {
        display: 'flex',
        ...shorthands.gap('20px'),
        marginTop: '16px',
        alignItems: 'flex-start',
    },
    queryPlanTabs: {
        flexShrink: 0,
        '& button': {
            fontSize: '12px',
            fontWeight: 600,
        },
    },
    queryPlanDetails: {
        flex: 1,
        minWidth: 0,
    },
    queryPlanPlaceholder: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...shorthands.padding('40px', '20px'),
        textAlign: 'center',
        color: tokens.colorNeutralForeground3,
    },
});

type Stage = 'IXSCAN' | 'FETCH' | 'PROJECTION';

interface StageDetails {
    stage: Stage;
    indexName?: string;
    keysExamined?: number;
    docsExamined?: number;
    nReturned?: number;
    indexBounds?: string;
}

export const PerformanceTabMain = (): JSX.Element => {
    const styles = useStyles();
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
    };

    return (
        <div className={styles.container}>
            {/* Content Area */}
            <div className={styles.contentArea}>
                {/* Metrics Row - Mobile Only (appears first) */}
                <div className={styles.metricsWrapper}>
                    <div className={styles.metricsRow}>
                        <Tooltip content={l10n.t('WIP: Available at Stage 1')} relationship="label">
                            <Card className={styles.metricCard} appearance="filled">
                                <div className={styles.metricLabel}>{l10n.t('Execution Time')}</div>
                                <div className={styles.metricValue}>{stageState >= 2 ? '2.333 ms' : '2.35 ms'}</div>
                            </Card>
                        </Tooltip>
                        <Tooltip content={l10n.t('WIP: Available at Stage 1')} relationship="label">
                            <Card className={styles.metricCard} appearance="filled">
                                <div className={styles.metricLabel}>{l10n.t('Documents Returned')}</div>
                                <div className={styles.metricValue}>2</div>
                            </Card>
                        </Tooltip>
                        <Tooltip content={l10n.t('WIP: Available at Stage 2')} relationship="label">
                            <Card className={styles.metricCard} appearance="filled">
                                <div className={styles.metricLabel}>{l10n.t('Keys Examined')}</div>
                                <div className={styles.metricValue}>
                                    {stageState >= 2 ? '2' : <SkeletonItem size={28} />}
                                </div>
                            </Card>
                        </Tooltip>
                        <Tooltip content={l10n.t('WIP: Available at Stage 2')} relationship="label">
                            <Card className={styles.metricCard} appearance="filled">
                                <div className={styles.metricLabel}>{l10n.t('Docs Examined')}</div>
                                <div className={styles.metricValue}>
                                    {stageState >= 2 ? '10,000' : <SkeletonItem size={28} />}
                                </div>
                            </Card>
                        </Tooltip>
                    </div>
                </div>
                {/* Left Panel */}
                <div className={styles.leftPanel}>
                    {/* Metrics Row - Desktop Only */}
                    <div className={styles.metricsRowInPanel}>
                        <Tooltip content={l10n.t('WIP: Available at Stage 1')} relationship="label">
                            <Card className={styles.metricCard} appearance="filled">
                                <div className={styles.metricLabel}>{l10n.t('Execution Time')}</div>
                                <div className={styles.metricValue}>{stageState >= 2 ? '2.333 ms' : '2.35 ms'}</div>
                            </Card>
                        </Tooltip>
                        <Tooltip content={l10n.t('WIP: Available at Stage 1')} relationship="label">
                            <Card className={styles.metricCard} appearance="filled">
                                <div className={styles.metricLabel}>{l10n.t('Documents Returned')}</div>
                                <div className={styles.metricValue}>2</div>
                            </Card>
                        </Tooltip>
                        <Tooltip content={l10n.t('WIP: Available at Stage 2')} relationship="label">
                            <Card className={styles.metricCard} appearance="filled">
                                <div className={styles.metricLabel}>{l10n.t('Keys Examined')}</div>
                                <div className={styles.metricValue}>
                                    {stageState >= 2 ? '2' : <SkeletonItem size={28} />}
                                </div>
                            </Card>
                        </Tooltip>
                        <Tooltip content={l10n.t('WIP: Available at Stage 2')} relationship="label">
                            <Card className={styles.metricCard} appearance="filled">
                                <div className={styles.metricLabel}>{l10n.t('Docs Examined')}</div>
                                <div className={styles.metricValue}>
                                    {stageState >= 2 ? '10,000' : <SkeletonItem size={28} />}
                                </div>
                            </Card>
                        </Tooltip>
                    </div>

                    {/* Optimization Opportunities */}
                    <div>
                        <Text weight="semibold" size={400} className={styles.optimizationTitle}>
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
                                <Card className={styles.aiCard}>
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
                                    <Card className={styles.suggestionCard}>
                                        <div style={{ display: 'flex', gap: '16px' }}>
                                            <SparkleRegular
                                                fontSize={32}
                                                style={{ color: tokens.colorBrandForeground1, flexShrink: 0 }}
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div className={styles.suggestionHeader}>
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
                                                                <Badge
                                                                    appearance="tint"
                                                                    shape="rounded"
                                                                    style={{ cursor: 'pointer', fontSize: '12px' }}
                                                                >
                                                                    user_id_1
                                                                </Badge>
                                                            </PopoverTrigger>
                                                            <PopoverSurface className={styles.popoverContent}>
                                                                <Text
                                                                    weight="semibold"
                                                                    size={400}
                                                                    style={{ display: 'block', marginBottom: '8px' }}
                                                                >
                                                                    {l10n.t('Index Details')}
                                                                </Text>
                                                                <div className={styles.codeBlock}>
                                                                    {`db.getCollection("a").createIndex({"user_id":1},{})`}
                                                                </div>
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
                                    <Card className={styles.suggestionCard}>
                                        <div style={{ display: 'flex', gap: '16px' }}>
                                            <SparkleRegular
                                                fontSize={32}
                                                style={{ color: tokens.colorNeutralForeground3, flexShrink: 0 }}
                                            />
                                            <div style={{ flex: 1 }}>
                                                <div className={styles.suggestionHeader}>
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
                                    <Card className={styles.suggestionCard}>
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
                                                <div className={styles.suggestionHeader}>
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
                                <Card className={styles.suggestionCard}>
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
                    <div className={styles.queryPlanWrapper}>
                        <Card className={styles.planSection}>
                            <Text size={400} weight="semibold">
                                {l10n.t('Query Plan Summary')}
                            </Text>

                            <div className={styles.queryPlanContent}>
                                <div className={styles.queryPlanTabs}>
                                    <TabList
                                        selectedValue={selectedTab}
                                        onTabSelect={(_, data) => setSelectedTab(data.value as Stage)}
                                        vertical
                                    >
                                        <Tab icon={<LayerRegular />} value="IXSCAN">
                                            IXSCAN
                                        </Tab>
                                        <Tab icon={<LayerRegular />} value="FETCH">
                                            FETCH
                                        </Tab>
                                        <Tab icon={<LayerRegular />} value="PROJECTION">
                                            PROJECTION
                                        </Tab>
                                    </TabList>
                                </div>

                                <div className={styles.queryPlanDetails}>
                                    {selectedTab !== null ? (
                                        <>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    marginBottom: '12px',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <Text weight="semibold" size={400}>
                                                        {l10n.t('Stage Details')}
                                                    </Text>
                                                    <Badge appearance="tint" shape="rounded">
                                                        {selectedTab}
                                                    </Badge>
                                                </div>
                                                <Button
                                                    appearance="subtle"
                                                    size="small"
                                                    icon={<DismissRegular />}
                                                    onClick={() => setSelectedTab(null)}
                                                />
                                            </div>

                                            <CollapseRelaxed visible={stageState >= 2}>
                                                <div>
                                                    {selectedTab === 'IXSCAN' && (
                                                        <>
                                                            <div className={styles.detailsGrid}>
                                                                <div className={styles.detailItem}>
                                                                    <Label size="small">{l10n.t('Index Name')}</Label>
                                                                    <Text>{stageDetails.IXSCAN.indexName}</Text>
                                                                </div>
                                                                <div className={styles.detailItem}>
                                                                    <Label size="small">
                                                                        {l10n.t('Keys Examined')}
                                                                    </Label>
                                                                    <Text weight="semibold">
                                                                        {stageDetails.IXSCAN.keysExamined}
                                                                    </Text>
                                                                </div>
                                                                <div className={styles.detailItem}>
                                                                    <Label size="small">{l10n.t('nReturned')}</Label>
                                                                    <Text weight="semibold">
                                                                        {stageDetails.IXSCAN.nReturned}
                                                                    </Text>
                                                                </div>
                                                            </div>
                                                            {stageDetails.IXSCAN.indexBounds && (
                                                                <>
                                                                    <Label
                                                                        size="small"
                                                                        style={{ marginTop: '12px', display: 'block' }}
                                                                    >
                                                                        {l10n.t('Index Bounds')}
                                                                    </Label>
                                                                    <div className={styles.codeBlock}>
                                                                        {stageDetails.IXSCAN.indexBounds}
                                                                    </div>
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                    {selectedTab === 'FETCH' && (
                                                        <div className={styles.detailsGrid}>
                                                            <div className={styles.detailItem}>
                                                                <Label size="small">{l10n.t('Docs Examined')}</Label>
                                                                <Text weight="semibold">
                                                                    {stageDetails.FETCH.docsExamined}
                                                                </Text>
                                                            </div>
                                                            <div className={styles.detailItem}>
                                                                <Label size="small">{l10n.t('nReturned')}</Label>
                                                                <Text weight="semibold">
                                                                    {stageDetails.FETCH.nReturned}
                                                                </Text>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {selectedTab === 'PROJECTION' && (
                                                        <div className={styles.detailsGrid}>
                                                            <div className={styles.detailItem}>
                                                                <Label size="small">{l10n.t('nReturned')}</Label>
                                                                <Text weight="semibold">
                                                                    {stageDetails.PROJECTION.nReturned}
                                                                </Text>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </CollapseRelaxed>

                                            {stageState < 2 && (
                                                <Text size={300}>
                                                    {l10n.t('Run detailed analysis to see stage metrics')}
                                                </Text>
                                            )}
                                        </>
                                    ) : (
                                        <div className={styles.queryPlanPlaceholder}>
                                            <InfoRegular style={{ fontSize: '48px', marginBottom: '12px' }} />
                                            <Text size={400} weight="semibold" style={{ marginBottom: '4px' }}>
                                                {l10n.t('No Stage Selected')}
                                            </Text>
                                            <Text size={300}>{l10n.t('Select a stage to view its details')}</Text>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Card>
                    </div>
                </div>{' '}
                {/* Right Panel */}
                <div className={styles.rightPanel}>
                    {/* Query Efficiency Analysis */}
                    <Card className={styles.executionSummary}>
                        <Text weight="semibold" size={400}>
                            {l10n.t('Query Efficiency Analysis')}
                        </Text>

                        <div className={styles.summaryGrid}>
                            <div className={styles.summaryItem}>
                                <div className={styles.metricLabel}>{l10n.t('Execution Strategy')}</div>
                                {stageState >= 2 ? <Text>COLLSCAN</Text> : <SkeletonItem size={16} />}
                            </div>
                            <div className={styles.summaryItem}>
                                <div className={styles.metricLabel}>{l10n.t('Index Used')}</div>
                                {stageState >= 2 ? <Text>{l10n.t('None')}</Text> : <SkeletonItem size={16} />}
                            </div>
                            <div className={styles.summaryItem}>
                                <div className={styles.metricLabel}>{l10n.t('Examined/Returned Ratio')}</div>
                                {stageState >= 2 ? <Text>5,000 : 1</Text> : <SkeletonItem size={16} />}
                            </div>
                            <div className={styles.summaryItem}>
                                <div className={styles.metricLabel}>{l10n.t('In-Memory Sort')}</div>
                                {stageState >= 2 ? <Text>{l10n.t('No')}</Text> : <SkeletonItem size={16} />}
                            </div>
                        </div>

                        <div style={{ marginTop: '16px' }}>
                            <div className={styles.metricLabel} style={{ marginBottom: '8px', display: 'block' }}>
                                {l10n.t('Performance Rating')}
                            </div>
                            <CollapseRelaxed visible={stageState >= 2}>
                                <div className={styles.efficiencyIndicator}>
                                    <div
                                        className={styles.efficiencyDot}
                                        style={{ backgroundColor: tokens.colorPaletteRedBackground3 }}
                                    />
                                    <div style={{ flex: 1 }}>
                                        <Text weight="semibold">{l10n.t('Poor')}</Text>
                                        <Text
                                            size={200}
                                            style={{ display: 'block', color: tokens.colorNeutralForeground3 }}
                                        >
                                            {l10n.t('Only 0.02% of examined documents were returned')}
                                        </Text>
                                    </div>
                                </div>
                            </CollapseRelaxed>
                            {stageState < 2 && <SkeletonItem size={16} />}
                        </div>
                    </Card>

                    {/* Query Plan Summary - Desktop Only */}
                    <div className={styles.queryPlanInPanel}>
                        <Card className={styles.planSection}>
                            <Text size={400} weight="semibold">
                                {l10n.t('Query Plan Summary')}
                            </Text>

                            <div className={styles.queryPlanContent}>
                                <div className={styles.queryPlanTabs}>
                                    <TabList
                                        selectedValue={selectedTab}
                                        onTabSelect={(_, data) => setSelectedTab(data.value as Stage)}
                                        vertical
                                    >
                                        <Tab icon={<LayerRegular />} value="IXSCAN">
                                            IXSCAN
                                        </Tab>
                                        <Tab icon={<LayerRegular />} value="FETCH">
                                            FETCH
                                        </Tab>
                                        <Tab icon={<LayerRegular />} value="PROJECTION">
                                            PROJECTION
                                        </Tab>
                                    </TabList>
                                </div>

                                <div className={styles.queryPlanDetails}>
                                    {selectedTab !== null ? (
                                        <>
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    marginBottom: '12px',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <Text weight="semibold" size={400}>
                                                        {l10n.t('Stage Details')}
                                                    </Text>
                                                    <Badge appearance="tint" shape="rounded">
                                                        {selectedTab}
                                                    </Badge>
                                                </div>
                                                <Button
                                                    appearance="subtle"
                                                    size="small"
                                                    icon={<DismissRegular />}
                                                    onClick={() => setSelectedTab(null)}
                                                />
                                            </div>

                                            <CollapseRelaxed visible={stageState >= 2}>
                                                <div>
                                                    {selectedTab === 'IXSCAN' && (
                                                        <>
                                                            <div className={styles.detailsGrid}>
                                                                <div className={styles.detailItem}>
                                                                    <Label size="small">{l10n.t('Index Name')}</Label>
                                                                    <Text>{stageDetails.IXSCAN.indexName}</Text>
                                                                </div>
                                                                <div className={styles.detailItem}>
                                                                    <Label size="small">
                                                                        {l10n.t('Keys Examined')}
                                                                    </Label>
                                                                    <Text weight="semibold">
                                                                        {stageDetails.IXSCAN.keysExamined}
                                                                    </Text>
                                                                </div>
                                                                <div className={styles.detailItem}>
                                                                    <Label size="small">{l10n.t('nReturned')}</Label>
                                                                    <Text weight="semibold">
                                                                        {stageDetails.IXSCAN.nReturned}
                                                                    </Text>
                                                                </div>
                                                            </div>
                                                            {stageDetails.IXSCAN.indexBounds && (
                                                                <>
                                                                    <Label
                                                                        size="small"
                                                                        style={{ marginTop: '12px', display: 'block' }}
                                                                    >
                                                                        {l10n.t('Index Bounds')}
                                                                    </Label>
                                                                    <div className={styles.codeBlock}>
                                                                        {stageDetails.IXSCAN.indexBounds}
                                                                    </div>
                                                                </>
                                                            )}
                                                        </>
                                                    )}
                                                    {selectedTab === 'FETCH' && (
                                                        <div className={styles.detailsGrid}>
                                                            <div className={styles.detailItem}>
                                                                <Label size="small">{l10n.t('Docs Examined')}</Label>
                                                                <Text weight="semibold">
                                                                    {stageDetails.FETCH.docsExamined}
                                                                </Text>
                                                            </div>
                                                            <div className={styles.detailItem}>
                                                                <Label size="small">{l10n.t('nReturned')}</Label>
                                                                <Text weight="semibold">
                                                                    {stageDetails.FETCH.nReturned}
                                                                </Text>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {selectedTab === 'PROJECTION' && (
                                                        <div className={styles.detailsGrid}>
                                                            <div className={styles.detailItem}>
                                                                <Label size="small">{l10n.t('nReturned')}</Label>
                                                                <Text weight="semibold">
                                                                    {stageDetails.PROJECTION.nReturned}
                                                                </Text>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </CollapseRelaxed>

                                            {stageState < 2 && (
                                                <Text size={300}>
                                                    {l10n.t('Run detailed analysis to see stage metrics')}
                                                </Text>
                                            )}
                                        </>
                                    ) : (
                                        <div className={styles.queryPlanPlaceholder}>
                                            <InfoRegular style={{ fontSize: '48px', marginBottom: '12px' }} />
                                            <Text size={400} weight="semibold" style={{ marginBottom: '4px' }}>
                                                {l10n.t('No Stage Selected')}
                                            </Text>
                                            <Text size={300}>{l10n.t('Select a stage to view its details')}</Text>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Card>
                    </div>

                    {/* Quick Actions - Desktop Only */}
                    <div className={styles.quickActionsInPanel}>
                        {stageState >= 2 && (
                            <Card style={{ padding: '16px' }}>
                                <Text weight="semibold" size={400} style={{ display: 'block', marginBottom: '12px' }}>
                                    {l10n.t('Quick Actions')}
                                </Text>
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px',
                                        alignItems: 'flex-start',
                                    }}
                                >
                                    <Button appearance="secondary" size="small" icon={<DocumentArrowLeftRegular />}>
                                        {l10n.t('Export Optimization Opportunities')}
                                    </Button>
                                    <Button appearance="secondary" size="small" icon={<DocumentArrowLeftRegular />}>
                                        {l10n.t('Export Execution Plan Details')}
                                    </Button>
                                    <Button appearance="secondary" size="small" icon={<EyeRegular />}>
                                        {l10n.t('View Raw Explain Output')}
                                    </Button>
                                </div>
                            </Card>
                        )}
                    </div>
                </div>
                {/* Quick Actions - Mobile Only (appears last) */}
                <div className={styles.quickActionsWrapper}>
                    {stageState >= 2 && (
                        <Card style={{ padding: '16px' }}>
                            <Text weight="semibold" size={400} style={{ display: 'block', marginBottom: '12px' }}>
                                {l10n.t('Quick Actions')}
                            </Text>
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                    alignItems: 'flex-start',
                                }}
                            >
                                <Button appearance="secondary" size="small" icon={<DocumentArrowLeftRegular />}>
                                    {l10n.t('Export Optimization Opportunities')}
                                </Button>
                                <Button appearance="secondary" size="small" icon={<DocumentArrowLeftRegular />}>
                                    {l10n.t('Export Execution Plan Details')}
                                </Button>
                                <Button appearance="secondary" size="small" icon={<EyeRegular />}>
                                    {l10n.t('View Raw Explain Output')}
                                </Button>
                            </div>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
};
