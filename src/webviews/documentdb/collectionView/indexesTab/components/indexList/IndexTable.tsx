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
    useTableFeatures,
    useTableSort,
    type SortDirection,
    type TableColumnDefinition,
    type TableColumnId,
} from '@fluentui/react-components';
import {
    ChevronDownRegular,
    ChevronRightRegular,
    DeleteRegular,
    EyeOffRegular,
    EyeRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, useEffect, useRef, type JSX } from 'react';
import { type IndexRow } from '../../types';
import { formatBytes, formatOps } from '../../utils/format';
import { classifyIndex } from '../../utils/indexType';
import { vectorIndexSearchText } from '../../utils/vectorIndex';
import { IndexPropertiesView } from './IndexPropertiesView';
import { IndexRowDetails } from './IndexRowDetails';
import { IndexStatusIndicator } from './IndexStatusIndicator';
import { IndexTypeBadgeView } from './IndexTypeBadgeView';

/**
 * Controlled sort state ({@link SortDirection} + which column). Mirrors Fluent's
 * internal `SortState` shape but is owned by the parent so it survives the
 * table being unmounted (e.g. a manual refresh swaps in the skeleton).
 */
export interface IndexSortState {
    sortColumn: TableColumnId | undefined;
    sortDirection: SortDirection;
}

export interface IndexTableProps {
    indexes: ReadonlyArray<IndexRow>;
    /** Maximum known size across all indexes, used only for the relative-size visual. */
    maxSizeBytes?: number;
    /** Maximum known usage across all indexes, used only for the relative-usage visual. */
    maxUsageOps?: number;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
    /** Names of rows with an action in flight (delete / hide / unhide) — shown with a spinner. */
    busyNames?: ReadonlySet<string>;
    /** Name of a row to scroll into view once (only if it is off-screen). */
    scrollToName?: string;
    /**
     * Sort state, owned by the parent. Controlled (rather than internal to the
     * table) so a manual refresh — which swaps this table for a skeleton and
     * therefore unmounts it — does not silently reset the user's chosen sort.
     */
    sortState: IndexSortState;
    /** Notified when the user toggles a column's sort. */
    onSortChange: (next: IndexSortState) => void;
    /**
     * Names of currently-expanded rows, owned by the parent for the same
     * survive-a-refresh reason as {@link sortState}.
     */
    expanded: ReadonlySet<string>;
    /** Toggle a row's expanded state (parent owns the set). */
    onToggleExpanded: (name: string) => void;
}

const MIN_POSITIVE_BAR_PERCENT = 20;

function relativeBarWidth(value: number | undefined, maximum: number | undefined): string | undefined {
    if (value === undefined || maximum === undefined || !Number.isFinite(value) || maximum <= 0 || value < 0) {
        return undefined;
    }
    if (value === 0) {
        return '0%';
    }
    return `${Math.max(MIN_POSITIVE_BAR_PERCENT, (value / maximum) * 100)}%`;
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
    return (left ?? Number.NEGATIVE_INFINITY) - (right ?? Number.NEGATIVE_INFINITY);
}

function propertySortKey(index: IndexRow): string {
    return [
        index.hidden ? 'hidden' : '',
        index.unique ? 'unique' : '',
        index.sparse ? 'sparse' : '',
        index.expireAfterSeconds !== undefined ? 'ttl' : '',
        index.partialFilterExpression !== undefined ? 'partial' : '',
        index.collation !== undefined ? 'collation' : '',
        index.wildcardProjection !== undefined ? 'wildcard' : '',
        vectorIndexSearchText(index.vectorOptions),
    ]
        .filter(Boolean)
        .join(' ');
}

const columns: TableColumnDefinition<IndexRow>[] = [
    createTableColumn<IndexRow>({
        columnId: 'name',
        compare: (left, right) => left.name.localeCompare(right.name),
    }),
    createTableColumn<IndexRow>({
        columnId: 'type',
        compare: (left, right) => classifyIndex(left).localeCompare(classifyIndex(right)),
    }),
    createTableColumn<IndexRow>({
        columnId: 'properties',
        compare: (left, right) => propertySortKey(left).localeCompare(propertySortKey(right)),
    }),
    createTableColumn<IndexRow>({
        columnId: 'size',
        compare: (left, right) => compareOptionalNumbers(left.sizeBytes, right.sizeBytes),
    }),
    createTableColumn<IndexRow>({
        columnId: 'usage',
        compare: (left, right) => compareOptionalNumbers(left.usageOps, right.usageOps),
    }),
];

