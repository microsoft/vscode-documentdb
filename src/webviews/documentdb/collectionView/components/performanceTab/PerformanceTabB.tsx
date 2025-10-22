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
    Link,
    makeStyles,
    shorthands,
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
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

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

    return (
        <div className={styles.container}>
            <div className={styles.summaryCards}>
                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <DatabaseRegular fontSize={24} />
                        <div className={styles.metricValue}>10</div>
                        <div className={styles.metricLabel}>{l10n.t('Documents Returned')}</div>
                    </div>
                </Card>

                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <KeyRegular fontSize={24} />
                        <div className={styles.metricValue}>10</div>
                        <div className={styles.metricLabel}>{l10n.t('Index Keys Examined')}</div>
                    </div>
                </Card>

                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <ArrowTrendingRegular fontSize={24} />
                        <div className={styles.metricValue}>10</div>
                        <div className={styles.metricLabel}>{l10n.t('Documents Examined')}</div>
                    </div>
                </Card>

                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <GaugeRegular fontSize={24} />
                        <div className={styles.metricValue}>0.45</div>
                        <div className={styles.metricLabel}>{l10n.t('Execution Time (ms)')}</div>
                    </div>
                </Card>
            </div>

            <Card className={styles.successCard}>
                <CardHeader
                    header={
                        <div className={styles.successHeader}>
                            <CheckmarkCircleRegular fontSize={20} />
                            <Text weight="semibold">
                                {l10n.t('Index used efficiently - optimal query performance')}
                            </Text>
                        </div>
                    }
                />
            </Card>

            <Text size={500} weight="semibold">
                {l10n.t('Execution Plan')}
            </Text>

            <div className={styles.actionCards}>
                <Card className={styles.actionCard}>
                    <CardPreview className={styles.actionCardPreview}>
                        <Badge appearance="tint" size="extra-large">
                            LIMIT
                        </Badge>
                        <Text size={200}>{l10n.t('Stage 1')}</Text>
                    </CardPreview>
                    <div className={styles.actionCardContent}>
                        <Text weight="semibold" size={400}>
                            {l10n.t('Limit Stage')}
                        </Text>
                        <Text size={300}>{l10n.t('Limits result set to 10 documents')}</Text>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                            <div>
                                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                    {l10n.t('nReturned')}
                                </Text>
                                <Text weight="semibold"> 10</Text>
                            </div>
                            <div>
                                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                    {l10n.t('works')}
                                </Text>
                                <Text weight="semibold"> 11</Text>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card className={styles.actionCard}>
                    <CardPreview className={styles.actionCardPreview}>
                        <Badge appearance="tint" size="extra-large">
                            FETCH
                        </Badge>
                        <Text size={200}>{l10n.t('Stage 2')}</Text>
                    </CardPreview>
                    <div className={styles.actionCardContent}>
                        <Text weight="semibold" size={400}>
                            {l10n.t('Fetch Stage')}
                        </Text>
                        <Text size={300}>{l10n.t('Retrieves full documents matching filter')}</Text>
                        <div className={styles.codePreview}>
                            {`purchase_items: {\n  $elemMatch: { item_id: { $eq: 5 } }\n}`}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                            <div>
                                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                    {l10n.t('nReturned')}
                                </Text>
                                <Text weight="semibold"> 10</Text>
                            </div>
                            <div>
                                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                    {l10n.t('docsExamined')}
                                </Text>
                                <Text weight="semibold"> 10</Text>
                            </div>
                        </div>
                    </div>
                </Card>

                <Card className={styles.actionCard}>
                    <CardPreview className={styles.actionCardPreview}>
                        <Badge appearance="tint" size="extra-large">
                            IXSCAN
                        </Badge>
                        <Text size={200}>{l10n.t('Stage 3')}</Text>
                    </CardPreview>
                    <div className={styles.actionCardContent}>
                        <Text weight="semibold" size={400}>
                            {l10n.t('Index Scan')}
                        </Text>
                        <Text size={300}>{l10n.t('Efficiently scans using compound index')}</Text>
                        <div className={styles.codePreview}>
                            {`region_id_1_purchase_items.item_id_1_purchase_date_-1`}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                            <div>
                                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                    {l10n.t('keysExamined')}
                                </Text>
                                <Text weight="semibold"> 10</Text>
                            </div>
                            <div>
                                <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                    {l10n.t('direction')}
                                </Text>
                                <Text weight="semibold"> forward</Text>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            <Card>
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <SparkleRegular fontSize={40} style={{ color: tokens.colorBrandForeground1 }} />
                    <Text as="h3" size={500} weight="semibold" style={{ marginTop: '12px', display: 'block' }}>
                        {l10n.t('Performance Insights')}
                    </Text>
                    <Text size={300} style={{ marginTop: '8px', display: 'block' }}>
                        {l10n.t(
                            'Your query uses a compound index effectively. The multi-key index handles array queries efficiently, and the 1:1 scan ratio shows optimal performance.',
                        )}
                    </Text>
                    <Button appearance="primary" icon={<SparkleRegular />} style={{ marginTop: '16px' }}>
                        {l10n.t('Get AI Analysis')}
                    </Button>
                    <div style={{ marginTop: '12px' }}>
                        <Link href="#">{l10n.t('Learn about index optimization')}</Link>
                    </div>
                </div>
            </Card>
        </div>
    );
};
