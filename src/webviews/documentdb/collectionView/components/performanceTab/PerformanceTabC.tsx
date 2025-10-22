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
    InfoLabel,
    Label,
    makeStyles,
    ProgressBar,
    shorthands,
    Text,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowClockwiseRegular,
    CheckmarkCircleRegular,
    ChevronRightRegular,
    SparkleRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('16px'),
        ...shorthands.padding('20px'),
        height: '100%',
        overflowY: 'auto',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        ...shorthands.gap('12px'),
    },
    statBox: {
        ...shorthands.padding('16px'),
        ...shorthands.borderRadius('8px'),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    },
    statBoxSuccess: {
        ...shorthands.border('1px', 'solid', tokens.colorPaletteGreenBorder1),
        backgroundColor: tokens.colorPaletteGreenBackground1,
    },
    executionPlan: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
    },
    stageCard: {
        ...shorthands.padding('16px'),
        ...shorthands.borderRadius('8px'),
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
        backgroundColor: tokens.colorNeutralBackground1,
    },
    stageHeader: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
    },
    stageTitle: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
    },
    stageDetails: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        ...shorthands.gap('12px'),
        ...shorthands.padding('12px'),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.borderRadius('4px'),
    },
    metricItem: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('4px'),
    },
    codeBlock: {
        ...shorthands.padding('12px'),
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '12px',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
    },
    aiSuggestion: {
        ...shorthands.padding('16px'),
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.borderRadius('8px'),
        ...shorthands.border('1px', 'solid', tokens.colorBrandStroke1),
    },
});

