/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';
// Reuse the Query Insights metric-card kit so the Index dashboard shares the
// exact same look, spacing, and responsive 1/2/4-column behaviour.
import { CountMetric, GenericMetric, MetricsRow } from '../../components/queryInsightsTab/components/metricsRow';
import { type IndexRow } from '../types';
import { formatBytes, formatOps } from '../utils/format';

export interface IndexMetricsRowProps {
    /** Undefined while loading so each metric card renders its skeleton. */
    indexes: ReadonlyArray<IndexRow> | undefined;
}

/**
 * Top-of-dashboard summary cards for the Index Management tab. Mirrors the
 * Query Insights metrics row: a single responsive row of four cards.
 *
 * The first three metrics are the collection-level index aggregates
 * (count, on-disk size, usage); the fourth surfaces index hygiene by
 * counting non-default indexes that have never been used.
 */
export const IndexMetricsRow = ({ indexes }: IndexMetricsRowProps): JSX.Element => {
    const totalSizeBytes = indexes?.reduce((sum, idx) => sum + (idx.sizeBytes ?? 0), 0);
    const totalUsageOps = indexes?.reduce((sum, idx) => sum + (idx.usageOps ?? 0), 0);
    // "Unused" = a non-default index with a known usage count of exactly zero.
    // Indexes whose stats are unavailable (usageOps undefined) are not counted.
    const unusedCount = indexes?.filter((idx) => !idx.isDefault && idx.usageOps === 0).length;

    return (
        <MetricsRow>
            <CountMetric
                label={l10n.t('Total Indexes')}
                value={indexes?.length}
                tooltipExplanation={l10n.t('Number of indexes on this collection, including the default _id index.')}
            />
            <GenericMetric
                label={l10n.t('Total Size')}
                value={totalSizeBytes === undefined ? undefined : formatBytes(totalSizeBytes)}
                tooltipExplanation={l10n.t('Combined on-disk size of all indexes on this collection.')}
            />
            <GenericMetric
                label={l10n.t('Total Usage')}
                value={totalUsageOps === undefined ? undefined : formatOps(totalUsageOps)}
                tooltipExplanation={l10n.t(
                    'Total number of operations that have used these indexes since the server began tracking usage.',
                )}
            />
            <CountMetric
                label={l10n.t('Unused Indexes')}
                value={unusedCount}
                tooltipExplanation={l10n.t(
                    'Non-default indexes with zero recorded usage since the server started tracking. Consider reviewing them. Unused indexes consume storage and slow writes.',
                )}
            />
        </MetricsRow>
    );
};
