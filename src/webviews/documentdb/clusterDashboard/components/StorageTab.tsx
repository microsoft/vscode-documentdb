/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Button,
    MessageBar,
    MessageBarBody,
    SearchBox,
    Spinner,
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableHeaderCell,
    TableRow,
} from '@fluentui/react-components';
import { ArrowClockwiseRegular } from '@fluentui/react-icons';
import * as l10n from '@vscode/l10n';
import { useMemo, useState, type JSX } from 'react';

import { type ClusterDatabaseStorage, type ClusterStorageStats } from '../../../../documentdb/utils/getClusterHealth';
import { formatCount } from '../../collectionView/components/queryInsightsTab/components/metricsRow';
import { formatBytes } from '../formatUtils';

export interface StorageTabProps {
    storageStats: ClusterStorageStats | null;
    isRefreshing: boolean;
    onRefresh: () => void;
}

/** Columns the table can be ordered by. */
type SortColumn = 'name' | 'sizeOnDiskBytes' | 'dataSizeBytes' | 'indexSizeBytes' | 'collections' | 'objects';

interface SortState {
    column: SortColumn;
    direction: 'ascending' | 'descending';
}

/**
 * Default order: largest first.
 *
 * The landing view has to answer "what is big here?" with no input from the user — the
 * question that brought them to a storage table in the first place. Alphabetical would make
 * them read every row to find it.
 */
const DEFAULT_SORT: SortState = { column: 'sizeOnDiskBytes', direction: 'descending' };

/** Numeric columns sort largest-first on the first click; the name column sorts A→Z. */
function defaultDirectionFor(column: SortColumn): SortState['direction'] {
    return column === 'name' ? 'ascending' : 'descending';
}

function compareDatabases(left: ClusterDatabaseStorage, right: ClusterDatabaseStorage, sort: SortState): number {
    if (sort.column === 'name') {
        const byName = left.name.localeCompare(right.name);
        return sort.direction === 'ascending' ? byName : -byName;
    }

    // A database whose `dbStats` failed sorts last whichever way the column is pointing:
    // "unknown" is not "zero", and burying it under real values would misrepresent it.
    const leftValue = left[sort.column];
    const rightValue = right[sort.column];
    if (leftValue === null && rightValue === null) {
        return left.name.localeCompare(right.name);
    }
    if (leftValue === null) {
        return 1;
    }
    if (rightValue === null) {
        return -1;
    }

    const byValue = leftValue - rightValue;
    if (byValue !== 0) {
        return sort.direction === 'ascending' ? byValue : -byValue;
    }

    // Stable tiebreak so equal sizes do not shuffle between refreshes.
    return left.name.localeCompare(right.name);
}

/**
 * Header cell that sorts, carrying `aria-sort` so the current order is announced rather than
 * only drawn.
 *
 * Declared at module scope, not inside `StorageTab`: a component created during render is a
 * new type on every render, so React would unmount and remount it — losing keyboard focus
 * the moment a sort changed, which is exactly when a keyboard user is holding it.
 */
function SortableHeader({
    column,
    label,
    sort,
    onToggle,
}: {
    column: SortColumn;
    label: string;
    sort: SortState;
    onToggle: (column: SortColumn) => void;
}): JSX.Element {
    const isActive = sort.column === column;

    return (
        <TableHeaderCell
            sortable
            sortDirection={isActive ? sort.direction : undefined}
            aria-sort={isActive ? sort.direction : 'none'}
            onClick={() => onToggle(column)}
        >
            {label}
        </TableHeaderCell>
    );
}

