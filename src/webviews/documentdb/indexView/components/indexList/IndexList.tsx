/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { type IndexRow } from '../../types';
import { IndexListFilterBar, type QuickFilters } from './IndexListFilterBar';
import { IndexTable } from './IndexTable';

/** Snapshot of the list's filter inputs and resulting counts, surfaced to the parent. */
export interface IndexListState {
    /** Total number of indexes provided (before filtering). */
    totalCount: number;
    /** Number of indexes visible after the current filters. */
    shownCount: number;
    /** Current free-text filter. */
    filterText: string;
    /** Current quick-filter toggle state. */
    quickFilters: QuickFilters;
}

export interface IndexListProps {
    indexes: ReadonlyArray<IndexRow>;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
    /**
     * Notified whenever the filter inputs or the visible/total counts change.
     * Lets the host surface counts / toggle state (e.g. in the metrics row)
     * without owning the filter UI.
     */
    onStateChange?: (state: IndexListState) => void;
}

/**
 * Self-contained index list: owns the filter box + quick-filter toggles,
 * applies them to the provided indexes, and renders the details table.
 *
 * The component exposes its filter state and the available vs. shown counts via
 * {@link IndexListProps.onStateChange}. Kept in its own folder so the list UI
 * can evolve independently of the rest of the Index Management tab.
 */
export const IndexList = ({ indexes, onDelete, onToggleHidden, onStateChange }: IndexListProps): JSX.Element => {
    const [filterText, setFilterText] = useState('');
    const [quickFilters, setQuickFilters] = useState<QuickFilters>({ hidden: false, unused: false });

    const shown = useMemo(() => {
        const query = filterText.trim().toLowerCase();
        return indexes.filter((index) => {
            if (query) {
                const nameMatch = index.name.toLowerCase().includes(query);
                const fieldMatch = index.key.some((k) => k.field.toLowerCase().includes(query));
                if (!nameMatch && !fieldMatch) {
                    return false;
                }
            }
            if (quickFilters.hidden && !index.hidden) {
                return false;
            }
            // "Unused" = a non-default index with a known usage count of zero.
            if (quickFilters.unused && (index.isDefault || index.usageOps !== 0)) {
                return false;
            }
            return true;
        });
    }, [indexes, filterText, quickFilters]);

    // Surface state to the host without re-running when the callback identity
    // changes (the parent may pass an inline function).
    const onStateChangeRef = useRef(onStateChange);
    useEffect(() => {
        onStateChangeRef.current = onStateChange;
    });
    useEffect(() => {
        onStateChangeRef.current?.({
            totalCount: indexes.length,
            shownCount: shown.length,
            filterText,
            quickFilters,
        });
    }, [indexes.length, shown.length, filterText, quickFilters]);

    return (
        <div className="indexList">
            <IndexListFilterBar
                filterText={filterText}
                onFilterTextChange={setFilterText}
                quickFilters={quickFilters}
                onQuickFiltersChange={setQuickFilters}
                totalCount={indexes.length}
                shownCount={shown.length}
            />
            <div className="indexContentContainer">
                <IndexTable indexes={shown} onDelete={onDelete} onToggleHidden={onToggleHidden} />
            </div>
        </div>
    );
};
