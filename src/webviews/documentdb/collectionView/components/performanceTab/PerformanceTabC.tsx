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
    makeStyles,
    ProgressBar,
    shorthands,
    Skeleton,
    SkeletonItem,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ChevronRightRegular, SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, useState } from 'react';

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
    const [stage, setStage] = useState<1 | 2 | 3>(1);
    const [isLoadingStage2, setIsLoadingStage2] = useState(false);
    const [isLoadingAI, setIsLoadingAI] = useState(false);

    const handleRunDetailedAnalysis = () => {
        setIsLoadingStage2(true);
        setTimeout(() => {
            setIsLoadingStage2(false);
            setStage(2);
        }, 5000);
    };

    const handleGetAISuggestions = () => {
        setIsLoadingAI(true);
        setTimeout(() => {
            setIsLoadingAI(false);
            setStage(3);
        }, 10000);
    };

    return (
        <div className={styles.container}>
            {/* Stats Grid */}
            <div className={styles.statsGrid}>
                <div className={styles.statBox}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Execution Time')}
                    </Label>
                    <Text size={500} weight="semibold">
                        {stage >= 2 ? '120 ms' : '180 ms'}
                    </Text>
                </div>
                <div className={styles.statBox}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Documents Returned')}
                    </Label>
                    <Text size={500} weight="semibold">
                        100
                    </Text>
                </div>
                <div className={styles.statBox}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Documents Examined')}
                    </Label>
                    <Text size={500} weight="semibold">
                        {stage === 1 ? 'n/a' : '100'}
                    </Text>
                </div>
                <div className={styles.statBox}>
                    <Label size="small" style={{ color: tokens.colorNeutralForeground2 }}>
                        {l10n.t('Index Keys Used')}
                    </Label>
                    <Text size={500} weight="semibold">
                        {stage === 1 ? 'n/a' : '100'}
                    </Text>
                </div>
            </div>

            {/* Efficiency Bar - only show in Stage 2+ */}
            {stage >= 2 && (
                <Card>
                    <div style={{ padding: '16px' }}>
                        <Text weight="semibold" style={{ marginBottom: '12px', display: 'block' }}>
                            {l10n.t('Query Efficiency')}
                        </Text>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <ProgressBar value={1} max={1} color="success" style={{ flex: 1 }} />
                            <Badge appearance="filled" color="success">
                                {l10n.t('Perfect')}
                            </Badge>
                        </div>
                        <Text size={200} style={{ marginTop: '8px', color: tokens.colorNeutralForeground2 }}>
                            {l10n.t('1.0 ratio - All examined documents were returned')}
                        </Text>
                    </div>
                </Card>
            )}

            {/* Stage 1: Execution Plan */}
            <div className={styles.executionPlan}>
                <Text size={500} weight="semibold">
                    {l10n.t('Execution Plan Stages')}
                </Text>

                <div className={styles.stageCard}>
                    <div className={styles.stageHeader}>
                        <div className={styles.stageTitle}>
                            <ChevronRightRegular fontSize={20} />
                            <Text weight="semibold">IXSCAN</Text>
                            <Badge appearance="tint">{l10n.t('Index Scan')}</Badge>
                        </div>
                        <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
                            {stage >= 2 ? '0.00 ms' : '—'}
                        </Text>
                    </div>

                    {stage >= 2 && (
                        <div className={styles.stageDetails}>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('keysExamined')}</Label>
                                <Text weight="semibold">100</Text>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('nReturned')}</Label>
                                <Text weight="semibold">100</Text>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('direction')}</Label>
                                <Text weight="semibold">forward</Text>
                            </div>
                        </div>
                    )}

                    <Accordion collapsible style={{ marginTop: '12px' }}>
                        <AccordionItem value="bounds">
                            <AccordionHeader size="small">{l10n.t('Index Bounds')}</AccordionHeader>
                            <AccordionPanel>
                                <div className={styles.codeBlock}>status: ["PENDING", "PENDING"]</div>
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
                            {stage >= 2 ? '0.00 ms' : '—'}
                        </Text>
                    </div>

                    {stage >= 2 && (
                        <div className={styles.stageDetails}>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('docsExamined')}</Label>
                                <Text weight="semibold">100</Text>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('nReturned')}</Label>
                                <Text weight="semibold">100</Text>
                            </div>
                            <div className={styles.metricItem}>
                                <Label size="small">{l10n.t('works')}</Label>
                                <Text weight="semibold">100</Text>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* CTA for Stage 2 */}
            {stage === 1 && (
                <Button
                    appearance="primary"
                    size="large"
                    style={{ width: '100%' }}
                    onClick={handleRunDetailedAnalysis}
                    disabled={isLoadingStage2}
                >
                    {isLoadingStage2 ? l10n.t('Running Analysis...') : l10n.t('Run Detailed Analysis')}
                </Button>
            )}

            {/* Loading State for Stage 2 */}
            {isLoadingStage2 && (
                <Card>
                    <div style={{ padding: '20px' }}>
                        <Text weight="semibold" style={{ marginBottom: '12px', display: 'block' }}>
                            {l10n.t('Executing query with instrumentation...')}
                        </Text>
                        <Skeleton>
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                            <SkeletonItem size={16} />
                        </Skeleton>
                    </div>
                </Card>
            )}

            {/* CTA for Stage 3 */}
            {stage === 2 && !isLoadingStage2 && (
                <Button
                    appearance="primary"
                    size="large"
                    icon={<SparkleRegular />}
                    style={{ width: '100%' }}
                    onClick={handleGetAISuggestions}
                    disabled={isLoadingAI}
                >
                    {isLoadingAI ? l10n.t('AI is analyzing...') : l10n.t('Get AI Performance Insights')}
                </Button>
            )}

            {/* Loading State for AI */}
            {isLoadingAI && (
                <Card>
                    <div style={{ padding: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                            <SparkleRegular fontSize={24} style={{ color: tokens.colorBrandForeground1 }} />
                            <Text weight="semibold">{l10n.t('AI is reviewing your execution plan...')}</Text>
                        </div>
                        <Skeleton>
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                            <SkeletonItem size={16} style={{ width: '75%' }} />
                        </Skeleton>
                    </div>
                </Card>
            )}

            {/* Stage 3: AI Recommendations */}
            {stage === 3 && !isLoadingAI && (
                <div className={styles.aiSuggestion}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        <SparkleRegular fontSize={24} style={{ color: tokens.colorBrandForeground1 }} />
                        <div style={{ flex: 1 }}>
                            <Text weight="semibold" style={{ display: 'block', marginBottom: '8px' }}>
                                {l10n.t('AI Performance Review')}
                            </Text>
                            <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                                {l10n.t(
                                    'The plan is an IXSCAN returning 100 docs with 1:1 docs/returned. No change recommended. Your query is already well-optimized.',
                                )}
                            </Text>
                            <div
                                style={{
                                    padding: '12px',
                                    backgroundColor: tokens.colorNeutralBackground1,
                                    borderRadius: '6px',
                                    marginTop: '8px',
                                }}
                            >
                                <Badge appearance="filled" color="success" style={{ marginRight: '8px' }}>
                                    {l10n.t('Optimal')}
                                </Badge>
                                <Text size={200}>
                                    {l10n.t('Index usage is efficient. Continue monitoring as data grows.')}
                                </Text>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
