/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProgressBar, Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseRegular, EyeRegular, WindowConsoleRegular } from '@fluentui/react-icons';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useRef, useState, type JSX } from 'react';

import { type ClusterHealthSample, type ClusterStorageStats } from '../../../documentdb/utils/getClusterHealth';
import { useTrpcClient } from '../../_integration/useTrpcClient';
import './clusterDashboard.scss';
import { type ClusterDashboardWebviewConfigurationType } from './clusterDashboardController';
import { type ClusterDashboardInfo } from './clusterDashboardRouter';
import { DashboardFeedback } from './components/DashboardFeedback';
import { DashboardHeader, type ConnectionState } from './components/DashboardHeader';
import { createInventoryViewState, InventoryPanel, type InventoryViewState } from './components/InventoryPanel';
import { StatusStrip } from './components/StatusStrip';
import { useDatabaseCollections } from './components/useDatabaseCollections';

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
    // Only the newest sample is kept: the header states the current connection state and
    // latency, and the diagnostics document takes its own sample on the host.
    const [latestSample, setLatestSample] = useState<ClusterHealthSample | null>(null);
    const [consecutiveFailures, setConsecutiveFailures] = useState(0);
    const [storageStats, setStorageStats] = useState<ClusterStorageStats | null>(null);
    const [storageLastUpdatedAt, setStorageLastUpdatedAt] = useState<number>();
    const [isRefreshingStorage, setIsRefreshingStorage] = useState(false);
    const [isCreatingNamespace, setIsCreatingNamespace] = useState(false);
    /**
     * How the reader has arranged the inventory — order, filter, level.
     *
     * Held here rather than inside the list so the main toolbar's Refresh can reach it.
     */
    const [inventoryViewState, setInventoryViewState] = useState<InventoryViewState>(() =>
        createInventoryViewState(configuration.selectedDatabaseName),
    );

    /**
     * The drilled-into database's collections.
     *
     * Held here rather than inside the inventory panel because Refresh acts on whichever list
     * is on screen and lives in the panel's main toolbar, which cannot reach state owned by a
     * component it sits above.
     */
    const collections = useDatabaseCollections(inventoryViewState.currentDatabase);

    /**
     * Guards every asynchronous state write. The polling closures outlive a single render,
     * so without this flag a late response could write state after the panel was torn down.
     */
    const disposedRef = useRef(false);
    /**
     * Prevents overlapping health polls. Non-emulator connections use the driver's 30 s
     * `serverSelectionTimeoutMS`, so an unreachable cluster answers far slower than the
     * 5 s interval; without this guard the interval stacks samples faster than they drain,
     * each re-entering `getClient`.
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
                setStorageLastUpdatedAt(Date.now());
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

    /**
     * Whether the panel is on screen.
     *
     * The webview is created with `retainContextWhenHidden`, so React keeps running when the
     * dashboard is not the active tab — a dashboard opened once and forgotten would otherwise
     * poll a production cluster every five seconds for the rest of the session with nobody
     * looking at it. Polling resumes with an immediate tick rather than waiting out the
     * interval, so a revealed panel is never showing stale numbers.
     */
    const isVisibleRef = useRef(typeof document === 'undefined' || document.visibilityState !== 'hidden');
    const [visibilityGeneration, setVisibilityGeneration] = useState(0);

    useEffect(() => {
        const onVisibilityChange = (): void => {
            const nowVisible = document.visibilityState !== 'hidden';
            const wasVisible = isVisibleRef.current;
            isVisibleRef.current = nowVisible;

            // Only a hidden-to-visible transition needs a refresh; re-running the effects on
            // the way out would start the very work being suspended.
            if (nowVisible && !wasVisible) {
                setVisibilityGeneration((generation) => generation + 1);
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    // Health polling loop. Failures are absorbed so a transient error does not flip the
    // header to Disconnected on the first missed sample.
    useEffect(() => {
        const tick = (): void => {
            if (sampleInFlightRef.current || !isVisibleRef.current) {
                return;
            }
            sampleInFlightRef.current = true;

            trpcClient.clusterDashboard.getHealthSample
                .query()
                .then((sample) => {
                    if (disposedRef.current) {
                        return;
                    }
                    setLatestSample(sample);
                    setConsecutiveFailures((failures) => (sample.pingLatencyMs === null ? failures + 1 : 0));
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
    }, [configuration.refreshIntervalMs, trpcClient, visibilityGeneration]);

    const [isExporting, setIsExporting] = useState(false);

    const exportDiagnostics = useCallback(async (): Promise<void> => {
        setIsExporting(true);
        try {
            // Everything is re-read on the host, so the export reflects the cluster now
            // rather than whatever the webview last rendered.
            await trpcClient.clusterDashboard.exportDiagnostics.mutate();
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
    }, [trpcClient]);

    const openShell = useCallback(async (): Promise<void> => {
        try {
            await trpcClient.clusterDashboard.openShell.mutate();
        } catch (error) {
            void trpcClient.common.displayErrorMessage.mutate({
                message: l10n.t('Failed to open the interactive shell.'),
                modal: false,
                cause: error instanceof Error ? error.message : String(error),
            });
        }
    }, [trpcClient]);

    /** Re-reads whichever inventory is on screen: the cluster's storage, plus the drilled-into database. */
    const reloadCollections = collections.reload;
    const refreshData = useCallback((): void => {
        void loadStorageStats();
        if (inventoryViewState.currentDatabase !== null) {
            reloadCollections();
        }
    }, [loadStorageStats, reloadCollections, inventoryViewState.currentDatabase]);

    const createNamespace = useCallback(async (): Promise<void> => {
        const databaseName = inventoryViewState.currentDatabase;
        setIsCreatingNamespace(true);

        try {
            if (databaseName === null) {
                await trpcClient.clusterDashboard.createDatabase.mutate();
            } else {
                await trpcClient.clusterDashboard.createCollection.mutate({ databaseName });
            }

            await loadStorageStats();
            if (databaseName !== null) {
                reloadCollections();
            }
        } catch (error) {
            void trpcClient.common.displayErrorMessage.mutate({
                message:
                    databaseName === null
                        ? l10n.t('Failed to create the database.')
                        : l10n.t('Failed to create the collection.'),
                modal: false,
                cause: error instanceof Error ? error.message : String(error),
            });
        } finally {
            if (!disposedRef.current) {
                setIsCreatingNamespace(false);
            }
        }
    }, [inventoryViewState.currentDatabase, loadStorageStats, reloadCollections, trpcClient]);

    const connectionState: ConnectionState =
        consecutiveFailures >= FAILURE_THRESHOLD
            ? 'disconnected'
            : latestSample !== null && latestSample.pingLatencyMs !== null
              ? 'connected'
              : 'connecting';

    // Every load that replaces content the reader is looking at reports through the one bar
    // pinned to the top edge. The health poll is deliberately excluded: it runs every five
    // seconds and would leave the bar permanently animating.
    const isBusy =
        clusterInfo === null || isRefreshingStorage || collections.isLoading || isExporting || isCreatingNamespace;

    return (
        <div className="clusterDashboard">
            {isBusy && <ProgressBar thickness="large" shape="square" className="progressBar" aria-hidden={true} />}

            {/*
             * The shaded band is the Collection View's header row: it carries the view's
             * identity and nothing else, separated from the work below by a single shade and
             * rule rather than by whitespace.
             */}
            <div className="dashboardHeaderBand">
                <DashboardHeader
                    clusterDisplayName={clusterInfo?.clusterDisplayName ?? configuration.clusterDisplayName}
                    clusterInfo={clusterInfo}
                    latestSample={latestSample}
                    connectionState={connectionState}
                    azure={configuration.azure}
                />
            </div>

            {/*
             * Actions sit below the band, not inside it — the Collection View puts its
             * `.primaryActionBar` in the panel, under the shaded tab strip. It is also the
             * row with space to grow: more tools will land here.
             */}
            <Toolbar
                size="small"
                className="primaryActionBar actionBarToolbar dashboardToolbar"
                aria-label={l10n.t('Cluster actions')}
            >
                {/*
                 * One Refresh for the panel, not one per list: the inventory tiles are on
                 * screen under every tab, so re-reading the cluster's storage is always the
                 * meaningful thing this button does. Drilled into a database, it re-reads
                 * that database's collections too.
                 */}
                <Tooltip
                    content={l10n.t('Re-read this cluster’s storage statistics')}
                    relationship="description"
                    withArrow
                >
                    <ToolbarButton
                        appearance="primary"
                        icon={<ArrowClockwiseRegular />}
                        disabled={isRefreshingStorage || collections.isLoading}
                        onClick={refreshData}
                    >
                        {l10n.t('Refresh')}
                    </ToolbarButton>
                </Tooltip>
                <Tooltip
                    content={l10n.t('Open an interactive shell against this cluster')}
                    relationship="description"
                    withArrow
                >
                    <ToolbarButton icon={<WindowConsoleRegular />} onClick={() => void openShell()}>
                        {l10n.t('Open Shell')}
                    </ToolbarButton>
                </Tooltip>
                <Tooltip
                    content={l10n.t('Open this cluster’s state as a JSON document')}
                    relationship="description"
                    withArrow
                >
                    <ToolbarButton
                        className="toolbarTrailingAction"
                        icon={<EyeRegular />}
                        disabled={isExporting}
                        onClick={() => void exportDiagnostics()}
                    >
                        {l10n.t('View Raw Diagnostics')}
                    </ToolbarButton>
                </Tooltip>
                {/*
                 * The question rides the action bar rather than the foot of the page: it is
                 * the same question on every tab, it is reachable without scrolling to the
                 * end of a long table, and up here it costs no vertical space at all.
                 */}
                {configuration.feedbackSignalsEnabled && <DashboardFeedback />}
            </Toolbar>

            {/*
             * One full-width column, the Indexes tab's shape. There is no separate scroll
             * region: the whole page scrolls, so the identity band and the action bar move
             * off the top like everything else rather than staying pinned above a short
             * viewport of table.
             */}
            <div className="dashboardContent">
                <StatusStrip
                    storageStats={isRefreshingStorage ? null : storageStats}
                    currentDatabase={inventoryViewState.currentDatabase}
                />

                <InventoryPanel
                    storageStats={storageStats}
                    storageLastUpdatedAt={storageLastUpdatedAt}
                    isLoading={isRefreshingStorage || collections.isLoading}
                    collections={collections}
                    viewState={inventoryViewState}
                    onViewStateChange={setInventoryViewState}
                    onCreateNamespace={() => void createNamespace()}
                    isCreatingNamespace={isCreatingNamespace}
                />
            </div>
        </div>
    );
};
