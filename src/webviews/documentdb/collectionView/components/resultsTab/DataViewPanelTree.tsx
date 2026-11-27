/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import * as l10n from '@vscode/l10n';
import { ChevronRight12Regular } from '@fluentui/react-icons';
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
import { useTreeRows } from './useTreeRows';
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
                                className="treeExpanderButton"
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
                                    event.currentTarget.closest<HTMLElement>('[role="gridcell"]')?.focus();
                                    gridRef.current?.setActivePosition(
                                        { rowIdx, idx: 0 },
                                        { shouldFocus: true },
                                    );
                                    setExpanded(row, !expandedKeys.has(row.key));
                                }}
                            >
                                <ChevronRight12Regular
                                    className="treeExpanderIcon"
                                    aria-hidden="true"
                                />
                            </button>
                        ) : (
                            <span className="treeExpanderSlot" aria-hidden="true" />
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
        setActivePosition: DataGridHandle['setActivePosition'],
        event: React.KeyboardEvent<HTMLDivElement>,
    ): void {
        if (event.target !== event.currentTarget) {
            return;
        }
        // RDG's treegrid Left boundary otherwise selects the whole row (idx: -1).
        if (event.key === 'ArrowLeft') {
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (
            event.key !== 'Enter' ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey
        ) {
            return;
        }

        event.stopPropagation();
        event.preventDefault();
        if (row.expandable && !event.repeat) {
            setActivePosition({ rowIdx, idx: 0 }, { shouldFocus: true });
            setExpanded(row, !expandedKeys.has(row.key));
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
                            if (!event.defaultPrevented && event.target === event.currentTarget) {
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
                    />
                ),
            }}
        />
    );
};
