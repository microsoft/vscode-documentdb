/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
// TODO(dashboard): promote metricsRow to src/webviews/components/ so views don't reach into each other.
import {
    CountMetric,
    GenericMetric,
    MetricsRow,
} from '../../collectionView/components/queryInsightsTab/components/metricsRow';
import { formatBytes } from '../formatUtils';

export interface StatusStripProps {
    storageStats: ClusterStorageStats | null;
}

/**
 * The dashboard's headline numbers: what the cluster *contains*.
 *
 * Deliberately static — no sparklines, no polling artifacts. The strip summarizes the data
 * inventory (storage, documents, databases/collections, indexes), which changes on the
 * timescale of deployments, not seconds; per the dashboard's motion rule, nothing above the
 * fold animates. Liveness (connection state, latency) lives in the header badge instead.
 *
 * `undefined` values render the metric row's loading skeleton; `null` renders the
 * "not reported" placeholder.
 */
export const StatusStrip = ({ storageStats }: StatusStripProps): JSX.Element => {
    const NOT_REPORTED = l10n.t('Not reported by this server');

    /** Sums a per-database figure, treating "no database reported it" as null. */
    const sumAcrossDatabases = (read: (db: ClusterStorageStats['databases'][number]) => number | null) =>
        storageStats === null
            ? undefined
            : storageStats.databases.reduce<number | null>((total, database) => {
                  const value = read(database);
                  if (value === null) {
                      return total;
                  }
                  return (total ?? 0) + value;
              }, null);

    const totalDocuments = sumAcrossDatabases((database) => database.objects);
    const totalCollections = sumAcrossDatabases((database) => database.collections);
    const totalIndexes = sumAcrossDatabases((database) => database.indexes);
    const totalIndexBytes = sumAcrossDatabases((database) => database.indexSizeBytes);

    const databaseSummary =
        storageStats === null
            ? undefined
            : l10n.t('{databases} / {collections}', {
                  databases: String(storageStats.databases.length),
                  collections: totalCollections === null ? '—' : String(totalCollections),
              });

    const indexSummary =
        storageStats === null
            ? undefined
            : totalIndexes === null
              ? NOT_REPORTED
              : totalIndexBytes === null
                ? String(totalIndexes)
                : l10n.t('{count} · {size}', { count: String(totalIndexes), size: formatBytes(totalIndexBytes) });

    return (
        <div className="statusStrip">
            <MetricsRow>
                <div className="statusTile">
                    <GenericMetric
                        label={l10n.t('Storage Used')}
                        value={
                            storageStats === null ? undefined : formatBytes(storageStats.totalSizeBytes, NOT_REPORTED)
                        }
                        tooltipExplanation={l10n.t(
                            'Total size on disk reported for all user databases. This is the data footprint, not the provisioned disk.',
                        )}
                    />
                </div>

                <div className="statusTile">
                    <CountMetric
                        label={l10n.t('Documents')}
                        value={totalDocuments}
                        nullValuePlaceholder={NOT_REPORTED}
                        tooltipExplanation={l10n.t('Total documents across all user databases.')}
                    />
                </div>

                <div className="statusTile">
                    <GenericMetric
                        label={l10n.t('Databases / Collections')}
                        value={databaseSummary}
                        tooltipExplanation={l10n.t('Number of user databases and the collections they contain.')}
                    />
                </div>

                <div className="statusTile">
                    <GenericMetric
                        label={l10n.t('Indexes')}
                        value={indexSummary}
                        tooltipExplanation={l10n.t(
                            'Number of indexes across all user databases, and their total size.',
                        )}
                    />
                </div>
            </MetricsRow>
        </div>
    );
};
