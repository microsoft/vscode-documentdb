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
    Button,
    Card,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Text,
    tokens,
} from '@fluentui/react-components';
import { MoreHorizontalRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import '../queryInsights.scss';
import './QueryPlanSummary.scss';
import { StageDetailCard } from './queryPlanSummary/StageDetailCard';

type Stage = 'IXSCAN' | 'FETCH' | 'PROJECTION' | 'SORT' | 'COLLSCAN';

interface StageDetails {
    stage: Stage;
    indexName?: string;
    keysExamined?: number;
    docsExamined?: number;
    nReturned?: number;
    indexBounds?: string;
}

interface ShardData {
    shardName: string;
    nReturned: number;
    keysExamined: number;
    docsExamined: number;
    executionTimeMs: number;
    plan: {
        stage: Stage;
        indexName?: string;
    };
    hasCollscan?: boolean;
    hasBlockedSort?: boolean;
}

interface QueryPlanSummaryProps {
    stageState: 1 | 2 | 3;
    selectedTab: Stage | null;
    setSelectedTab: (tab: Stage | null) => void;
    stageDetails: Record<Stage, StageDetails>;
}

type MockLayout = 'expandable-shards' | 'expandable-single';

export const QueryPlanSummary: React.FC<QueryPlanSummaryProps> = () => {
    const [mockLayout, setMockLayout] = React.useState<MockLayout>('expandable-single');

    // Mock sharded data based on performance-advisor.md example
    const shardedData: ShardData[] = [
        {
            shardName: 'shardA',
            nReturned: 30,
            keysExamined: 6200,
            docsExamined: 7500,
            executionTimeMs: 850,
            plan: {
                stage: 'FETCH',
                indexName: 'status_1',
            },
        },
        {
            shardName: 'shardB',
            nReturned: 20,
            keysExamined: 0,
            docsExamined: 2400,
            executionTimeMs: 550,
            plan: {
                stage: 'SORT',
            },
            hasCollscan: true,
            hasBlockedSort: true,
        },
    ];

    // Mock 6: Expandable Shards (variation of compact list with stage details)
    const renderExpandableShardsView = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Lightweight merge info */}
            <Text size={200} style={{ color: tokens.colorNeutralForeground3, paddingLeft: '4px' }}>
                {l10n.t('SHARD_MERGE · 2 shards · 50 docs · 1.4s')}
            </Text>

            {shardedData.map((shard) => (
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
                            {shard.plan.stage === 'FETCH' && shard.plan.indexName ? (
                                <>
                                    <Badge appearance="tint" size="small" shape="rounded">
                                        IXSCAN
                                    </Badge>
                                    <Text size={200}>→</Text>
                                    <Badge appearance="tint" size="small" shape="rounded">
                                        FETCH
                                    </Badge>
                                    <Text size={200}>→</Text>
                                    <Badge appearance="tint" size="small" shape="rounded">
                                        PROJECTION
                                    </Badge>
                                </>
                            ) : (
                                <>
                                    <Badge appearance="tint" size="small" shape="rounded">
                                        COLLSCAN
                                    </Badge>
                                    <Text size={200}>→</Text>
                                    <Badge appearance="tint" size="small" shape="rounded">
                                        SORT
                                    </Badge>
                                    <Text size={200}>→</Text>
                                    <Badge appearance="tint" size="small" shape="rounded">
                                        PROJECTION
                                    </Badge>
                                </>
                            )}
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' }}>
                                    {/* Stage breakdown using StageDetailCard */}
                                    {shard.plan.stage === 'FETCH' && shard.plan.indexName && (
                                        <>
                                            <StageDetailCard
                                                stageType="IXSCAN"
                                                description={`Index: ${shard.plan.indexName}`}
                                                returned={shard.docsExamined}
                                                executionTimeMs={shard.executionTimeMs * 0.6}
                                                timePercentage={60}
                                                metrics={[
                                                    {
                                                        label: l10n.t('Keys Examined'),
                                                        value: shard.keysExamined.toLocaleString(),
                                                    },
                                                ]}
                                            />
                                            <StageDetailCard
                                                stageType="FETCH"
                                                returned={shard.nReturned}
                                                executionTimeMs={shard.executionTimeMs * 0.4}
                                                timePercentage={40}
                                                metrics={[
                                                    {
                                                        label: l10n.t('Docs Examined'),
                                                        value: shard.docsExamined.toLocaleString(),
                                                    },
                                                ]}
                                            />
                                        </>
                                    )}
                                    {shard.plan.stage === 'SORT' && shard.hasCollscan && (
                                        <>
                                            <StageDetailCard
                                                stageType="COLLSCAN"
                                                returned={shard.docsExamined}
                                                executionTimeMs={shard.executionTimeMs * 0.7}
                                                timePercentage={70}
                                                metrics={[
                                                    {
                                                        label: l10n.t('Docs Examined'),
                                                        value: shard.docsExamined.toLocaleString(),
                                                    },
                                                ]}
                                            />
                                            <StageDetailCard
                                                stageType="SORT"
                                                description={l10n.t('In-memory sort')}
                                                returned={shard.nReturned}
                                                executionTimeMs={shard.executionTimeMs * 0.3}
                                                timePercentage={30}
                                            />
                                        </>
                                    )}
                                </div>
                            </AccordionPanel>
                        </AccordionItem>
                    </Accordion>
                </div>
            ))}
        </div>
    );

    // Mock 7: Expandable Single (non-sharded query with stage details)
    const renderExpandableSingleView = () => {
        // Mock single shard execution data
        const singleQueryData = {
            nReturned: 100,
            keysExamined: 100,
            docsExamined: 100,
            executionTimeMs: 120,
            plan: 'IXSCAN → FETCH → PROJECTION',
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

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {/* Query Summary Card */}
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
                            {l10n.t('Your Cluster')}
                        </Text>
                        {/* Stage flow with badges */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                            <Badge appearance="tint" size="small" shape="rounded">
                                IXSCAN
                            </Badge>
                            <Text size={200}>→</Text>
                            <Badge appearance="tint" size="small" shape="rounded">
                                FETCH
                            </Badge>
                            <Text size={200}>→</Text>
                            <Badge appearance="tint" size="small" shape="rounded">
                                PROJECTION
                            </Badge>
                        </div>
                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                            {singleQueryData.nReturned} returned · {singleQueryData.keysExamined.toLocaleString()} keys
                            · {singleQueryData.docsExamined.toLocaleString()} docs · {singleQueryData.executionTimeMs}ms
                        </Text>
                    </div>

                    {/* Expandable Stage Details */}
                    <Accordion collapsible>
                        <AccordionItem value="1">
                            <AccordionHeader size="small">{l10n.t('Show Stage Details')}</AccordionHeader>
                            <AccordionPanel>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '8px' }}>
                                    {singleQueryData.stages.map((stage, index) => {
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

                                        // Calculate percentage of total execution time
                                        const timePercentage = stage.executionTimeMs
                                            ? (stage.executionTimeMs / singleQueryData.executionTimeMs) * 100
                                            : undefined;

                                        return (
                                            <StageDetailCard
                                                key={index}
                                                stageType={stage.stage as Stage}
                                                description={stage.indexName ? `Index: ${stage.indexName}` : undefined}
                                                returned={stage.nReturned}
                                                executionTimeMs={stage.executionTimeMs}
                                                timePercentage={timePercentage}
                                                metrics={metrics.length > 0 ? metrics : undefined}
                                            />
                                        );
                                    })}
                                </div>
                            </AccordionPanel>
                        </AccordionItem>
                    </Accordion>
                </div>
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

                <Menu>
                    <MenuTrigger disableButtonEnhancement>
                        <Button appearance="subtle" icon={<MoreHorizontalRegular />} size="small" />
                    </MenuTrigger>

                    <MenuPopover>
                        <MenuList>
                            <MenuItem onClick={() => setMockLayout('expandable-shards')}>
                                {l10n.t('Expandable Shards')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockLayout('expandable-single')}>
                                {l10n.t('Expandable Single')}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </div>

            {mockLayout === 'expandable-shards' && renderExpandableShardsView()}
            {mockLayout === 'expandable-single' && renderExpandableSingleView()}
        </Card>
    );
};
