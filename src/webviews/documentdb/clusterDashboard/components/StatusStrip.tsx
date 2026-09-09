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
    /** `null` while the collectors have not answered yet. */
    storageStats: ClusterStorageStats | null;
    /** The database whose collections are open, or `null` for cluster-wide metrics. */
    currentDatabase: string | null;
    /** The read failed and will not be retried on its own, so the tiles must stop looking busy. */
    isUnavailable?: boolean;
}

/**
 * One tile.
 *
 * `value: undefined` renders the metric row's loading skeleton and `null` its "not reported"
 * placeholder — the three-state contract the collectors produce, kept intact rather than
 * flattened into a string here.
 */
interface Tile {
    label: string;
    value: string | number | null | undefined;
    tooltip: string;
    /** `roundedCount` is for a figure the server estimates rather than counts. */
    render: 'text' | 'count' | 'roundedCount';
}

/**
 * What a composed value shows for the half of it the server did not report.
 *
 * The same text `MetricBase` renders for a wholly unavailable value, so `2 / N/A` and a
 * dimmed `N/A` say the same thing in the same words.
 */
function unavailable(): string {
    return l10n.t('N/A');
}

/** Sums a per-database figure, treating "no database reported it" as null. */
function sumAcrossDatabases(
    stats: ClusterStorageStats,
    read: (database: ClusterStorageStats['databases'][number]) => number | null,
): number | null {
    return stats.databases.reduce<number | null>((total, database) => {
        const value = read(database);
        return value === null ? total : (total ?? 0) + value;
    }, null);
}

/**
 * `count / size` — the same `a / b` shape as the databases tile beside it, so the label can
 * name both figures in order and neither tile has to be read twice.
 */
function describeIndexes(count: number | null, sizeBytes: number | null): string | null {
    return count === null
        ? null
        : l10n.t('{count} / {size}', { count: String(count), size: formatBytes(sizeBytes, unavailable()) });
}

/**
 * The four tiles summarising the whole cluster.
 *
 * Two independent truncations can leave these sums covering less than the cluster:
 * `getStorageStats` inspects at most `DATABASE_STATS_LIMIT` databases, and any database whose
 * `dbStats` failed contributes nothing. A partial sum presented as a total is the one kind of
 * wrong this page must not be — it reads as a fact about the cluster and there is nothing on
 * screen to contradict it — so an incomplete sum is marked as a lower bound and says why.
 */
function clusterTiles(stats: ClusterStorageStats | null): Tile[] {
    const omittedCount = stats?.omittedDatabaseCount ?? 0;
    const unreportedCount =
        stats === null ? 0 : stats.databases.filter((database) => database.sizeOnDiskBytes === null).length;
    const isPartial = omittedCount > 0 || unreportedCount > 0;

    /** Appended to every summed tile's tooltip while the sum is incomplete. */
    const caveat = !isPartial
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

    const asBound = (formatted: string | null): string | null =>
        isPartial && formatted !== null ? l10n.t('≥ {value}', { value: formatted }) : formatted;

    /** `undefined` — the loading skeleton — until the collectors have answered. */
    const read = <T,>(compute: (loaded: ClusterStorageStats) => T): T | undefined =>
        stats === null ? undefined : compute(stats);

    return [
        {
            label: l10n.t('Storage Used'),
            value: read((loaded) =>
                asBound(loaded.totalSizeBytes === null ? null : formatBytes(loaded.totalSizeBytes)),
            ),
            render: 'text',
            tooltip:
                l10n.t('Combined on-disk size of all user databases. Excludes provisioned disk capacity.') + caveat,
        },
        {
            label: l10n.t('Documents'),
            value: read((loaded) => sumAcrossDatabases(loaded, (database) => database.objects)),
            render: 'roundedCount',
            tooltip:
                l10n.t('Approximate number of documents across all user databases, based on collection metadata.') +
                caveat,
        },
        {
            label: l10n.t('Databases / Collections'),
            value: read((loaded) => {
                const totalCollections = sumAcrossDatabases(loaded, (database) => database.collections);

                return l10n.t('{databases} / {collections}', {
                    databases: String(loaded.databases.length),
                    collections:
                        totalCollections === null && loaded.databases.length > 0
                            ? unavailable()
                            : String(totalCollections ?? 0),
                });
            }),
            render: 'text',
            tooltip: l10n.t('Number of user databases and their combined collections.'),
        },
        {
            label: l10n.t('Indexes / Size'),
            value: read((loaded) =>
                describeIndexes(
                    sumAcrossDatabases(loaded, (database) => database.indexes),
                    sumAcrossDatabases(loaded, (database) => database.indexSizeBytes),
                ),
            ),
            render: 'text',
            tooltip: l10n.t('Number of indexes across all user databases and their combined on-disk size.'),
        },
    ];
}

