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
    goodDot: {
        backgroundColor: tokens.colorPaletteLightGreenBackground3,
    },
    poorDot: {
        backgroundColor: tokens.colorPaletteRedBackground3,
    },
    aiCard: {
        ...shorthands.padding('20px'),
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.border('1px', 'solid', tokens.colorBrandStroke1),
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
    { metric: l10n.t('nReturned'), value: 8 },
    { metric: l10n.t('executionTimeMillis'), value: 0.004, unit: 'ms' },
    { metric: l10n.t('totalKeysExamined'), value: 0 },
    { metric: l10n.t('totalDocsExamined'), value: 8 },
    { metric: l10n.t('works'), value: 9 },
    { metric: l10n.t('advanced'), value: 8 },
];

export const PerformanceTab4 = (): JSX.Element => {
    const styles = useStyles();

    return (
        <div className={styles.container}>
            <div className={styles.leftPanel}>
                <Card>
                    <div className={styles.metricsRow}>
                        <Card className={styles.metricCard} appearance="filled">
                            <DatabaseRegular fontSize={24} />
                            <div className={styles.metricValue}>8</div>
                            <Label size="small">{l10n.t('Docs Returned')}</Label>
                        </Card>
                        <Card className={styles.metricCard} appearance="filled">
                            <TargetArrowRegular fontSize={24} />
                            <div className={styles.metricValue}>8</div>
                            <Label size="small">{l10n.t('Docs Examined')}</Label>
                        </Card>
                        <Card className={styles.metricCard} appearance="filled">
                            <CircleRegular fontSize={24} />
                            <div className={styles.metricValue}>4.2</div>
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
                            <TreeItem itemType="branch" value="root">
                                <TreeItemLayout>
                                    <div className={styles.stageNode}>
                                        <Badge appearance="filled" className={styles.stageBadge}>
                                            COLLSCAN
                                        </Badge>
                                        <Text size={300}>{l10n.t('Collection Scan')}</Text>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                            0.004ms
                                        </Text>
                                    </div>
                                </TreeItemLayout>
                                <Tree>
                                    <TreeItem itemType="leaf">
                                        <TreeItemLayout>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <ChevronRightRegular fontSize={16} />
                                                <Text size={300}>{l10n.t('Filter: user_id = 123')}</Text>
                                            </div>
                                        </TreeItemLayout>
                                    </TreeItem>
                                    <TreeItem itemType="leaf">
                                        <TreeItemLayout>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <ChevronRightRegular fontSize={16} />
                                                <Text size={300}>{l10n.t('Direction: forward')}</Text>
                                            </div>
                                        </TreeItemLayout>
                                    </TreeItem>
                                    <TreeItem itemType="leaf">
                                        <TreeItemLayout>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <ChevronRightRegular fontSize={16} />
                                                <Text size={300}>{l10n.t('8 docs examined → 8 returned')}</Text>
                                            </div>
                                        </TreeItemLayout>
                                    </TreeItem>
                                </Tree>
                            </TreeItem>
                        </Tree>
                    </div>
                </Card>

                <Card>
                    <div style={{ padding: '16px' }}>
                        <Text weight="semibold" style={{ marginBottom: '12px', display: 'block' }}>
                            {l10n.t('Stage Metrics')}
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
                    <Text weight="semibold" size={400}>
                        {l10n.t('Query Efficiency Analysis')}
                    </Text>

                    <div className={styles.detailsGrid}>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('Execution Strategy')}</Label>
                            <Text>
                                <Badge appearance="tint">COLLSCAN</Badge>
                            </Text>
                        </div>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('Index Used')}</Label>
                            <Text>{l10n.t('None')}</Text>
                        </div>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('Examined/Returned Ratio')}</Label>
                            <Text>1.0</Text>
                        </div>
                        <div className={styles.detailItem}>
                            <Label size="small">{l10n.t('In-Memory Sort')}</Label>
                            <Text>{l10n.t('No')}</Text>
                        </div>
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
                                    {l10n.t('100% of examined documents were returned')}
                                </Text>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card className={styles.aiCard}>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <SparkleRegular fontSize={32} style={{ color: tokens.colorBrandForeground1 }} />
                        <div style={{ flex: 1 }}>
                            <Text weight="semibold" size={400} style={{ display: 'block', marginBottom: '8px' }}>
                                {l10n.t('AI Performance Insights')}
                            </Text>
                            <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                                {l10n.t(
                                    'Your query is performing optimally for the current dataset size. However, as data grows, consider adding an index.',
                                )}
                            </Text>
                            <Text
                                size={300}
                                weight="semibold"
                                style={{ display: 'block', marginBottom: '12px', color: tokens.colorBrandForeground1 }}
                            >
                                {l10n.t('Recommended: Create index on user_id')}
                            </Text>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <Button appearance="primary" icon={<SparkleRegular />} size="small">
                                    {l10n.t('Get Full Analysis')}
                                </Button>
                                <Button appearance="subtle" size="small">
                                    {l10n.t('Dismiss')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card>
                    <div style={{ padding: '16px' }}>
                        <Text weight="semibold" size={400} style={{ marginBottom: '12px', display: 'block' }}>
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
                                {l10n.t('Compare with Previous Execution')}
                            </Button>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
};
