/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
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
    ChevronDownRegular,
    ChevronRightRegular,
    DeleteRegular,
    EyeOffRegular,
    EyeRegular,
} from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { Fragment, useEffect, useRef, useState, type JSX } from 'react';
import { type IndexRow } from '../../types';
import { formatBytes, formatOps } from '../../utils/format';
import { classifyIndex } from '../../utils/indexType';
import { IndexPropertiesView } from './IndexPropertiesView';
import { IndexRowDetails } from './IndexRowDetails';
import { IndexStatusIndicator } from './IndexStatusIndicator';
import { IndexTypeBadgeView } from './IndexTypeBadgeView';

export interface IndexTableProps {
    indexes: ReadonlyArray<IndexRow>;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
    /** Names of rows with an action in flight (delete / hide / unhide) — shown with a spinner. */
    busyNames?: ReadonlySet<string>;
    /** Name of a row to scroll into view once (only if it is off-screen). */
    scrollToName?: string;
}

/**
 * Stable column identifiers, kept only for documentation / cell-class
 * alignment. Column widths are driven by the `<colgroup>` below plus CSS
 * (`table-layout: fixed`) so the table always fills the width it is given
 * and the name column absorbs any slack — no horizontal scrollbar.
 */

export const IndexTable = ({
    indexes,
    onDelete,
    onToggleHidden,
    busyNames,
    scrollToName,
}: IndexTableProps): JSX.Element => {
    // Set of currently-expanded index names. Kept in component state so
    // expansion survives table re-renders driven by data refresh.
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

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
        <Table aria-label={l10n.t('Indexes')} size="small" className="indexTable" sortable={false}>
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
                    <TableHeaderCell className="expandHeaderCell" aria-label={l10n.t('Expand row')} />
                    {/* Name column is intentionally wide — real-world index names can be 80+ chars */}
                    <TableHeaderCell className="nameHeaderCell">{l10n.t('Name')}</TableHeaderCell>
                    <TableHeaderCell>{l10n.t('Type')}</TableHeaderCell>
                    <TableHeaderCell>{l10n.t('Properties')}</TableHeaderCell>
                    <TableHeaderCell>{l10n.t('Size')}</TableHeaderCell>
                    <TableHeaderCell className="usageCell">{l10n.t('Usage')}</TableHeaderCell>
                    <TableHeaderCell>{l10n.t('Actions')}</TableHeaderCell>
                </TableRow>
            </TableHeader>
            <TableBody>
                {indexes.map((idx, rowIdx) => {
                    const badge = classifyIndex(idx);
                    const isProtected = idx.isDefault;
                    // Optimistic "Creating…" rows have no server-side index yet, so
                    // actions that operate on a live index are disabled.
                    const isPending = idx.state === 'creating';
                    const isExpanded = expanded.has(idx.name);
                    // Compute zebra parity from the data index (not the DOM
                    // position) so an inserted detail row never breaks the
                    // alternating pattern.
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
                                        onClick={() => toggleExpanded(idx.name)}
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
                                <TableCell>{formatBytes(idx.sizeBytes)}</TableCell>
                                <TableCell className="usageCell">
                                    <span>{formatOps(idx.usageOps)}</span>
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
                                                disabled={isProtected || isPending}
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
                                                disabled={isProtected || isPending}
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
