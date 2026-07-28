/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Tab, TabList } from '@fluentui/react-components';
import { ArrowDownloadRegular } from '@fluentui/react-icons';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import {
    getFailedCommandName,
    type ClusterHealthSample,
    type ClusterStorageStats,
} from '../../../documentdb/utils/getClusterHealth';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import './clusterDashboard.scss';
import { type ClusterDashboardWebviewConfigurationType } from './clusterDashboardController';
import { type ClusterDashboardInfo } from './clusterDashboardRouter';
import { HeaderCard, type ConnectionState } from './components/HeaderCard';
import { OperationsTab } from './components/OperationsTab';
import { OverviewTab } from './components/OverviewTab';
import { StatusStrip } from './components/StatusStrip';
import { StorageTab } from './components/StorageTab';

type DashboardTab = 'overview' | 'operations' | 'storage';

/** Number of samples kept in the webview for the sparklines (5 minutes at a 5 s cadence). */
const MAX_SAMPLES = 60;

/** Consecutive failed polls after which the dashboard reports the cluster as disconnected. */
const FAILURE_THRESHOLD = 2;

/** Storage is refreshed every Nth health tick — `dbStats` per database is far heavier. */
const STORAGE_REFRESH_MULTIPLIER = 12;

export const ClusterDashboard = (): JSX.Element => {
    /**
     * Use the configuration object to access the data passed to the webview at its creation.
     * Feel free to update the content of the object. It won't be synced back to the extension though.
     */
    const configuration = useConfiguration<ClusterDashboardWebviewConfigurationType>();

    /**
     * Use the `useTrpcClient` hook to get the tRPC client
     */
    const trpcClient = useTrpcClient();

    const [clusterInfo, setClusterInfo] = useState<ClusterDashboardInfo | null>(null);
    const [samples, setSamples] = useState<ClusterHealthSample[]>([]);
    const [consecutiveFailures, setConsecutiveFailures] = useState(0);
    const [storageStats, setStorageStats] = useState<ClusterStorageStats | null>(null);
    const [isRefreshingStorage, setIsRefreshingStorage] = useState(false);
    const [opcountersUnsupported, setOpcountersUnsupported] = useState(false);
    const [selectedTab, setSelectedTab] = useState<DashboardTab>('overview');

    /**
     * Guards every asynchronous state write. The polling closures outlive a single render,
     * so without this flag a late response could write state after the panel was torn down.
     */
    const disposedRef = useRef(false);
    /**
     * Prevents overlapping health polls. Non-emulator connections use the driver's 30 s
     * `serverSelectionTimeoutMS`, so an unreachable cluster answers far slower than the
     * 5 s interval; without this guard the interval stacks samples faster than they drain,
     * each re-entering `getClient`, and the backlog also makes `timestampMs` non-monotonic.
     */
    const sampleInFlightRef = useRef(false);
    const storageInFlightRef = useRef(false);

    const loadStorageStats = useCallback(async (): Promise<void> => {
        if (storageInFlightRef.current) {
            return;
        }
        storageInFlightRef.current = true;
        setIsRefreshingStorage(true);

        try {
            const stats = await trpcClient.clusterDashboard.getStorageStats.query();
            if (!disposedRef.current) {
                setStorageStats(stats);
            }
        } catch (error) {
            if (!disposedRef.current) {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: l10n.t('Failed to read storage statistics.'),
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            }
        } finally {
            storageInFlightRef.current = false;
            if (!disposedRef.current) {
                setIsRefreshingStorage(false);
            }
        }
    }, [trpcClient]);

    // One-time header + storage load.
    useEffect(() => {
        disposedRef.current = false;

        void trpcClient.clusterDashboard.getClusterInfo
            .query()
            .then((info) => {
                if (!disposedRef.current) {
                    setClusterInfo(info);
                }
            })
            .catch((error: unknown) => {
                if (!disposedRef.current) {
                    void trpcClient.common.displayErrorMessage.mutate({
                        message: l10n.t('Failed to read cluster information.'),
                        modal: false,
                        cause: error instanceof Error ? error.message : String(error),
                    });
                }
            });

        void loadStorageStats();

        return () => {
            disposedRef.current = true;
        };
    }, [loadStorageStats, trpcClient]);

    // Health polling loop. Failures are absorbed so a transient error does not clear the charts.
    useEffect(() => {
        const tick = (): void => {
            if (sampleInFlightRef.current) {
                return;
            }
            sampleInFlightRef.current = true;

            trpcClient.clusterDashboard.getHealthSample
                .query()
                .then((sample) => {
                    if (disposedRef.current) {
                        return;
                    }
                    setSamples((previous) => [...previous.slice(-(MAX_SAMPLES - 1)), sample]);
                    setConsecutiveFailures((failures) => (sample.pingLatencyMs === null ? failures + 1 : 0));
                    if (sample.errors.some((entry) => getFailedCommandName(entry) === 'serverStatus')) {
                        setOpcountersUnsupported(true);
                    }
                })
                .catch(() => {
                    if (!disposedRef.current) {
                        setConsecutiveFailures((failures) => failures + 1);
                    }
                })
                .finally(() => {
                    sampleInFlightRef.current = false;
                });
        };

        tick();
        const intervalId = setInterval(tick, configuration.refreshIntervalMs);

        return () => clearInterval(intervalId);
    }, [configuration.refreshIntervalMs, trpcClient]);

    // Storage refreshes on a much slower cadence than the health sample: `dbStats` per
    // database is far heavier than a ping, but leaving it to a single load would freeze
    // two tiles that sit in the live strip looking identical to the 5 s ones.
    useEffect(() => {
        const intervalId = setInterval(
            () => void loadStorageStats(),
            configuration.refreshIntervalMs * STORAGE_REFRESH_MULTIPLIER,
        );

        return () => clearInterval(intervalId);
    }, [configuration.refreshIntervalMs, loadStorageStats]);

    const [isExporting, setIsExporting] = useState(false);

    const exportDiagnostics = useCallback(async (): Promise<void> => {
        setIsExporting(true);
        try {
            // The samples only exist here — everything else is re-read on the host, so the
            // export reflects the cluster now rather than whatever the webview last rendered.
            await trpcClient.clusterDashboard.exportDiagnostics.mutate({ samples });
        } catch (error) {
            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Failed to export diagnostics.'),
                modal: false,
                cause: error instanceof Error ? error.message : String(error),
            });
        } finally {
            if (!disposedRef.current) {
                setIsExporting(false);
            }
        }
    }, [samples, trpcClient]);

    const latestSample = samples.length > 0 ? samples[samples.length - 1] : null;

    const connectionState: ConnectionState =
        consecutiveFailures >= FAILURE_THRESHOLD
            ? 'disconnected'
            : latestSample !== null && latestSample.pingLatencyMs !== null
              ? 'connected'
              : 'connecting';

    return (
        <div className="clusterDashboard">
            <HeaderCard
                clusterDisplayName={clusterInfo?.clusterDisplayName ?? configuration.clusterDisplayName}
                clusterInfo={clusterInfo}
                latestSample={latestSample}
                connectionState={connectionState}
            />

            <StatusStrip
                samples={samples}
                storageStats={storageStats}
                isStale={consecutiveFailures >= FAILURE_THRESHOLD}
            />

            <div className="dashboardToolbar">
                <Button
                    appearance="subtle"
                    icon={<ArrowDownloadRegular />}
                    disabled={isExporting}
                    onClick={() => void exportDiagnostics()}
                    aria-label={l10n.t('Export a diagnostics snapshot of this cluster')}
                >
                    {l10n.t('Export diagnostics')}
                </Button>
            </div>

            <TabList
                selectedValue={selectedTab}
                onTabSelect={(_event, data) => setSelectedTab(data.value as DashboardTab)}
                aria-label={l10n.t('Cluster dashboard sections')}
            >
                <Tab value="overview">{l10n.t('Overview')}</Tab>
                <Tab value="operations">{l10n.t('Operations')}</Tab>
                <Tab value="storage">{l10n.t('Storage')}</Tab>
            </TabList>

            <div className="dashboardContent">
                {selectedTab === 'overview' && (
                    <OverviewTab samples={samples} opcountersUnsupported={opcountersUnsupported} />
                )}
                {selectedTab === 'operations' && <OperationsTab refreshIntervalMs={configuration.refreshIntervalMs} />}
                {selectedTab === 'storage' && (
                    <StorageTab
                        storageStats={storageStats}
                        isRefreshing={isRefreshingStorage}
                        onRefresh={() => void loadStorageStats()}
                    />
                )}
            </div>
        </div>
    );
};
