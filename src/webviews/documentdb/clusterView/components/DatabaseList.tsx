/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageBar, MessageBarBody, SearchBox, Spinner, Toolbar, ToolbarButton } from '@fluentui/react-components';
import { AddRegular, ArrowClockwiseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import {
    DASHBOARD_COLUMN_WIDTH,
    DASHBOARD_METRIC_MIN_WIDTH,
    DASHBOARD_NAME_MIN_WIDTH,
    METRICS_CONCURRENCY_LIMIT,
} from '../constants';
import { useBoundedMetrics, type MetricLoader } from '../hooks/useBoundedMetrics';
import { type DatabaseMetrics, type DatabaseRow, type DatabaseSortColumn, type SortDirection } from '../types';
import { formatBytes, formatCount } from '../utils/format';
import { filterAndSortRows } from '../utils/sort';
import { DashboardTable, type DashboardColumn } from './DashboardTable';

export interface DatabaseListProps {
    /** Drill into the named database (switches the parent view to collections). */
    onOpenDatabase: (databaseName: string) => void;
}

/**
 * Cluster overview: one row per database with streamed collection-count,
 * index-count and size metrics. Renders the names immediately from the cheap
 * `listDatabases` call, then fills metrics in per row via {@link useBoundedMetrics}.
 */
export const DatabaseList = ({ onOpenDatabase }: DatabaseListProps): JSX.Element => {
    const { trpcClient } = useTrpcClient();

    const [names, setNames] = useState<ReadonlyArray<string>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | undefined>(undefined);
    const [search, setSearch] = useState('');
    const [sortColumn, setSortColumn] = useState<DatabaseSortColumn>('name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('ascending');
    const [resetToken, setResetToken] = useState(0);
    const [createError, setCreateError] = useState<string | undefined>(undefined);

    /** Load the database name list. Throws surface as an error state. */
    const loadDatabases = useCallback(async (): Promise<void> => {
        setIsLoading(true);
        setLoadError(undefined);
        try {
            const rows = await trpcClient.mongoClusters.clusterView.listDatabases.query();
            setNames(rows.map((r) => r.name));
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
            setNames([]);
        } finally {
            setIsLoading(false);
        }
    }, [trpcClient]);

    useEffect(() => {
        void loadDatabases();
    }, [loadDatabases, resetToken]);

    const metricLoader = useCallback<MetricLoader<DatabaseMetrics>>(
        (databaseName, signal) =>
            trpcClient.mongoClusters.clusterView.getDatabaseMetrics.query({ databaseName }, { signal }),
        [trpcClient],
    );

    const metrics = useBoundedMetrics<DatabaseMetrics>(names, metricLoader, METRICS_CONCURRENCY_LIMIT, resetToken);

    /** Merge the name list with streamed metrics into renderable rows. */
    const rows = useMemo<DatabaseRow[]>(
        () =>
            names.map((name) => {
                const entry = metrics[name];
                if (!entry || entry.status === 'loading') {
                    return { name, status: 'loading' };
                }
                if (entry.status === 'unavailable' || !entry.metrics) {
                    return { name, status: 'unavailable' };
                }
                return {
                    name,
                    status: 'loaded',
                    storageSize: entry.metrics.storageSize,
                    collectionCount: entry.metrics.collectionCount,
                    indexCount: entry.metrics.indexCount,
                };
            }),
        [names, metrics],
    );

    const getSortValue = useCallback(
        (row: DatabaseRow): string | number | undefined => {
            switch (sortColumn) {
                case 'name':
                    return row.name;
                case 'storageSize':
                    return row.storageSize;
                case 'collectionCount':
                    return row.collectionCount;
                case 'indexCount':
                    return row.indexCount;
            }
        },
        [sortColumn],
    );

    const visibleRows = useMemo(
        () => filterAndSortRows(rows, search, (r) => r.name, getSortValue, sortDirection),
        [rows, search, getSortValue, sortDirection],
    );

    const toggleSort = useCallback(
        (columnId: string): void => {
            const column = columnId as DatabaseSortColumn;
            if (column === sortColumn) {
                setSortDirection((prev) => (prev === 'ascending' ? 'descending' : 'ascending'));
            } else {
                setSortColumn(column);
                setSortDirection('ascending');
            }
        },
        [sortColumn],
    );

    const handleCreate = useCallback(async (): Promise<void> => {
        setCreateError(undefined);
        // Reuses the shared "Create database" wizard (native input box +
        // validation + tree refresh) via the router, rather than a webview
        // dialog. A pre-flight failure (e.g. not signed in) is returned to
        // surface inline; wizard-time errors are shown natively by the command
        // infrastructure. Refresh the table only when a database was created.
        const result = await trpcClient.mongoClusters.clusterView.createDatabase.mutate();
        if (result.created) {
            setResetToken((prev) => prev + 1);
        } else if (result.error) {
            setCreateError(result.error);
        }
    }, [trpcClient]);

    const columns = useMemo<DashboardColumn<DatabaseRow>[]>(
        () => [
            {
                columnId: 'name',
                label: l10n.t('Database'),
                align: 'start',
                sortable: true,
                width: DASHBOARD_COLUMN_WIDTH.name,
                minWidth: DASHBOARD_NAME_MIN_WIDTH,
                render: (row) => row.name,
            },
            {
                columnId: 'storageSize',
                label: l10n.t('Storage size'),
                align: 'end',
                sortable: true,
                width: DASHBOARD_COLUMN_WIDTH.metric,
                minWidth: DASHBOARD_METRIC_MIN_WIDTH,
                showSpinnerWhileLoading: true,
                render: (row) => formatBytes(row.storageSize),
            },
            {
                columnId: 'collectionCount',
                label: l10n.t('Collections'),
                align: 'end',
                sortable: true,
                width: DASHBOARD_COLUMN_WIDTH.metric,
                minWidth: DASHBOARD_METRIC_MIN_WIDTH,
                showSpinnerWhileLoading: true,
                render: (row) => formatCount(row.collectionCount),
            },
            {
                columnId: 'indexCount',
                label: l10n.t('Indexes'),
                align: 'end',
                sortable: true,
                width: DASHBOARD_COLUMN_WIDTH.metric,
                minWidth: DASHBOARD_METRIC_MIN_WIDTH,
                showSpinnerWhileLoading: true,
                render: (row) => formatCount(row.indexCount),
            },
        ],
        [],
    );

    return (
        <div className="dashboardPage">
            <div className="dashboardToolbar">
                <Toolbar size="small" className="dashboardToolbarActions">
                    <ToolbarButton appearance="primary" icon={<AddRegular />} onClick={() => void handleCreate()}>
                        {l10n.t('Create database')}
                    </ToolbarButton>
                    <ToolbarButton icon={<ArrowClockwiseRegular />} onClick={() => setResetToken((prev) => prev + 1)}>
                        {l10n.t('Refresh')}
                    </ToolbarButton>
                </Toolbar>
                <SearchBox
                    className="dashboardSearch"
                    placeholder={l10n.t('Filter databases')}
                    value={search}
                    onChange={(_, data) => setSearch(data.value)}
                    aria-label={l10n.t('Filter databases by name')}
                />
            </div>

            {createError ? (
                <MessageBar intent="error">
                    <MessageBarBody>{createError}</MessageBarBody>
                </MessageBar>
            ) : null}

            {loadError ? (
                <MessageBar intent="error">
                    <MessageBarBody>{l10n.t('Failed to load databases: {0}', loadError)}</MessageBarBody>
                </MessageBar>
            ) : isLoading ? (
                <div className="dashboardCentered">
                    <Spinner label={l10n.t('Loading databases…')} />
                </div>
            ) : visibleRows.length === 0 ? (
                <div className="dashboardCentered">
                    <p className="dashboardEmpty">
                        {names.length === 0
                            ? l10n.t('This cluster has no databases yet.')
                            : l10n.t('No databases match your filter.')}
                    </p>
                </div>
            ) : (
                <DashboardTable<DatabaseRow>
                    ariaLabel={l10n.t('Databases')}
                    columns={columns}
                    rows={visibleRows}
                    getRowKey={(row) => row.name}
                    isRowLoading={(row) => row.status === 'loading'}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onToggleSort={toggleSort}
                    onRowActivate={(row) => onOpenDatabase(row.name)}
                />
            )}
        </div>
    );
};
