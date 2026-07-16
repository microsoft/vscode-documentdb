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
import { Fragment, useState, type JSX } from 'react';
import { type IndexRow } from '../../types';
import { formatBytes, formatOps } from '../../utils/format';
import { classifyIndex } from '../../utils/indexType';
import { IndexPropertiesView } from './IndexPropertiesView';
import { IndexRowDetails } from './IndexRowDetails';
import { IndexTypeBadgeView } from './IndexTypeBadgeView';

export interface IndexTableProps {
    indexes: ReadonlyArray<IndexRow>;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
}

/**
 * Stable column identifiers, kept only for documentation / cell-class
 * alignment. Column widths are driven by the `<colgroup>` below plus CSS
 * (`table-layout: fixed`) so the table always fills the width it is given
 * and the name column absorbs any slack — no horizontal scrollbar.
 */

export const IndexTable = ({ indexes, onDelete, onToggleHidden }: IndexTableProps): JSX.Element => {
    // Set of currently-expanded index names. Kept in component state so
    // expansion survives table re-renders driven by data refresh.
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

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
                    const isExpanded = expanded.has(idx.name);
                    // Compute zebra parity from the data index (not the DOM
                    // position) so an inserted detail row never breaks the
                    // alternating pattern.
                    const rowClass = rowIdx % 2 === 0 ? 'rowEven' : 'rowOdd';
                    return (
                        <Fragment key={idx.name}>
                            <TableRow key={idx.name} className={rowClass}>
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
                                    <TableCellLayout truncate>{idx.name}</TableCellLayout>
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
