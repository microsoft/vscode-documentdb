/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { DataGrid, Row, type Column, type DataGridHandle, type DefaultColumnOptions } from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import * as l10n from '@vscode/l10n';
import {
    getCell,
    type ColumnKey,
    type TablePage,
    type TableRow,
} from '../../../../../utils/documentGrid/types';
import { CollectionViewContext } from '../../collectionViewContext';
import { LoadingAnimationTable } from './LoadingAnimationTable';
import { TypedValueCell } from './TypedValueCell';
import './dataGridTheme.scss';
import './dataViewPanelTable.scss';

interface DataViewPanelTableProps {
    readonly page: TablePage | undefined;
    readonly selectedRowKeys: readonly string[];
    readonly onSelectedRowKeysChange: (rowKeys: readonly string[]) => void;
    readonly onStepIn: (rowKey: string, columnKey: ColumnKey) => void;
}

const defaultColumnOptions: DefaultColumnOptions<TableRow, unknown> = {
    resizable: true,
};

export function DataViewPanelTable({
    page,
    selectedRowKeys,
    onSelectedRowKeysChange,
    onStepIn,
}: DataViewPanelTableProps): React.JSX.Element {
    const [currentContext] = React.useContext(CollectionViewContext);
    const gridRef = React.useRef<DataGridHandle>(null);
    const anchorRef = React.useRef<string | undefined>(undefined);
    const selectionScopeRef = React.useRef({
        query: currentContext.activeQuery,
        path: page?.path,
    });
    if (
        selectionScopeRef.current.query !== currentContext.activeQuery ||
        selectionScopeRef.current.path !== page?.path
    ) {
        selectionScopeRef.current = { query: currentContext.activeQuery, path: page?.path };
        anchorRef.current = undefined;
    }
    const selectedRows = React.useMemo(() => new Set(selectedRowKeys), [selectedRowKeys]);
    React.useEffect(() => (): void => onSelectedRowKeysChange([]), [onSelectedRowKeysChange]);

    function selectRow(row: TableRow, gesture: 'replace' | 'toggle' | 'extend'): void {
        const rows = page?.rows;
        if (!rows || !rows.includes(row)) {
            return;
        }
        const next = new Set(selectedRowKeys);
        if (gesture === 'extend') {
            const anchorIndex = rows.findIndex((candidate) => candidate.rowKey === anchorRef.current);
            const rowIndex = rows.indexOf(row);
            if (anchorIndex === -1) {
                anchorRef.current = row.rowKey;
                next.add(row.rowKey);
            } else {
                const range = rows.slice(Math.min(anchorIndex, rowIndex), Math.max(anchorIndex, rowIndex) + 1);
                for (const candidate of range) {
                    next.add(candidate.rowKey);
                }
            }
        } else {
            anchorRef.current = row.rowKey;
            if (gesture === 'replace') {
                next.clear();
                next.add(row.rowKey);
            } else if (!next.delete(row.rowKey)) {
                next.add(row.rowKey);
            }
        }
        onSelectedRowKeysChange([...next]);
    }

    function handleRowKeyDown(row: TableRow, event: React.KeyboardEvent<HTMLDivElement>): void {
        if (event.key !== ' ' && event.key !== 'Enter') {
            return;
        }
        event.stopPropagation();
        if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !(event.target instanceof HTMLElement) ||
            event.target.getAttribute('role') !== 'gridcell' ||
            event.target.parentElement !== event.currentTarget
        ) {
            return;
        }
        event.preventDefault();
        if (!event.repeat) {
            const columnIndex = Number(event.target.getAttribute('aria-colindex')) - 1;
            const rowIndex = page?.rows.indexOf(row) ?? -1;
            const columnKey = page?.columns[columnIndex]?.key;
            if (
                rowIndex === -1 ||
                !Number.isInteger(columnIndex) ||
                columnIndex < 0 ||
                columnKey === undefined
            ) {
                return;
            }
            // RDG's active position can lag direct focus, so sync it from the actual focused cell.
            gridRef.current?.setActivePosition({ idx: columnIndex, rowIdx: rowIndex }, { shouldFocus: false });
            if (event.key === 'Enter') {
                if (!event.shiftKey) {
                    onStepIn(row.rowKey, columnKey);
                }
            } else {
                selectRow(row, event.shiftKey ? 'extend' : 'toggle');
            }
        }
    }

    const columns = React.useMemo<readonly Column<TableRow>[]>(
        () =>
            (page?.columns ?? []).map(
                (column): Column<TableRow> => ({
                    key: column.key,
                    name: column.label,
                    renderCell: ({ row }): React.ReactNode => (
                        <TypedValueCell value={getCell(row, column.key)} isRootId={column.isRootId} />
                    ),
                }),
            ),
        [page?.columns],
    );

    if (currentContext.isFirstTimeLoad) {
        return <LoadingAnimationTable />;
    }

    return (
        <DataGrid
            ref={gridRef}
            aria-label={l10n.t('Table View')}
            className="documentDataGrid dataViewPanelTable"
            columns={columns}
            defaultColumnOptions={defaultColumnOptions}
            getRowKey={(row): string => row.rowKey}
            rows={page?.rows ?? []}
            selectedRows={selectedRows}
            onSelectedRowsChange={(rowKeys): void => onSelectedRowKeysChange([...rowKeys])}
            onCellClick={({ row }, event): void => {
                if (event.defaultPrevented || event.button !== 0 || event.altKey) {
                    return;
                }
                if (event.shiftKey) {
                    selectRow(row, 'extend');
                } else {
                    selectRow(row, event.ctrlKey || event.metaKey ? 'toggle' : 'replace');
                }
            }}
            onCellDoubleClick={({ column, row }, event): void => {
                if (event.defaultPrevented || event.button !== 0) {
                    return;
                }
                const columnKey = page?.columns.find((candidate) => candidate.key === column.key)?.key;
                if (columnKey !== undefined) {
                    onStepIn(row.rowKey, columnKey);
                }
            }}
            renderers={{
                renderRow: (key, props): React.JSX.Element => (
                    <Row key={key} {...props} onKeyDown={(event): void => handleRowKeyDown(props.row, event)} />
                ),
            }}
        />
    );
}
