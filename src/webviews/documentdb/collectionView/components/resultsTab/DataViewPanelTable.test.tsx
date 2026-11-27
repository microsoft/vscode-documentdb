/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// @vitest-environment jsdom

import { act, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client'; // eslint-disable-line import/no-internal-modules
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Column, DataGridHandle, DataGridProps, RenderRowProps } from 'react-data-grid';
import {
    fieldColumnKey,
    getCell,
    ROOT_ID_COLUMN_KEY,
    type ColumnKey,
    type TablePage,
    type TableRow,
} from '../../../../../utils/documentGrid/types';
import { CollectionViewContext, DefaultCollectionViewContext } from '../../collectionViewContext';
import { DataViewPanelTable, type DataViewPanelTableFocusRequest } from './DataViewPanelTable';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rdg = vi.hoisted(() => ({
    setActivePosition: vi.fn(),
}));

vi.mock('@vscode/l10n', () => ({ t: (message: string): string => message }));
vi.mock('react-data-grid', async () => {
    const React = await import('react');

    const Row = ({
        children,
        onKeyDown,
    }: {
        readonly children: ReactNode;
        readonly onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
    }): React.JSX.Element => <div role="row" onKeyDown={onKeyDown}>{children}</div>;

    const DataGrid = React.forwardRef<DataGridHandle, DataGridProps<TableRow>>(function MockDataGrid(props, ref) {
        const elementRef = React.useRef<HTMLDivElement>(null);
        React.useImperativeHandle(ref, (): DataGridHandle => ({
            element: elementRef.current,
            scrollToCell: vi.fn(),
            setActivePosition: rdg.setActivePosition,
        }));
        const leafColumns = props.columns.map((column): Column<TableRow> => {
            if (!('key' in column)) {
                throw new Error('Unexpected column group in DataViewPanelTable');
            }
            return column;
        });

        return (
            <div ref={elementRef} role="grid">
                {props.rows.map((row, rowIdx) => {
                    const children = leafColumns.map((column, columnIdx) => (
                        <button
                            key={String(column.key)}
                            type="button"
                            role="gridcell"
                            aria-colindex={columnIdx + 1}
                            onDoubleClick={(event): void => {
                                const args = {
                                    row,
                                    column: { ...column, idx: columnIdx },
                                } as Parameters<NonNullable<DataGridProps<TableRow>['onCellDoubleClick']>>[0];
                                props.onCellDoubleClick?.(
                                    args,
                                    event as unknown as Parameters<
                                        NonNullable<DataGridProps<TableRow>['onCellDoubleClick']>
                                    >[1],
                                );
                            }}
                        >
                            {getCell(row, column.key as ColumnKey)?.display ?? ''}
                        </button>
                    ));
                    const rowProps = { row, rowIdx, children } as unknown as RenderRowProps<TableRow, unknown>;
                    return props.renderers?.renderRow?.(row.rowKey, rowProps);
                })}
            </div>
        );
    });

    return {
        Cell: ({ children }: { readonly children?: ReactNode }): React.JSX.Element => <div>{children}</div>,
        DataGrid,
        Row,
    };
});

const idColumn = { key: ROOT_ID_COLUMN_KEY, label: '_id' } as const;
const detailsColumn = { key: fieldColumnKey('details'), label: 'details' } as const;

function page(rows: readonly TableRow[], path: readonly string[] = ['details']): TablePage {
    return {
        path,
        columns: [idColumn, detailsColumn],
        rows,
    };
}

const firstRow: TableRow = {
    rowKey: 'id:"first"',
    documentId: '"first"',
    cells: {
        [ROOT_ID_COLUMN_KEY]: { display: 'first', type: 'string' },
        [detailsColumn.key]: { display: '{...}', type: 'object' },
    },
};
const positionalRow: TableRow = {
    rowKey: 'pos:0',
    cells: {
        [detailsColumn.key]: { display: '{...}', type: 'object' },
    },
};