/**
 * Stable column identifiers, kept only for documentation / cell-class
 * alignment. Column widths are driven by the `<colgroup>` below plus CSS
 * (`table-layout: fixed`) so the table always fills the width it is given
 * and the name column absorbs any slack — no horizontal scrollbar.
 */

export const IndexTable = ({
    indexes,
    maxSizeBytes,
    maxUsageOps,
    onDelete,
    onToggleHidden,
    busyNames,
    scrollToName,
    sortState,
    onSortChange,
    expanded,
    onToggleExpanded,
}: IndexTableProps): JSX.Element => {
    // Sort and expansion state are controlled by the parent (see the prop docs):
    // a manual refresh unmounts this table for a skeleton, so keeping either here
    // would silently discard the user's sort/expanded rows on every refresh.
    const {
        getRows,
        sort: { getSortDirection, toggleColumnSort, sort },
    } = useTableFeatures({ columns, items: [...indexes] }, [
        useTableSort({
            sortState,
            onSortChange: (_event, next) => onSortChange(next),
        }),
    ]);
    const rows = sort(getRows());

    const headerSortProps = (columnId: TableColumnId) => ({
        onClick: (event: React.MouseEvent) => toggleColumnSort(event, columnId),
        sortDirection: getSortDirection(columnId),
    });

    // DOM refs per row so we can scroll a freshly-created index into view.
    const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
    // Guards against scrolling the same target more than once (e.g. on later
    // refreshes) so we never yank the viewport after the initial reveal.
    const lastScrolledRef = useRef<string | undefined>(undefined);

    // Scroll the requested row into view the first time it is available.
    // `block: 'nearest'` is a no-op when the row is already visible, so we never
    // yank a row that is already on screen.
    //
    // The scroll is deferred to after paint (with a one-frame retry) because the
    // target is usually a *just-inserted* optimistic row: on the render where
    // `scrollToName` first changes, that row may not be laid out at its final
    // (alphabetically-sorted) position yet — or its name may still be
    // reconciling to the server's — so an immediate `scrollIntoView` runs
    // against a stale layout and appears to do nothing.
    useEffect(() => {
        if (!scrollToName || scrollToName === lastScrolledRef.current) {
            return;
        }
        const target = scrollToName;
        let raf2 = 0;
        const scrollNow = (): boolean => {
            const el = rowRefs.current.get(target);
            if (!el) {
                return false;
            }
            lastScrolledRef.current = target;
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            return true;
        };
        const raf1 = requestAnimationFrame(() => {
            if (!scrollNow()) {
                // Row not mounted yet — try once more on the next frame.
                raf2 = requestAnimationFrame(scrollNow);
            }
        });
        return () => {
            cancelAnimationFrame(raf1);
            if (raf2) {
                cancelAnimationFrame(raf2);
            }
        };
    }, [scrollToName, indexes]);

    return (
        <Table aria-label={l10n.t('Indexes')} size="small" className="indexTable" sortable>
            <colgroup>
                <col className="colExpand" />
                <col className="colName" />
                <col className="colType" />
                <col className="colProperties" />
                <col className="colMemory" />
                <col className="colUsage" />
                <col className="colActions" />
            </colgroup>
            <TableHeader>
                <TableRow>
                    {/* Empty header above the expand-chevron column */}
                    <TableHeaderCell className="expandHeaderCell" aria-label={l10n.t('Expand row')} sortable={false} />
                    {/* Name column is intentionally wide — real-world index names can be 80+ chars */}
                    <TableHeaderCell className="nameHeaderCell" {...headerSortProps('name')}>
                        {l10n.t('Name')}
                    </TableHeaderCell>
                    <TableHeaderCell {...headerSortProps('type')}>{l10n.t('Type')}</TableHeaderCell>
                    <TableHeaderCell {...headerSortProps('properties')}>{l10n.t('Properties')}</TableHeaderCell>
                    <TableHeaderCell {...headerSortProps('size')}>{l10n.t('Size')}</TableHeaderCell>
                    <TableHeaderCell className="usageCell" {...headerSortProps('usage')}>
                        {l10n.t('Usage')}
                    </TableHeaderCell>
                    <TableHeaderCell sortable={false}>{l10n.t('Actions')}</TableHeaderCell>
                </TableRow>
            </TableHeader>
            <TableBody>
                {rows.map(({ item: idx }, rowIdx) => {
                    const badge = classifyIndex(idx);
                    const sizeBarWidth = relativeBarWidth(idx.sizeBytes, maxSizeBytes);
                    const usageBarWidth = relativeBarWidth(idx.usageOps, maxUsageOps);
                    const isProtected = idx.isDefault;
                    // Optimistic "Creating…" rows have no server-side index yet, so
                    // actions that operate on a live index are disabled.
                    const isPending = idx.state === 'creating';
                    const isExpanded = expanded.has(idx.name);
                    /*
                     * Zebra parity comes from the data index, not the DOM position, so an
                     * inserted detail row never breaks the alternating pattern. The colors
                     * (and the matching hover/pressed rules) live in indexesTab.scss.
                     */
                    const rowClass = rowIdx % 2 === 0 ? 'rowEven' : 'rowOdd';
                    // A delete / hide / unhide in flight shows a spinner in the
                    // status column (in place of the ready check) for this row.
                    const isBusy = busyNames?.has(idx.name) ?? false;
                    return (
                        <Fragment key={idx.name}>
                            <TableRow
                                key={idx.name}
                                className={rowClass}
                                ref={(el: HTMLTableRowElement | null) => {
                                    if (el) {
                                        rowRefs.current.set(idx.name, el);
                                    } else {
                                        rowRefs.current.delete(idx.name);
                                    }
                                }}
                            >
                                <TableCell className="expandCell">
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
                                        onClick={() => onToggleExpanded(idx.name)}
                                    />
                                </TableCell>
                                <TableCell className="nameCell">
                                    <TableCellLayout
                                        truncate
                                        media={<IndexStatusIndicator state={idx.state} busy={isBusy} />}
                                    >
                                        {idx.name}
                                    </TableCellLayout>
                                </TableCell>
                                <TableCell>
                                    <IndexTypeBadgeView type={badge} />
                                </TableCell>
                                <TableCell>
                                    <IndexPropertiesView index={idx} />
                                </TableCell>
                                <TableCell>
                                    <div className="indexMetricValue">
                                        <span className="indexMetricText">{formatBytes(idx.sizeBytes)}</span>
                                        {sizeBarWidth !== undefined && (
                                            <span className="relativeMetricTrack" aria-hidden="true">
                                                <span className="relativeMetricBar" style={{ width: sizeBarWidth }} />
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="usageCell">
                                    <div className="indexMetricValue">
                                        <span className="indexMetricText">{formatOps(idx.usageOps)}</span>
                                        {usageBarWidth !== undefined && (
                                            <span className="relativeMetricTrack" aria-hidden="true">
                                                <span className="relativeMetricBar" style={{ width: usageBarWidth }} />
                                            </span>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell>
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
                                                disabledFocusable={isProtected || isPending || isBusy}
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
                                                disabledFocusable={isProtected || isPending || isBusy}
                                                onClick={() => onToggleHidden(idx)}
                                            />
                                        </Tooltip>
                                    </div>
                                </TableCell>
                            </TableRow>
                            {isExpanded && (
                                // The expanded sub-row spans every column and renders the
                                // index's field list inside a full-width detail card.
                                // Reuse the parent row's zebra class so the detail row
                                // visually belongs to it.
                                <TableRow key={`${idx.name}-fields`} className={`fieldsDetailRow ${rowClass}`}>
                                    <TableCell colSpan={7} className="fieldsDetailCell">
                                        <IndexRowDetails index={idx} />
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
