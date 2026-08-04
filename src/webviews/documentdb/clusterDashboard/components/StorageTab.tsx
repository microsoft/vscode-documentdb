/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    MessageBar,
    MessageBarBody,
    SearchBox,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Toolbar,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular, ChevronDownRegular, ChevronRightRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, useMemo, type JSX } from 'react';

import { type ClusterDatabaseStorage, type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import { formatCount } from '../../collectionView/components/queryInsightsTab/components/metricsRow';
import { formatBytes } from '../formatUtils';
import { CollectionsPanel } from './CollectionsPanel';
import { RelativeSize } from './RelativeSize';

/** Columns the table can be ordered by. */
export type SortColumn = 'name' | 'sizeOnDiskBytes' | 'dataSizeBytes' | 'indexSizeBytes' | 'collections' | 'objects';

export interface SortState {
    column: SortColumn;
    direction: 'ascending' | 'descending';
}

/**
 * How the reader has arranged the list: the order, the filter, and which databases they
 * opened.
 *
 * Owned by the dashboard rather than this component because switching to Operations and back
 * unmounts the tab — which discarded the sort, the filter text, and every expanded row. The
 * Collection View's index list hoists the same three pieces of state to its parent for the
 * same reason (there, a manual refresh swaps the table for a skeleton).
 */
export interface StorageTabViewState {
    sort: SortState;
    filterText: string;
    expanded: ReadonlySet<string>;
}

export interface StorageTabProps {
    storageStats: ClusterStorageStats | null;
    isRefreshing: boolean;
    onRefresh: () => void;
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
const DEFAULT_SORT: SortState = { column: 'sizeOnDiskBytes', direction: 'descending' };

/**
 * The arrangement a freshly-opened dashboard starts from.
 *
 * A factory, not a shared constant: the state holds a `Set`, and one module-level instance
 * handed to every panel would be a mutation away from leaking one dashboard's expanded rows
 * into another's.
 */
export function createStorageViewState(): StorageTabViewState {
    return { sort: DEFAULT_SORT, filterText: '', expanded: new Set<string>() };
}

/** Numeric columns sort largest-first on the first click; the name column sorts A→Z. */
function defaultDirectionFor(column: SortColumn): SortState['direction'] {
    return column === 'name' ? 'ascending' : 'descending';
}

function compareDatabases(left: ClusterDatabaseStorage, right: ClusterDatabaseStorage, sort: SortState): number {
    if (sort.column === 'name') {
        const byName = left.name.localeCompare(right.name);
        return sort.direction === 'ascending' ? byName : -byName;
    }

    // A database whose `dbStats` failed sorts last whichever way the column is pointing:
    // "unknown" is not "zero", and burying it under real values would misrepresent it.
    const leftValue = left[sort.column];
    const rightValue = right[sort.column];
    if (leftValue === null && rightValue === null) {
        return left.name.localeCompare(right.name);
    }
    if (leftValue === null) {
        return 1;
    }
    if (rightValue === null) {
        return -1;
    }

    const byValue = leftValue - rightValue;
    if (byValue !== 0) {
        return sort.direction === 'ascending' ? byValue : -byValue;
    }

    // Stable tiebreak so equal sizes do not shuffle between refreshes.
    return left.name.localeCompare(right.name);
}

/**
 * Header cell that sorts, carrying `aria-sort` so the current order is announced rather than
 * only drawn.
 *
 * Declared at module scope, not inside `StorageTab`: a component created during render is a
 * new type on every render, so React would unmount and remount it — losing keyboard focus
 * the moment a sort changed, which is exactly when a keyboard user is holding it.
 */
function SortableHeader({
    column,
    label,
    sort,
    onToggle,
    className,
}: {
    column: SortColumn;
    label: string;
    sort: SortState;
    onToggle: (column: SortColumn) => void;
    className?: string;
}): JSX.Element {
    const isActive = sort.column === column;

    return (
        <TableHeaderCell
            className={className}
            sortable
            sortDirection={isActive ? sort.direction : undefined}
            aria-sort={isActive ? sort.direction : 'none'}
            onClick={() => onToggle(column)}
        >
            {label}
        </TableHeaderCell>
    );
}

export const StorageTab = ({
    storageStats,
    isRefreshing,
    onRefresh,
    viewState,
    onViewStateChange,
}: StorageTabProps): JSX.Element => {
    const { sort, filterText, expanded } = viewState;

    const setSort = (next: SortState): void => onViewStateChange((current) => ({ ...current, sort: next }));
    const setFilterText = (next: string): void => onViewStateChange((current) => ({ ...current, filterText: next }));

    const databases = useMemo(() => {
        if (storageStats === null) {
            return [];
        }

        const needle = filterText.trim().toLowerCase();
        const matching =
            needle === ''
                ? storageStats.databases
                : storageStats.databases.filter((database) => database.name.toLowerCase().includes(needle));

        return [...matching].sort((left, right) => compareDatabases(left, right, sort));
    }, [storageStats, filterText, sort]);

    if (storageStats === null) {
        return (
            <div className="tabPanel">
                <Spinner size="small" label={l10n.t('Loading databases…')} />
            </div>
        );
    }

    const toggleSort = (column: SortColumn): void =>
        setSort(
            sort.column === column
                ? { column, direction: sort.direction === 'ascending' ? 'descending' : 'ascending' }
                : { column, direction: defaultDirectionFor(column) },
        );

    const toggleExpanded = (name: string): void =>
        onViewStateChange((current) => {
            const next = new Set(current.expanded);
            if (!next.delete(name)) {
                next.add(name);
            }
            return { ...current, expanded: next };
        });

    // Scaled against the largest *visible* database so the bars stay meaningful while filtered.
    const largestDatabaseBytes = databases.reduce(
        (largest, database) => Math.max(largest, database.sizeOnDiskBytes ?? 0),
        0,
    );

    const sumOf = (read: (database: ClusterDatabaseStorage) => number | null): number | null =>
        databases.reduce<number | null>((total, database) => {
            const value = read(database);
            return value === null ? total : (total ?? 0) + value;
        }, null);

    /**
     * Renders a summed count, preserving "not reported" rather than collapsing it to zero.
     *
     * `sumOf` returns `null` only when *no* visible database reported the field, which means
     * the cluster did not answer — not that the cluster holds none. Formatting that as `0`
     * would state a fact the server never gave us, and would contradict the per-row cells,
     * which already render the placeholder in exactly this case. `formatBytes` applies the
     * same rule to the size columns on its own.
     */
    const formatSum = (total: number | null): string => (total === null ? '—' : formatCount(total));

    const isFiltered = filterText.trim() !== '';

    return (
        <div className="tabPanel">
            {/*
             * Filter first, actions after — the same order the Collection View's index list
             * uses. The box has a fixed flex basis rather than an intrinsic width so it does
             * not resize when it gains focus and grows a dismiss button.
             */}
            <Toolbar size="small" className="dataToolbar" aria-label={l10n.t('Database list controls')}>
                <SearchBox
                    className="dataFilterInput"
                    value={filterText}
                    placeholder={l10n.t('Filter databases…')}
                    aria-label={l10n.t('Filter databases by name')}
                    onChange={(_event, data) => setFilterText(data.value)}
                />
                <Button
                    className="dataRefreshButton"
                    appearance="subtle"
                    icon={<ArrowClockwiseRegular />}
                    disabled={isRefreshing}
                    onClick={onRefresh}
                    aria-label={l10n.t('Refresh database statistics')}
                >
                    {l10n.t('Refresh')}
                </Button>
                {isRefreshing && <Spinner size="tiny" aria-label={l10n.t('Refreshing…')} />}
            </Toolbar>

            {storageStats.errors.length > 0 && (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        {l10n.t('Some database statistics could not be read: {reason}', {
                            reason: storageStats.errors.join('; '),
                        })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {storageStats.omittedDatabaseCount > 0 && (
                <MessageBar intent="info">
                    <MessageBarBody>
                        {l10n.t('Showing the first {shown} databases; {omitted} more are not listed.', {
                            shown: String(storageStats.databases.length),
                            omitted: String(storageStats.omittedDatabaseCount),
                        })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {databases.length === 0 ? (
                <div className="emptyState">
                    {isFiltered
                        ? l10n.t('No database matches "{filter}".', { filter: filterText })
                        : storageStats.errors.length > 0
                          ? l10n.t('Database statistics are unavailable for this cluster.')
                          : l10n.t('No user databases were reported for this cluster.')}
                </div>
            ) : (
                // Below the table's minimum width the columns would be squeezed into each
                // other, so the region scrolls sideways instead — the same shape the index
                // list uses. Nothing is ever hidden by clipping alone.
                <div className="tableScroller">
                    <Table size="small" className="databasesTable" aria-label={l10n.t('Databases in this cluster')}>
                        {/*
                         * Fixed layout with declared column widths. Without it a long database
                         * name pushes every following column out from under its heading and the
                         * values print on top of each other — the name column absorbs the slack
                         * instead, and clips with an ellipsis when there is none left.
                         */}
                        <colgroup>
                            <col className="colExpand" />
                            <col className="colDatabaseName" />
                            <col className="colSize" />
                            <col className="colNumber" />
                            <col className="colNumber" />
                            <col className="colNarrow" />
                            <col className="colNumber" />
                        </colgroup>
                        <TableHeader>
                            <TableRow>
                                <TableHeaderCell className="expandHeaderCell" aria-label={l10n.t('Expand row')} />
                                <SortableHeader
                                    column="name"
                                    label={l10n.t('Database')}
                                    sort={sort}
                                    onToggle={toggleSort}
                                />
                                <SortableHeader
                                    column="sizeOnDiskBytes"
                                    label={l10n.t('Size')}
                                    sort={sort}
                                    onToggle={toggleSort}
                                />
                                <SortableHeader
                                    column="dataSizeBytes"
                                    label={l10n.t('Data')}
                                    sort={sort}
                                    onToggle={toggleSort}
                                />
                                <SortableHeader
                                    column="indexSizeBytes"
                                    label={l10n.t('Indexes')}
                                    sort={sort}
                                    onToggle={toggleSort}
                                />
                                <SortableHeader
                                    column="collections"
                                    label={l10n.t('Collections')}
                                    sort={sort}
                                    onToggle={toggleSort}
                                />
                                <SortableHeader
                                    column="objects"
                                    label={l10n.t('Documents')}
                                    sort={sort}
                                    onToggle={toggleSort}
                                />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {databases.map((database) => {
                                const isExpanded = expanded.has(database.name);

                                return (
                                    <Fragment key={database.name}>
                                        <TableRow>
                                            {/*
                                             * No tooltip on the chevron: it is the same
                                             * affordance the index list uses bare, and a
                                             * tooltip anchored in the leftmost column opens
                                             * across the row it belongs to. The aria-label
                                             * carries the meaning for assistive tech.
                                             */}
                                            <TableCell className="expandCell">
                                                <Button
                                                    appearance="subtle"
                                                    size="small"
                                                    aria-expanded={isExpanded}
                                                    aria-label={
                                                        isExpanded
                                                            ? l10n.t('Collapse collections for {name}', {
                                                                  name: database.name,
                                                              })
                                                            : l10n.t('Expand collections for {name}', {
                                                                  name: database.name,
                                                              })
                                                    }
                                                    icon={isExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
                                                    onClick={() => toggleExpanded(database.name)}
                                                />
                                            </TableCell>
                                            <TableCell className="databaseNameCell">
                                                <TableCellLayout truncate title={database.name}>
                                                    {database.name}
                                                </TableCellLayout>
                                            </TableCell>
                                            <TableCell>
                                                <RelativeSize
                                                    value={database.sizeOnDiskBytes}
                                                    maximum={largestDatabaseBytes}
                                                />
                                            </TableCell>
                                            <TableCell>
                                                <span className="numberCell">
                                                    {formatBytes(database.dataSizeBytes)}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <span className="numberCell">
                                                    {formatBytes(database.indexSizeBytes)}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <span className="numberCell">
                                                    {database.collections === null
                                                        ? '—'
                                                        : formatCount(database.collections)}
                                                </span>
                                            </TableCell>
                                            <TableCell>
                                                <span className="numberCell">
                                                    {database.objects === null ? '—' : formatCount(database.objects)}
                                                </span>
                                            </TableCell>
                                        </TableRow>
                                        {isExpanded && (
                                            <TableRow className="collectionsDetailRow">
                                                <TableCell colSpan={7} className="collectionsDetailCell">
                                                    <CollectionsPanel databaseName={database.name} />
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </Fragment>
                                );
                            })}
                            <TableRow className="storageTotalRow">
                                <TableCell className="expandCell" />
                                <TableCell className="databaseNameCell">
                                    <TableCellLayout truncate>
                                        {isFiltered ? l10n.t('Total (filtered)') : l10n.t('Total')}
                                    </TableCellLayout>
                                </TableCell>
                                <TableCell>
                                    <span className="numberCell">
                                        {formatBytes(sumOf((database) => database.sizeOnDiskBytes))}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="numberCell">
                                        {formatBytes(sumOf((database) => database.dataSizeBytes))}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="numberCell">
                                        {formatBytes(sumOf((database) => database.indexSizeBytes))}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="numberCell">
                                        {formatSum(sumOf((database) => database.collections))}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    <span className="numberCell">
                                        {formatSum(sumOf((database) => database.objects))}
                                    </span>
                                </TableCell>
                            </TableRow>
                        </TableBody>
                    </Table>
                </div>
            )}
        </div>
    );
};
