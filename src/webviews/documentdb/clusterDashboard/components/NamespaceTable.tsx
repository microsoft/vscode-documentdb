/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableCellActions,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Tooltip,
} from '@fluentui/react-components';
import { ArrowExpandRegular, DatabaseRegular, LibraryRegular, MoreHorizontalRegular } from '@fluentui/react-icons';
import { useConfiguration } from '@microsoft/vscode-ext-webview/react';
import * as l10n from '@vscode/l10n';
import { useMemo, type JSX } from 'react';

import {
    type ClusterCollectionStorage,
    type ClusterDatabaseStorage,
} from '../../../../documentdb/utils/getClusterHealth';
import { formatCount } from '../../collectionView/queryInsightsTab/components/metricsRow';
import { type ClusterDashboardWebviewConfigurationType } from '../clusterDashboardController';
import { formatApproximateCount, formatBytes, formatExactCount } from '../formatUtils';
import { RelativeSize } from './RelativeSize';

/**
 * A database and a collection reduced to the facts they have in common.
 *
 * The two levels used to be drawn by two tables with different densities, column sets and
 * chrome — the collections one nested inside a row of the databases one — which asked the
 * reader to learn two list formats to read one hierarchy. They are the same shape: a named
 * container with a size, a data/index split, a child count and a document count. Collapsing
 * them here is what lets one table render either level at identical spacing.
 */
export interface NamespaceRow {
    name: string;
    /** `sizeOnDisk` for a database, `storageSize` (or `size`) for a collection. */
    sizeBytes: number | null;
    dataSizeBytes: number | null;
    indexSizeBytes: number | null;
    /** Collections in a database, or indexes on a collection. */
    childCount: number | null;
    documents: number | null;
    /** A view stores nothing, so its size cell says so instead of drawing a bar. */
    isView: boolean;
}

export type SortColumn = 'name' | 'sizeBytes' | 'dataSizeBytes' | 'indexSizeBytes' | 'childCount' | 'documents';

export interface SortState {
    column: SortColumn;
    direction: 'ascending' | 'descending';
}

export function toDatabaseRow(database: ClusterDatabaseStorage): NamespaceRow {
    return {
        name: database.name,
        sizeBytes: database.sizeOnDiskBytes,
        dataSizeBytes: database.dataSizeBytes,
        indexSizeBytes: database.indexSizeBytes,
        childCount: database.collections,
        documents: database.objects,
        isView: false,
    };
}

export function toCollectionRow(collection: ClusterCollectionStorage): NamespaceRow {
    return {
        name: collection.name,
        sizeBytes: collection.storageSizeBytes ?? collection.dataSizeBytes,
        dataSizeBytes: collection.dataSizeBytes,
        indexSizeBytes: collection.indexSizeBytes,
        childCount: collection.indexes,
        documents: collection.documents,
        isView: collection.type === 'view',
    };
}

/** Numeric columns sort largest-first on the first click; the name column sorts A→Z. */
export function defaultDirectionFor(column: SortColumn): SortState['direction'] {
    return column === 'name' ? 'ascending' : 'descending';
}

