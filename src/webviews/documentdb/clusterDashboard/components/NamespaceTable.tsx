/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    Menu,
    MenuDivider,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Tooltip,
} from '@fluentui/react-components';
import {
    ArrowDownloadRegular,
    ArrowExpandRegular,
    ArrowUploadRegular,
    ClipboardPasteRegular,
    CopyRegular,
    DatabaseRegular,
    DeleteRegular,
    DocumentMultipleRegular,
    KeyboardRegular,
    KeyMultipleRegular,
    LibraryRegular,
    LinkRegular,
    WindowConsoleRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useMemo, type JSX } from 'react';

import {
    type ClusterCollectionStorage,
    type ClusterDatabaseStorage,
} from '../../../../documentdb/utils/getClusterHealth';
import { formatCount } from '../../collectionView/queryInsightsTab/components/metricsRow';
import { type NamespaceCommandId } from '../clusterDashboardRouter';
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
    onActivate: (row: NamespaceRow) => void;
    onManageIndexes: (row: NamespaceRow) => void;
    onRunCommand: (row: NamespaceRow, commandId: NamespaceCommandId) => void;
}

/**
 * The two or three actions a reader reaches for repeatedly, as buttons in the Actions column.
 *
 * The split is the tree's: the tree puts Open / Shell / Playground inline on the node and
 * everything else in the context menu, so a reader who has learned one surface has learned
 * this one.
 */
const RowActionButtons = ({ row, isDatabases, onActivate, onRunCommand }: RowActionsProps): JSX.Element => {
    // Not "Open a shell scoped to sample_mflix": the button sits in that row, so the row
    // already says which namespace it acts on. Naming it again makes every tooltip in the
    // column a different length and reads back the one thing the reader can already see.
    const primaryLabel = isDatabases ? l10n.t('Show collections') : l10n.t('Open collection');
    const shellLabel = l10n.t('Open shell');
    const playgroundLabel = l10n.t('New query playground');

    return (
        <div className="namespaceActions">
            <Tooltip content={primaryLabel} relationship="description" withArrow>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={isDatabases ? <ArrowExpandRegular /> : <DocumentMultipleRegular />}
                    aria-label={primaryLabel}
                    onClick={(event) => {
                        // A database row handles the click too; without this it fires twice.
                        event.stopPropagation();
                        onActivate(row);
                    }}
                />
            </Tooltip>

            <Tooltip content={shellLabel} relationship="description" withArrow>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<WindowConsoleRegular />}
                    aria-label={shellLabel}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRunCommand(row, 'vscode-documentdb.command.shell.open');
                    }}
                />
            </Tooltip>

            {/* A playground is scoped to a collection; at the database level it has nothing to query. */}
            {!isDatabases && (
                <Tooltip content={playgroundLabel} relationship="description" withArrow>
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<KeyboardRegular />}
                        aria-label={playgroundLabel}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRunCommand(row, 'vscode-documentdb.command.playground.new');
                        }}
                    />
                </Tooltip>
            )}
        </div>
    );
};

/**
 * Everything the tree offers on this node, in the tree's own grouping and order.
 *
 * Opened by right-clicking the row, as in the tree. Every item runs the tree's own command,
 * not a reimplementation.
 */