/** The same four facts for the one database the inventory has stepped into. */
function databaseTiles(stats: ClusterStorageStats | null, databaseName: string): Tile[] {
    // Undefined while the collectors are still working, null once they answered and this
    // database was not among the databases they inspected.
    const database =
        stats === null ? undefined : (stats.databases.find((entry) => entry.name === databaseName) ?? null);
    const read = <T,>(compute: (entry: ClusterStorageStats['databases'][number]) => T): T | null | undefined =>
        database === undefined ? undefined : database === null ? null : compute(database);

    return [
        {
            label: l10n.t('Storage Used'),
            value: read((entry) => formatBytes(entry.sizeOnDiskBytes)),
            render: 'text',
            tooltip: l10n.t('On-disk size of the data in database "{database}". Excludes provisioned disk capacity.', {
                database: databaseName,
            }),
        },
        {
            label: l10n.t('Documents'),
            value: read((entry) => entry.objects),
            render: 'roundedCount',
            tooltip: l10n.t('Approximate number of documents in database "{database}", based on collection metadata.', {
                database: databaseName,
            }),
        },
        {
            label: l10n.t('Collections'),
            value: read((entry) => entry.collections),
            render: 'count',
            tooltip: l10n.t('Number of collections in database "{database}".', { database: databaseName }),
        },
        {
            label: l10n.t('Indexes / Size'),
            value: read((entry) => describeIndexes(entry.indexes, entry.indexSizeBytes)),
            render: 'text',
            tooltip: l10n.t('Number of indexes in database "{database}" and their combined on-disk size.', {
                database: databaseName,
            }),
        },
    ];
}

/**
 * The dashboard's headline numbers: what the cluster — or the database being read —
 * *contains*.
 *
 * Deliberately static. The strip summarizes the data inventory, which changes on the
 * timescale of deployments, not seconds; per the dashboard's motion rule, nothing above the
 * fold animates. Liveness (connection state, latency) lives in the header badge instead.
 */
export const StatusStrip = ({
    storageStats,
    currentDatabase,
    isUnavailable = false,
}: StatusStripProps): JSX.Element => {
    const computedTiles =
        currentDatabase === null ? clusterTiles(storageStats) : databaseTiles(storageStats, currentDatabase);

    // A failed read is a terminal state, not slow work: collapse the loading skeleton onto
    // the "not reported" placeholder so the strip stops implying work is still in flight.
    const tiles = isUnavailable ? computedTiles.map((tile) => ({ ...tile, value: tile.value ?? null })) : computedTiles;

    return (
        <div className="statusStrip">
            <Fade key={currentDatabase ?? 'cluster'} appear visible>
                <MetricsRow>
                    {tiles.map((tile) => (
                        <div className="statusTile" key={tile.label}>
                            {tile.render === 'text' ? (
                                <GenericMetric
                                    label={tile.label}
                                    value={tile.value as string | null | undefined}
                                    tooltipExplanation={tile.tooltip}
                                />
                            ) : (
                                <CountMetric
                                    label={tile.label}
                                    value={tile.value as number | null | undefined}
                                    compact={tile.render === 'roundedCount'}
                                    compactThreshold={1000}
                                    tooltipExplanation={tile.tooltip}
                                />
                            )}
                        </div>
                    ))}
                </MetricsRow>
            </Fade>
        </div>
    );
};
