/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    createTableColumn,
    Table,
    TableBody,
    TableCell,
    TableCellLayout,
    TableHeader,
    TableHeaderCell,
    TableRow,
    Tooltip,
    useTableColumnSizing_unstable,
    useTableFeatures,
    type TableColumnDefinition,
    type TableColumnSizingOptions,
} from '@fluentui/react-components';
import {
    ChevronDownRegular,
    ChevronRightRegular,
    DeleteRegular,
    EyeOffRegular,
    EyeRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, useState, type JSX } from 'react';
import { type IndexRow } from '../types';
import { formatBytes, formatDate, formatOps, formatSinceTooltip } from '../utils/format';
import { classifyIndex } from '../utils/indexType';
import { IndexTypeBadgeView } from './IndexTypeBadgeView';

export interface IndexTableProps {
    indexes: ReadonlyArray<IndexRow>;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
}

/**
 * Translate the wire-level direction value into a human-readable label.
 * Numeric directions (±1) become "asc"/"desc"; string sentinels like
 * "text" / "2dsphere" pass through unchanged.
 */
function formatDirection(direction: number | string): string {
    if (direction === 1) return l10n.t('asc');
    if (direction === -1) return l10n.t('desc');
    return String(direction);
}

/**
 * Stable column identifiers used by Fluent's column-sizing feature.
 * Keep these in sync with the header and body cell ordering below.
 */
const COLUMN_IDS = {
    expand: 'expand',
    name: 'name',
    type: 'type',
    memory: 'memory',
    usage: 'usage',
    notes: 'notes',
    actions: 'actions',
} as const;

// Static column definitions for `useTableFeatures`. The `items` array we
// pass to the hook is unused for rendering (we still render manually so we
// can interleave the expanded detail rows), but the hook requires the
// shape to derive column-sizing state.
const COLUMNS: TableColumnDefinition<IndexRow>[] = [
    createTableColumn<IndexRow>({ columnId: COLUMN_IDS.expand }),
    createTableColumn<IndexRow>({ columnId: COLUMN_IDS.name }),
    createTableColumn<IndexRow>({ columnId: COLUMN_IDS.type }),
    createTableColumn<IndexRow>({ columnId: COLUMN_IDS.memory }),
    createTableColumn<IndexRow>({ columnId: COLUMN_IDS.usage }),
    createTableColumn<IndexRow>({ columnId: COLUMN_IDS.notes }),
    createTableColumn<IndexRow>({ columnId: COLUMN_IDS.actions }),
];

// Initial widths in pixels. `minWidth` guards against users collapsing a
// column past usability; `idealWidth` is the default each column starts at.
const COLUMN_SIZING_OPTIONS: TableColumnSizingOptions = {
    [COLUMN_IDS.expand]: { idealWidth: 36, minWidth: 32, defaultWidth: 36 },
    [COLUMN_IDS.name]: { idealWidth: 320, minWidth: 120, defaultWidth: 320 },
    [COLUMN_IDS.type]: { idealWidth: 140, minWidth: 100, defaultWidth: 140 },
    [COLUMN_IDS.memory]: { idealWidth: 110, minWidth: 80, defaultWidth: 110 },
    [COLUMN_IDS.usage]: { idealWidth: 110, minWidth: 80, defaultWidth: 110 },
    [COLUMN_IDS.notes]: { idealWidth: 220, minWidth: 100, defaultWidth: 220 },
    [COLUMN_IDS.actions]: { idealWidth: 110, minWidth: 90, defaultWidth: 110 },
};

