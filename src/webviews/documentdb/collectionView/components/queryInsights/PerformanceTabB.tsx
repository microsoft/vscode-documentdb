/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Badge,
    Button,
    Card,
    CardHeader,
    CardPreview,
    makeStyles,
    shorthands,
    Skeleton,
    SkeletonItem,
    Text,
    tokens,
} from '@fluentui/react-components';
import {
    ArrowTrendingRegular,
    CheckmarkCircleRegular,
    DatabaseRegular,
    GaugeRegular,
    KeyRegular,
    SparkleRegular,
    WarningRegular,
} from '@fluentui/react-icons';
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
    summaryCards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        ...shorthands.gap('16px'),
    },
    summaryCard: {
        height: '140px',
        cursor: 'default',
    },
    cardContent: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
        ...shorthands.padding('16px'),
        height: '100%',
    },
    metricValue: {
        fontSize: '32px',
        fontWeight: 600,
        lineHeight: '40px',
    },
    metricLabel: {
        fontSize: '14px',
        color: tokens.colorNeutralForeground2,
    },
    successCard: {
        backgroundColor: tokens.colorPaletteGreenBackground2,
    },
    successHeader: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
        color: tokens.colorPaletteGreenForeground2,
    },
    actionCards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
        ...shorthands.gap('16px'),
    },
    actionCard: {
        cursor: 'pointer',
        ':hover': {
            backgroundColor: tokens.colorNeutralBackground1Hover,
        },
    },
    actionCardPreview: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        ...shorthands.gap('8px'),
        height: '100px',
        backgroundColor: tokens.colorBrandBackground2,
        ...shorthands.borderRadius(tokens.borderRadiusMedium, tokens.borderRadiusMedium, '0', '0'),
    },
    actionCardContent: {
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
        ...shorthands.padding('16px'),
    },
    iconLarge: {
        fontSize: '40px',
        color: tokens.colorBrandForeground1,
    },
    codePreview: {
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.padding('8px', '12px'),
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '11px',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
        overflowX: 'auto',
    },
});

