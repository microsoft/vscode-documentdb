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
    MessageBarActions,
    MessageBarBody,
    MessageBarTitle,
    SearchBox,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
} from '@fluentui/react-components';
import {
    AddRegular,
    ArrowLeftRegular,
    DatabaseMultipleRegular,
    DatabaseRegular,
    ErrorCircleFilled,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import { type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import { useTrpcClient } from '../../../_integration/useTrpcClient';
import { isShowCollectionsMessage } from '../clusterDashboardContextMenu';
import { useDashboardReporter } from '../useDashboardReporter';
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

/** How the reader has arranged the list, and which level they are on. */
export interface InventoryViewState {
    sort: SortState;
    filterText: string;
    /** The database being read, or `null` at the cluster's database list. */
    currentDatabase: string | null;
}

export interface InventoryPanelProps {
    storageStats: ClusterStorageStats | null;
    /**
     * Why the cluster's database list is missing, or `null` when it is only still loading.
     *
     * The dashboard states the failure itself; the panel needs it only to stop showing a
     * skeleton and to avoid claiming the cluster has no databases.
     */
    storageError: string | null;
    /** Time when the cluster's database inventory was last read successfully. */
    storageLastUpdatedAt?: number;
    /** True while the active inventory level is being re-read. */
    isLoading: boolean;
    /**
     * The drilled-into database's collections, owned by the dashboard.
     *
     * Lifted out of this component along with the Refresh button: the button lives in the
     * panel's main toolbar, and it cannot reload a list whose state is held here.
     */
    collections: DatabaseCollectionsState;
    viewState: InventoryViewState;
    /**
     * Takes an updater rather than a value, so every change rebases on the current state
     * instead of the snapshot this render closed over. With a plain value, two changes
     * landing in one React batch would have the second silently discard the first.
     */
    onViewStateChange: (update: (current: InventoryViewState) => InventoryViewState) => void;
    /** Creates a database or collection, according to the inventory level on screen. */
    onCreateNamespace: (control: 'inventoryToolbar' | 'emptyState') => void;
    /** Re-reads the cluster's database inventory after a failed request. */
    onRetryStorage: () => void;
    isCreatingNamespace: boolean;
    busyNamespaces: ReadonlyArray<{
        readonly databaseName: string;
        readonly collectionName?: string;
        readonly operation: 'create' | 'delete';
        readonly phase: 'running' | 'settling';
    }>;
}

/**
 * Default order: by name, A→Z.
 *
 * The list is read to find a known name at least as often as to find the biggest thing, and
 * an alphabetical list is the one a reader can scan without first working out what it is
 * sorted by. The size columns carry a bar each, so "what is big here?" is answerable at a
 * glance in any order.
 */
const DEFAULT_SORT: SortState = { column: 'name', direction: 'ascending' };

/** The arrangement a freshly-opened dashboard starts from. */
export function createInventoryViewState(selectedDatabaseName?: string): InventoryViewState {
    return { sort: DEFAULT_SORT, filterText: '', currentDatabase: selectedDatabaseName ?? null };
}

type MouseBackEvent = Pick<MouseEvent, 'button' | 'type' | 'preventDefault' | 'stopPropagation'>;
type InventoryBackControl = 'breadcrumb' | 'footerButton' | 'mouseBackButton';

export function handleMouseBackNavigation(
    event: MouseBackEvent,
    goBack: (control: InventoryBackControl) => void,
): void {
    if (event.button !== 3) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.type === 'mousedown') {
        goBack('mouseBackButton');
    }
}

export function navigateBackFromCollections(
    control: InventoryBackControl,
    report: ReturnType<typeof useDashboardReporter>,
    onViewStateChange: InventoryPanelProps['onViewStateChange'],
): void {
    report('inventoryNavigation', { direction: 'up', control, level: 'collections' });
    onViewStateChange((current) => ({ ...current, currentDatabase: null, filterText: '' }));
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
export const InventoryPanel = ({
    storageStats,
    storageError,
    storageLastUpdatedAt,
    isLoading,
    collections,
    viewState,
    onViewStateChange,
    onCreateNamespace,
    onRetryStorage,
    isCreatingNamespace,
    busyNamespaces,
}: InventoryPanelProps): JSX.Element => {
    const { sort, filterText, currentDatabase } = viewState;
    const trpcClient = useTrpcClient();
    const report = useDashboardReporter();

    const setFilterText = (next: string): void => onViewStateChange((current) => ({ ...current, filterText: next }));

    /**
     * Leaves the collections of a database for the cluster's database list.
     *
     * Reached from the breadcrumb above the table and from the labelled button below it, which
     * exist for different readers — one arrived by stepping in, the other opened the dashboard
     * already inside a database. Which of them is load-bearing is the whole reason the second
     * one was added, and only telemetry can answer it.
     */
    const goBack = useCallback(
        (control: InventoryBackControl): void => {
            navigateBackFromCollections(control, report, onViewStateChange);
        },
        [onViewStateChange, report],
    );

    useEffect(() => {
        if (currentDatabase === null) {
            return;
        }

        const handleMouseButton = (event: MouseEvent): void => {
            handleMouseBackNavigation(event, goBack);
        };

        window.addEventListener('mousedown', handleMouseButton, true);
        window.addEventListener('mouseup', handleMouseButton, true);
        window.addEventListener('auxclick', handleMouseButton, true);
        return () => {
            window.removeEventListener('mousedown', handleMouseButton, true);
            window.removeEventListener('mouseup', handleMouseButton, true);
            window.removeEventListener('auxclick', handleMouseButton, true);
        };
    }, [currentDatabase, goBack]);

    const databaseRows = useMemo(
        () => (storageStats === null ? [] : storageStats.databases.map(toDatabaseRow)),
        [storageStats],
    );

    const collectionRows = useMemo(
        () => (collections.result === null ? [] : collections.result.collections.map(toCollectionRow)),
        [collections.result],
    );

    const busyNames = useMemo(
        () =>
            new Set(
                busyNamespaces.flatMap((namespace) => {
                    if (currentDatabase === null && namespace.collectionName === undefined) {
                        return [namespace.databaseName];
                    }
                    if (currentDatabase === namespace.databaseName && namespace.collectionName !== undefined) {
                        return [namespace.collectionName];
                    }
                    return [];
                }),
            ),
        [busyNamespaces, currentDatabase],
    );

    const allRows = useMemo(() => {
        const loadedRows = currentDatabase === null ? databaseRows : collectionRows;
        const loadedNames = new Set(loadedRows.map((row) => row.name));
        const pendingRows = [...busyNames]
            .filter((name) => !loadedNames.has(name))
            .map<NamespaceRow>((name) => ({
                name,
                sizeBytes: null,
                dataSizeBytes: null,
                indexSizeBytes: null,
                childCount: null,
                documents: null,
                isView: false,
            }));
        return pendingRows.length === 0 ? loadedRows : [...loadedRows, ...pendingRows];
    }, [busyNames, collectionRows, currentDatabase, databaseRows]);

    const rows = useMemo(() => arrangeRows(allRows, filterText, sort), [allRows, filterText, sort]);

    /** Everything the level holds, before the filter — the denominator of the footer count. */
    const lastUpdatedAt = currentDatabase === null ? storageLastUpdatedAt : collections.lastUpdatedAt;
    const inventoryIsLoading = isLoading || (storageStats === null && storageError === null);

    /**
     * How tall the loading skeleton should stand, so a refresh does not collapse the page and
     * push everything under the table up.
     *
     * A storage refresh keeps the previous rows on hand, so their count is the answer. Stepping
     * into a database has none yet — the database's own row already said how many collections
     * to expect.
     */
    const skeletonRowCount =
        allRows.length > 0
            ? allRows.length
            : currentDatabase === null
              ? undefined
              : (databaseRows.find((database) => database.name === currentDatabase)?.childCount ?? undefined);

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
        (databaseName: string, collectionName: string, activationSource: 'rowClick' | 'rowActionButton'): void => {
            void trpcClient.clusterDashboard.openCollectionView
                .mutate({ databaseName, collectionName, activationSource })
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

    // Every other context-menu entry is carried out on the host against the row's tree node;
    // only stepping into a database is something the host cannot do for this panel.
    useEffect(() => {
        const handleMessage = (event: MessageEvent<unknown>): void => {
            if (isShowCollectionsMessage(event.data)) {
                const { databaseName } = event.data;
                report('inventoryNavigation', { direction: 'down', control: 'rowContextMenu', level: 'databases' });
                onViewStateChange((current) => ({ ...current, currentDatabase: databaseName, filterText: '' }));
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [onViewStateChange, report]);

    const activate = (row: NamespaceRow, control: 'rowClick' | 'rowActionButton'): void => {
        if (currentDatabase === null) {
            report('inventoryNavigation', {
                direction: 'down',
                control,
                level: 'databases',
                isFiltered: filterText.length > 0 ? 'true' : 'false',
            });
            onViewStateChange((current) => ({ ...current, currentDatabase: row.name, filterText: '' }));
        } else {
            openCollection(currentDatabase, row.name, control);
        }
    };

    const toggleSort = (column: SortColumn): void => {
        // Which column the estate is arranged by is the closest thing to a statement of what
        // the reader came here to find out.
        report('inventorySort', { column, level: currentDatabase === null ? 'databases' : 'collections' });
        onViewStateChange((current) => ({
            ...current,
            sort:
                current.sort.column === column
                    ? { column, direction: current.sort.direction === 'ascending' ? 'descending' : 'ascending' }
                    : { column, direction: defaultDirectionFor(column) },
        }));
    };

    const errors = inventoryIsLoading
        ? []
        : currentDatabase === null
          ? (storageStats?.errors ?? [])
          : (collections.result?.errors ?? []);
    const omittedCount =
        inventoryIsLoading || storageStats === null
            ? 0
            : currentDatabase === null
              ? storageStats.omittedDatabaseCount
              : (collections.result?.omittedCollectionCount ?? 0);
    const shownCount = currentDatabase === null ? (storageStats?.databases.length ?? 0) : collectionRows.length;
    const emptyStateFailureReason =
        allRows.length === 0
            ? currentDatabase === null
                ? (storageError ?? (errors.length > 0 ? errors.join('; ') : null))
                : (collections.error ?? (errors.length > 0 ? errors.join('; ') : null))
            : null;
    const canCreateNamespace = emptyStateFailureReason === null && (allRows.length > 0 || !inventoryIsLoading);

    const renderEmptyState = (): JSX.Element => {
        if (emptyStateFailureReason !== null) {
            return (
                <div className="emptyState" role="status">
                    <MessageBar
                        className="emptyStateFailure"
                        intent="error"
                        layout="multiline"
                        icon={<ErrorCircleFilled />}
                    >
                        <MessageBarBody className="emptyStateMessageBody">
                            <MessageBarTitle>
                                {currentDatabase === null
                                    ? l10n.t('Could not read databases')
                                    : l10n.t('Could not read collections')}
                            </MessageBarTitle>
                            <span>
                                {currentDatabase === null
                                    ? l10n.t(
                                          'The databases in this cluster could not be listed: {0}',
                                          emptyStateFailureReason,
                                      )
                                    : l10n.t('The collections of "{database}" could not be listed: {reason}', {
                                          database: currentDatabase,
                                          reason: emptyStateFailureReason,
                                      })}
                            </span>
                        </MessageBarBody>
                        <MessageBarActions>
                            <Button
                                appearance="secondary"
                                disabled={currentDatabase === null ? isLoading : collections.isLoading}
                                onClick={currentDatabase === null ? onRetryStorage : () => collections.reload('manual')}
                            >
                                {l10n.t('Retry')}
                            </Button>
                        </MessageBarActions>
                    </MessageBar>
                </div>
            );
        }

        return (
            <div className="emptyState" role="status">
                <h3 className="emptyStateHeading">
                    {currentDatabase === null
                        ? l10n.t('No databases in this cluster')
                        : l10n.t('No collections in "{database}"', { database: currentDatabase })}
                </h3>
                <p className="emptyStateDescription">{l10n.t('Create one to start storing documents.')}</p>
                <Button
                    className="emptyStateAction"
                    appearance="primary"
                    icon={<AddRegular />}
                    disabled={isCreatingNamespace}
                    onClick={() => onCreateNamespace('emptyState')}
                >
                    {currentDatabase === null ? l10n.t('New Database') : l10n.t('New Collection')}
                </Button>
            </div>
        );
    };

    return (
        <div className="inventoryPanel">
            {/* The breadcrumb is the only control that yields width when the inventory toolbar is constrained. */}
            <Toolbar className="inventoryToolbar" size="small" aria-label={l10n.t('Inventory controls')}>
                <Breadcrumb aria-label={l10n.t('Inventory level')} size="medium">
                    <BreadcrumbItem>
                        <BreadcrumbButton
                            current={currentDatabase === null}
                            icon={<DatabaseMultipleRegular />}
                            onClick={currentDatabase === null ? undefined : () => goBack('breadcrumb')}
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
                <ToolbarDivider />
                {canCreateNamespace && (
                    <ToolbarButton
                        icon={<AddRegular />}
                        disabled={isCreatingNamespace}
                        onClick={() => onCreateNamespace('inventoryToolbar')}
                    >
                        {currentDatabase === null ? l10n.t('New Database') : l10n.t('New Collection')}
                    </ToolbarButton>
                )}
                <SearchBox
                    className="inventoryFilterInput"
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

            {collections.error !== null && currentDatabase !== null && allRows.length > 0 && (
                <MessageBar intent="warning" layout="multiline">
                    <MessageBarBody>
                        {l10n.t('Could not list the collections of "{database}": {reason}', {
                            database: currentDatabase,
                            reason: collections.error,
                        })}
                    </MessageBarBody>
                    <MessageBarActions>
                        <Button
                            appearance="secondary"
                            disabled={collections.isLoading}
                            onClick={() => collections.reload('manual')}
                        >
                            {l10n.t('Retry')}
                        </Button>
                    </MessageBarActions>
                </MessageBar>
            )}

            {errors.length > 0 && emptyStateFailureReason === null && (
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
                <NamespaceTableSkeleton rowCount={skeletonRowCount} />
            ) : allRows.length === 0 ? (
                renderEmptyState()
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
                    busyNames={busyNames}
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
             * A labelled way out shares that line. It is not redundant with the breadcrumb: a
             * dashboard opened from a database node lands already inside a database, so its
             * reader never performed the step-in and has no reason to read the trail above the
             * table as a way back out.
             */}
            {!inventoryIsLoading && allRows.length > 0 && (
                <div className="listFooter">
                    <div className="listFooterStart">
                        {currentDatabase !== null && (
                            <Button
                                size="small"
                                appearance="outline"
                                icon={<ArrowLeftRegular />}
                                onClick={() => goBack('footerButton')}
                            >
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