export const IndexTable = ({ indexes, onDelete, onToggleHidden }: IndexTableProps): JSX.Element => {
    // Set of currently-expanded index names. Kept in component state so
    // expansion survives table re-renders driven by data refresh.
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

    // Wire up Fluent's column-sizing feature. `getRows` is unused here
    // because we render rows manually to support the expand/detail UX.
    const { columnSizing_unstable, tableRef } = useTableFeatures({ columns: COLUMNS, items: indexes as IndexRow[] }, [
        useTableColumnSizing_unstable({ columnSizingOptions: COLUMN_SIZING_OPTIONS, autoFitColumns: false }),
    ]);

    const toggleExpanded = (name: string): void => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(name)) {
                next.delete(name);
            } else {
                next.add(name);
            }
            return next;
        });
    };

    return (
        <Table
            aria-label={l10n.t('Indexes')}
            size="small"
            className="indexTable"
            sortable={false}
            ref={tableRef}
            {...columnSizing_unstable.getTableProps()}
        >
            <TableHeader>
                <TableRow>
                    {/* Empty header above the expand-chevron column */}
                    <TableHeaderCell
                        {...columnSizing_unstable.getTableHeaderCellProps(COLUMN_IDS.expand)}
                        className="expandHeaderCell"
                        aria-label={l10n.t('Expand row')}
                    />
                    {/* Name column is intentionally wide — real-world index names can be 80+ chars */}
                    <TableHeaderCell
                        {...columnSizing_unstable.getTableHeaderCellProps(COLUMN_IDS.name)}
                        className="nameHeaderCell"
                    >
                        {l10n.t('Name')}
                    </TableHeaderCell>
                    <TableHeaderCell {...columnSizing_unstable.getTableHeaderCellProps(COLUMN_IDS.type)}>
                        {l10n.t('Type')}
                    </TableHeaderCell>
                    <TableHeaderCell {...columnSizing_unstable.getTableHeaderCellProps(COLUMN_IDS.memory)}>
                        {l10n.t('Memory')}
                    </TableHeaderCell>
                    <TableHeaderCell
                        {...columnSizing_unstable.getTableHeaderCellProps(COLUMN_IDS.usage)}
                        className="usageCell"
                    >
                        {l10n.t('Usage')}
                    </TableHeaderCell>
                    <TableHeaderCell {...columnSizing_unstable.getTableHeaderCellProps(COLUMN_IDS.notes)}>
                        {l10n.t('Notes')}
                    </TableHeaderCell>
                    <TableHeaderCell {...columnSizing_unstable.getTableHeaderCellProps(COLUMN_IDS.actions)}>
                        {l10n.t('Actions')}
                    </TableHeaderCell>
                </TableRow>
            </TableHeader>
            <TableBody>
                {indexes.map((idx, rowIdx) => {
                    const badge = classifyIndex(idx);
                    const isProtected = idx.isDefault;
                    const isExpanded = expanded.has(idx.name);
                    // Compute zebra parity from the data index (not the DOM
                    // position) so an inserted detail row never breaks the
                    // alternating pattern.
                    const rowClass = rowIdx % 2 === 0 ? 'rowEven' : 'rowOdd';
                    return (
                        <Fragment key={idx.name}>
                            <TableRow key={idx.name} className={rowClass}>
                                <TableCell
                                    {...columnSizing_unstable.getTableCellProps(COLUMN_IDS.expand)}
                                    className="expandCell"
                                >
                                    {/*
                                     * Per-row expand toggle. Mirrors the Results-tab tree-view
                                     * chevron so users get a familiar interaction for drilling
                                     * into the index's underlying field/direction list.
                                     */}
                                    <Button
                                        appearance="subtle"
                                        size="small"
                                        aria-label={
                                            isExpanded
                                                ? l10n.t('Collapse fields for {0}', idx.name)
                                                : l10n.t('Expand fields for {0}', idx.name)
                                        }
                                        aria-expanded={isExpanded}
                                        icon={isExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
                                        onClick={() => toggleExpanded(idx.name)}
                                    />
                                </TableCell>
                                <TableCell
                                    {...columnSizing_unstable.getTableCellProps(COLUMN_IDS.name)}
                                    className="nameCell"
                                >
                                    <TableCellLayout truncate>{idx.name}</TableCellLayout>
                                </TableCell>
                                <TableCell {...columnSizing_unstable.getTableCellProps(COLUMN_IDS.type)}>
                                    <IndexTypeBadgeView type={badge} />
                                </TableCell>
                                <TableCell {...columnSizing_unstable.getTableCellProps(COLUMN_IDS.memory)}>
                                    {formatBytes(idx.sizeBytes)}
                                </TableCell>
                                <TableCell
                                    {...columnSizing_unstable.getTableCellProps(COLUMN_IDS.usage)}
                                    className="usageCell"
                                >
                                    <Tooltip
                                        content={formatSinceTooltip(idx.usageSince)}
                                        relationship="description"
                                        withArrow
                                    >
                                        <span>{formatOps(idx.usageOps)}</span>
                                    </Tooltip>
                                </TableCell>
                                <TableCell {...columnSizing_unstable.getTableCellProps(COLUMN_IDS.notes)}>
                                    <TableCellLayout truncate>{idx.notes ?? ''}</TableCellLayout>
                                </TableCell>
                                <TableCell {...columnSizing_unstable.getTableCellProps(COLUMN_IDS.actions)}>
                                    <div className="actionsCell">
                                        <Tooltip
                                            content={
                                                isProtected
                                                    ? l10n.t('The default index cannot be deleted')
                                                    : l10n.t('Delete index')
                                            }
                                            relationship="description"
                                            withArrow
                                        >
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={<DeleteRegular />}
                                                aria-label={l10n.t('Delete index {0}', idx.name)}
                                                disabled={isProtected}
                                                onClick={() => onDelete(idx)}
                                            />
                                        </Tooltip>
                                        <Tooltip
                                            content={
                                                isProtected
                                                    ? l10n.t('The default index cannot be hidden')
                                                    : idx.hidden
                                                      ? l10n.t('Unhide index')
                                                      : l10n.t('Hide index')
                                            }
                                            relationship="description"
                                            withArrow
                                        >
                                            <Button
                                                appearance="subtle"
                                                size="small"
                                                icon={idx.hidden ? <EyeRegular /> : <EyeOffRegular />}
                                                aria-label={
                                                    idx.hidden
                                                        ? l10n.t('Unhide index {0}', idx.name)
                                                        : l10n.t('Hide index {0}', idx.name)
                                                }
                                                disabled={isProtected}
                                                onClick={() => onToggleHidden(idx)}
                                            />
                                        </Tooltip>
                                    </div>
                                </TableCell>
                            </TableRow>
                            {isExpanded && (
                                // The expanded sub-row spans every column and renders a
                                // small inline grid of (field, direction) pairs. Kept
                                // light-weight on purpose — most indexes have <10 keys.
                                // Reuse the parent row's zebra class so the detail row
                                // visually belongs to it.
                                <TableRow key={`${idx.name}-fields`} className={`fieldsDetailRow ${rowClass}`}>
                                    <TableCell colSpan={7} className="fieldsDetailCell">
                                        <div className="fieldsDetailGrid" role="group" aria-label={l10n.t('Fields')}>
                                            <div className="fieldsDetailHeader">{l10n.t('Field')}</div>
                                            <div className="fieldsDetailHeader">{l10n.t('Order')}</div>
                                            {idx.key.map(({ field, direction }) => (
                                                <Fragment key={`${field}:${String(direction)}`}>
                                                    <div className="fieldsDetailField">{field}</div>
                                                    <div className="fieldsDetailDirection">
                                                        {formatDirection(direction)}
                                                    </div>
                                                </Fragment>
                                            ))}
                                        </div>
                                        {/*
                                         * "Created" lives in the detail panel rather than the
                                         * main row so the table stays compact; users still get
                                         * the timestamp by expanding the index.
                                         */}
                                        <div className="fieldsDetailMeta">
                                            <span className="fieldsDetailMetaLabel">{l10n.t('Created')}:</span>{' '}
                                            <span>{formatDate(idx.usageSince)}</span>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </Fragment>
                    );
                })}
            </TableBody>
        </Table>
    );
};