const RowMenuList = ({ row, isDatabases, onActivate, onManageIndexes, onRunCommand }: RowActionsProps): JSX.Element => {
    const runShell = (): void => onRunCommand(row, 'vscode-documentdb.command.shell.open');
    const runPlayground = (): void => onRunCommand(row, 'vscode-documentdb.command.playground.new');

    return (
        <MenuList>
            {isDatabases ? (
                <>
                    <MenuItem icon={<ArrowExpandRegular />} onClick={() => onActivate(row)}>
                        {l10n.t('View Collections')}
                    </MenuItem>
                    <MenuItem
                        icon={<LinkRegular />}
                        onClick={() => onRunCommand(row, 'vscode-documentdb.command.copyReference')}
                    >
                        {l10n.t('Copy Reference')}
                    </MenuItem>

                    <MenuDivider />

                    <MenuItem icon={<WindowConsoleRegular />} onClick={runShell}>
                        {l10n.t('Open Shell')}
                    </MenuItem>
                    <MenuItem icon={<KeyboardRegular />} onClick={runPlayground}>
                        {l10n.t('New Query Playground')}
                    </MenuItem>

                    <MenuDivider />

                    <MenuItem
                        icon={<DeleteRegular />}
                        onClick={() => onRunCommand(row, 'vscode-documentdb.command.dropDatabase')}
                    >
                        {l10n.t('Delete Database')}
                    </MenuItem>
                </>
            ) : (
                <>
                    <MenuItem icon={<DocumentMultipleRegular />} onClick={() => onActivate(row)}>
                        {l10n.t('Open Collection')}
                    </MenuItem>
                    <MenuItem icon={<WindowConsoleRegular />} onClick={runShell}>
                        {l10n.t('Open Shell')}
                    </MenuItem>
                    <MenuItem icon={<KeyboardRegular />} onClick={runPlayground}>
                        {l10n.t('New Query Playground')}
                    </MenuItem>
                    <MenuItem
                        icon={<LinkRegular />}
                        onClick={() => onRunCommand(row, 'vscode-documentdb.command.copyReference')}
                    >
                        {l10n.t('Copy Reference')}
                    </MenuItem>

                    <MenuDivider />

                    <MenuItem icon={<KeyMultipleRegular />} onClick={() => onManageIndexes(row)}>
                        {l10n.t('Manage Indexes')}
                    </MenuItem>

                    <MenuDivider />

                    <MenuItem
                        icon={<CopyRegular />}
                        onClick={() => onRunCommand(row, 'vscode-documentdb.command.copyCollection')}
                    >
                        {l10n.t('Copy Collection')}
                    </MenuItem>
                    <MenuItem
                        icon={<ClipboardPasteRegular />}
                        onClick={() => onRunCommand(row, 'vscode-documentdb.command.pasteCollection')}
                    >
                        {l10n.t('Paste Collection')}
                    </MenuItem>
                    <MenuItem
                        icon={<ArrowDownloadRegular />}
                        onClick={() => onRunCommand(row, 'vscode-documentdb.command.exportDocuments')}
                    >
                        {l10n.t('Export Documents')}
                    </MenuItem>
                    <MenuItem
                        icon={<ArrowUploadRegular />}
                        onClick={() => onRunCommand(row, 'vscode-documentdb.command.importDocuments')}
                    >
                        {l10n.t('Import Documents')}
                    </MenuItem>

                    <MenuDivider />

                    <MenuItem
                        icon={<DeleteRegular />}
                        onClick={() => onRunCommand(row, 'vscode-documentdb.command.dropCollection')}
                    >
                        {l10n.t('Delete Collection')}
                    </MenuItem>
                </>
            )}
        </MenuList>
    );
};

export interface NamespaceTableProps {
    level: 'databases' | 'collections';
    rows: NamespaceRow[];
    sort: SortState;
    onSortToggle: (column: SortColumn) => void;
    /** Drills into a database, or opens the Collection View for a collection. */
    onActivate: (row: NamespaceRow) => void;
    /** Opens the Collection View's Indexes tab for a collection. */
    onManageIndexes: (row: NamespaceRow) => void;
    /** Runs one of the tree's own commands against the row. */
    onRunCommand: (row: NamespaceRow, commandId: NamespaceCommandId) => void;
}

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
    onManageIndexes,
    onRunCommand,
}: NamespaceTableProps): JSX.Element => {
    const isDatabases = level === 'databases';

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
                    <col className="colAction" />
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
                        <TableHeaderCell className="actionCell">{l10n.t('Actions')}</TableHeaderCell>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {rows.map((row) => {
                        const actions = {
                            row,
                            isDatabases,
                            onActivate,
                            onManageIndexes,
                            onRunCommand,
                        };

                        return (
                            // Right-click the row, as in the tree. `openOnContext` is what
                            // suppresses the editor's own menu; `Menu` renders no element of
                            // its own, so the <tr> stays a direct child of <tbody>.
                            <Menu key={row.name} openOnContext>
                                <MenuTrigger disableButtonEnhancement>
                                    <TableRow
                                        className={isDatabases ? 'namespaceRow namespaceRowClickable' : 'namespaceRow'}
                                        // Only a database row is clickable. Stepping into one
                                        // is a cheap, in-place move; opening a collection
                                        // leaves for another editor tab, which is too much to
                                        // hang on a stray click at a row the reader was only
                                        // reading.
                                        onClick={isDatabases ? () => onActivate(row) : undefined}
                                    >
                                        <TableCell>
                                            <TableCellLayout
                                                truncate
                                                title={row.name}
                                                media={isDatabases ? <DatabaseRegular /> : <LibraryRegular />}
                                            >
                                                {row.name}
                                            </TableCellLayout>
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
                                            <span className="numberCell">{formatBytes(row.dataSizeBytes)}</span>
                                        </TableCell>
                                        <TableCell>
                                            <RelativeSize value={row.indexSizeBytes} maximum={largestIndexBytes} />
                                        </TableCell>
                                        <TableCell>
                                            <span className="numberCell">
                                                {row.childCount === null ? '—' : formatCount(row.childCount)}
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
                                                {formatApproximateCount(row.documents)}
                                            </span>
                                        </TableCell>
                                        <TableCell className="actionCell">
                                            <RowActionButtons {...actions} />
                                        </TableCell>
                                    </TableRow>
                                </MenuTrigger>
                                <MenuPopover>
                                    <RowMenuList {...actions} />
                                </MenuPopover>
                            </Menu>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
};