let host: HTMLDivElement;
let root: Root;

async function render(
    currentPage: TablePage,
    focusRequest?: DataViewPanelTableFocusRequest,
    onStepIn: (rowKey: string, columnKey: TablePage['columns'][number]['key'], gesture: 'keyboard' | 'pointer') => void =
        vi.fn(),
    onSelectedRowKeysChange: (rowKeys: readonly string[]) => void = vi.fn(),
): Promise<void> {
    await act(async () => {
        root.render(
            <CollectionViewContext.Provider
                value={[{ ...DefaultCollectionViewContext, isFirstTimeLoad: false }, vi.fn()]}
            >
                <DataViewPanelTable
                    page={currentPage}
                    selectedRowKeys={[]}
                    onSelectedRowKeysChange={onSelectedRowKeysChange}
                    onStepIn={onStepIn}
                    focusRequest={focusRequest}
                />
            </CollectionViewContext.Provider>,
        );
    });
}

function gridCell(name: string): HTMLElement {
    const cell = [...host.querySelectorAll<HTMLElement>('[role="gridcell"]')].find(
        (candidate): boolean => candidate.textContent === name,
    );
    if (!cell) {
        throw new Error(`Missing grid cell: ${name}`);
    }
    return cell;
}

beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    rdg.setActivePosition.mockReset();
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});

describe('TDD: DataViewPanelTable keyboard step-in focus', (): void => {
    it('settles a matching page once by row key after reordering and for positional rows', async (): Promise<void> => {
        const reordered = page([firstRow, positionalRow]);
        const request = { page: reordered, rowKey: positionalRow.rowKey };
        await render(reordered);
        gridCell('first').focus();
        await render(reordered, request);

        expect(rdg.setActivePosition).toHaveBeenCalledTimes(1);
        expect(rdg.setActivePosition).toHaveBeenCalledWith({ idx: 0, rowIdx: 1 }, { shouldFocus: true });

        await render(reordered, request);
        expect(rdg.setActivePosition).toHaveBeenCalledTimes(1);
    });

    it('suppresses stale page, missing row and outside-focus requests without changing selection', async (): Promise<void> => {
        const selected = vi.fn();
        const current = page([firstRow]);
        const stale = page([firstRow], []);
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        outside.focus();
        await render(current, { page: stale, rowKey: firstRow.rowKey }, vi.fn(), selected);
        await render(current, { page: current, rowKey: 'missing' }, vi.fn(), selected);
        await render(current, { page: current, rowKey: firstRow.rowKey }, vi.fn(), selected);
        outside.remove();

        expect(rdg.setActivePosition).not.toHaveBeenCalled();
        expect(selected).not.toHaveBeenCalled();
    });

    it('allows focus restoration from body and preserves the no-selection side effect', async (): Promise<void> => {
        const selected = vi.fn();
        const current = page([firstRow]);
        (document.activeElement as HTMLElement | null)?.blur();
        await render(current, { page: current, rowKey: firstRow.rowKey }, vi.fn(), selected);

        expect(rdg.setActivePosition).toHaveBeenCalledWith({ idx: 0, rowIdx: 0 }, { shouldFocus: true });
        expect(selected).not.toHaveBeenCalled();
    });

    it('distinguishes keyboard and pointer step-in gestures', async (): Promise<void> => {
        const onStepIn = vi.fn();
        await render(page([firstRow]), undefined, onStepIn);
        const objectCell = gridCell('{...}');
        objectCell.focus();

        await act(async () => {
            objectCell.dispatchEvent(
                new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
            );
            objectCell.dispatchEvent(new MouseEvent('dblclick', { button: 0, bubbles: true, cancelable: true }));
        });

        expect(onStepIn).toHaveBeenNthCalledWith(1, firstRow.rowKey, detailsColumn.key, 'keyboard');
        expect(onStepIn).toHaveBeenNthCalledWith(2, firstRow.rowKey, detailsColumn.key, 'pointer');
    });
});
