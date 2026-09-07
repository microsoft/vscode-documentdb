/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Breadcrumb,
    BreadcrumbButton,
    BreadcrumbDivider,
    BreadcrumbItem,
    Button,
    MessageBar,
    MessageBarBody,
    SearchBox,
    Toolbar,
} from '@fluentui/react-components';
import { ArrowLeftRegular, DatabaseMultipleRegular, DatabaseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import { isClusterDashboardContextMenuMessage } from '../clusterDashboardContextMenu';
import { type NamespaceCommandId } from '../clusterDashboardRouter';
import {
    arrangeRows,
    defaultDirectionFor,
    NamespaceTable,
    toCollectionRow,
    toDatabaseRow,
    type NamespaceRow,
    type SortColumn,
    type SortState,
} from './NamespaceTable';
import { NamespaceTableSkeleton } from './NamespaceTableSkeleton';
import { type DatabaseCollectionsState } from './useDatabaseCollections';

/**
 * How the reader has arranged the list, and which level they are on.
 *
 * Owned by the dashboard rather than this component because switching to Operations and back
 * unmounts the tab — which discarded the sort, the filter text, and the level. The Collection
 * View's index list hoists the same state to its parent for the same reason (there, a manual
 * refresh swaps the table for a skeleton).
 */
export interface StorageTabViewState {
    sort: SortState;
    filterText: string;
    /** The database being read, or `null` at the cluster's database list. */
    currentDatabase: string | null;
}

export interface StorageTabProps {
    storageStats: ClusterStorageStats | null;
    /** Time when the cluster's database inventory was last read successfully. */
    storageLastUpdatedAt?: number;
    /** True while the active inventory level is being re-read. */
    isLoading: boolean;
    /**
     * The drilled-into database's collections, owned by the dashboard.
     *
     * Lifted out of this component along with the Refresh button: the button now lives in
     * the panel's main toolbar, and it cannot reload a list whose state is held here.
     */
    collections: DatabaseCollectionsState;
    viewState: StorageTabViewState;
    /**
     * Takes an updater rather than a value, so every change rebases on the current state
     * instead of the snapshot this render closed over. With a plain value, two changes
     * landing in one React batch would have the second silently discard the first.
     */
    onViewStateChange: (update: (current: StorageTabViewState) => StorageTabViewState) => void;
}

/**
 * Default order: largest first.
 *
 * The landing view has to answer "what is big here?" with no input from the user — the
 * question that brought them to a storage table in the first place. Alphabetical would make
 * them read every row to find it.
 */
const DEFAULT_SORT: SortState = { column: 'name', direction: 'ascending' };

/** The arrangement a freshly-opened dashboard starts from. */
export function createStorageViewState(selectedDatabaseName?: string): StorageTabViewState {
    return { sort: DEFAULT_SORT, filterText: '', currentDatabase: selectedDatabaseName ?? null };
}

/**
 * The cluster's inventory: databases, and the collections of the one being read.
 *
 * One level is on screen at a time and both are drawn by the same table, so moving between
 * them changes the contents and nothing else. The alternative — nesting the collections
 * inside an expanded database row — made the two levels two different-looking lists, let
 * several of them interleave down the page, and left the collections no room for the columns
 * the databases already had.
 */
export const StorageTab = ({
    storageStats,
    storageLastUpdatedAt,
    isLoading,
    collections,
    viewState,
    onViewStateChange,
}: StorageTabProps): JSX.Element => {
    const { sort, filterText, currentDatabase } = viewState;
    const trpcClient = useTrpcClient();

    const setFilterText = (next: string): void => onViewStateChange((current) => ({ ...current, filterText: next }));

    const goBack = (): void => onViewStateChange((current) => ({ ...current, currentDatabase: null, filterText: '' }));

    const databaseRows = useMemo(
        () => (storageStats === null ? [] : storageStats.databases.map(toDatabaseRow)),
        [storageStats],
    );

    const collectionRows = useMemo(
        () => (collections.result === null ? [] : collections.result.collections.map(toCollectionRow)),
        [collections.result],
    );

    const rows = useMemo(
        () => arrangeRows(currentDatabase === null ? databaseRows : collectionRows, filterText, sort),
        [currentDatabase, databaseRows, collectionRows, filterText, sort],
    );

    /** Everything the level holds, before the filter — the denominator of the footer count. */
    const allRows = currentDatabase === null ? databaseRows : collectionRows;
    const lastUpdatedAt = currentDatabase === null ? storageLastUpdatedAt : collections.lastUpdatedAt;
    const levelKey = currentDatabase ?? 'databases';
    const knownCollectionCount =
        currentDatabase === null
            ? undefined
            : databaseRows.find((database) => database.name === currentDatabase)?.childCount;
    const [lastRowCounts, setLastRowCounts] = useState<Record<string, number>>({});
    const inventoryIsLoading = isLoading || storageStats === null;

    useEffect(() => {
        if (!inventoryIsLoading) {
            setLastRowCounts((current) =>
                current[levelKey] === allRows.length ? current : { ...current, [levelKey]: allRows.length },
            );
        }
    }, [allRows.length, inventoryIsLoading, levelKey]);

    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (lastUpdatedAt === undefined) {
            return;
        }
        const elapsedMs = Math.max(0, Date.now() - lastUpdatedAt);
        const nextUpdateMs =
            elapsedMs < 30_000
                ? 30_000 - elapsedMs
                : elapsedMs < 60_000
                  ? 60_000 - elapsedMs
                  : 60_000 - (elapsedMs % 60_000);
        const timer = setTimeout(() => setNow(Date.now()), Math.max(1, nextUpdateMs));
        return () => clearTimeout(timer);
    }, [lastUpdatedAt, now]);

    const updatedText = useMemo(() => {
        if (lastUpdatedAt === undefined) {
            return undefined;
        }
        const elapsedSeconds = Math.max(0, Math.floor((now - lastUpdatedAt) / 1000));
        if (elapsedSeconds < 30) {
            return l10n.t('Updated a few seconds ago');
        }
        if (elapsedSeconds < 60) {
            return l10n.t('Updated less than a minute ago');
        }
        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
        return elapsedMinutes === 1
            ? l10n.t('Updated 1 minute ago')
            : l10n.t('Updated {0} minutes ago', elapsedMinutes);
    }, [lastUpdatedAt, now]);

    const openCollection = useCallback(
        (databaseName: string, collectionName: string, initialTab?: 'tab_result' | 'tab_indexes'): void => {
            void trpcClient.clusterDashboard.openNamespace
                .mutate({ namespace: `${databaseName}.${collectionName}`, initialTab })
                .catch((error: unknown) => {
                    void trpcClient.common.displayErrorMessage.mutate({
                        message: l10n.t('Failed to open the collection view.'),
                        modal: false,
                        cause: error instanceof Error ? error.message : String(error),
                    });
                });
        },
        [trpcClient],
    );

    /**
     * Runs one of the tree's own commands against a row.
     *
     * Failures are modal: the reader asked for this explicitly, and the most likely one —
     * the branch not being expanded in the tree, so the node cannot be found — is
     * actionable but invisible from here.
     */
    const runCommand = useCallback(
        (databaseName: string, collectionName: string | undefined, commandId: NamespaceCommandId): void => {
            void trpcClient.clusterDashboard.runNamespaceCommand
                .mutate({
                    commandId,
                    databaseName,
                    collectionName,
                })
                .catch((error: unknown) => {
                    void trpcClient.common.displayErrorMessage.mutate({
                        message: l10n.t('The action could not be started.'),
                        modal: true,
                        cause: error instanceof Error ? error.message : String(error),
                    });
                });
        },
        [trpcClient],
    );

    useEffect(() => {
        const handleMessage = (event: MessageEvent<unknown>): void => {
            if (!isClusterDashboardContextMenuMessage(event.data)) {
                return;
            }

            const { action, databaseName, collectionName } = event.data;
            if (action === 'viewCollections') {
                onViewStateChange((current) => ({ ...current, currentDatabase: databaseName, filterText: '' }));
            } else if (action === 'openCollection' && collectionName !== undefined) {
                openCollection(databaseName, collectionName);
            } else if (action === 'manageIndexes' && collectionName !== undefined) {
                openCollection(databaseName, collectionName, 'tab_indexes');
            } else if (action !== 'openCollection' && action !== 'manageIndexes') {
                runCommand(databaseName, collectionName, action);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [onViewStateChange, openCollection, runCommand]);

    const activate = (row: NamespaceRow): void => {
        if (currentDatabase === null) {
            onViewStateChange((current) => ({ ...current, currentDatabase: row.name, filterText: '' }));
        } else {
            openCollection(currentDatabase, row.name);
        }
    };

    const toggleSort = (column: SortColumn): void =>
        onViewStateChange((current) => ({
            ...current,
            sort:
                current.sort.column === column
                    ? { column, direction: current.sort.direction === 'ascending' ? 'descending' : 'ascending' }
                    : { column, direction: defaultDirectionFor(column) },
        }));

    const errors =
        inventoryIsLoading || storageStats === null
            ? []
            : currentDatabase === null
              ? storageStats.errors
              : (collections.result?.errors ?? []);
    const omittedCount =
        inventoryIsLoading || storageStats === null
            ? 0
            : currentDatabase === null
              ? storageStats.omittedDatabaseCount
              : (collections.result?.omittedCollectionCount ?? 0);
    const shownCount = currentDatabase === null ? (storageStats?.databases.length ?? 0) : collectionRows.length;

    return (
        <div className="tabPanel">
            {/*
             * Where the reader is, as a path rather than a title plus a back button. One line
             * at both levels and the same height at both, so stepping in or out no longer
             * moves the toolbar and the table beneath it. Which list is on screen is already
             * stated by the table's own first column heading, so the band does not repeat it.
             */}
            <div className="levelHeader">
                <Breadcrumb aria-label={l10n.t('Inventory level')} size="medium">
                    <BreadcrumbItem>
                        <BreadcrumbButton
                            current={currentDatabase === null}
                            icon={<DatabaseMultipleRegular />}
                            onClick={currentDatabase === null ? undefined : goBack}
                        >
                            {l10n.t('Databases')}
                        </BreadcrumbButton>
                    </BreadcrumbItem>
                    {currentDatabase !== null && (
                        <>
                            <BreadcrumbDivider />
                            <BreadcrumbItem>
                                <BreadcrumbButton current icon={<DatabaseRegular />} title={currentDatabase}>
                                    {currentDatabase}
                                </BreadcrumbButton>
                            </BreadcrumbItem>
                        </>
                    )}
                </Breadcrumb>
            </div>

            {/*
             * Filter only — the same filter-first row the Collection View's index list uses.
             * Refresh is not repeated here: it acts on the whole panel and lives once, in the
             * main toolbar, rather than once per list.
             */}
            <Toolbar size="small" className="dataToolbar" aria-label={l10n.t('List controls')}>
                <SearchBox
                    className="dataFilterInput"
                    value={filterText}
                    placeholder={currentDatabase === null ? l10n.t('Filter databases…') : l10n.t('Filter collections…')}
                    aria-label={
                        currentDatabase === null
                            ? l10n.t('Filter databases by name')
                            : l10n.t('Filter collections by name')
                    }
                    onChange={(_event, data) => setFilterText(data.value)}
                />
            </Toolbar>

            {collections.error !== null && currentDatabase !== null && (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        {l10n.t('Could not list the collections of "{database}": {reason}', {
                            database: currentDatabase,
                            reason: collections.error,
                        })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {errors.length > 0 && (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        {currentDatabase === null
                            ? l10n.t('Some database statistics could not be read: {reason}', {
                                  reason: errors.join('; '),
                              })
                            : l10n.t('Some collection statistics could not be read: {reason}', {
                                  reason: errors.join('; '),
                              })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {omittedCount > 0 && (
                <MessageBar intent="info">
                    <MessageBarBody>
                        {currentDatabase === null
                            ? l10n.t('Showing the first {shown} databases; {omitted} more are not listed.', {
                                  shown: String(shownCount),
                                  omitted: String(omittedCount),
                              })
                            : l10n.t('Showing the first {shown} collections; {omitted} more are not listed.', {
                                  shown: String(shownCount),
                                  omitted: String(omittedCount),
                              })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {inventoryIsLoading ? (
                <NamespaceTableSkeleton rowCount={lastRowCounts[levelKey] ?? knownCollectionCount} />
            ) : allRows.length === 0 ? (
                <div className="emptyState">
                    {currentDatabase !== null
                        ? l10n.t('"{database}" holds no collections.', { database: currentDatabase })
                        : errors.length > 0
                          ? l10n.t('Database statistics are unavailable for this cluster.')
                          : l10n.t('No user databases were reported for this cluster.')}
                </div>
            ) : (
                // A filter that matches nothing leaves the table standing and empty, as the
                // index list does: the footer below already says "Showing 0 of N", and
                // swapping the columns out for a sentence hides the filter's own effect.
                <NamespaceTable
                    level={currentDatabase === null ? 'databases' : 'collections'}
                    rows={rows}
                    sort={sort}
                    onSortToggle={toggleSort}
                    onActivate={activate}
                    databaseName={currentDatabase ?? undefined}
                />
            )}

            {/*
             * The index list's footer: how much of the list the filter is hiding, which is
             * the one thing the table itself cannot say.
             *
             * Nothing else. It once restated the drilled-into database's own size and document
             * count, which read as a claim about the list above it — "1 of 1 collections ·
             * 27.93 MB" invites the arithmetic that the one collection is 27.93 MB, and the
             * two figures come from different levels.
             *
             * The way out shares the line rather than taking one of its own: the breadcrumb
             * is off screen by the time a reader reaches the end of a long list, and a second
             * exit costs nothing here if it does not add a row.
             */}
            {!inventoryIsLoading && allRows.length > 0 && (
                <div className="listFooter">
                    <div className="listFooterStart">
                        {currentDatabase !== null && (
                            <Button size="small" appearance="outline" icon={<ArrowLeftRegular />} onClick={goBack}>
                                {l10n.t('Back to Databases')}
                            </Button>
                        )}
                    </div>
                    <div className="listCount">
                        <span aria-live="polite">
                            {currentDatabase === null
                                ? l10n.t('Showing {0} of {1} databases', rows.length, allRows.length)
                                : l10n.t('Showing {0} of {1} collections', rows.length, allRows.length)}
                        </span>
                        {updatedText !== undefined && (
                            <>
                                <span aria-hidden="true"> · </span>
                                <span>{updatedText}</span>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
