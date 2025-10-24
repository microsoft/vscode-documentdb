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
    mergeClasses,
    shorthands,
    Skeleton,
    SkeletonItem,
    Text,
    tokens,
    Tree,
    TreeItem,
    TreeItemLayout,
} from '@fluentui/react-components';
import { ChevronRightRegular, DatabaseRegular, SparkleRegular, TargetArrowRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX, useState } from 'react';

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

export const PerformanceTabD = (): JSX.Element => {
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
            <div className={styles.leftPanel}>
                {/* Metrics Row */}
                <Card>
                    <div className={styles.metricsRow}>
                        <Card className={styles.metricCard} appearance="filled">
                            <DatabaseRegular fontSize={24} />
                            <div className={styles.metricValue}>100</div>
                            <Label size="small">{l10n.t('Docs Returned')}</Label>
                        </Card>
                        <Card className={styles.metricCard} appearance="filled">
                            <TargetArrowRegular fontSize={24} />
                            <div className={styles.metricValue}>{stage === 1 ? 'n/a' : '100'}</div>
                            <Label size="small">{l10n.t('Docs Examined')}</Label>
                        </Card>
                        <Card className={styles.metricCard} appearance="filled">
                            <Label size="small" style={{ fontSize: '10px' }}>
                                {l10n.t('Time')}
                            </Label>
                            <div className={styles.metricValue}>{stage >= 2 ? '120' : '180'}</div>
                            <Label size="small">{l10n.t('ms')}</Label>
                        </Card>
                    </div>
                </Card>

                {/* Execution Plan Tree */}
                <Card>
                    <div className={styles.treeContainer}>
                        <Text weight="semibold" style={{ marginBottom: '12px', display: 'block' }}>
                            {l10n.t('Execution Plan Tree')}
                        </Text>
                        <Tree aria-label="Execution Plan">
                            <TreeItem itemType="branch" value="ixscan">
                                <TreeItemLayout>
                                    <div className={styles.stageNode}>
                                        <Badge appearance="filled" className={styles.stageBadge}>
                                            IXSCAN
                                        </Badge>
                                        <Text size={300}>{l10n.t('Index Scan')}</Text>
                                        {stage >= 2 && (
                                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                                0.00ms
                                            </Text>
                                        )}
                                    </div>
                                </TreeItemLayout>
                                <Tree>
                                    <TreeItem itemType="leaf">
                                        <TreeItemLayout>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <ChevronRightRegular fontSize={16} />
                                                <Text size={300}>{l10n.t('Index: status_1')}</Text>
                                            </div>
                                        </TreeItemLayout>
                                    </TreeItem>
                                    {stage >= 2 && (
                                        <TreeItem itemType="leaf">
                                            <TreeItemLayout>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <ChevronRightRegular fontSize={16} />
                                                    <Text size={300}>{l10n.t('100 keys examined, 100 returned')}</Text>
                                                </div>
                                            </TreeItemLayout>
                                        </TreeItem>
                                    )}
                                </Tree>
                            </TreeItem>
                        </Tree>

                        <Tree aria-label="Fetch Stage" style={{ marginTop: '12px' }}>
                            <TreeItem itemType="branch" value="fetch">
                                <TreeItemLayout>
                                    <div className={styles.stageNode}>
                                        <Badge appearance="filled" className={styles.stageBadge}>
                                            FETCH
                                        </Badge>
                                        <Text size={300}>{l10n.t('Fetch Documents')}</Text>
                                        {stage >= 2 && (
                                            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
                                                0.00ms
                                            </Text>
                                        )}
                                    </div>
                                </TreeItemLayout>
                                {stage >= 2 && (
                                    <Tree>
                                        <TreeItem itemType="leaf">
                                            <TreeItemLayout>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <ChevronRightRegular fontSize={16} />
                                                    <Text size={300}>{l10n.t('100 docs examined → 100 returned')}</Text>
                                                </div>
                                            </TreeItemLayout>
                                        </TreeItem>
                                    </Tree>
                                )}
                            </TreeItem>
                        </Tree>
                    </div>
                </Card>

                {/* CTA for Stage 2 */}
                {stage === 1 && (
                    <Button
                        appearance="primary"
                        size="large"
                        style={{ width: '100%' }}
                        onClick={handleRunDetailedAnalysis}
                        disabled={isLoadingStage2}
                    >
                        {isLoadingStage2 ? l10n.t('Running Detailed Analysis...') : l10n.t('Run Detailed Analysis')}
                    </Button>
                )}

                {/* Loading State for Stage 2 */}
                {isLoadingStage2 && (
                    <Card>
                        <div style={{ padding: '20px' }}>
                            <Text weight="semibold" style={{ marginBottom: '12px', display: 'block' }}>
                                {l10n.t('Collecting execution statistics...')}
                            </Text>
                            <Skeleton>
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} />
                            </Skeleton>
                        </div>
                    </Card>
                )}
            </div>

            <div className={styles.rightPanel}>
                {/* Index Details */}
                {stage >= 2 && !isLoadingStage2 && (
                    <Card className={styles.detailsCard}>
                        <Text weight="semibold" size={500}>
                            {l10n.t('Execution Summary')}
                        </Text>

                        <div className={styles.detailsGrid}>
                            <div className={styles.detailItem}>
                                <Label size="small">{l10n.t('Plan Type')}</Label>
                                <Text>IXSCAN → FETCH</Text>
                            </div>
                            <div className={styles.detailItem}>
                                <Label size="small">{l10n.t('Index Used')}</Label>
                                <Text>status_1</Text>
                            </div>
                            <div className={styles.detailItem}>
                                <Label size="small">{l10n.t('Efficiency Ratio')}</Label>
                                <Text>1.0</Text>
                            </div>
                            <div className={styles.detailItem}>
                                <Label size="small">{l10n.t('In-Memory Sort')}</Label>
                                <Text>No</Text>
                            </div>
                        </div>

                        <div style={{ marginTop: '16px' }}>
                            <div className={styles.efficiencyIndicator}>
                                <div className={mergeClasses(styles.efficiencyDot, styles.excellentDot)} />
                                <div style={{ flex: 1 }}>
                                    <Text weight="semibold">{l10n.t('Excellent')}</Text>
                                    <Text
                                        size={200}
                                        style={{ display: 'block', color: tokens.colorNeutralForeground3 }}
                                    >
                                        {l10n.t('Perfect 1:1 scan ratio')}
                                    </Text>
                                </div>
                            </div>
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
                        {isLoadingAI ? l10n.t('AI is analyzing...') : l10n.t('Get AI Insights')}
                    </Button>
                )}

                {/* Loading State for AI */}
                {isLoadingAI && (
                    <Card>
                        <div style={{ padding: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                                <SparkleRegular fontSize={24} style={{ color: tokens.colorBrandForeground1 }} />
                                <Text weight="semibold">{l10n.t('Generating AI insights...')}</Text>
                            </div>
                            <Skeleton>
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                <SkeletonItem size={16} style={{ width: '65%' }} />
                            </Skeleton>
                        </div>
                    </Card>
                )}

                {/* Stage 3: AI Recommendations */}
                {stage === 3 && !isLoadingAI && (
                    <Card className={styles.aiCard}>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <SparkleRegular fontSize={32} style={{ color: tokens.colorBrandForeground1 }} />
                            <div style={{ flex: 1 }}>
                                <Text weight="semibold" size={500} style={{ display: 'block', marginBottom: '8px' }}>
                                    {l10n.t('AI Analysis')}
                                </Text>
                                <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                                    {l10n.t(
                                        'The plan is an IXSCAN returning 100 docs with 1:1 docs/returned. No change recommended.',
                                    )}
                                </Text>
                                <Text
                                    size={300}
                                    weight="semibold"
                                    style={{
                                        display: 'block',
                                        marginBottom: '12px',
                                        color: tokens.colorBrandForeground1,
                                    }}
                                >
                                    {l10n.t('✓ Query is already optimized')}
                                </Text>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <Button appearance="primary" size="small">
                                        {l10n.t('Export Report')}
                                    </Button>
                                    <Button appearance="subtle" size="small">
                                        {l10n.t('Close')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>
                )}
            </div>
        </div>
    );
};
