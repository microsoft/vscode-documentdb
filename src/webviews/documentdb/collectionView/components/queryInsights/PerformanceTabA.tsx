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
    shorthands,
    Skeleton,
    SkeletonItem,
    Text,
    tokens,
} from '@fluentui/react-components';
import { ChevronRightRegular, LightbulbRegular, SparkleRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, useState } from 'react';

const useStyles = makeStyles({
    container: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('20px'),
        ...shorthands.padding('20px'),
        height: '100%',
        overflowY: 'auto',
    },
    summaryBar: {
        display: 'flex',
        ...shorthands.gap('12px'),
        ...shorthands.padding('16px'),
        backgroundColor: tokens.colorNeutralBackground2,
        ...shorthands.borderRadius('8px'),
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    },
    summaryItem: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('4px'),
    },
    summaryValue: {
        fontSize: '24px',
        fontWeight: 600,
        lineHeight: '28px',
    },
    summaryLabel: {
        fontSize: '12px',
        color: tokens.colorNeutralForeground2,
    },
    planSection: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
    },
    planStages: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
        ...shorthands.padding('16px'),
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.borderRadius('6px'),
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    },
    stageChip: {
        ...shorthands.padding('6px', '12px'),
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '13px',
        fontWeight: 600,
    },
    indexBounds: {
        display: 'flex',
        ...shorthands.gap('8px'),
        flexWrap: 'wrap',
    },
    boundsChip: {
        ...shorthands.padding('4px', '8px'),
        backgroundColor: tokens.colorNeutralBackground3,
        ...shorthands.borderRadius('4px'),
        fontSize: '11px',
        fontFamily: 'monospace',
    },
    ctaButton: {
        width: '100%',
        justifyContent: 'center',
    },
    aiSection: {
        ...shorthands.padding('20px'),
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.borderRadius('8px'),
        ...shorthands.border('1px', 'solid', tokens.colorBrandStroke1),
    },
});