function compareRows(left: NamespaceRow, right: NamespaceRow, sort: SortState): number {
    if (sort.column === 'name') {
        const byName = left.name.localeCompare(right.name);
        return sort.direction === 'ascending' ? byName : -byName;
    }

    // A row whose stats failed sorts last whichever way the column is pointing: "unknown" is
    // not "zero", and burying it under real values would misrepresent it.
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

/** Filters by name and applies the current order, in that sequence. */
export function arrangeRows(rows: NamespaceRow[], filterText: string, sort: SortState): NamespaceRow[] {
    const needle = filterText.trim().toLowerCase();
    const matching = needle === '' ? rows : rows.filter((row) => row.name.toLowerCase().includes(needle));
    return [...matching].sort((left, right) => compareRows(left, right, sort));
}

/**
 * Header cell that sorts, carrying `aria-sort` so the current order is announced rather than
 * only drawn.
 *
 * Declared at module scope, not inside the table: a component created during render is a new
 * type on every render, so React would unmount and remount it — losing keyboard focus the
 * moment a sort changed, which is exactly when a keyboard user is holding it.
 */
function SortableHeader({
    column,
    label,
    sort,
    onToggle,
}: {
    column: SortColumn;
    label: string;
    sort: SortState;
    onToggle: (column: SortColumn) => void;
}): JSX.Element {
    const isActive = sort.column === column;

    return (
        <TableHeaderCell
            sortable
            sortDirection={isActive ? sort.direction : undefined}
            aria-sort={isActive ? sort.direction : 'none'}
            onClick={() => onToggle(column)}
        >
            {label}
        </TableHeaderCell>
    );
}

interface RowActionsProps {
    row: NamespaceRow;
    isDatabases: boolean;
    isBusy: boolean;
    onActivate: (row: NamespaceRow, control: 'rowClick' | 'rowActionButton') => void;
}

/**
 * The primary action and a button that opens the row's native VS Code context menu.
 */
const RowActionButtons = ({ row, isDatabases, isBusy, onActivate }: RowActionsProps): JSX.Element => {
    // Not "Open a shell scoped to sample_mflix": the button sits in that row, so the row
    // already says which namespace it acts on. Naming it again makes every tooltip in the
    // column a different length and reads back the one thing the reader can already see.
    const primaryLabel = isDatabases ? l10n.t('Show collections') : l10n.t('Open collection');
    const moreActionsLabel = l10n.t('More actions');

    return (
        <div className="namespaceActions">
            <Tooltip content={primaryLabel} relationship="description" withArrow>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<ArrowExpandRegular />}
                    aria-label={primaryLabel}
                    disabled={isBusy}
                    onClick={(event) => {
                        // A database row handles the click too; without this it fires twice.
                        event.stopPropagation();
                        onActivate(row, 'rowActionButton');
                    }}
                />
            </Tooltip>

            <Button
                appearance="subtle"
                size="small"
                icon={<MoreHorizontalRegular />}
                aria-label={moreActionsLabel}
                title={moreActionsLabel}
                disabled={isBusy}
                onClick={(event) => {
                    event.stopPropagation();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    event.currentTarget.dispatchEvent(
                        new MouseEvent('contextmenu', {
                            bubbles: true,
                            clientX: event.clientX || bounds.left,
                            clientY: event.clientY || bounds.bottom,
                        }),
                    );
                }}
            />
        </div>
    );
};

export interface NamespaceTableProps {
    level: 'databases' | 'collections';
    rows: NamespaceRow[];
    sort: SortState;
    onSortToggle: (column: SortColumn) => void;
    /** Drills into a database, or opens the Collection View for a collection. */
    onActivate: (row: NamespaceRow, control: 'rowClick' | 'rowActionButton') => void;
    /** Parent database when rendering collections. */
    databaseName?: string;
    /** Names of rows whose create or delete command is in progress. */
    busyNames?: ReadonlySet<string>;
}

const NamespaceStatusIndicator = ({ isDatabase, busy }: { isDatabase: boolean; busy: boolean }): JSX.Element => {
    if (busy) {
        const label = isDatabase ? l10n.t('Updating database') : l10n.t('Updating collection');
        return (
            <Tooltip content={label} relationship="label" withArrow>
                <Spinner size="extra-tiny" aria-label={label} className="namespaceStatusSpinner" />
            </Tooltip>
        );
    }

    return isDatabase ? (
        <DatabaseRegular className="namespaceStatusIcon" aria-hidden={true} />
    ) : (
        <LibraryRegular className="namespaceStatusIcon" aria-hidden={true} />
    );
};

/**
 * The inventory list, at either level.
 *
 * One table, one density, one column geometry. Only the leading heading and the trailing
 * action change with the level, because those are the only things that actually differ: a
 * database row goes one level down, a collection row leaves for the Collection View.
 */
