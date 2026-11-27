/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as l10n from '@vscode/l10n';
import {
    Cell,
    DataGrid,
    Row,
    type Column,
    type DataGridHandle,
} from 'react-data-grid';
import 'react-data-grid/lib/styles.css';
import { type TreeNode } from '../../../../../utils/documentGrid/types';
import { bsonStringToDisplayString } from '../../../../utils/documentGrid/typeToDisplayString';
import { getTreeKeyAction, useTreeRows } from './useTreeRows';
import './dataGridTheme.scss';

interface DataViewPanelTreeProps {
    readonly nodes: readonly TreeNode[];
}

export const DataViewPanelTree = ({ nodes }: DataViewPanelTreeProps): React.JSX.Element => {
    const gridRef = React.useRef<DataGridHandle>(null);
    const { rows, expandedKeys, setExpanded } = useTreeRows(nodes);
    const columns = React.useMemo<readonly Column<TreeNode>[]>(
        (): readonly Column<TreeNode>[] => [
            {
                key: 'field',
                name: l10n.t('Field'),
                renderCell: ({ row, rowIdx }): React.ReactNode => (
                    <>
                        <span aria-hidden="true">{'\u00a0\u00a0'.repeat(row.depth)}</span>
                        {row.expandable ? (
                            <button
                                type="button"
                                tabIndex={-1}
                                aria-label={
                                    expandedKeys.has(row.key)
                                        ? l10n.t('Collapse fields for {0}', row.field)
                                        : l10n.t('Expand fields for {0}', row.field)
                                }
                                aria-expanded={expandedKeys.has(row.key)}
                                onMouseDown={(event): void => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                }}
                                onClick={(event): void => {
                                    event.stopPropagation();
                                    // Focus the surviving cell before hiding any active descendant.
                                    gridRef.current?.setActivePosition(
                                        { rowIdx, idx: 0 },
                                        { shouldFocus: true },
                                    );
                                    setExpanded(row, !expandedKeys.has(row.key));
                                }}
                            >
                                <span aria-hidden="true">{expandedKeys.has(row.key) ? '▾' : '▸'}</span>
                            </button>
                        ) : (
                            <span aria-hidden="true">{'\u00a0\u00a0'}</span>
                        )}
                        {row.field}
                    </>
                ),
            },
            {
                key: 'value',
                name: l10n.t('Value'),
                renderCell: ({ row }): string => row.value.display,
            },
            {
                key: 'type',
                name: l10n.t('Type'),
                renderCell: ({ row }): string =>
                    row.depth === 0 ? l10n.t('Document') : bsonStringToDisplayString(row.value.type),
            },
        ],
        [expandedKeys, setExpanded],
    );

    function onTreeKeyDown(
        row: TreeNode,
        rowIdx: number,
        idx: number,
        setActivePosition: DataGridHandle['setActivePosition'],
        event: React.KeyboardEvent<HTMLDivElement>,
    ): void {
        if (
            (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
        ) {
            return;
        }

        const action = getTreeKeyAction(rows, row, expandedKeys, event.key);
        if (!action) {
            return;
        }
        // Handle the focused row locally, before RDG can use a stale active position.
        event.stopPropagation();
        event.preventDefault();
        if (action.type === 'focus') {
            const targetRowIdx = rows.findIndex((node): boolean => node.key === action.key);
            if (targetRowIdx >= 0) {
                setActivePosition(
                    { rowIdx: targetRowIdx, idx },
                    { shouldFocus: true },
                );
            }
        } else {
            setActivePosition({ rowIdx, idx }, { shouldFocus: true });
            setExpanded(row, action.type === 'expand');
        }
    }

    return (
        <DataGrid
            ref={gridRef}
            role="treegrid"
            aria-label={l10n.t('Tree View')}
            className="documentDataGrid"
            columns={columns}
            rows={rows}
            getRowKey={(row): string => row.key}
            defaultColumnOptions={{ minWidth: 100, resizable: true }}
            renderers={{
                // Name the Field cell from its value, not its nested expander's action label.
                renderCell: (key, props): React.ReactNode => (
                    <Cell
                        key={key}
                        {...props}
                        aria-label={props.column.key === 'field' ? props.row.field : undefined}
                        onFocusCapture={(event): void => {
                            props.onFocusCapture?.(event);
                            if (!event.defaultPrevented) {
                                // Keep Cell's own bubbling onFocus for native roving focus.
                                props.setActivePosition({ rowIdx: props.rowIdx, idx: props.column.idx });
                            }
                        }}
                        onKeyDown={(event): void => {
                            props.onKeyDown?.(event);
                            if (!event.defaultPrevented && props.column.key === 'field') {
                                onTreeKeyDown(
                                    props.row,
                                    props.rowIdx,
                                    props.column.idx,
                                    props.setActivePosition,
                                    event,
                                );
                            }
                        }}
                    />
                ),
                renderRow: (key, props): React.ReactNode => (
                    <Row
                        key={key}
                        {...props}
                        aria-level={props.row.depth + 1}
                        aria-expanded={props.row.expandable ? expandedKeys.has(props.row.key) : undefined}
                        onFocusCapture={(event): void => {
                            props.onFocusCapture?.(event);
                            if (!event.defaultPrevented && event.target === event.currentTarget) {
                                props.setActivePosition({ rowIdx: props.rowIdx, idx: -1 });
                            }
                        }}
                        onKeyDown={(event): void => {
                            props.onKeyDown?.(event);
                            if (!event.defaultPrevented && event.target === event.currentTarget) {
                                onTreeKeyDown(
                                    props.row,
                                    props.rowIdx,
                                    -1,
                                    props.setActivePosition,
                                    event,
                                );
                            }
                        }}
                    />
                ),
            }}
        />
    );
};
