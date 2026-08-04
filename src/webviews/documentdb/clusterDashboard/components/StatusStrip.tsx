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
import { PLACEHOLDER } from '../clusterFacts';
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
    /**
     * What a tile shows when the server did not report the figure.
     *
     * The em dash, not a sentence: these values render at 28px, so "Not reported by this
     * server" was truncated to "Not reported…" in every tile — larger, louder, and less
     * informative than the mark the tables already use for the same fact. The tile's tooltip
     * carries the explanation.
     */
    const NOT_REPORTED = PLACEHOLDER;

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

    // `undefined` while loading, `null` when the server answered nothing — the two states the
    // metric cards distinguish, and the reason these are not collapsed into a string here.
    const storageUsed =
        storageStats === null
            ? undefined
            : storageStats.totalSizeBytes === null
              ? null
              : formatBytes(storageStats.totalSizeBytes);

    const databaseSummary =
        storageStats === null
            ? undefined
            : l10n.t('{databases} / {collections}', {
                  databases: String(storageStats.databases.length),
                  collections: totalCollections === null ? PLACEHOLDER : String(totalCollections),
              });

    // Same `a / b` shape as the databases tile beside it: the label names the two figures in
    // order and the value pairs them off, so neither tile has to be read twice to work out
    // which number is which.
    const indexSummary =
        storageStats === null
            ? undefined
            : totalIndexes === null
              ? null
              : l10n.t('{count} / {size}', {
                    count: String(totalIndexes),
                    size: formatBytes(totalIndexBytes),
                });

    return (
        <div className="statusStrip">
            <MetricsRow>
                <div className="statusTile">
                    <GenericMetric
                        label={l10n.t('Storage Used')}
                        value={storageUsed}
                        nullValuePlaceholder={NOT_REPORTED}
                        tooltipExplanation={l10n.t(
                            'Total size on disk reported for all user databases. This is the data footprint, not the provisioned disk. A dash means this server did not report it.',
                        )}
                    />
                </div>

                <div className="statusTile">
                    <CountMetric
                        label={l10n.t('Documents')}
                        value={totalDocuments}
                        nullValuePlaceholder={NOT_REPORTED}
                        tooltipExplanation={l10n.t(
                            'Total documents across all user databases. A dash means this server did not report it.',
                        )}
                    />
                </div>

                <div className="statusTile">
                    <GenericMetric
                        label={l10n.t('Databases / Collections')}
                        value={databaseSummary}
                        nullValuePlaceholder={NOT_REPORTED}
                        tooltipExplanation={l10n.t('Number of user databases and the collections they contain.')}
                    />
                </div>

                <div className="statusTile">
                    <GenericMetric
                        label={l10n.t('Indexes / Size')}
                        value={indexSummary}
                        nullValuePlaceholder={NOT_REPORTED}
                        tooltipExplanation={l10n.t(
                            'Number of indexes across all user databases, and their total size. A dash means this server did not report it.',
                        )}
                    />
                </div>
            </MetricsRow>
        </div>
    );
};
