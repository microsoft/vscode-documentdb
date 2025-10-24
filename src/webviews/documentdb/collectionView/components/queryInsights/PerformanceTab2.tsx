/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
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
    DocumentBulletListRegular,
    GaugeRegular,
    KeyRegular,
    SparkleRegular,
    WarningRegular,
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
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
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
    warningCard: {
        backgroundColor: tokens.colorPaletteYellowBackground2,
    },
    warningHeader: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
        color: tokens.colorPaletteYellowForeground2,
    },
    actionCards: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
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
        alignItems: 'center',
        justifyContent: 'center',
        height: '120px',
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
        fontSize: '48px',
        color: tokens.colorBrandForeground1,
    },
    codePreview: {
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.padding('8px', '12px'),
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '12px',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    },
});

export const PerformanceTab2 = (): JSX.Element => {
    const styles = useStyles();

    return (
        <div className={styles.container}>
            <div className={styles.summaryCards}>
                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <DocumentBulletListRegular fontSize={24} />
                        <div className={styles.metricValue}>8</div>
                        <div className={styles.metricLabel}>{l10n.t('Documents Returned')}</div>
                    </div>
                </Card>

                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <KeyRegular fontSize={24} />
                        <div className={styles.metricValue}>0</div>
                        <div className={styles.metricLabel}>{l10n.t('Index Keys Examined')}</div>
                    </div>
                </Card>

                <Card className={styles.summaryCard} appearance="filled">
                    <div className={styles.cardContent}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <ArrowTrendingRegular fontSize={24} />
                            <WarningRegular fontSize={20} color={tokens.colorPaletteYellowForeground1} />
                        </div>
                        <div className={styles.metricValue}>8</div>
                        <div className={styles.metricLabel}>{l10n.t('Documents Examined')}</div>
                    </div>
                </Card>

                <Card className={styles.summaryCard}>
                    <div className={styles.cardContent}>
                        <GaugeRegular fontSize={24} />
                        <div className={styles.metricValue}>4.2</div>
                        <div className={styles.metricLabel}>{l10n.t('Execution Time (ms)')}</div>
                    </div>
                </Card>
            </div>

            <Card className={styles.warningCard}>
                <CardHeader
                    header={
                        <div className={styles.warningHeader}>
                            <WarningRegular fontSize={20} />
                            <Text weight="semibold">
                                {l10n.t('No index available for this query - performance may be impacted')}
                            </Text>
                        </div>
                    }
                />
            </Card>

            <Text size={500} weight="semibold">
                {l10n.t('Optimization Opportunities')}
            </Text>

            <div className={styles.actionCards}>
                <Card className={styles.actionCard}>
                    <CardPreview className={styles.actionCardPreview}>
                        <SparkleRegular className={styles.iconLarge} />
                    </CardPreview>
                    <div className={styles.actionCardContent}>
                        <Text weight="semibold" size={400}>
                            {l10n.t('Create Index')}
                        </Text>
                        <Text size={300}>{l10n.t('Add an index to improve query performance by 1000x')}</Text>
                        <div className={styles.codePreview}>
                            {`db.getCollection("users").createIndex({"user_id": 1})`}
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <Button appearance="primary" size="small" icon={<SparkleRegular />}>
                                {l10n.t('Apply')}
                            </Button>
                            <Button appearance="subtle" size="small">
                                {l10n.t('Learn More')}
                            </Button>
                        </div>
                    </div>
                </Card>

                <Card className={styles.actionCard}>
                    <CardPreview className={styles.actionCardPreview}>
                        <GaugeRegular className={styles.iconLarge} />
                    </CardPreview>
                    <div className={styles.actionCardContent}>
                        <Text weight="semibold" size={400}>
                            {l10n.t('Optimize Query Structure')}
                        </Text>
                        <Text size={300}>
                            {l10n.t('Current query performs a full collection scan examining all documents')}
                        </Text>
                        <div style={{ marginTop: '8px' }}>
                            <Text size={200} style={{ color: tokens.colorNeutralForeground2 }}>
                                {l10n.t('Estimated improvement: 500x faster')}
                            </Text>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <Button appearance="secondary" size="small">
                                {l10n.t('View Details')}
                            </Button>
                        </div>
                    </div>
                </Card>
            </div>

            <Card>
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <SparkleRegular fontSize={40} style={{ color: tokens.colorBrandForeground1 }} />
                    <Text as="h3" size={500} weight="semibold" style={{ marginTop: '12px', display: 'block' }}>
                        {l10n.t('Get AI-Powered Insights')}
                    </Text>
                    <Text size={300} style={{ marginTop: '8px', display: 'block' }}>
                        {l10n.t('Let AI analyze your query execution plan and provide optimization recommendations')}
                    </Text>
                    <Button appearance="primary" icon={<SparkleRegular />} style={{ marginTop: '16px' }}>
                        {l10n.t('Analyze with AI')}
                    </Button>
                    <div style={{ marginTop: '12px' }}>
                        <Link href="#">{l10n.t('Learn about query optimization')}</Link>
                    </div>
                </div>
            </Card>
        </div>
    );
};
