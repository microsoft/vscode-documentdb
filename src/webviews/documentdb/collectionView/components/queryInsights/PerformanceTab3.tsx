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
import { ArrowClockwiseRegular, ChevronRightRegular, SparkleRegular, WarningRegular } from '@fluentui/react-icons';
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
    statBoxWarning: {
        ...shorthands.border('1px', 'solid', tokens.colorPaletteYellowBorder1),
        backgroundColor: tokens.colorPaletteYellowBackground1,
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
    efficiencyBar: {
        marginTop: '12px',
    },
    aiSuggestion: {
        ...shorthands.padding('16px'),
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.borderRadius('8px'),
        ...shorthands.border('1px', 'solid', tokens.colorBrandStroke1),
    },
});

export const PerformanceTab3 = (): JSX.Element => {
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
                        4.2 ms
                    </Text>
                </div>
                <div className={styles.statBox}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Documents Returned')}
                    </Label>
                    <Text size={500} weight="semibold">
                        8
                    </Text>
                </div>
                <div className={`${styles.statBox} ${styles.statBoxWarning}`}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Documents Scanned')}
                    </Label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Text size={500} weight="semibold">
                            8
                        </Text>
                        <WarningRegular fontSize={20} color={tokens.colorPaletteYellowForeground1} />
                    </div>
                </div>
                <div className={styles.statBox}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Index Keys Used')}
                    </Label>
                    <Text size={500} weight="semibold">
                        0
                    </Text>
                </div>
            </div>

            <Card>
                <div style={{ padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                        <Text weight="semibold">{l10n.t('Query Efficiency')}</Text>
                        <InfoLabel
                            info={l10n.t(
                                'Measures how efficiently the query executes. Lower is better. Ratio of documents examined to documents returned.',
                            )}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <ProgressBar value={0.1} max={1} color="success" style={{ flex: 1 }} />
                        <Badge appearance="filled" color="success">
                            {l10n.t('Excellent')}
                        </Badge>
                    </div>
                    <Text size={200} style={{ marginTop: '8px', color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('1:1 ratio - All examined documents were returned')}
                    </Text>
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
                            <Text weight="semibold">COLLSCAN</Text>
                            <Badge appearance="tint">{l10n.t('Collection Scan')}</Badge>
                        </div>
                        <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
                            0.004 ms
                        </Text>
                    </div>

                    <div className={styles.stageDetails}>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('nReturned')}</Label>
                            <Text weight="semibold">8</Text>
                        </div>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('Documents Examined')}</Label>
                            <Text weight="semibold">8</Text>
                        </div>
                        <div className={styles.metricItem}>
                            <Label size="small">{l10n.t('Direction')}</Label>
                            <Text weight="semibold">forward</Text>
                        </div>
                    </div>

                    <Accordion collapsible style={{ marginTop: '12px' }}>
                        <AccordionItem value="details">
                            <AccordionHeader size="small">{l10n.t('Stage Details')}</AccordionHeader>
                            <AccordionPanel>
                                <div
                                    style={{
                                        padding: '12px',
                                        backgroundColor: tokens.colorNeutralBackground1,
                                        borderRadius: '4px',
                                        fontFamily: 'monospace',
                                        fontSize: '12px',
                                    }}
                                >
                                    <pre style={{ margin: 0 }}>
                                        {JSON.stringify(
                                            {
                                                stage: 'COLLSCAN',
                                                filter: { user_id: { $eq: 123 } },
                                                nReturned: 8,
                                                executionTimeMillisEstimate: 0.004,
                                                works: 9,
                                                advanced: 8,
                                                needTime: 0,
                                                needYield: 0,
                                                saveState: 0,
                                                restoreState: 0,
                                                direction: 'forward',
                                                docsExamined: 8,
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
            </div>

            <div className={styles.aiSuggestion}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <SparkleRegular fontSize={24} style={{ color: tokens.colorBrandForeground1 }} />
                    <div style={{ flex: 1 }}>
                        <Text weight="semibold" style={{ display: 'block', marginBottom: '8px' }}>
                            {l10n.t('AI Optimization Suggestion')}
                        </Text>
                        <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                            {l10n.t(
                                'While your query is currently efficient, creating an index on user_id would future-proof performance as your collection grows.',
                            )}
                        </Text>
                        <Button appearance="primary" icon={<SparkleRegular />} size="small">
                            {l10n.t('Get Detailed Analysis')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
