/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type JSX, type ReactNode } from 'react';

import { type ClusterHealthSample, type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
// TODO(dashboard): promote metricsRow to src/webviews/components/ so views don't reach into each other.
import {
    CountMetric,
    GenericMetric,
    MetricsRow,
    TimeMetric,
} from '../../collectionView/components/queryInsightsTab/components/metricsRow';
import { formatBytes } from '../formatUtils';
import { Sparkline } from './Sparkline';

export interface StatusStripProps {
    samples: ClusterHealthSample[];
    storageStats: ClusterStorageStats | null;
    /** True once the poller has missed two samples in a row; the tiles then show stale data. */
    isStale: boolean;
}

const NOT_AVAILABLE = (): string => l10n.t('Not available on this server');

function Tile({ children, series }: { children: ReactNode; series?: Array<number | null> }): JSX.Element {
    return (
        <div className="statusTile">
            {children}
            {series && (
                <div className="statusTileSparkline">
                    <Sparkline data={series} />
                </div>
            )}
        </div>
    );
}

export const StatusStrip = ({ samples, storageStats, isStale }: StatusStripProps): JSX.Element => {
    const latestSample = samples.length > 0 ? samples[samples.length - 1] : null;

    // `undefined` renders a loading skeleton, `null` renders the "not available" placeholder.
    const latencyMs = latestSample ? latestSample.pingLatencyMs : undefined;
    const activeOperations = latestSample ? latestSample.activeOperations : undefined;

    const totalCollections =
        storageStats === null
            ? undefined
            : storageStats.databases.reduce<number | null>((total, database) => {
                  if (database.collections === null) {
                      return total;
                  }
                  return (total ?? 0) + database.collections;
              }, null);

    const databaseSummary =
        storageStats === null
            ? undefined
            : l10n.t('{databases} / {collections}', {
                  databases: String(storageStats.databases.length),
                  collections: totalCollections === null ? '—' : String(totalCollections),
              });

    return (
        <div className={isStale ? 'statusStrip statusStripStale' : 'statusStrip'}>
            <MetricsRow>
                <Tile series={samples.map((sample) => sample.pingLatencyMs)}>
                    <TimeMetric
                        label={l10n.t('Latency')}
                        valueMs={latencyMs}
                        nullValuePlaceholder={l10n.t('Unreachable')}
                        tooltipExplanation={l10n.t('Round-trip time of the last ping to the cluster.')}
                    />
                </Tile>

                <Tile series={samples.map((sample) => sample.activeOperations)}>
                    <CountMetric
                        label={l10n.t('Active Operations')}
                        value={activeOperations}
                        nullValuePlaceholder={NOT_AVAILABLE()}
                        tooltipExplanation={l10n.t('Operations currently reported as running by the cluster.')}
                    />
                </Tile>

                <Tile>
                    <GenericMetric
                        label={l10n.t('Storage Used')}
                        value={
                            storageStats === null
                                ? undefined
                                : formatBytes(storageStats.totalSizeBytes, NOT_AVAILABLE())
                        }
                        tooltipExplanation={l10n.t('Total size on disk reported for all user databases.')}
                    />
                </Tile>

                <Tile>
                    <GenericMetric
                        label={l10n.t('Databases / Collections')}
                        value={databaseSummary}
                        tooltipExplanation={l10n.t('Number of user databases and the collections they contain.')}
                    />
                </Tile>
            </MetricsRow>
        </div>
    );
};
