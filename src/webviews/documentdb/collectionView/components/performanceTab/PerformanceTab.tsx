/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Badge, Button, Card, CardHeader, Label, makeStyles, shorthands, tokens } from '@fluentui/react-components';
import { LightbulbRegular, SparkleRegular, WarningRegular } from '@fluentui/react-icons';
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
    warningBadge: {
        backgroundColor: tokens.colorPaletteYellowBackground2,
        color: tokens.colorPaletteYellowForeground2,
    },
    recommendationCard: {
        backgroundColor: tokens.colorNeutralBackground3,
    },
    recommendationHeader: {
        display: 'flex',
        alignItems: 'center',
        ...shorthands.gap('8px'),
    },
    recommendationContent: {
        ...shorthands.padding('12px', '16px'),
        display: 'flex',
        flexDirection: 'column',
        ...shorthands.gap('12px'),
    },
    codeBlock: {
        backgroundColor: tokens.colorNeutralBackground1,
        ...shorthands.padding('12px'),
        ...shorthands.borderRadius('4px'),
        fontFamily: 'monospace',
        fontSize: '13px',
        ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke1),
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

export const PerformanceTab = (): JSX.Element => {
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
                            2
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Label size="small">{l10n.t('Actual Query Execution Time (ms):')}</Label>
                        <Label size="large" weight="semibold">
                            2.333
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Label size="small">{l10n.t('Index Keys Examined:')}</Label>
                        <Label size="large" weight="semibold">
                            2
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Label size="small">{l10n.t('Sorted in Memory:')}</Label>
                        <Label size="large" weight="semibold">
                            no
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Label size="small">{l10n.t('Documents Examined:')}</Label>
                        <Label size="large" weight="semibold">
                            10000
                        </Label>
                    </div>
                    <div className={styles.summaryItem}>
                        <Badge
                            appearance="filled"
                            color="warning"
                            icon={<WarningRegular />}
                            className={styles.warningBadge}
                        >
                            {l10n.t('No index available for this query')}
                        </Badge>
                    </div>
                </div>
            </div>

            <Card className={styles.recommendationCard}>
                <CardHeader
                    header={
                        <div className={styles.recommendationHeader}>
                            <SparkleRegular fontSize={20} />
                            <Label weight="semibold">{l10n.t('Create Index on user_id')}</Label>
                            <Badge appearance="filled" color="danger">
                                {l10n.t('HIGH PRIORITY')}
                            </Badge>
                        </div>
                    }
                />

                <div className={styles.recommendationContent}>
                    <div className={styles.analysisSection}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <LightbulbRegular />
                            <Label weight="semibold">{l10n.t('AI ANALYSIS')}</Label>
                        </div>
                        <Label>
                            {l10n.t(
                                'The query performs a COLLSCAN examining 10000 documents to return only 2, indicating poor selectivity without an index. The keys-to-docs ratio (0.0002) shows virtually no index assistance. Only the default __id__ index exists and is unused for this predicate. A single-field equality predicate on user_id would be fully supported by an index (user_id:1). Creating this index should reduce documents examined from 10000 to near the result set size. No drops are advised due to only one existing essential index.',
                            )}
                        </Label>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Label weight="semibold">{l10n.t('Suggested Command:')}</Label>
                        <div className={styles.codeBlock}>{`db.getCollection("a").createIndex({"user_id":1},())`}</div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Label size="small">{l10n.t('Current Performance:')}</Label>
                        <Label>
                            <strong>10,000 docs</strong> {l10n.t('Documents Examined')}
                        </Label>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Label size="small">{l10n.t('After Index:')}</Label>
                        <Label>
                            <strong>~2 docs</strong> {l10n.t('Estimated Reduction: 5000x')}
                        </Label>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <Label size="small" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <WarningRegular fontSize={16} />
                            {l10n.t('Risk:')}
                        </Label>
                        <Label>{l10n.t('Additional write and storage overhead for maintaining a new index.')}</Label>
                    </div>

                    <div className={styles.buttonGroup}>
                        <Button appearance="primary" icon={<SparkleRegular />}>
                            {l10n.t('Apply & Run Again')}
                        </Button>
                        <Button appearance="secondary">{l10n.t('Revert')}</Button>
                    </div>
                </div>
            </Card>
        </div>
    );
};
