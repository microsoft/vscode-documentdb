/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Card,
    createTableColumn,
    DataGrid,
    DataGridBody,
    DataGridCell,
    DataGridHeader,
    DataGridHeaderCell,
    DataGridRow,
    Label,
    makeStyles,
    mergeClasses,
    shorthands,
    TableCellLayout,
    type TableColumnDefinition,
    Text,
    tokens,
    Tree,
    TreeItem,
    TreeItemLayout,
} from '@fluentui/react-components';
import {
    ChevronDownRegular,
    ChevronRightRegular,
    CircleRegular,
    DatabaseRegular,
    SparkleRegular,
    TargetArrowRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        ...shorthands.gap('20px'),
        ...shorthands.padding('20px'),
        height: '100%',
        overflowY: 'auto',
    },
    leftPanel: {
        flex: '1 1 60%',
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('16px'),
    },
    rightPanel: {
        flex: '1 1 40%',
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('16px'),
    },
    metricsRow: {
        display: 'flex',
        ...shorthands.gap('12px'),
    },
    metricCard: {
        flex: 1,
        ...shorthands.padding('16px'),
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        ...shorthands.gap('8px'),
    },
    metricValue: {
        fontSize: '28px',
        fontWeight: 600,
        lineHeight: '32px',
    },
    treeContainer: {
        ...shorthands.padding('16px'),
    },
    stageNode: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
    },
    stageBadge: {
        fontFamily: 'monospace',
        fontSize: '11px',
    },
    detailsCard: {
        ...shorthands.padding('16px'),
    },
    detailsGrid: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        ...shorthands.gap('12px'),
        marginTop: '12px',
    },
    detailItem: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('4px'),
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
    aiCard: {
        ...shorthands.padding('20px'),
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.border('1px', 'solid', tokens.colorBrandStroke1),
    },
    codeBlock: {
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.padding('8px', '12px'),
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '11px',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
        overflowX: 'auto',
    },
});

interface StageMetric {
    metric: string;
    value: string | number;
    unit?: string;
}

const columns: TableColumnDefinition<StageMetric>[] = [
    createTableColumn<StageMetric>({
        columnId: 'metric',
        renderHeaderCell: () => l10n.t('Metric'),
        renderCell: (item) => <TableCellLayout>{item.metric}</TableCellLayout>,
    }),
    createTableColumn<StageMetric>({
        columnId: 'value',
        renderHeaderCell: () => l10n.t('Value'),
        renderCell: (item) => (
            <TableCellLayout>
                <Text weight="semibold">
                    {item.value} {item.unit || ''}
                </Text>
            </TableCellLayout>
        ),
    }),
];

const stageMetrics: StageMetric[] = [
    { metric: l10n.t('nReturned'), value: 10 },
    { metric: l10n.t('executionTimeMillis'), value: 0.45, unit: 'ms' },
    { metric: l10n.t('totalKeysExamined'), value: 10 },
    { metric: l10n.t('totalDocsExamined'), value: 10 },
    { metric: l10n.t('Efficiency Ratio'), value: '1.0' },
    { metric: l10n.t('Index Used'), value: 'Yes' },
];

