/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Accordion,
    AccordionHeader,
    AccordionItem,
    AccordionPanel,
    Badge,
    Card,
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Skeleton,
    SkeletonItem,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ArrowUpFilled, MoreHorizontalRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import {
    type QueryInsightsStage1Response,
    type QueryInsightsStage2Response,
} from '../../../../../../documentdb/collectionView/types/queryInsights';
import '../../queryInsights.scss';
import './QueryPlanSummary.scss';
import { StageDetailCard, type StageType } from './StageDetailCard';

type MockExample = 'single' | 'sharded' | 'collscan';

interface ShardData {
    shardName: string;
    nReturned: number;
    keysExamined: number;
    docsExamined: number;
    executionTimeMs: number;
    stages: Array<{
        stage: string;
        indexName?: string;
        keysExamined?: number;
        docsExamined?: number;
        nReturned?: number;
        bounds?: string;
        executionTimeMs?: number;
    }>;
    hasCollscan?: boolean;
    hasBlockedSort?: boolean;
}

interface QueryPlanSummaryProps {
    stage1Data: QueryInsightsStage1Response | null;
    stage2Data: QueryInsightsStage2Response | null;
    stage1Loading: boolean;
    stage2Loading: boolean;
}

export const QueryPlanSummary: React.FC<QueryPlanSummaryProps> = ({
    stage1Data,
    stage2Data,
    stage1Loading,
    stage2Loading,
}) => {
    const [mockExample, setMockExample] = React.useState<MockExample | null>(null);

    // Mock data for hardcoded examples
    const singleQueryMockData = {
        nReturned: 100,
        keysExamined: 100,
        docsExamined: 100,
        executionTimeMs: 120,
        stages: [
            {
                stage: 'IXSCAN',
                indexName: 'status_1',
                keysExamined: 100,
                nReturned: 100,
                bounds: 'status: ["PENDING", "PENDING"]',
                executionTimeMs: 65,
            },
            {
                stage: 'FETCH',
                docsExamined: 100,
                nReturned: 100,
                executionTimeMs: 45,
            },
            {
                stage: 'PROJECTION',
                nReturned: 100,
                executionTimeMs: 10,
            },
        ],
    };

    const shardedQueryMockData: ShardData[] = [
        {
            shardName: 'shardA',
            nReturned: 30,
            keysExamined: 6200,
            docsExamined: 7500,
            executionTimeMs: 850,
            stages: [
                {
                    stage: 'IXSCAN',
                    indexName: 'status_1',
                    keysExamined: 6200,
                    nReturned: 7500,
                    executionTimeMs: 510,
                },
                {
                    stage: 'FETCH',
                    docsExamined: 7500,
                    nReturned: 30,
                    executionTimeMs: 340,
                },
            ],
        },
        {
            shardName: 'shardB',
            nReturned: 20,
            keysExamined: 0,
            docsExamined: 2400,
            executionTimeMs: 550,
            stages: [
                {
                    stage: 'COLLSCAN',
                    docsExamined: 2400,
                    nReturned: 2400,
                    executionTimeMs: 385,
                },
                {
                    stage: 'SORT',
                    nReturned: 20,
                    executionTimeMs: 165,
                },
            ],
            hasCollscan: true,
            hasBlockedSort: true,
        },
    ];

    const collscanQueryMockData = {
        nReturned: 2400,
        keysExamined: 0,
        docsExamined: 2400,
        executionTimeMs: 550,
        stages: [
            {
                stage: 'COLLSCAN',
                docsExamined: 2400,
                nReturned: 2400,
                executionTimeMs: 385,
            },
            {
                stage: 'SORT',
                nReturned: 20,
                executionTimeMs: 165,
            },
        ],
    };

    const renderShardedView = (shards: ShardData[]) => {
        const totalReturned = shards.reduce((sum, shard) => sum + shard.nReturned, 0);
        const totalTime = Math.max(...shards.map((s) => s.executionTimeMs));

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Lightweight merge info */}
                <Text size={200} style={{ color: tokens.colorNeutralForeground3, paddingLeft: '4px' }}>
                    {l10n.t('SHARD_MERGE · {0} shards · {1} docs · {2}ms', shards.length, totalReturned, totalTime)}
                </Text>

                {shards.map((shard) => (
                    <div
                        key={shard.shardName}
                        style={{
                            backgroundColor: tokens.colorNeutralBackground1,
                            borderRadius: '6px',
                            borderLeft: `3px solid ${
                                shard.hasCollscan || shard.hasBlockedSort
                                    ? tokens.colorStatusWarningBorder1
                                    : tokens.colorStatusSuccessBorder1
                            }`,
                        }}
                    >
                        {/* Shard Summary (always visible) */}
                        <div style={{ padding: '12px' }}>
                            <Text weight="semibold" size={300} style={{ display: 'block', marginBottom: '8px' }}>
                                {l10n.t('Shard: {0}', shard.shardName)}
                            </Text>
                            {/* Stage flow with badges */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                                {shard.stages.map((stage, index) => (
                                    <React.Fragment key={index}>
                                        {index > 0 && <Text size={200}>→</Text>}
                                        <Badge appearance="tint" size="small" shape="rounded">
                                            {stage.stage}
                                        </Badge>
                                    </React.Fragment>
                                ))}
                                <Text size={200}>→</Text>
                                <Badge appearance="tint" size="small" shape="rounded">
                                    PROJECTION
                                </Badge>
                            </div>
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                {shard.nReturned} returned · {shard.keysExamined.toLocaleString()} keys ·{' '}
                                {shard.docsExamined.toLocaleString()} docs · {shard.executionTimeMs}ms
                            </Text>
                        </div>

                        {/* Expandable Stage Details */}
                        <Accordion collapsible>
                            <AccordionItem value="1">
                                <AccordionHeader size="small">{l10n.t('Show Stage Details')}</AccordionHeader>
                                <AccordionPanel>
                                    <div
                                        style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' }}
                                    >
                                        {shard.stages.map((stage, index) => {
                                            const metrics: Array<{ label: string; value: string | number }> = [];

                                            if (stage.keysExamined !== undefined) {
                                                metrics.push({
                                                    label: l10n.t('Keys Examined'),
                                                    value: stage.keysExamined.toLocaleString(),
                                                });
                                            }
                                            if (stage.docsExamined !== undefined) {
                                                metrics.push({
                                                    label: l10n.t('Docs Examined'),
                                                    value: stage.docsExamined.toLocaleString(),
                                                });
                                            }
                                            if (stage.bounds) {
                                                metrics.push({
                                                    label: l10n.t('Index Bounds'),
                                                    value: stage.bounds,
                                                });
                                            }

                                            return (
                                                <React.Fragment key={index}>
                                                    {index > 0 && (
                                                        <div className="stage-separator">
                                                            <ArrowUpFilled fontSize={20} />
                                                        </div>
                                                    )}
                                                    <StageDetailCard
                                                        stageType={stage.stage as StageType}
                                                        description={
                                                            stage.indexName ? `Index: ${stage.indexName}` : undefined
                                                        }
                                                        returned={stage.nReturned}
                                                        executionTimeMs={stage.executionTimeMs}
                                                        metrics={metrics.length > 0 ? metrics : undefined}
                                                    />
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>
                                </AccordionPanel>
                            </AccordionItem>
                        </Accordion>
                    </div>
                ))}
            </div>
        );
    };

    const renderSingleView = (data: typeof singleQueryMockData) => {
        return (
            <div
                style={{
                    backgroundColor: tokens.colorNeutralBackground1,
                    borderRadius: '6px',
                    borderLeft: `3px solid ${tokens.colorStatusSuccessBorder1}`,
                }}
            >
                {/* Summary (always visible) */}
                <div style={{ padding: '12px' }}>
                    <Text weight="semibold" size={400} style={{ display: 'block', marginBottom: '8px' }}>
                        {l10n.t('Query Execution Plan')}
                    </Text>
                    {/* Stage flow with badges */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                        {data.stages.map((stage, index) => (
                            <React.Fragment key={index}>
                                {index > 0 && <Text size={200}>→</Text>}
                                <Badge appearance="tint" size="small" shape="rounded">
                                    {stage.stage}
                                </Badge>
                            </React.Fragment>
                        ))}
                    </div>
                    <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                        {data.nReturned} returned · {data.keysExamined.toLocaleString()} keys ·{' '}
                        {data.docsExamined.toLocaleString()} docs · {data.executionTimeMs}ms
                    </Text>
                </div>

                {/* Expandable Stage Details */}
                <Accordion collapsible>
                    <AccordionItem value="1">
                        <AccordionHeader size="small">{l10n.t('Show Stage Details')}</AccordionHeader>
                        <AccordionPanel>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' }}>
                                {data.stages.map((stage, index) => {
                                    const metrics: Array<{ label: string; value: string | number }> = [];

                                    if (stage.keysExamined !== undefined) {
                                        metrics.push({
                                            label: l10n.t('Keys Examined'),
                                            value: stage.keysExamined.toLocaleString(),
                                        });
                                    }
                                    if (stage.docsExamined !== undefined) {
                                        metrics.push({
                                            label: l10n.t('Docs Examined'),
                                            value: stage.docsExamined.toLocaleString(),
                                        });
                                    }
                                    if (stage.bounds) {
                                        metrics.push({
                                            label: l10n.t('Index Bounds'),
                                            value: stage.bounds,
                                        });
                                    }

                                    return (
                                        <React.Fragment key={index}>
                                            {index > 0 && (
                                                <div className="stage-separator">
                                                    <ArrowUpFilled fontSize={20} />
                                                </div>
                                            )}
                                            <StageDetailCard
                                                stageType={stage.stage as StageType}
                                                description={stage.indexName ? `Index: ${stage.indexName}` : undefined}
                                                returned={stage.nReturned}
                                                executionTimeMs={stage.executionTimeMs}
                                                metrics={metrics.length > 0 ? metrics : undefined}
                                            />
                                        </React.Fragment>
                                    );
                                })}
                            </div>
                        </AccordionPanel>
                    </AccordionItem>
                </Accordion>
            </div>
        );
    };

    return (
        <Card className="planSection">
            <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}
            >
                <Text size={400} weight="semibold">
                    {l10n.t('Query Plan Summary')}
                </Text>

                {/* Dropdown menu for hardcoded examples */}
                <Menu>
                    <MenuTrigger disableButtonEnhancement>
                        <MenuButton
                            appearance="subtle"
                            icon={<MoreHorizontalRegular />}
                            aria-label={l10n.t('More options')}
                        />
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            <MenuItem onClick={() => setMockExample('single')}>
                                {l10n.t('Show Single Shard Example')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockExample('sharded')}>
                                {l10n.t('Show Sharded Example')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockExample('collscan')}>
                                {l10n.t('Show COLLSCAN Example')}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </div>

            {/* Show hardcoded example if selected */}
            {mockExample === 'single' && renderSingleView(singleQueryMockData)}
            {mockExample === 'sharded' && renderShardedView(shardedQueryMockData)}
            {mockExample === 'collscan' && renderSingleView(collscanQueryMockData)}

            {/* Show skeleton if Stage 1 is loading or no data yet (and no mock selected) */}
            {!mockExample && (stage1Loading || (!stage1Data && !stage2Data)) && (
                <Skeleton>
                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                    <SkeletonItem size={16} style={{ width: '60%' }} />
                </Skeleton>
            )}

            {/* Show real data when Stage 1 is available (and no mock selected) */}
            {!mockExample && stage1Data && !stage1Loading && (
                <div
                    style={{
                        backgroundColor: tokens.colorNeutralBackground1,
                        borderRadius: '6px',
                        borderLeft: `3px solid ${tokens.colorStatusSuccessBorder1}`,
                    }}
                >
                    {/* Summary (always visible from Stage 1) */}
                    <div style={{ padding: '12px' }}>
                        <Text weight="semibold" size={400} style={{ display: 'block', marginBottom: '8px' }}>
                            {l10n.t('Query Execution Plan')}
                        </Text>

                        {/* Stage flow with badges */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                            {stage1Data.stages.map((stage, index) => (
                                <React.Fragment key={index}>
                                    {index > 0 && <Text size={200}>→</Text>}
                                    <Badge appearance="tint" size="small" shape="rounded">
                                        {stage.stage}
                                    </Badge>
                                </React.Fragment>
                            ))}
                        </div>

                        {/* Metrics - Stage 2 data shows detailed counts, otherwise show skeleton or basic info */}
                        {stage2Loading && (
                            <Skeleton>
                                <SkeletonItem size={12} style={{ width: '80%' }} />
                            </Skeleton>
                        )}
                        {stage2Data && !stage2Loading && (
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                {stage2Data.documentsReturned} returned ·{' '}
                                {stage2Data.totalKeysExamined.toLocaleString()} keys ·{' '}
                                {stage2Data.totalDocsExamined.toLocaleString()} docs ·{' '}
                                {stage2Data.executionTimeMs.toFixed(2)}ms
                            </Text>
                        )}
                        {!stage2Data && !stage2Loading && (
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                {l10n.t('Execution time: {0}ms', stage1Data.executionTime.toFixed(2))}
                            </Text>
                        )}
                    </div>

                    {/* Expandable Stage Details - only show when Stage 2 data is available */}
                    {stage2Data && !stage2Loading && (
                        <Accordion collapsible>
                            <AccordionItem value="1">
                                <AccordionHeader size="small">{l10n.t('Show Stage Details')}</AccordionHeader>
                                <AccordionPanel>
                                    <div
                                        style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' }}
                                    >
                                        {stage2Data.stages.map((stage, index) => {
                                            const metrics: Array<{ label: string; value: string | number }> = [];

                                            if (stage.keysExamined !== undefined) {
                                                metrics.push({
                                                    label: l10n.t('Keys Examined'),
                                                    value: stage.keysExamined.toLocaleString(),
                                                });
                                            }
                                            if (stage.docsExamined !== undefined) {
                                                metrics.push({
                                                    label: l10n.t('Docs Examined'),
                                                    value: stage.docsExamined.toLocaleString(),
                                                });
                                            }

                                            return (
                                                <React.Fragment key={index}>
                                                    {index > 0 && (
                                                        <div className="stage-separator">
                                                            <ArrowUpFilled fontSize={20} />
                                                        </div>
                                                    )}
                                                    <StageDetailCard
                                                        stageType={stage.stage as StageType}
                                                        description={
                                                            stage.indexName ? `Index: ${stage.indexName}` : undefined
                                                        }
                                                        returned={stage.nReturned}
                                                        executionTimeMs={stage.executionTimeMs}
                                                        metrics={metrics.length > 0 ? metrics : undefined}
                                                    />
                                                </React.Fragment>
                                            );
                                        })}
                                    </div>
                                </AccordionPanel>
                            </AccordionItem>
                        </Accordion>
                    )}
                </div>
            )}
        </Card>
    );
};