export const StorageTab = ({ storageStats, isRefreshing, onRefresh }: StorageTabProps): JSX.Element => {
    const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
    const [filterText, setFilterText] = useState('');

    const databases = useMemo(() => {
        if (storageStats === null) {
            return [];
        }

        const needle = filterText.trim().toLowerCase();
        const matching =
            needle === ''
                ? storageStats.databases
                : storageStats.databases.filter((database) => database.name.toLowerCase().includes(needle));

        return [...matching].sort((left, right) => compareDatabases(left, right, sort));
    }, [storageStats, filterText, sort]);

    if (storageStats === null) {
        return (
            <div className="tabPanel">
                <Spinner size="small" label={l10n.t('Loading databases…')} />
            </div>
        );
    }

    const toggleSort = (column: SortColumn): void =>
        setSort((current) =>
            current.column === column
                ? { column, direction: current.direction === 'ascending' ? 'descending' : 'ascending' }
                : { column, direction: defaultDirectionFor(column) },
        );

    // Scaled against the largest *visible* database so the bars stay meaningful while filtered.
    const largestDatabaseBytes = databases.reduce(
        (largest, database) => Math.max(largest, database.sizeOnDiskBytes ?? 0),
        0,
    );

    const sumOf = (read: (database: ClusterDatabaseStorage) => number | null): number | null =>
        databases.reduce<number | null>((total, database) => {
            const value = read(database);
            return value === null ? total : (total ?? 0) + value;
        }, null);

    const isFiltered = filterText.trim() !== '';

    return (
        <div className="tabPanel">
            <div className="tabToolbar">
                <Button
                    appearance="subtle"
                    icon={<ArrowClockwiseRegular />}
                    disabled={isRefreshing}
                    onClick={onRefresh}
                    aria-label={l10n.t('Refresh database statistics')}
                >
                    {l10n.t('Refresh')}
                </Button>
                {isRefreshing && <Spinner size="tiny" aria-label={l10n.t('Refreshing…')} />}
                <SearchBox
                    className="tabFilter"
                    value={filterText}
                    placeholder={l10n.t('Filter databases')}
                    aria-label={l10n.t('Filter databases by name')}
                    onChange={(_event, data) => setFilterText(data.value)}
                />
            </div>

            {storageStats.errors.length > 0 && (
                <MessageBar intent="warning">
                    <MessageBarBody>
                        {l10n.t('Some database statistics could not be read: {reason}', {
                            reason: storageStats.errors.join('; '),
                        })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {storageStats.omittedDatabaseCount > 0 && (
                <MessageBar intent="info">
                    <MessageBarBody>
                        {l10n.t('Showing the first {shown} databases; {omitted} more are not listed.', {
                            shown: String(storageStats.databases.length),
                            omitted: String(storageStats.omittedDatabaseCount),
                        })}
                    </MessageBarBody>
                </MessageBar>
            )}

            {databases.length === 0 ? (
                <div className="emptyState">
                    {isFiltered
                        ? l10n.t('No database matches "{filter}".', { filter: filterText })
                        : storageStats.errors.length > 0
                          ? l10n.t('Database statistics are unavailable for this cluster.')
                          : l10n.t('No user databases were reported for this cluster.')}
                </div>
            ) : (
                <Table size="small" aria-label={l10n.t('Databases in this cluster')}>
                    <TableHeader>
                        <TableRow>
                            <SortableHeader
                                column="name"
                                label={l10n.t('Database')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                            <SortableHeader
                                column="sizeOnDiskBytes"
                                label={l10n.t('Size')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                            <SortableHeader
                                column="dataSizeBytes"
                                label={l10n.t('Data')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                            <SortableHeader
                                column="indexSizeBytes"
                                label={l10n.t('Indexes')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                            <SortableHeader
                                column="collections"
                                label={l10n.t('Collections')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                            <SortableHeader
                                column="objects"
                                label={l10n.t('Documents')}
                                sort={sort}
                                onToggle={toggleSort}
                            />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {databases.map((database) => {
                            const sizePercentage =
                                largestDatabaseBytes > 0
                                    ? ((database.sizeOnDiskBytes ?? 0) / largestDatabaseBytes) * 100
                                    : 0;

                            return (
                                <TableRow key={database.name}>
                                    <TableCell>{database.name}</TableCell>
                                    <TableCell>
                                        <div className="storageSizeCell">
                                            <span>{formatBytes(database.sizeOnDiskBytes)}</span>
                                            <div className="storageBarTrack" aria-hidden="true">
                                                <div
                                                    className="storageBarFill"
                                                    style={{ width: `${sizePercentage}%` }}
                                                />
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell>{formatBytes(database.dataSizeBytes)}</TableCell>
                                    <TableCell>{formatBytes(database.indexSizeBytes)}</TableCell>
                                    <TableCell>
                                        {database.collections === null ? '—' : formatCount(database.collections)}
                                    </TableCell>
                                    <TableCell>
                                        {database.objects === null ? '—' : formatCount(database.objects)}
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        <TableRow className="storageTotalRow">
                            <TableCell>{isFiltered ? l10n.t('Total (filtered)') : l10n.t('Total')}</TableCell>
                            <TableCell>{formatBytes(sumOf((database) => database.sizeOnDiskBytes))}</TableCell>
                            <TableCell>{formatBytes(sumOf((database) => database.dataSizeBytes))}</TableCell>
                            <TableCell>{formatBytes(sumOf((database) => database.indexSizeBytes))}</TableCell>
                            <TableCell>{formatCount(sumOf((database) => database.collections) ?? 0)}</TableCell>
                            <TableCell>{formatCount(sumOf((database) => database.objects) ?? 0)}</TableCell>
                        </TableRow>
                    </TableBody>
                </Table>
            )}
        </div>
    );
};