export const PerformanceTabC = (): JSX.Element => {
    const styles = useStyles();

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Text size={600} weight="semibold">
                    {l10n.t('Query Execution Analysis')}
                </Text>
                <Button appearance="subtle" icon={<ArrowClockwiseRegular />}>
                    {l10n.t('Re-analyze')}
                </Button>
            </div>

            <div className={styles.statsGrid}>
                <div className={styles.statBox}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Execution Time')}
                    </Label>
                    <Text size={500} weight="semibold">
                        0.45 ms
                    </Text>
                </div>
                <div className={styles.statBox}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Documents Returned')}
                    </Label>
                    <Text size={500} weight="semibold">
                        10
                    </Text>
                </div>
                <div className={styles.statBox}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Documents Examined')}
                    </Label>
                    <Text size={500} weight="semibold">
                        10
                    </Text>
                </div>
                <div className={`${styles.statBox} ${styles.statBoxSuccess}`}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Index Keys Used')}
                    </Label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Text size={500} weight="semibold">
                            10
                        </Text>
                        <CheckmarkCircleRegular fontSize={20} color={tokens.colorPaletteGreenForeground1} />
                    </div>
                </div>
            </div>

            <Card>
                <div style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <Text weight="semibold">{l10n.t('Query Efficiency')}</Text>
                        <InfoLabel
                            info={l10n.t(
                                'Ratio of documents examined to documents returned. A ratio of 1.0 indicates perfect efficiency.',
                            )}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <ProgressBar value={1} max={1} color="success" style={{ flex: 1 }} />
                        <Badge appearance="filled" color="success">
                            {l10n.t('Perfect')}
                        </Badge>
                    </div>
                    <Text size={200} style={{ marginTop: '8px', color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('1.0 ratio - Index scan returns exactly the documents needed')}
                    </Text>
                </div>
            </Card>

            <Card>
                <div style={{ padding: '16px' }}>
                    <Text weight="semibold" style={{ marginBottom: '12px', display: 'block' }}>
                        {l10n.t('Index Information')}
                    </Text>
                    <div className={styles.codeBlock}>region_id_1_purchase_items.item_id_1_purchase_date_-1</div>
                    <div style={{ marginTop: '12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div>
                            <Label size="small">{l10n.t('Type:')}</Label>
                            <Text> Compound Multi-Key</Text>
                        </div>
                        <div>
                            <Label size="small">{l10n.t('Direction:')}</Label>
                            <Text> Forward</Text>
                        </div>
                        <div>
                            <Label size="small">{l10n.t('Unique:')}</Label>
                            <Text> No</Text>
                        </div>
                        <div>
                            <Label size="small">{l10n.t('Sparse:')}</Label>
                            <Text> No</Text>
                        </div>
                    </div>
                </div>
            </Card>

            <div className={styles.executionPlan}>
                <Text size={500} weight="semibold">
                    {l10n.t('Execution Plan Stages')}
                </Text>

                <div className={styles.stageCard}>
                    <div className={styles.stageHeader}>
                        <div className={styles.stageTitle}>
                            <ChevronRightRegular fontSize={20} />
                            <Text weight="semibold">LIMIT</Text>
                            <Badge appearance="tint">{l10n.t('Result Limiter')}</Badge>
                        </div>
                        <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
                            0.00 ms
                        </Text>
                    </div>

                    <div className={styles.stageDetails}>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('nReturned')}</Label>
                            <Text weight="semibold">10</Text>
                        </div>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('works')}</Label>
                            <Text weight="semibold">11</Text>
                        </div>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('limitAmount')}</Label>
                            <Text weight="semibold">10</Text>
                        </div>
                    </div>

                    <Accordion collapsible style={{ marginTop: '12px' }}>
                        <AccordionItem value="details">
                            <AccordionHeader size="small">{l10n.t('Stage Details')}</AccordionHeader>
                            <AccordionPanel>
                                <div className={styles.codeBlock}>
                                    <pre style={{ margin: 0 }}>
                                        {JSON.stringify(
                                            {
                                                stage: 'LIMIT',
                                                nReturned: 10,
                                                executionTimeMillisEstimate: 0,
                                                works: 11,
                                                advanced: 10,
                                                limitAmount: 10,
                                            },
                                            null,
                                            2,
                                        )}
                                    </pre>
                                </div>
                            </AccordionPanel>
                        </AccordionItem>
                    </Accordion>
                </div>

                <div className={styles.stageCard}>
                    <div className={styles.stageHeader}>
                        <div className={styles.stageTitle}>
                            <ChevronRightRegular fontSize={20} />
                            <Text weight="semibold">FETCH</Text>
                            <Badge appearance="tint">{l10n.t('Document Retrieval')}</Badge>
                        </div>
                        <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
                            0.00 ms
                        </Text>
                    </div>

                    <div className={styles.stageDetails}>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('nReturned')}</Label>
                            <Text weight="semibold">10</Text>
                        </div>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('docsExamined')}</Label>
                            <Text weight="semibold">10</Text>
                        </div>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('works')}</Label>
                            <Text weight="semibold">10</Text>
                        </div>
                    </div>

                    <div style={{ marginTop: '12px' }}>
                        <Label size="small">{l10n.t('Filter:')}</Label>
                        <div className={styles.codeBlock}>
                            {`purchase_items: { $elemMatch: { item_id: { $eq: 5 } } }`}
                        </div>
                    </div>
                </div>

                <div className={styles.stageCard}>
                    <div className={styles.stageHeader}>
                        <div className={styles.stageTitle}>
                            <ChevronRightRegular fontSize={20} />
                            <Text weight="semibold">IXSCAN</Text>
                            <Badge appearance="tint">{l10n.t('Index Scan')}</Badge>
                        </div>
                        <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
                            0.00 ms
                        </Text>
                    </div>

                    <div className={styles.stageDetails}>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('nReturned')}</Label>
                            <Text weight="semibold">10</Text>
                        </div>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('keysExamined')}</Label>
                            <Text weight="semibold">10</Text>
                        </div>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('direction')}</Label>
                            <Text weight="semibold">forward</Text>
                        </div>
                    </div>

                    <div style={{ marginTop: '12px' }}>
                        <Label size="small">{l10n.t('Index Bounds:')}</Label>
                        <div className={styles.codeBlock}>
                            {`region_id: [1, 1]\npurchase_items.item_id: [5, 5]\npurchase_date: [MaxKey, MinKey]`}
                        </div>
                    </div>
                </div>
            </div>

            <div className={styles.aiSuggestion}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <SparkleRegular fontSize={24} style={{ color: tokens.colorBrandForeground1 }} />
                    <div style={{ flex: 1 }}>
                        <Text weight="semibold" style={{ display: 'block', marginBottom: '8px' }}>
                            {l10n.t('AI Performance Review')}
                        </Text>
                        <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                            {l10n.t(
                                'Excellent! Your compound index perfectly matches the query pattern. The multi-key index on purchase_items efficiently handles the array filtering. With a 1:1 efficiency ratio, no optimization is needed.',
                            )}
                        </Text>
                        <Button appearance="primary" icon={<SparkleRegular />} size="small">
                            {l10n.t('Get Detailed Insights')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
