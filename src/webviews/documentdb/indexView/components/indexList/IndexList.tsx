/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { type IndexRow } from '../../types';
import { IndexListFilterBar, type QuickFilters } from './IndexListFilterBar';
import { IndexTable, type IndexSortState } from './IndexTable';
import { IndexTableSkeleton } from './IndexTableSkeleton';

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
    /** Time of the latest successful index-list refresh. */
    lastUpdatedAt?: number;
    onDelete: (index: IndexRow) => void;
    onToggleHidden: (index: IndexRow) => void;
    /** When true, the table is replaced with a loading skeleton and the count is hidden. */
    isLoading?: boolean;
    /** Names of rows with an action in flight (delete / hide / unhide) — shown with a spinner. */
    busyNames?: ReadonlySet<string>;
    /** Name of a row to scroll into view once (if it is off-screen). */
    scrollToName?: string;
    /**
     * Notified whenever the filter inputs or the visible/total counts change.
     * Lets the host surface counts / toggle state (e.g. in the metrics row)
     * without owning the filter UI.
     */
    onStateChange?: (state: IndexListState) => void;
}

function maxKnownMetric(indexes: ReadonlyArray<IndexRow>, metric: 'sizeBytes' | 'usageOps'): number | undefined {
    const values = indexes
        .map((index) => index[metric])
        .filter((value): value is number => value !== undefined && Number.isFinite(value));
    return values.length === 0 ? undefined : Math.max(...values);
}

/**
 * Self-contained index list: owns the filter box + quick-filter toggles,
 * applies them to the provided indexes, and renders the details table.
 *
 * The component exposes its filter state and the available vs. shown counts via
 * {@link IndexListProps.onStateChange}. Kept in its own folder so the list UI
 * can evolve independently of the rest of the Index Management tab.
 */
export const IndexList = ({
    indexes,
    lastUpdatedAt,
    onDelete,
    onToggleHidden,
    isLoading = false,
    busyNames,
    scrollToName,
    onStateChange,
}: IndexListProps): JSX.Element => {
    const [filterText, setFilterText] = useState('');
    const [quickFilters, setQuickFilters] = useState<QuickFilters>({ hidden: false, unused: false });
    const [now, setNow] = useState(Date.now);
    // Sort + expanded-row state live here (not inside IndexTable) so they survive
    // a manual refresh: that swaps IndexTable for the skeleton, unmounting the
    // table. Owning the state one level up — in this component, which stays
    // mounted across the swap — keeps the user's chosen sort and expanded rows.
    const [sortState, setSortState] = useState<IndexSortState>({
        sortColumn: 'name',
        sortDirection: 'ascending',
    });
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
    // Keep visual metric scales stable while filters change which rows are visible.
    const maxSizeBytes = maxKnownMetric(indexes, 'sizeBytes');
    const maxUsageOps = maxKnownMetric(indexes, 'usageOps');

    useEffect(() => {
        if (lastUpdatedAt === undefined) {
            return;
        }
        const elapsedMs = Math.max(0, Date.now() - lastUpdatedAt);
        const nextUpdateMs =
            elapsedMs < 30_000
                ? 30_000 - elapsedMs
                : elapsedMs < 60_000
                  ? 60_000 - elapsedMs
                  : 60_000 - (elapsedMs % 60_000);
        const timer = setTimeout(() => setNow(Date.now()), Math.max(1, nextUpdateMs));
        return () => clearTimeout(timer);
    }, [lastUpdatedAt, now]);

    const updatedText = useMemo(() => {
        if (lastUpdatedAt === undefined) {
            return undefined;
        }
        const elapsedSeconds = Math.max(0, Math.floor((now - lastUpdatedAt) / 1000));
        if (elapsedSeconds < 30) {
            return l10n.t('Updated a few seconds ago');
        }
        if (elapsedSeconds < 60) {
            return l10n.t('Updated less than a minute ago');
        }
        const elapsedMinutes = Math.floor(elapsedSeconds / 60);
        return elapsedMinutes === 1
            ? l10n.t('Updated 1 minute ago')
            : l10n.t('Updated {0} minutes ago', elapsedMinutes);
    }, [lastUpdatedAt, now]);

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
                onClearFilters={() => {
                    setFilterText('');
                    setQuickFilters({ hidden: false, unused: false });
                }}
            />
            <div className="indexContentContainer">
                {isLoading ? (
                    <IndexTableSkeleton rowCount={lastUpdatedAt === undefined ? undefined : shown.length} />
                ) : (
                    <IndexTable
                        indexes={shown}
                        maxSizeBytes={maxSizeBytes}
                        maxUsageOps={maxUsageOps}
                        onDelete={onDelete}
                        onToggleHidden={onToggleHidden}
                        busyNames={busyNames}
                        scrollToName={scrollToName}
                        sortState={sortState}
                        onSortChange={setSortState}
                        expanded={expanded}
                        onToggleExpanded={toggleExpanded}
                    />
                )}
                {!isLoading && (
                    <div className="indexListCount">
                        <span aria-live="polite">
                            {l10n.t('Showing {0} of {1} indexes', shown.length, indexes.length)}
                        </span>
                        {updatedText !== undefined && (
                            <>
                                <span aria-hidden="true"> · </span>
                                <span>{updatedText}</span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
