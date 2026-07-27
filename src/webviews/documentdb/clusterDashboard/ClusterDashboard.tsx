/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Tab, TabList } from '@fluentui/react-components';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { type ClusterHealthSample, type ClusterStorageStats } from '../../../documentdb/utils/getClusterHealth';
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
    const [selectedTab, setSelectedTab] = useState<DashboardTab>('overview');

    /**
     * Guards every asynchronous state write. The polling closures outlive a single render,
     * so without this flag a late response could write state after the panel was torn down.
     */
    const disposedRef = useRef(false);

    const loadStorageStats = useCallback(async (): Promise<void> => {
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
            trpcClient.clusterDashboard.getHealthSample
                .query()
                .then((sample) => {
                    if (disposedRef.current) {
                        return;
                    }
                    setSamples((previous) => [...previous.slice(-(MAX_SAMPLES - 1)), sample]);
                    setConsecutiveFailures((failures) => (sample.pingLatencyMs === null ? failures + 1 : 0));
                })
                .catch(() => {
                    if (!disposedRef.current) {
                        setConsecutiveFailures((failures) => failures + 1);
                    }
                });
        };

        tick();
        const intervalId = setInterval(tick, configuration.refreshIntervalMs);

        return () => clearInterval(intervalId);
    }, [configuration.refreshIntervalMs, trpcClient]);

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
                {selectedTab === 'overview' && <OverviewTab samples={samples} />}
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