export const PerformanceTabA = (): JSX.Element => {
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
            {/* Summary Bar - Always Visible */}
            <div className={styles.summaryBar}>
                <div className={styles.summaryItem}>
                    <div className={styles.summaryValue}>180 ms</div>
                    <div className={styles.summaryLabel}>{l10n.t('Execution Time')}</div>
                </div>
                <div className={styles.summaryItem}>
                    <div className={styles.summaryValue}>100</div>
                    <div className={styles.summaryLabel}>{l10n.t('Documents Returned')}</div>
                </div>
                <div className={styles.summaryItem}>
                    {stage === 1 ? (
                        <>
                            <div className={styles.summaryValue}>n/a</div>
                            <div className={styles.summaryLabel}>{l10n.t('Keys Examined')}</div>
                        </>
                    ) : (
                        <>
                            <div className={styles.summaryValue}>100</div>
                            <div className={styles.summaryLabel}>{l10n.t('Keys Examined')}</div>
                        </>
                    )}
                </div>
                <div className={styles.summaryItem}>
                    {stage === 1 ? (
                        <>
                            <div className={styles.summaryValue}>n/a</div>
                            <div className={styles.summaryLabel}>{l10n.t('Docs Examined')}</div>
                        </>
                    ) : (
                        <>
                            <div className={styles.summaryValue}>100</div>
                            <div className={styles.summaryLabel}>{l10n.t('Docs Examined')}</div>
                        </>
                    )}
                </div>
                <div className={styles.summaryItem}>
                    {stage === 1 ? (
                        <>
                            <div className={styles.summaryValue}>n/a</div>
                            <div className={styles.summaryLabel}>{l10n.t('Docs/Returned')}</div>
                        </>
                    ) : (
                        <>
                            <div className={styles.summaryValue}>1 : 1</div>
                            <div className={styles.summaryLabel}>{l10n.t('Docs/Returned')}</div>
                        </>
                    )}
                </div>
            </div>

            {/* Stage 1: Query Plan Summary */}
            <div className={styles.planSection}>
                <Label size="large" weight="semibold">
                    {l10n.t('Query Plan Summary')}
                </Label>

                <Card>
                    <div style={{ padding: '16px' }}>
                        <Label size="small" style={{ marginBottom: '8px', display: 'block' }}>
                            {l10n.t('Winning Plan')}
                        </Label>
                        <div className={styles.planStages}>
                            <div className={styles.stageChip}>IXSCAN(status_1)</div>
                            <ChevronRightRegular fontSize={20} />
                            <div className={styles.stageChip}>FETCH</div>
                            <ChevronRightRegular fontSize={20} />
                            <div className={styles.stageChip}>PROJECTION</div>
                        </div>
                    </div>
                </Card>

                <Card>
                    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Label size="small">{l10n.t('Index Bounds')}</Label>
                            <Badge appearance="tint" color="success">
                                {l10n.t('Uses index')}
                            </Badge>
                        </div>
                        <div className={styles.indexBounds}>
                            <div className={styles.boundsChip}>status: ["PENDING", "PENDING"]</div>
                        </div>
                    </div>
                </Card>

                <Card>
                    <div style={{ padding: '16px' }}>
                        <Label size="small" style={{ marginBottom: '8px', display: 'block' }}>
                            {l10n.t('Rejected Plans')}
                        </Label>
                        <Text size={300}>1 other plan considered (COLLSCAN)</Text>
                    </div>
                </Card>
            </div>

            {/* CTA for Stage 2 */}
            {stage === 1 && (
                <Button
                    appearance="primary"
                    size="large"
                    className={styles.ctaButton}
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
                            {l10n.t('Loading Execution Statistics...')}
                        </Text>
                        <Skeleton>
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                        </Skeleton>
                    </div>
                </Card>
            )}

            {/* Stage 2: Execution Details */}
            {stage >= 2 && !isLoadingStage2 && (
                <>
                    <div className={styles.planSection}>
                        <Label size="large" weight="semibold">
                            {l10n.t('Execution Details')}
                        </Label>

                        <Card>
                            <div style={{ padding: '16px' }}>
                                <Label size="small" style={{ marginBottom: '12px', display: 'block' }}>
                                    {l10n.t('Per-Stage Counters')}
                                </Label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Text size={300}>IXSCAN(status_1)</Text>
                                        <Text size={300} weight="semibold">
                                            keysExamined: 100, nReturned: 100
                                        </Text>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Text size={300}>FETCH</Text>
                                        <Text size={300} weight="semibold">
                                            docsExamined: 100, nReturned: 100
                                        </Text>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Text size={300}>PROJECTION</Text>
                                        <Text size={300} weight="semibold">
                                            nReturned: 100
                                        </Text>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        <Card>
                            <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <Badge appearance="tint" color="success">
                                    {l10n.t('Efficient')}
                                </Badge>
                                <Text size={300}>
                                    {l10n.t('1:1 docs/returned ratio - All examined documents were returned')}
                                </Text>
                            </div>
                        </Card>
                    </div>

                    {/* CTA for Stage 3 */}
                    {stage === 2 && (
                        <Button
                            appearance="primary"
                            size="large"
                            icon={<SparkleRegular />}
                            className={styles.ctaButton}
                            onClick={handleGetAISuggestions}
                            disabled={isLoadingAI}
                        >
                            {isLoadingAI ? l10n.t('AI is analyzing...') : l10n.t('Get AI Suggestions')}
                        </Button>
                    )}

                    {/* Loading State for AI */}
                    {isLoadingAI && (
                        <Card>
                            <div style={{ padding: '20px' }}>
                                <div
                                    style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}
                                >
                                    <SparkleRegular fontSize={24} style={{ color: tokens.colorBrandForeground1 }} />
                                    <Text weight="semibold">{l10n.t('AI is analyzing your query...')}</Text>
                                </div>
                                <Skeleton>
                                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                    <SkeletonItem size={16} style={{ width: '60%' }} />
                                </Skeleton>
                            </div>
                        </Card>
                    )}
                </>
            )}

            {/* Stage 3: AI Recommendations */}
            {stage === 3 && !isLoadingAI && (
                <div className={styles.aiSection}>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <SparkleRegular fontSize={32} style={{ color: tokens.colorBrandForeground1 }} />
                        <div style={{ flex: 1 }}>
                            <Text weight="semibold" size={500} style={{ display: 'block', marginBottom: '12px' }}>
                                {l10n.t('AI Analysis')}
                            </Text>
                            <Text size={300} style={{ display: 'block', marginBottom: '16px' }}>
                                {l10n.t(
                                    'The plan is an IXSCAN returning 100 docs with 1:1 docs/returned. No change recommended.',
                                )}
                            </Text>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '8px',
                                    padding: '12px',
                                    backgroundColor: tokens.colorNeutralBackground1,
                                    borderRadius: '6px',
                                }}
                            >
                                <LightbulbRegular fontSize={20} />
                                <Text size={300}>
                                    {l10n.t('Your query is already well-optimized. Consider monitoring as data grows.')}
                                </Text>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
