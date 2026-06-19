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
import { type CollectionMetrics, type CollectionRow, type CollectionSortColumn, type SortDirection } from '../types';
import { formatBytes, formatCount } from '../utils/format';
import { filterAndSortRows } from '../utils/sort';
import { DashboardTable, type DashboardColumn } from './DashboardTable';

export interface CollectionListProps {
    /** The database whose collections are listed. */
    databaseName: string;
}

/**
 * Database drill-in: one row per collection with streamed index-count and size
 * metrics. Mirrors {@link DatabaseList}: cheap `listCollections` renders rows
 * immediately, metrics stream in per row with bounded concurrency.
 */
export const CollectionList = ({ databaseName }: CollectionListProps): JSX.Element => {
    const { trpcClient } = useTrpcClient();

    const [names, setNames] = useState<ReadonlyArray<string>>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | undefined>(undefined);
    const [search, setSearch] = useState('');
    const [sortColumn, setSortColumn] = useState<CollectionSortColumn>('name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('ascending');
    const [resetToken, setResetToken] = useState(0);
    const [createError, setCreateError] = useState<string | undefined>(undefined);

    const loadCollections = useCallback(async (): Promise<void> => {
        setIsLoading(true);
        setLoadError(undefined);
        try {
            const rows = await trpcClient.mongoClusters.clusterView.listCollections.query({ databaseName });
            setNames(rows.map((r) => r.name));
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
            setNames([]);
        } finally {
            setIsLoading(false);
        }
    }, [trpcClient, databaseName]);

    useEffect(() => {
        void loadCollections();
    }, [loadCollections, resetToken]);

    const metricLoader = useCallback<MetricLoader<CollectionMetrics>>(
        (collectionName, signal) =>
            trpcClient.mongoClusters.clusterView.getCollectionMetrics.query(
                { databaseName, collectionName },
                { signal },
            ),
        [trpcClient, databaseName],
    );

    const metrics = useBoundedMetrics<CollectionMetrics>(names, metricLoader, METRICS_CONCURRENCY_LIMIT, resetToken);

    const rows = useMemo<CollectionRow[]>(
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
                    documentCount: entry.metrics.documentCount,
                    avgDocumentSize: entry.metrics.avgDocumentSize,
                    indexCount: entry.metrics.indexCount,
                    totalIndexSize: entry.metrics.totalIndexSize,
                };
            }),
        [names, metrics],
    );

    const getSortValue = useCallback(
        (row: CollectionRow): string | number | undefined => {
            switch (sortColumn) {
                case 'name':
                    return row.name;
                case 'storageSize':
                    return row.storageSize;
                case 'documentCount':
                    return row.documentCount;
                case 'avgDocumentSize':
                    return row.avgDocumentSize;
                case 'indexCount':
                    return row.indexCount;
                case 'totalIndexSize':
                    return row.totalIndexSize;
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
            const column = columnId as CollectionSortColumn;
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
        // Reuses the shared "Create collection" wizard (native input box +
        // validation + tree refresh) via the router, rather than a webview
        // dialog. A pre-flight failure (e.g. not signed in) is returned to
        // surface inline; wizard-time errors are shown natively by the command
        // infrastructure. Refresh the table only when a collection was created.
        const result = await trpcClient.mongoClusters.clusterView.createCollection.mutate({ databaseName });
        if (result.created) {
            setResetToken((prev) => prev + 1);
        } else if (result.error) {
            setCreateError(result.error);
        }
    }, [trpcClient, databaseName]);

    const columns = useMemo<DashboardColumn<CollectionRow>[]>(
        () => [
            {
                columnId: 'name',
                label: l10n.t('Collection'),
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
                columnId: 'documentCount',
                label: l10n.t('Documents'),
                align: 'end',
                sortable: true,
                width: DASHBOARD_COLUMN_WIDTH.metric,
                minWidth: DASHBOARD_METRIC_MIN_WIDTH,
                showSpinnerWhileLoading: true,
                render: (row) => formatCount(row.documentCount),
            },
            {
                columnId: 'avgDocumentSize',
                label: l10n.t('Avg. document size'),
                align: 'end',
                sortable: true,
                width: DASHBOARD_COLUMN_WIDTH.metric,
                minWidth: DASHBOARD_METRIC_MIN_WIDTH,
                showSpinnerWhileLoading: true,
                render: (row) => formatBytes(row.avgDocumentSize),
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
            {
                columnId: 'totalIndexSize',
                label: l10n.t('Total index size'),
                align: 'end',
                sortable: true,
                width: DASHBOARD_COLUMN_WIDTH.metric,
                minWidth: DASHBOARD_METRIC_MIN_WIDTH,
                showSpinnerWhileLoading: true,
                render: (row) => formatBytes(row.totalIndexSize),
            },
        ],
        [],
    );

    return (
        <div className="dashboardPage">
            <div className="dashboardToolbar">
                <Toolbar size="small" className="dashboardToolbarActions">
                    <ToolbarButton appearance="primary" icon={<AddRegular />} onClick={() => void handleCreate()}>
                        {l10n.t('Create collection')}
                    </ToolbarButton>
                    <ToolbarButton icon={<ArrowClockwiseRegular />} onClick={() => setResetToken((prev) => prev + 1)}>
                        {l10n.t('Refresh')}
                    </ToolbarButton>
                </Toolbar>
                <SearchBox
                    className="dashboardSearch"
                    placeholder={l10n.t('Filter collections')}
                    value={search}
                    onChange={(_, data) => setSearch(data.value)}
                    aria-label={l10n.t('Filter collections by name')}
                />
            </div>

            {createError ? (
                <MessageBar intent="error">
                    <MessageBarBody>{createError}</MessageBarBody>
                </MessageBar>
            ) : null}

            {loadError ? (
                <MessageBar intent="error">
                    <MessageBarBody>{l10n.t('Failed to load collections: {0}', loadError)}</MessageBarBody>
                </MessageBar>
            ) : isLoading ? (
                <div className="dashboardCentered">
                    <Spinner label={l10n.t('Loading collections…')} />
                </div>
            ) : visibleRows.length === 0 ? (
                <div className="dashboardCentered">
                    <p className="dashboardEmpty">
                        {names.length === 0
                            ? l10n.t('This database has no collections yet.')
                            : l10n.t('No collections match your filter.')}
                    </p>
                </div>
            ) : (
                <DashboardTable<CollectionRow>
                    ariaLabel={l10n.t('Collections')}
                    columns={columns}
                    rows={visibleRows}
                    getRowKey={(row) => row.name}
                    isRowLoading={(row) => row.status === 'loading'}
                    sortColumn={sortColumn}
                    sortDirection={sortDirection}
                    onToggleSort={toggleSort}
                />
            )}
        </div>
    );
};