export const PerformanceTabD = (): JSX.Element => {
    const styles = useStyles();

    return (
        <div className={styles.container}>
            <div className={styles.leftPanel}>
                <Card>
                    <div className={styles.metricsRow}>
                        <Card className={styles.metricCard} appearance="filled">
                            <DatabaseRegular fontSize={24} />
                            <div className={styles.metricValue}>10</div>
                            <Label size="small">{l10n.t('Docs Returned')}</Label>
                        </Card>
                        <Card className={styles.metricCard} appearance="filled">
                            <TargetArrowRegular fontSize={24} />
                            <div className={styles.metricValue}>10</div>
                            <Label size="small">{l10n.t('Docs Examined')}</Label>
                        </Card>
                        <Card className={styles.metricCard} appearance="filled">
                            <CircleRegular fontSize={24} />
                            <div className={styles.metricValue}>0.45</div>
                            <Label size="small">{l10n.t('Time (ms)')}</Label>
                        </Card>
                    </div>
                </Card>

                <Card>
                    <div className={styles.treeContainer}>
                        <Text weight="semibold" style={{ marginBottom: '12px', display: 'block' }}>
                            {l10n.t('Execution Plan Tree')}
                        </Text>
                        <Tree aria-label="Execution Plan">
                            <TreeItem itemType="branch" value="limit">
                                <TreeItemLayout>
                                    <div className={styles.stageNode}>
                                        <Badge appearance="filled" className={styles.stageBadge}>
                                            LIMIT
                                        </Badge>
                                        <Text size={300}>{l10n.t('Limit Results')}</Text>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                            0.00ms
                                        </Text>
                                    </div>
                                </TreeItemLayout>
                                <Tree>
                                    <TreeItem itemType="branch" value="fetch">
                                        <TreeItemLayout>
                                            <div className={styles.stageNode}>
                                                <Badge appearance="filled" className={styles.stageBadge}>
                                                    FETCH
                                                </Badge>
                                                <Text size={300}>{l10n.t('Fetch Documents')}</Text>
                                                <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                                    0.00ms
                                                </Text>
                                            </div>
                                        </TreeItemLayout>
                                        <Tree>
                                            <TreeItem itemType="leaf">
                                                <TreeItemLayout>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <ChevronRightRegular fontSize={16} />
                                                        <Text size={300}>
                                                            {l10n.t('Filter: purchase_items.$elemMatch')}
                                                        </Text>
                                                    </div>
                                                </TreeItemLayout>
                                            </TreeItem>
                                            <TreeItem itemType="leaf">
                                                <TreeItemLayout>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <ChevronRightRegular fontSize={16} />
                                                        <Text size={300}>
                                                            {l10n.t('10 docs examined → 10 returned')}
                                                        </Text>
                                                    </div>
                                                </TreeItemLayout>
                                            </TreeItem>
                                            <TreeItem itemType="branch" value="ixscan">
                                                <TreeItemLayout>
                                                    <div className={styles.stageNode}>
                                                        <Badge appearance="filled" className={styles.stageBadge}>
                                                            IXSCAN
                                                        </Badge>
                                                        <Text size={300}>{l10n.t('Index Scan')}</Text>
                                                        <Text
                                                            size={200}
                                                            style={{ color: tokens.colorNeutralForeground3 }}
                                                        >
                                                            0.00ms
                                                        </Text>
                                                    </div>
                                                </TreeItemLayout>
                                                <Tree>
                                                    <TreeItem itemType="leaf">
                                                        <TreeItemLayout>
                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '8px',
                                                                }}
                                                            >
                                                                <ChevronRightRegular fontSize={16} />
                                                                <Text size={300}>
                                                                    {l10n.t(
                                                                        'Index: region_id + purchase_items.item_id + purchase_date',
                                                                    )}
                                                                </Text>
                                                            </div>
                                                        </TreeItemLayout>
                                                    </TreeItem>
                                                    <TreeItem itemType="leaf">
                                                        <TreeItemLayout>
                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '8px',
                                                                }}
                                                            >
                                                                <ChevronRightRegular fontSize={16} />
                                                                <Text size={300}>
                                                                    {l10n.t('10 keys examined, 10 returned')}
                                                                </Text>
                                                            </div>
                                                        </TreeItemLayout>
                                                    </TreeItem>
                                                    <TreeItem itemType="leaf">
                                                        <TreeItemLayout>
                                                            <div
                                                                style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '8px',
                                                                }}
                                                            >
                                                                <ChevronRightRegular fontSize={16} />
                                                                <Text size={300}>{l10n.t('Multi-key: true')}</Text>
                                                            </div>
                                                        </TreeItemLayout>
                                                    </TreeItem>
                                                </Tree>
                                            </TreeItem>
                                        </Tree>
                                    </TreeItem>
                                </Tree>
                            </TreeItem>
                        </Tree>
                    </div>
                </Card>

                <Card>
                    <div style={{ padding: '16px' }}>
                        <Text weight="semibold" style={{ marginBottom: '12px', display: 'block' }}>
                            {l10n.t('Overall Metrics')}
                        </Text>
                        <DataGrid items={stageMetrics} columns={columns} size="small">
                            <DataGridHeader>
                                <DataGridRow>
                                    {({ renderHeaderCell }) => (
                                        <DataGridHeaderCell>{renderHeaderCell()}</DataGridHeaderCell>
                                    )}
                                </DataGridRow>
                            </DataGridHeader>
                            <DataGridBody<StageMetric>>
                                {({ item, rowId }) => (
                                    <DataGridRow<StageMetric> key={rowId}>
                                        {({ renderCell }) => <DataGridCell>{renderCell(item)}</DataGridCell>}
                                    </DataGridRow>
                                )}
                            </DataGridBody>
                        </DataGrid>
                    </div>
                </Card>
            </div>

            <div className={styles.rightPanel}>
                <Card className={styles.detailsCard}>
                    <Text weight="semibold" size={500}>
                        {l10n.t('Index Details')}
                    </Text>

                    <div style={{ marginTop: '12px' }}>
                        <Label size="small">{l10n.t('Index Name:')}</Label>
                        <div className={styles.codeBlock}>region_id_1_purchase_items.item_id_1_purchase_date_-1</div>
                    </div>

                    <div className={styles.detailsGrid}>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('Type')}</Label>
                            <Text>Compound Multi-Key</Text>
                        </div>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('Direction')}</Label>
                            <Text>Forward</Text>
                        </div>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('Unique')}</Label>
                            <Text>No</Text>
                        </div>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('Sparse')}</Label>
                            <Text>No</Text>
                        </div>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('Partial')}</Label>
                            <Text>No</Text>
                        </div>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('Version')}</Label>
                            <Text>2</Text>
                        </div>
                    </div>

                    <div style={{ marginTop: '16px' }}>
                        <Label size="small">{l10n.t('Multi-Key Paths:')}</Label>
                        <div className={styles.codeBlock}>{`purchase_items.item_id: ["purchase_items"]`}</div>
                    </div>

                    <div style={{ marginTop: '16px' }}>
                        <Label size="small" style={{ marginBottom: '8px', display: 'block' }}>
                            {l10n.t('Performance Rating')}
                        </Label>
                        <div className={styles.efficiencyIndicator}>
                            <div className={mergeClasses(styles.efficiencyDot, styles.excellentDot)} />
                            <div style={{ flex: 1 }}>
                                <Text weight="semibold">{l10n.t('Excellent')}</Text>
                                <Text size={200} style={{ display: 'block', color: tokens.colorNeutralForeground3 }}>
                                    {l10n.t('Perfect 1:1 scan ratio - optimal index usage')}
                                </Text>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card className={styles.aiCard}>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <SparkleRegular fontSize={32} style={{ color: tokens.colorBrandForeground1 }} />
                        <div style={{ flex: 1 }}>
                            <Text weight="semibold" size={500} style={{ display: 'block', marginBottom: '8px' }}>
                                {l10n.t('AI Performance Insights')}
                            </Text>
                            <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                                {l10n.t(
                                    'Outstanding performance! Your compound index perfectly matches the query predicates. The multi-key index efficiently handles the array field filtering, achieving a perfect 1:1 efficiency ratio.',
                                )}
                            </Text>
                            <Text
                                size={300}
                                weight="semibold"
                                style={{ display: 'block', marginBottom: '12px', color: tokens.colorBrandForeground1 }}
                            >
                                {l10n.t('✓ No optimization needed')}
                            </Text>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <Button appearance="primary" icon={<SparkleRegular />} size="small">
                                    {l10n.t('Get Detailed Report')}
                                </Button>
                                <Button appearance="subtle" size="small">
                                    {l10n.t('View Tips')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card>
                    <div style={{ padding: '16px' }}>
                        <Text weight="semibold" size={500} style={{ marginBottom: '12px', display: 'block' }}>
                            {l10n.t('Quick Actions')}
                        </Text>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <Button appearance="outline" style={{ justifyContent: 'flex-start' }}>
                                <ChevronDownRegular style={{ marginRight: '8px' }} />
                                {l10n.t('Export Execution Plan')}
                            </Button>
                            <Button appearance="outline" style={{ justifyContent: 'flex-start' }}>
                                <ChevronDownRegular style={{ marginRight: '8px' }} />
                                {l10n.t('View Raw Explain Output')}
                            </Button>
                            <Button appearance="outline" style={{ justifyContent: 'flex-start' }}>
                                <ChevronDownRegular style={{ marginRight: '8px' }} />
                                {l10n.t('Share Performance Report')}
                            </Button>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
};
