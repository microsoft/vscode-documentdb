/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Fade } from '@fluentui/react-motion-components-preview';
import * as l10n from '@vscode/l10n';
import { type JSX } from 'react';

import { type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
// TODO(dashboard): promote metricsRow to src/webviews/components/ so views don't reach into each other.
import { CountMetric, GenericMetric, MetricsRow } from '../../collectionView/queryInsightsTab/components/metricsRow';
import { formatBytes } from '../formatUtils';

export interface StatusStripProps {
    storageStats: ClusterStorageStats | null;
    /** The database whose collections are open, or `null` for cluster-wide metrics. */
    currentDatabase: string | null;
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
export const StatusStrip = ({ storageStats, currentDatabase }: StatusStripProps): JSX.Element => {
    /**
     * What a composed value shows for the half of it the server did not report.
     *
     * The same text `MetricBase` renders for a wholly unavailable value, so `2 / N/A` and a
     * dimmed `N/A` say the same thing in the same words. The tiles used an em dash, which is
     * the tables' convention, not this row's.
     */
    const UNAVAILABLE = l10n.t('N/A');

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

    /**
     * Whether these tiles are summing less than the whole cluster.
     *
     * Two independent truncations feed one number: `getStorageStats` inspects at most
     * `DATABASE_STATS_LIMIT` databases, and any database whose `dbStats` failed contributes
     * nothing. The Storage tab states both, but this strip stays on screen while Operations or
     * Activity is selected, so a caveat that lives only on the tab is not always next to the
     * number it qualifies.
     */
    const omittedCount = storageStats?.omittedDatabaseCount ?? 0;
    const unreportedCount =
        storageStats === null
            ? 0
            : storageStats.databases.filter((database) => database.sizeOnDiskBytes === null).length;
    const isPartial = omittedCount > 0 || unreportedCount > 0;

    /**
     * Marks a summed figure as a lower bound when the sum is incomplete.
     *
     * A partial sum presented as a total is the one kind of wrong this page must not be: it
     * reads as a fact about the cluster and there is nothing on screen to contradict it.
     */
    const asBound = (formatted: string | null | undefined): string | null | undefined =>
        isPartial && typeof formatted === 'string' ? l10n.t('≥ {value}', { value: formatted }) : formatted;

    /** Appended to every summed tile's tooltip while the sum is incomplete. */
    const partialCaveat = !isPartial
        ? ''
        : omittedCount > 0 && unreportedCount > 0
          ? l10n.t(
                ' Showing a lower bound: {omitted} more database(s) were not inspected and {unreported} did not report a size.',
                { omitted: String(omittedCount), unreported: String(unreportedCount) },
            )
          : omittedCount > 0
            ? l10n.t(' Showing a lower bound: {omitted} more database(s) were not inspected.', {
                  omitted: String(omittedCount),
              })
            : l10n.t(' Showing a lower bound: {unreported} database(s) did not report a size.', {
                  unreported: String(unreportedCount),
              });

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
                  collections: totalCollections === null ? UNAVAILABLE : String(totalCollections),
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
                    size: formatBytes(totalIndexBytes, UNAVAILABLE),
                });

    const selectedDatabase =
        currentDatabase === null || storageStats === null
            ? undefined
            : storageStats.databases.find((database) => database.name === currentDatabase);

    const databaseStorageUsed =
        storageStats === null
            ? undefined
            : selectedDatabase?.sizeOnDiskBytes === undefined
              ? null
              : formatBytes(selectedDatabase.sizeOnDiskBytes);
    const databaseDocumentCount = storageStats === null ? undefined : (selectedDatabase?.objects ?? null);
    const databaseCollectionCount = storageStats === null ? undefined : (selectedDatabase?.collections ?? null);
    const databaseIndexSummary =
        storageStats === null
            ? undefined
            : selectedDatabase?.indexes === undefined
              ? null
              : selectedDatabase.indexes === null
                ? null
                : l10n.t('{count} / {size}', {
                      count: String(selectedDatabase.indexes),
                      size: formatBytes(selectedDatabase.indexSizeBytes, UNAVAILABLE),
                  });

    return (
        <div className="statusStrip">
            <Fade key={currentDatabase ?? 'cluster'} appear visible>
                <MetricsRow>
                    <div className="statusTile">
                        <GenericMetric
                            label={l10n.t('Storage Used')}
                            value={currentDatabase === null ? asBound(storageUsed) : databaseStorageUsed}
                            tooltipExplanation={
                                currentDatabase === null
                                    ? l10n.t(
                                          'Size on disk across the user databases this dashboard inspected. This is the data footprint, not the provisioned disk. N/A means this server did not report it.',
                                      ) + partialCaveat
                                    : l10n.t(
                                          'Size on disk reported for database "{database}". This is the data footprint, not the provisioned disk. N/A means this server did not report it.',
                                          { database: currentDatabase },
                                      )
                            }
                        />
                    </div>

                    <div className="statusTile">
                        <CountMetric
                            label={l10n.t('Documents')}
                            value={currentDatabase === null ? totalDocuments : databaseDocumentCount}
                            compact
                            compactThreshold={1000}
                            tooltipExplanation={
                                currentDatabase === null
                                    ? l10n.t(
                                          'Approximate number of documents across the user databases this dashboard inspected. The servers report it from collection metadata rather than by counting, so it can drift. N/A means this server did not report it.',
                                      ) + partialCaveat
                                    : l10n.t(
                                          'Approximate number of documents in database "{database}". The server reports it from collection metadata rather than by counting, so it can drift. N/A means this server did not report it.',
                                          { database: currentDatabase },
                                      )
                            }
                        />
                    </div>

                    <div className="statusTile">
                        {currentDatabase === null ? (
                            <GenericMetric
                                label={l10n.t('Databases / Collections')}
                                value={databaseSummary}
                                tooltipExplanation={l10n.t(
                                    'Number of user databases and the collections they contain.',
                                )}
                            />
                        ) : (
                            <CountMetric
                                label={l10n.t('Collections')}
                                value={databaseCollectionCount}
                                tooltipExplanation={l10n.t('Number of collections in database "{database}".', {
                                    database: currentDatabase,
                                })}
                            />
                        )}
                    </div>

                    <div className="statusTile">
                        <GenericMetric
                            label={l10n.t('Indexes / Size')}
                            value={currentDatabase === null ? indexSummary : databaseIndexSummary}
                            tooltipExplanation={
                                currentDatabase === null
                                    ? l10n.t(
                                          'Number of indexes across all user databases, and their total size. N/A means this server did not report it.',
                                      )
                                    : l10n.t(
                                          'Number of indexes in database "{database}", and their total size. N/A means this server did not report it.',
                                          { database: currentDatabase },
                                      )
                            }
                        />
                    </div>
                </MetricsRow>
            </Fade>
        </div>
    );
};
