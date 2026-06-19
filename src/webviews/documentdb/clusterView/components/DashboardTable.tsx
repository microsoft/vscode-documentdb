/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createTableColumn,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    useTableColumnSizing_unstable,
    useTableFeatures,
    type TableColumnDefinition,
    type TableColumnSizingOptions,
} from '@fluentui/react-components';
import { useMemo, type JSX, type ReactNode } from 'react';
import { type SortDirection } from '../types';

/** Column descriptor for {@link DashboardTable}. */
export interface DashboardColumn<TRow> {
    /** Stable column identifier, also used as the sort key. */
    columnId: string;
    /** Localised header label. */
    label: string;
    /** Cell content alignment. Defaults to `start`. */
    align?: 'start' | 'center' | 'end';
    /** Whether the column header is clickable to sort. Defaults to `false`. */
    sortable?: boolean;
    /**
     * Ideal/default column width in pixels. Drives Fluent's column-sizing
     * feature so columns stay a fixed width instead of stretching to fill the
     * editor. Keeping these consistent across the database and collection
     * tables makes both views look identical regardless of column count.
     */
    width?: number;
    /** Minimum column width in pixels. Defaults to `80`. */
    minWidth?: number;
    /** Renders the cell content for a row. */
    render: (row: TRow) => ReactNode;
    /**
     * When true, the cell shows a spinner instead of `render(row)` while the
     * row's metrics are still loading. Used for the streamed metric columns.
     */
    showSpinnerWhileLoading?: boolean;
}

export interface DashboardTableProps<TRow> {
    ariaLabel: string;
    columns: ReadonlyArray<DashboardColumn<TRow>>;
    rows: ReadonlyArray<TRow>;
    getRowKey: (row: TRow) => string;
    /** True while the given row's streamed metrics are still loading. */
    isRowLoading: (row: TRow) => boolean;
    sortColumn: string;
    sortDirection: SortDirection;
    onToggleSort: (columnId: string) => void;
    /** Invoked when a row is activated (click / Enter / Space) for drill-in. */
    onRowActivate?: (row: TRow) => void;
}

/** Default minimum width applied to columns that don't specify one. */
const DEFAULT_MIN_WIDTH = 80;

/**
 * Generic sortable, zebra-striped dashboard table built on Fluent UI table
 * primitives. Rendering of sort state and cell alignment is driven entirely by
 * the {@link DashboardColumn} descriptors so the database overview and the
 * collection drill-in can share one implementation.
 *
 * Column widths are applied through Fluent's column-sizing feature so columns
 * keep a fixed width rather than each ballooning to an even share of the editor
 * width — this keeps the database and collection tables visually consistent
 * regardless of how many columns each has.
 *
 * The component is presentational: callers pass already-filtered, already-sorted
 * rows and own the sort state. Header clicks call `onToggleSort`.
 */
export function DashboardTable<TRow>({
    ariaLabel,
    columns,
    rows,
    getRowKey,
    isRowLoading,
    sortColumn,
    sortDirection,
    onToggleSort,
    onRowActivate,
}: DashboardTableProps<TRow>): JSX.Element {
    const interactive = onRowActivate !== undefined;

    const tableColumns = useMemo<TableColumnDefinition<TRow>[]>(
        () => columns.map((col) => createTableColumn<TRow>({ columnId: col.columnId })),
        [columns],
    );

    const columnSizingOptions = useMemo<TableColumnSizingOptions>(() => {
        const options: TableColumnSizingOptions = {};
        for (const col of columns) {
            if (col.width !== undefined) {
                options[col.columnId] = {
                    idealWidth: col.width,
                    defaultWidth: col.width,
                    minWidth: col.minWidth ?? DEFAULT_MIN_WIDTH,
                };
            }
        }
        return options;
    }, [columns]);

    const { columnSizing_unstable, tableRef } = useTableFeatures<TRow>(
        { columns: tableColumns, items: rows as TRow[] },
        [useTableColumnSizing_unstable({ columnSizingOptions, autoFitColumns: false })],
    );

    return (
        <Table
            aria-label={ariaLabel}
            size="small"
            className="dashboardTable"
            sortable
            ref={tableRef}
            {...columnSizing_unstable.getTableProps()}
        >
            <TableHeader>
                <TableRow>
                    {columns.map((col) => (
                        <TableHeaderCell
                            key={col.columnId}
                            {...columnSizing_unstable.getTableHeaderCellProps(col.columnId)}
                            className={`cell-${col.align ?? 'start'}`}
                            sortDirection={col.sortable && sortColumn === col.columnId ? sortDirection : undefined}
                            onClick={col.sortable ? () => onToggleSort(col.columnId) : undefined}
                            aria-sort={col.sortable && sortColumn === col.columnId ? sortDirection : undefined}
                        >
                            {col.label}
                        </TableHeaderCell>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map((row, rowIdx) => {
                    const rowClass = rowIdx % 2 === 0 ? 'rowEven' : 'rowOdd';
                    const loading = isRowLoading(row);
                    return (
                        <TableRow
                            key={getRowKey(row)}
                            className={`${rowClass}${interactive ? ' interactiveRow' : ''}`}
                            onClick={interactive ? () => onRowActivate?.(row) : undefined}
                            onKeyDown={
                                interactive
                                    ? (event) => {
                                          if (event.key === 'Enter' || event.key === ' ') {
                                              event.preventDefault();
                                              onRowActivate?.(row);
                                          }
                                      }
                                    : undefined
                            }
                            tabIndex={interactive ? 0 : undefined}
                            role={interactive ? 'button' : undefined}
                        >
                            {columns.map((col) => (
                                <TableCell
                                    key={col.columnId}
                                    {...columnSizing_unstable.getTableCellProps(col.columnId)}
                                    className={`cell-${col.align ?? 'start'}`}
                                >
                                    {col.showSpinnerWhileLoading && loading ? (
                                        <Spinner size="tiny" aria-label={col.label} />
                                    ) : (
                                        <TableCellLayout truncate>{col.render(row)}</TableCellLayout>
                                    )}
                                </TableCell>
                            ))}
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}
