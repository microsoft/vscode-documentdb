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
    Label,
    Menu,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Tab,
    TabList,
    Text,
    tokens,
} from '@fluentui/react-components';
import {
    DatabaseRegular,
    DismissRegular,
    InfoRegular,
    LayerRegular,
    MoreHorizontalRegular,
} from '@fluentui/react-icons';
import { CollapseRelaxed } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import * as React from 'react';
import '../queryInsights.scss';
import './QueryPlanSummary.scss';

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

type MockLayout =
    | 'single'
    | 'horizontal-tabs'
    | 'sub-cards'
    | 'table-view'
    | 'tree-view'
    | 'compact-list'
    | 'expandable-shards'
    | 'expandable-single';

export const QueryPlanSummary: React.FC<QueryPlanSummaryProps> = ({
    stageState,
    selectedTab,
    setSelectedTab,
    stageDetails,
}) => {
    const [mockLayout, setMockLayout] = React.useState<MockLayout>('expandable-single');
    const [selectedShard, setSelectedShard] = React.useState<string>('merge');

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

    const renderSingleShardView = () => (
        <div className="queryPlanContent">
            <div className="queryPlanTabs">
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

            <div className="queryPlanDetails">
                {selectedTab !== null ? (
                    <>
                        <div className="stageHeader">
                            <div className="stageHeaderLeft">
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
                                        <div className="detailsGrid">
                                            <div className="detailItem">
                                                <Label size="small">{l10n.t('Index Name')}</Label>
                                                <Text>{stageDetails.IXSCAN.indexName}</Text>
                                            </div>
                                            <div className="detailItem">
                                                <Label size="small">{l10n.t('Keys Examined')}</Label>
                                                <Text weight="semibold">{stageDetails.IXSCAN.keysExamined}</Text>
                                            </div>
                                            <div className="detailItem">
                                                <Label size="small">{l10n.t('nReturned')}</Label>
                                                <Text weight="semibold">{stageDetails.IXSCAN.nReturned}</Text>
                                            </div>
                                        </div>
                                        {stageDetails.IXSCAN.indexBounds && (
                                            <>
                                                <Label size="small" className="indexBoundsLabel">
                                                    {l10n.t('Index Bounds')}
                                                </Label>
                                                <div className="codeBlock">{stageDetails.IXSCAN.indexBounds}</div>
                                            </>
                                        )}
                                    </>
                                )}
                                {selectedTab === 'FETCH' && (
                                    <div className="detailsGrid">
                                        <div className="detailItem">
                                            <Label size="small">{l10n.t('Docs Examined')}</Label>
                                            <Text weight="semibold">{stageDetails.FETCH.docsExamined}</Text>
                                        </div>
                                        <div className="detailItem">
                                            <Label size="small">{l10n.t('nReturned')}</Label>
                                            <Text weight="semibold">{stageDetails.FETCH.nReturned}</Text>
                                        </div>
                                    </div>
                                )}
                                {selectedTab === 'PROJECTION' && (
                                    <div className="detailsGrid">
                                        <div className="detailItem">
                                            <Label size="small">{l10n.t('nReturned')}</Label>
                                            <Text weight="semibold">{stageDetails.PROJECTION.nReturned}</Text>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </CollapseRelaxed>

                        {stageState < 2 && (
                            <Text size={300}>{l10n.t('Run detailed analysis to see stage metrics')}</Text>
                        )}
                    </>
                ) : (
                    <div className="queryPlanPlaceholder">
                        <InfoRegular style={{ fontSize: '48px', marginBottom: '12px' }} />
                        <Text size={400} weight="semibold" style={{ marginBottom: '4px' }}>
                            {l10n.t('No Stage Selected')}
                        </Text>
                        <Text size={300}>{l10n.t('Select a stage to view its details')}</Text>
                    </div>
                )}
            </div>
        </div>
    );

    // Mock 1: Horizontal Tabs for Each Shard
    const renderHorizontalTabsView = () => {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <TabList
                    selectedValue={selectedShard}
                    onTabSelect={(_, data) => setSelectedShard(data.value as string)}
                >
                    <Tab value="merge" icon={<DatabaseRegular />}>
                        {l10n.t('SHARD_MERGE')}
                    </Tab>
                    {shardedData.map((shard) => (
                        <Tab key={shard.shardName} value={shard.shardName} icon={<DatabaseRegular />}>
                            {shard.shardName}
                            {(shard.hasCollscan || shard.hasBlockedSort) && (
                                <Badge appearance="filled" color="danger" size="small" style={{ marginLeft: '4px' }}>
                                    !
                                </Badge>
                            )}
                        </Tab>
                    ))}
                </TabList>

                <div>
                    {selectedShard === 'merge' ? (
                        <div
                            style={{
                                padding: '16px',
                                backgroundColor: tokens.colorNeutralBackground3,
                                borderRadius: '6px',
                            }}
                        >
                            <Text weight="semibold" size={400} style={{ display: 'block', marginBottom: '12px' }}>
                                {l10n.t('Merge Stage')}
                            </Text>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                                <div>
                                    <Label size="small">{l10n.t('Total Returned')}</Label>
                                    <Text>50</Text>
                                </div>
                                <div>
                                    <Label size="small">{l10n.t('Shards')}</Label>
                                    <Text>2</Text>
                                </div>
                                <div>
                                    <Label size="small">{l10n.t('Execution Time')}</Label>
                                    <Text>1.4 s</Text>
                                </div>
                            </div>
                        </div>
                    ) : (
                        shardedData
                            .filter((s) => s.shardName === selectedShard)
                            .map((shard) => (
                                <div
                                    key={shard.shardName}
                                    style={{
                                        padding: '16px',
                                        backgroundColor: tokens.colorNeutralBackground1,
                                        borderRadius: '6px',
                                    }}
                                >
                                    <div
                                        style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}
                                    >
                                        <Badge appearance="tint">{shard.plan.stage}</Badge>
                                        {shard.plan.indexName && (
                                            <Badge appearance="outline">{shard.plan.indexName}</Badge>
                                        )}
                                        {shard.hasCollscan && (
                                            <Badge appearance="filled" color="danger">
                                                COLLSCAN
                                            </Badge>
                                        )}
                                        {shard.hasBlockedSort && (
                                            <Badge appearance="filled" color="warning">
                                                Blocked Sort
                                            </Badge>
                                        )}
                                    </div>
                                    <div
                                        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}
                                    >
                                        <div>
                                            <Label size="small">{l10n.t('Returned')}</Label>
                                            <Text weight="semibold">{shard.nReturned}</Text>
                                        </div>
                                        <div>
                                            <Label size="small">{l10n.t('Keys')}</Label>
                                            <Text weight="semibold">{shard.keysExamined}</Text>
                                        </div>
                                        <div>
                                            <Label size="small">{l10n.t('Docs')}</Label>
                                            <Text weight="semibold">{shard.docsExamined}</Text>
                                        </div>
                                        <div>
                                            <Label size="small">{l10n.t('Time')}</Label>
                                            <Text weight="semibold">{shard.executionTimeMs} ms</Text>
                                        </div>
                                    </div>
                                </div>
                            ))
                    )}
                </div>
            </div>
        );
    };

    // Mock 2: Sub-Cards for Each Shard
    const renderSubCardsView = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Merge Stage Card */}
            <Card style={{ padding: '16px', backgroundColor: tokens.colorBrandBackground2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <DatabaseRegular fontSize={24} style={{ color: tokens.colorBrandForeground1 }} />
                    <Text weight="semibold" size={500}>
                        {l10n.t('SHARD_MERGE')}
                    </Text>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    <div>
                        <div className="dataHeader">{l10n.t('Total Returned')}</div>
                        <div className="dataValue" style={{ fontSize: '20px', lineHeight: '28px' }}>
                            50
                        </div>
                    </div>
                    <div>
                        <div className="dataHeader">{l10n.t('Shards')}</div>
                        <div className="dataValue" style={{ fontSize: '20px', lineHeight: '28px' }}>
                            2
                        </div>
                    </div>
                    <div>
                        <div className="dataHeader">{l10n.t('Total Time')}</div>
                        <div className="dataValue" style={{ fontSize: '20px', lineHeight: '28px' }}>
                            1.4 s
                        </div>
                    </div>
                </div>
            </Card>

            {/* Shard Sub-Cards */}
            {shardedData.map((shard) => (
                <Card key={shard.shardName} style={{ padding: '16px' }}>
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: '12px',
                        }}
                    >
                        <div>
                            <Text weight="semibold" size={400} style={{ display: 'block', marginBottom: '4px' }}>
                                {shard.shardName}
                            </Text>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <Badge appearance="tint">{shard.plan.stage}</Badge>
                                {shard.plan.indexName && <Badge appearance="outline">{shard.plan.indexName}</Badge>}
                                {shard.hasCollscan && (
                                    <Badge appearance="filled" color="danger">
                                        COLLSCAN
                                    </Badge>
                                )}
                                {shard.hasBlockedSort && (
                                    <Badge appearance="filled" color="warning">
                                        Blocked Sort
                                    </Badge>
                                )}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                        <div>
                            <div className="dataHeader">{l10n.t('Returned')}</div>
                            <Text weight="semibold">{shard.nReturned}</Text>
                        </div>
                        <div>
                            <div className="dataHeader">{l10n.t('Keys Examined')}</div>
                            <Text weight="semibold">{shard.keysExamined.toLocaleString()}</Text>
                        </div>
                        <div>
                            <div className="dataHeader">{l10n.t('Docs Examined')}</div>
                            <Text weight="semibold">{shard.docsExamined.toLocaleString()}</Text>
                        </div>
                        <div>
                            <div className="dataHeader">{l10n.t('Time')}</div>
                            <Text weight="semibold">{shard.executionTimeMs} ms</Text>
                        </div>
                    </div>
                </Card>
            ))}
        </div>
    );

    // Mock 3: Table View
    const renderTableView = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ padding: '12px', backgroundColor: tokens.colorBrandBackground2, borderRadius: '6px' }}>
                <Text weight="semibold">{l10n.t('SHARD_MERGE → 50 docs, 1.4s')}</Text>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                    <tr style={{ borderBottom: `1px solid ${tokens.colorNeutralStroke1}` }}>
                        <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600 }}>
                            {l10n.t('Shard')}
                        </th>
                        <th style={{ textAlign: 'left', padding: '8px', fontSize: '12px', fontWeight: 600 }}>
                            {l10n.t('Plan')}
                        </th>
                        <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600 }}>
                            {l10n.t('Returned')}
                        </th>
                        <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600 }}>
                            {l10n.t('Keys')}
                        </th>
                        <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600 }}>
                            {l10n.t('Docs')}
                        </th>
                        <th style={{ textAlign: 'right', padding: '8px', fontSize: '12px', fontWeight: 600 }}>
                            {l10n.t('Time')}
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {shardedData.map((shard) => (
                        <tr key={shard.shardName} style={{ borderBottom: `1px solid ${tokens.colorNeutralStroke2}` }}>
                            <td style={{ padding: '12px' }}>
                                <Text weight="semibold">{shard.shardName}</Text>
                            </td>
                            <td style={{ padding: '12px' }}>
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                    <Badge appearance="tint" size="small">
                                        {shard.plan.stage}
                                    </Badge>
                                    {shard.plan.indexName && (
                                        <Badge appearance="outline" size="small">
                                            {shard.plan.indexName}
                                        </Badge>
                                    )}
                                    {shard.hasCollscan && (
                                        <Badge appearance="filled" color="danger" size="small">
                                            SCAN
                                        </Badge>
                                    )}
                                    {shard.hasBlockedSort && (
                                        <Badge appearance="filled" color="warning" size="small">
                                            SORT
                                        </Badge>
                                    )}
                                </div>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right' }}>
                                <Text>{shard.nReturned}</Text>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right' }}>
                                <Text>{shard.keysExamined.toLocaleString()}</Text>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right' }}>
                                <Text>{shard.docsExamined.toLocaleString()}</Text>
                            </td>
                            <td style={{ padding: '12px', textAlign: 'right' }}>
                                <Text>{shard.executionTimeMs} ms</Text>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    // Mock 4: Tree/Hierarchical View (inspired by PerformanceTabB)
    const renderTreeView = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Root merge node */}
            <div
                style={{
                    padding: '12px',
                    backgroundColor: tokens.colorBrandBackground2,
                    borderLeft: `4px solid ${tokens.colorBrandForeground1}`,
                    borderRadius: '4px',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <Badge appearance="filled" color="brand">
                            SHARD_MERGE
                        </Badge>
                        <Text size={300} style={{ marginLeft: '8px' }}>
                            {l10n.t('50 docs, 1.4s')}
                        </Text>
                    </div>
                </div>
            </div>

            {/* Child shard nodes */}
            {shardedData.map((shard) => (
                <div
                    key={shard.shardName}
                    style={{
                        marginLeft: '24px',
                        padding: '12px',
                        backgroundColor: tokens.colorNeutralBackground1,
                        borderLeft: `3px solid ${shard.hasCollscan || shard.hasBlockedSort ? tokens.colorPaletteRedBorder1 : tokens.colorNeutralStroke1}`,
                        borderRadius: '4px',
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: '8px',
                        }}
                    >
                        <div>
                            <Text weight="semibold" size={400}>
                                {shard.shardName}
                            </Text>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                            {shard.hasCollscan && (
                                <Badge appearance="filled" color="danger" size="small">
                                    COLLSCAN
                                </Badge>
                            )}
                            {shard.hasBlockedSort && (
                                <Badge appearance="filled" color="warning" size="small">
                                    Blocked Sort
                                </Badge>
                            )}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                        <Text size={300}>
                            <strong>{shard.plan.stage}</strong>
                            {shard.plan.indexName && ` (${shard.plan.indexName})`}
                        </Text>
                        <Text size={300}>→ {shard.nReturned} docs</Text>
                        <Text size={300}>Keys: {shard.keysExamined.toLocaleString()}</Text>
                        <Text size={300}>Docs: {shard.docsExamined.toLocaleString()}</Text>
                        <Text size={300}>{shard.executionTimeMs}ms</Text>
                    </div>
                </div>
            ))}
        </div>
    );

    // Mock 5: Compact List View
    const renderCompactListView = () => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div
                style={{
                    padding: '12px',
                    backgroundColor: tokens.colorBrandBackground2,
                    borderRadius: '6px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <DatabaseRegular fontSize={20} style={{ color: tokens.colorBrandForeground1 }} />
                    <div>
                        <Text weight="semibold" size={400}>
                            {l10n.t('SHARD_MERGE')}
                        </Text>
                        <Text size={200} style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                            {l10n.t('2 shards, 50 docs, 1.4s')}
                        </Text>
                    </div>
                </div>
            </div>

            {shardedData.map((shard) => (
                <div
                    key={shard.shardName}
                    style={{
                        padding: '12px',
                        backgroundColor: tokens.colorNeutralBackground1,
                        borderRadius: '6px',
                        borderLeft: `3px solid ${shard.hasCollscan || shard.hasBlockedSort ? tokens.colorPaletteRedBorder1 : tokens.colorNeutralStroke1}`,
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                <Text weight="semibold" size={300}>
                                    {shard.shardName}
                                </Text>
                                <Badge appearance="tint" size="small">
                                    {shard.plan.stage}
                                </Badge>
                                {shard.plan.indexName && (
                                    <Badge appearance="outline" size="small">
                                        {shard.plan.indexName}
                                    </Badge>
                                )}
                                {shard.hasCollscan && (
                                    <Badge appearance="filled" color="danger" size="small">
                                        SCAN
                                    </Badge>
                                )}
                                {shard.hasBlockedSort && (
                                    <Badge appearance="filled" color="warning" size="small">
                                        SORT
                                    </Badge>
                                )}
                            </div>
                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                {shard.nReturned} returned · {shard.keysExamined.toLocaleString()} keys ·{' '}
                                {shard.docsExamined.toLocaleString()} docs · {shard.executionTimeMs}ms
                            </Text>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );

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
                                    {/* Mock stage breakdown based on shard plan */}
                                    {shard.plan.stage === 'FETCH' && shard.plan.indexName && (
                                        <>
                                            <div
                                                style={{
                                                    padding: '8px',
                                                    backgroundColor: tokens.colorNeutralBackground3,
                                                    borderRadius: '4px',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        marginBottom: '4px',
                                                    }}
                                                >
                                                    <Badge appearance="tint" size="small" shape="rounded">
                                                        IXSCAN
                                                    </Badge>
                                                    <Text size={200} weight="semibold">
                                                        {shard.plan.indexName}
                                                    </Text>
                                                </div>
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: 'repeat(2, 1fr)',
                                                        gap: '8px',
                                                        marginTop: '4px',
                                                    }}
                                                >
                                                    <Text size={200}>
                                                        <strong>{l10n.t('Keys:')}</strong>{' '}
                                                        {shard.keysExamined.toLocaleString()}
                                                    </Text>
                                                    <Text size={200}>
                                                        <strong>{l10n.t('Returned:')}</strong>{' '}
                                                        {shard.docsExamined.toLocaleString()}
                                                    </Text>
                                                </div>
                                            </div>
                                            <div
                                                style={{
                                                    padding: '8px',
                                                    backgroundColor: tokens.colorNeutralBackground3,
                                                    borderRadius: '4px',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        marginBottom: '4px',
                                                    }}
                                                >
                                                    <Badge appearance="tint" size="small" shape="rounded">
                                                        FETCH
                                                    </Badge>
                                                </div>
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: 'repeat(2, 1fr)',
                                                        gap: '8px',
                                                        marginTop: '4px',
                                                    }}
                                                >
                                                    <Text size={200}>
                                                        <strong>{l10n.t('Docs:')}</strong>{' '}
                                                        {shard.docsExamined.toLocaleString()}
                                                    </Text>
                                                    <Text size={200}>
                                                        <strong>{l10n.t('Returned:')}</strong> {shard.nReturned}
                                                    </Text>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                    {shard.plan.stage === 'SORT' && shard.hasCollscan && (
                                        <>
                                            <div
                                                style={{
                                                    padding: '8px',
                                                    backgroundColor: tokens.colorNeutralBackground3,
                                                    borderRadius: '4px',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        marginBottom: '4px',
                                                    }}
                                                >
                                                    <Badge appearance="tint" size="small" shape="rounded">
                                                        COLLSCAN
                                                    </Badge>
                                                </div>
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: 'repeat(2, 1fr)',
                                                        gap: '8px',
                                                        marginTop: '4px',
                                                    }}
                                                >
                                                    <Text size={200}>
                                                        <strong>{l10n.t('Docs:')}</strong>{' '}
                                                        {shard.docsExamined.toLocaleString()}
                                                    </Text>
                                                    <Text size={200}>
                                                        <strong>{l10n.t('Returned:')}</strong>{' '}
                                                        {shard.docsExamined.toLocaleString()}
                                                    </Text>
                                                </div>
                                            </div>
                                            <div
                                                style={{
                                                    padding: '8px',
                                                    backgroundColor: tokens.colorNeutralBackground3,
                                                    borderRadius: '4px',
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        marginBottom: '4px',
                                                    }}
                                                >
                                                    <Badge appearance="tint" size="small" shape="rounded">
                                                        SORT
                                                    </Badge>
                                                    <Text size={200}>{l10n.t('In-memory sort')}</Text>
                                                </div>
                                                <div
                                                    style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: 'repeat(2, 1fr)',
                                                        gap: '8px',
                                                        marginTop: '4px',
                                                    }}
                                                >
                                                    <Text size={200}>
                                                        <strong>{l10n.t('Returned:')}</strong> {shard.nReturned}
                                                    </Text>
                                                </div>
                                            </div>
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
                },
                {
                    stage: 'FETCH',
                    docsExamined: 100,
                    nReturned: 100,
                },
                {
                    stage: 'PROJECTION',
                    nReturned: 100,
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
                                    {singleQueryData.stages.map((stage, index) => (
                                        <div
                                            key={index}
                                            style={{
                                                padding: '8px',
                                                backgroundColor: tokens.colorNeutralBackground3,
                                                borderRadius: '4px',
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px',
                                                    marginBottom: '4px',
                                                }}
                                            >
                                                <Badge appearance="tint" size="small" shape="rounded">
                                                    {stage.stage}
                                                </Badge>
                                                {stage.indexName && (
                                                    <Text size={200} weight="semibold">
                                                        {stage.indexName}
                                                    </Text>
                                                )}
                                            </div>
                                            <div
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: 'repeat(2, 1fr)',
                                                    gap: '8px',
                                                    marginTop: '4px',
                                                }}
                                            >
                                                {stage.keysExamined !== undefined && (
                                                    <Text size={200}>
                                                        <strong>{l10n.t('Keys:')}</strong>{' '}
                                                        {stage.keysExamined.toLocaleString()}
                                                    </Text>
                                                )}
                                                {stage.docsExamined !== undefined && (
                                                    <Text size={200}>
                                                        <strong>{l10n.t('Docs:')}</strong>{' '}
                                                        {stage.docsExamined.toLocaleString()}
                                                    </Text>
                                                )}
                                                <Text size={200}>
                                                    <strong>{l10n.t('Returned:')}</strong> {stage.nReturned}
                                                </Text>
                                            </div>
                                            {stage.bounds && (
                                                <Text
                                                    size={200}
                                                    style={{
                                                        marginTop: '4px',
                                                        fontFamily: 'monospace',
                                                        color: tokens.colorNeutralForeground3,
                                                    }}
                                                >
                                                    {stage.bounds}
                                                </Text>
                                            )}
                                        </div>
                                    ))}
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
                            <MenuItem onClick={() => setMockLayout('single')}>
                                {l10n.t('Mock: Single Shard (Current)')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockLayout('horizontal-tabs')}>
                                {l10n.t('Mock 1: Horizontal Tabs')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockLayout('sub-cards')}>
                                {l10n.t('Mock 2: Sub-Cards')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockLayout('table-view')}>
                                {l10n.t('Mock 3: Table View')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockLayout('tree-view')}>
                                {l10n.t('Mock 4: Tree View')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockLayout('compact-list')}>
                                {l10n.t('Mock 5: Compact List')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockLayout('expandable-shards')}>
                                {l10n.t('Mock 6: Expandable Shards')}
                            </MenuItem>
                            <MenuItem onClick={() => setMockLayout('expandable-single')}>
                                {l10n.t('Mock 7: Expandable Single')}
                            </MenuItem>
                        </MenuList>
                    </MenuPopover>
                </Menu>
            </div>

            {mockLayout === 'single' && renderSingleShardView()}
            {mockLayout === 'horizontal-tabs' && renderHorizontalTabsView()}
            {mockLayout === 'sub-cards' && renderSubCardsView()}
            {mockLayout === 'table-view' && renderTableView()}
            {mockLayout === 'tree-view' && renderTreeView()}
            {mockLayout === 'compact-list' && renderCompactListView()}
            {mockLayout === 'expandable-shards' && renderExpandableShardsView()}
            {mockLayout === 'expandable-single' && renderExpandableSingleView()}
        </Card>
    );
};