export const NamespaceTable = ({
    level,
    rows,
    sort,
    onSortToggle,
    onActivate,
    databaseName,
    busyNames,
}: NamespaceTableProps): JSX.Element => {
    const isDatabases = level === 'databases';
    const configuration = useConfiguration<ClusterDashboardWebviewConfigurationType>();

    // Scaled against the largest *visible* row so the bars stay meaningful while filtered.
    // The two size columns are scaled independently: an index total is a fraction of the
    // storage figure beside it, so sharing a maximum would flatten every index bar to nothing
    // and answer no question at all.
    const largestBytes = useMemo(() => rows.reduce((largest, row) => Math.max(largest, row.sizeBytes ?? 0), 0), [rows]);
    const largestIndexBytes = useMemo(
        () => rows.reduce((largest, row) => Math.max(largest, row.indexSizeBytes ?? 0), 0),
        [rows],
    );

    return (
        // Below the table's minimum width the columns would be squeezed into each other, so
        // the region scrolls sideways instead. Nothing is ever hidden by clipping alone.
        <div className="tableScroller">
            <Table
                size="small"
                className="namespaceTable"
                aria-label={isDatabases ? l10n.t('Databases in this cluster') : l10n.t('Collections in this database')}
            >
                {/*
                 * Fixed layout with declared column widths, identical at both levels. Without
                 * it a long name pushes every following column out from under its heading and
                 * the values print on top of each other — the name column absorbs the slack
                 * instead, and clips with an ellipsis when there is none left.
                 */}
                <colgroup>
                    <col className="colName" />
                    <col className="colSize" />
                    <col className="colNumber" />
                    <col className="colSize" />
                    <col className="colNarrow" />
                    <col className="colNumber" />
                </colgroup>
                <TableHeader>
                    <TableRow>
                        <SortableHeader
                            column="name"
                            label={isDatabases ? l10n.t('Database') : l10n.t('Collection')}
                            sort={sort}
                            onToggle={onSortToggle}
                        />
                        <SortableHeader
                            column="sizeBytes"
                            label={l10n.t('Size on disk')}
                            sort={sort}
                            onToggle={onSortToggle}
                        />
                        <SortableHeader
                            column="dataSizeBytes"
                            label={l10n.t('Data')}
                            sort={sort}
                            onToggle={onSortToggle}
                        />
                        <SortableHeader
                            column="indexSizeBytes"
                            label={l10n.t('Index size')}
                            sort={sort}
                            onToggle={onSortToggle}
                        />
                        <SortableHeader
                            column="childCount"
                            label={isDatabases ? l10n.t('Collections') : l10n.t('Indexes')}
                            sort={sort}
                            onToggle={onSortToggle}
                        />
                        <SortableHeader
                            column="documents"
                            label={l10n.t('Documents')}
                            sort={sort}
                            onToggle={onSortToggle}
                        />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row) => {
                        const isBusy = busyNames?.has(row.name) ?? false;
                        const actions = {
                            row,
                            isDatabases,
                            isBusy,
                            onActivate,
                        };

                        const contextMenuContext = JSON.stringify({
                            preventDefaultContextMenuItems: true,
                            clusterDashboardNamespace: isDatabases ? 'database' : 'collection',
                            clusterDashboardClusterId: configuration.clusterId,
                            clusterDashboardSelectedDatabase: configuration.selectedDatabaseName,
                            clusterDashboardDatabase: isDatabases ? row.name : databaseName,
                            clusterDashboardCollection: isDatabases ? undefined : row.name,
                        });

                        return (
                            <TableRow
                                key={row.name}
                                data-vscode-context={contextMenuContext}
                                className={isDatabases ? 'namespaceRow namespaceRowClickable' : 'namespaceRow'}
                                // Only a database row is clickable. Stepping into one
                                // is a cheap, in-place move; opening a collection
                                // leaves for another editor tab, which is too much to
                                // hang on a stray click at a row the reader was only
                                // reading.
                                onClick={isDatabases && !isBusy ? () => onActivate(row, 'rowClick') : undefined}
                            >
                                <TableCell>
                                    <TableCellLayout
                                        truncate
                                        title={row.name}
                                        media={<NamespaceStatusIndicator isDatabase={isDatabases} busy={isBusy} />}
                                    >
                                        {row.name}
                                    </TableCellLayout>
                                    <TableCellActions>
                                        <RowActionButtons {...actions} />
                                    </TableCellActions>
                                </TableCell>
                                <TableCell>
                                    {row.isView ? (
                                        // A view stores nothing; a bar would claim
                                        // otherwise. Kept in the size column's own
                                        // slot so the figures above and below it keep
                                        // their shared right edge.
                                        <div className="relativeSizeCell">
                                            <span className="relativeSizeText mutedCell">{l10n.t('View')}</span>
                                        </div>
                                    ) : (
                                        <RelativeSize value={row.sizeBytes} maximum={largestBytes} />
                                    )}
                                </TableCell>
                                <TableCell>
                                    <span className="numberCell">{formatBytes(row.dataSizeBytes, l10n.t('N/A'))}</span>
                                </TableCell>
                                <TableCell>
                                    <RelativeSize value={row.indexSizeBytes} maximum={largestIndexBytes} />
                                </TableCell>
                                <TableCell>
                                    <span className="numberCell">
                                        {row.childCount === null ? l10n.t('N/A') : formatCount(row.childCount)}
                                    </span>
                                </TableCell>
                                <TableCell>
                                    {/*
                                     * Rounded, with the server's own figure in the
                                     * tooltip: a document count is read from
                                     * collection metadata rather than counted, so the
                                     * digits it would print are more precise than the
                                     * number is.
                                     */}
                                    <span className="numberCell" title={formatExactCount(row.documents)}>
                                        {formatApproximateCount(row.documents, l10n.t('N/A'))}
                                    </span>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
};