export const PerformanceTabB = (): JSX.Element => {
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
            {/* Metric Cards - Stage 1 shows n/a for some, Stage 2+ shows real values */}
            <div className={styles.summaryCards}>
                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <DatabaseRegular fontSize={24} />
                        <div className={styles.metricValue}>50</div>
                        <div className={styles.metricLabel}>{l10n.t('Documents Returned')}</div>
                    </div>
                </Card>

                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <KeyRegular fontSize={24} />
                        {stage === 1 ? (
                            <>
                                <div className={styles.metricValue}>n/a</div>
                                <div className={styles.metricLabel}>{l10n.t('Keys Examined')}</div>
                            </>
                        ) : (
                            <>
                                <div className={styles.metricValue}>8,140</div>
                                <div className={styles.metricLabel}>{l10n.t('Keys Examined')}</div>
                            </>
                        )}
                    </div>
                </Card>

                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'flex-start',
                                width: '100%',
                            }}
                        >
                            <ArrowTrendingRegular fontSize={24} />
                            {stage >= 2 && (
                                <WarningRegular fontSize={20} color={tokens.colorPaletteYellowForeground1} />
                            )}
                        </div>
                        {stage === 1 ? (
                            <>
                                <div className={styles.metricValue}>n/a</div>
                                <div className={styles.metricLabel}>{l10n.t('Docs Examined')}</div>
                            </>
                        ) : (
                            <>
                                <div className={styles.metricValue}>9,900</div>
                                <div className={styles.metricLabel}>{l10n.t('Docs Examined')}</div>
                            </>
                        )}
                    </div>
                </Card>

                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <GaugeRegular fontSize={24} />
                        <div className={styles.metricValue}>{stage >= 2 ? '1.4 s' : '1.9 s'}</div>
                        <div className={styles.metricLabel}>{l10n.t('Execution Time')}</div>
                    </div>
                </Card>
            </div>

            {/* Status Card */}
            {stage >= 2 && (
                <Card appearance="filled" style={{ backgroundColor: tokens.colorPaletteYellowBackground2 }}>
                    <CardHeader
                        header={
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <WarningRegular fontSize={20} color={tokens.colorPaletteYellowForeground2} />
                                <Text weight="semibold" style={{ color: tokens.colorPaletteYellowForeground2 }}>
                                    {l10n.t('Low efficiency detected - 198:1 docs examined to returned ratio')}
                                </Text>
                            </div>
                        }
                    />
                </Card>
            )}

            {stage === 1 && (
                <>
                    <Text size={500} weight="semibold">
                        {l10n.t('Targeting & Merge Summary')}
                    </Text>
                    <Card>
                        <div style={{ padding: '16px' }}>
                            <Text size={300} style={{ display: 'block', marginBottom: '8px' }}>
                                <strong>{l10n.t('Shards:')}</strong> shardA, shardB
                            </Text>
                            <Text size={300}>
                                <strong>{l10n.t('Merge Stage:')}</strong> SHARD_MERGE
                            </Text>
                        </div>
                    </Card>

                    <Button
                        appearance="primary"
                        size="large"
                        style={{ width: '100%', justifyContent: 'center' }}
                        onClick={handleRunDetailedAnalysis}
                        disabled={isLoadingStage2}
                    >
                        {isLoadingStage2 ? l10n.t('Running Detailed Analysis...') : l10n.t('Run Detailed Analysis')}
                    </Button>
                </>
            )}

            {/* Loading State for Stage 2 */}
            {isLoadingStage2 && (
                <Card>
                    <div style={{ padding: '20px' }}>
                        <Text weight="semibold" style={{ marginBottom: '12px', display: 'block' }}>
                            {l10n.t('Executing query plan...')}
                        </Text>
                        <Skeleton>
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                            <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                            <SkeletonItem size={16} />
                        </Skeleton>
                    </div>
                </Card>
            )}

            {/* Stage 2: Per-Shard Breakdown */}
            {stage >= 2 && !isLoadingStage2 && (
                <>
                    <Text size={500} weight="semibold">
                        {l10n.t('Per-Shard Execution')}
                    </Text>

                    <div className={styles.actionCards}>
                        <Card className={styles.actionCard}>
                            <CardPreview className={styles.actionCardPreview}>
                                <Text weight="semibold" size={400}>
                                    shardA
                                </Text>
                                <Badge appearance="tint">IXSCAN → FETCH</Badge>
                            </CardPreview>
                            <div className={styles.actionCardContent}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                    <div>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                            {l10n.t('Keys')}
                                        </Text>
                                        <Text weight="semibold"> 6,200</Text>
                                    </div>
                                    <div>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                            {l10n.t('Docs')}
                                        </Text>
                                        <Text weight="semibold"> 7,500</Text>
                                    </div>
                                    <div>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                            {l10n.t('Returned')}
                                        </Text>
                                        <Text weight="semibold"> 30</Text>
                                    </div>
                                </div>
                                <div className={styles.codePreview}>index: status_1</div>
                            </div>
                        </Card>

                        <Card className={styles.actionCard}>
                            <CardPreview
                                className={styles.actionCardPreview}
                                style={{ backgroundColor: tokens.colorPaletteYellowBackground2 }}
                            >
                                <Text weight="semibold" size={400}>
                                    shardB
                                </Text>
                                <div style={{ display: 'flex', gap: '4px' }}>
                                    <Badge appearance="filled" color="warning">
                                        COLLSCAN
                                    </Badge>
                                    <Badge appearance="filled" color="warning">
                                        Blocked sort
                                    </Badge>
                                </div>
                            </CardPreview>
                            <div className={styles.actionCardContent}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                                    <div>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                            {l10n.t('Keys')}
                                        </Text>
                                        <Text weight="semibold"> 0</Text>
                                    </div>
                                    <div>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                            {l10n.t('Docs')}
                                        </Text>
                                        <Text weight="semibold"> 2,400</Text>
                                    </div>
                                    <div>
                                        <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                            {l10n.t('Returned')}
                                        </Text>
                                        <Text weight="semibold"> 20</Text>
                                    </div>
                                </div>
                                <Text size={200} style={{ color: tokens.colorPaletteYellowForeground1 }}>
                                    ⚠ {l10n.t('In-memory sort required')}
                                </Text>
                            </div>
                        </Card>
                    </div>

                    {stage === 2 && (
                        <Button
                            appearance="primary"
                            size="large"
                            icon={<SparkleRegular />}
                            style={{ width: '100%', justifyContent: 'center' }}
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
                                    <Text weight="semibold">{l10n.t('AI is analyzing your query execution...')}</Text>
                                </div>
                                <Skeleton>
                                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                    <SkeletonItem size={16} style={{ marginBottom: '8px' }} />
                                    <SkeletonItem size={16} style={{ width: '70%' }} />
                                </Skeleton>
                            </div>
                        </Card>
                    )}
                </>
            )}

            {/* Stage 3: AI Recommendations */}
            {stage === 3 && !isLoadingAI && (
                <Card style={{ backgroundColor: tokens.colorBrandBackground2 }}>
                    <div style={{ padding: '20px' }}>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <SparkleRegular fontSize={32} style={{ color: tokens.colorBrandForeground1 }} />
                            <div style={{ flex: 1 }}>
                                <Text weight="semibold" size={500} style={{ display: 'block', marginBottom: '12px' }}>
                                    {l10n.t('AI Recommendation')}
                                </Text>
                                <Text size={300} style={{ display: 'block', marginBottom: '12px' }}>
                                    {l10n.t(
                                        'Merged results across shards; examined 9,900 docs to return 50 (198:1). Consider indexing',
                                    )}{' '}
                                    <strong>{'{ status: 1, createdAt: -1 }'}</strong>{' '}
                                    {l10n.t('to support filter + sort.')}
                                </Text>
                                <div className={styles.codePreview} style={{ marginTop: '12px' }}>
                                    {`db.getCollection('orders').createIndex(\n  { status: 1, createdAt: -1 }\n);`}
                                </div>
                                <Button
                                    appearance="primary"
                                    icon={<CheckmarkCircleRegular />}
                                    style={{ marginTop: '16px' }}
                                >
                                    {l10n.t('Create Index')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
};
