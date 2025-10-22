/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, CardHeader, Label, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { CheckmarkCircleRegular, LightbulbRegular, SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('16px'),
        ...shorthands.padding('16px'),
        height: '100%',
        overflowY: 'auto',
    },
    header: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('8px'),
    },
    summaryGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        ...shorthands.gap('16px'),
    },
    summaryItem: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('4px'),
    },
    successBadge: {
        backgroundColor: tokens.colorPaletteGreenBackground2,
        color: tokens.colorPaletteGreenForeground2,
    },
    stagesCard: {
        backgroundColor: tokens.colorNeutralBackground3,
    },
    stageItem: {
        ...shorthands.padding('12px', '16px'),
        ...shorthands.borderRadius('4px'),
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('8px'),
    },
    stageHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    stageName: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
    },
    stageMetrics: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        ...shorthands.gap('12px'),
        marginTop: '8px',
    },
    metricItem: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('4px'),
    },
    codeBlock: {
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.padding('12px'),
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '12px',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
        overflowX: 'auto',
    },
    indexInfo: {
        ...shorthands.padding('12px', '16px'),
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.borderRadius('4px'),
        ...shorthands.border('1px', 'solid', tokens.colorBrandStroke1),
    },
    analysisSection: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('8px'),
        ...shorthands.padding('12px', '16px'),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.borderRadius('4px'),
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    },
    buttonGroup: {
        display: 'flex',
        ...shorthands.gap('8px'),
        marginTop: '8px',
    },
});

export const PerformanceTabA = (): JSX.Element => {
    const styles = useStyles();

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Label size="large" weight="semibold">
                    {l10n.t('Query Performance Summary')}
                </Label>

                <div className={styles.summaryGrid}>
                    <div className={styles.summaryItem}>
                        <Label size="small">{l10n.t('Documents Returned:')}</Label>
                        <Label size="large" weight="semibold">
                            10
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Label size="small">{l10n.t('Execution Time (ms):')}</Label>
                        <Label size="large" weight="semibold">
                            0.45
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Label size="small">{l10n.t('Index Keys Examined:')}</Label>
                        <Label size="large" weight="semibold">
                            10
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Label size="small">{l10n.t('Documents Examined:')}</Label>
                        <Label size="large" weight="semibold">
                            10
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Label size="small">{l10n.t('Efficiency Ratio:')}</Label>
                        <Label size="large" weight="semibold">
                            1.0
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Badge
                            appearance="filled"
                            color="success"
                            icon={<CheckmarkCircleRegular />}
                            className={styles.successBadge}
                        >
                            {l10n.t('Index Used Efficiently')}
                        </Badge>
                    </div>
                </div>
            </div>

            <div className={styles.indexInfo}>
                <Label weight="semibold" style={{ marginBottom: '8px', display: 'block' }}>
                    {l10n.t('Index Used')}
                </Label>
                <div className={styles.codeBlock}>{`region_id_1_purchase_items.item_id_1_purchase_date_-1`}</div>
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <Label size="small">{l10n.t('Key Pattern:')}</Label>
                    <div className={styles.codeBlock}>
                        {`{ region_id: 1, "purchase_items.item_id": 1, purchase_date: -1 }`}
                    </div>
                </div>
            </div>

            <Card className={styles.stagesCard}>
                <CardHeader
                    header={
                        <Label weight="semibold" size="large">
                            {l10n.t('Execution Stages')}
                        </Label>
                    }
                />

                <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div className={styles.stageItem}>
                        <div className={styles.stageHeader}>
                            <div className={styles.stageName}>
                                <Badge appearance="tint">LIMIT</Badge>
                                <Label size="small">{l10n.t('Limit results to 10')}</Label>
                            </div>
                            <Label size="small" style={{ color: tokens.colorNeutralForeground3 }}>
                                0.00 ms
                            </Label>
                        </div>
                        <div className={styles.stageMetrics}>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('nReturned')}</Label>
                                <Label weight="semibold">10</Label>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('works')}</Label>
                                <Label weight="semibold">11</Label>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('advanced')}</Label>
                                <Label weight="semibold">10</Label>
                            </div>
                        </div>
                    </div>

                    <div className={styles.stageItem}>
                        <div className={styles.stageHeader}>
                            <div className={styles.stageName}>
                                <Badge appearance="tint">FETCH</Badge>
                                <Label size="small">{l10n.t('Fetch matching documents')}</Label>
                            </div>
                            <Label size="small" style={{ color: tokens.colorNeutralForeground3 }}>
                                0.00 ms
                            </Label>
                        </div>
                        <div className={styles.stageMetrics}>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('nReturned')}</Label>
                                <Label weight="semibold">10</Label>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('docsExamined')}</Label>
                                <Label weight="semibold">10</Label>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('works')}</Label>
                                <Label weight="semibold">10</Label>
                            </div>
                        </div>
                        <div style={{ marginTop: '8px' }}>
                            <Label size="small">{l10n.t('Filter:')}</Label>
                            <div className={styles.codeBlock}>
                                {`purchase_items: { $elemMatch: { item_id: { $eq: 5 } } }`}
                            </div>
                        </div>
                    </div>

                    <div className={styles.stageItem}>
                        <div className={styles.stageHeader}>
                            <div className={styles.stageName}>
                                <Badge appearance="tint">IXSCAN</Badge>
                                <Label size="small">{l10n.t('Index Scan')}</Label>
                            </div>
                            <Label size="small" style={{ color: tokens.colorNeutralForeground3 }}>
                                0.00 ms
                            </Label>
                        </div>
                        <div className={styles.stageMetrics}>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('nReturned')}</Label>
                                <Label weight="semibold">10</Label>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('keysExamined')}</Label>
                                <Label weight="semibold">10</Label>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('direction')}</Label>
                                <Label weight="semibold">forward</Label>
                            </div>
                        </div>
                        <div style={{ marginTop: '8px' }}>
                            <Label size="small">{l10n.t('Index Bounds:')}</Label>
                            <div className={styles.codeBlock}>
                                {`region_id: [1, 1]\npurchase_items.item_id: [5, 5]\npurchase_date: [MaxKey, MinKey]`}
                            </div>
                        </div>
                        <div style={{ marginTop: '8px', display: 'flex', gap: '16px' }}>
                            <div>
                                <Label size="small">{l10n.t('Multi-Key:')}</Label>
                                <Label weight="semibold"> true</Label>
                            </div>
                            <div>
                                <Label size="small">{l10n.t('Unique:')}</Label>
                                <Label weight="semibold"> false</Label>
                            </div>
                        </div>
                    </div>
                </div>
            </Card>

            <Card>
                <div style={{ padding: '16px' }}>
                    <div className={styles.analysisSection}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <LightbulbRegular />
                            <Label weight="semibold">{l10n.t('AI ANALYSIS')}</Label>
                        </div>
                        <Label>
                            {l10n.t(
                                'Excellent query performance! The index is being used efficiently with a 1:1 ratio of documents examined to returned. The compound index on region_id, purchase_items.item_id, and purchase_date allows the query to skip directly to relevant documents. The multi-key index on the purchase_items array handles the $elemMatch filter effectively.',
                            )}
                        </Label>
                    </div>

                    <div className={styles.buttonGroup}>
                        <Button appearance="primary" icon={<SparkleRegular />}>
                            {l10n.t('Get Detailed Analysis')}
                        </Button>
                        <Button appearance="secondary">{l10n.t('Export Plan')}</Button>
                    </div>
                </div>
            </Card>
        </div>
    );
};
