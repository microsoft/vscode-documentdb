/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * NOTE: Mostly of these functions are async to be able to move them to backend in the future
 */

import { type ItemDefinition, type PartitionKeyDefinition } from '@azure/cosmos';

export type StatsItem = {
    metric: string;
    value: string | number;
    formattedValue: string;
    tooltip: string;
};

export type TableRecord = Record<string, string> & { __id: string };
export type TableData = {
    headers: string[];
    dataset: TableRecord[];
};

export type ColumnOptions = {
    ShowPartitionKey: 'first' | 'none'; // 'first' = show id + partition key first, 'none' = the nested partition key values are hidden + partition key are shown as is (without / prefix)
    ShowServiceColumns: 'last' | 'none'; // 'last' = show service columns last, 'none' = hide service columns
    Sorting: 'ascending' | 'descending' | 'none'; // 'ascending' = sort columns in ascending order, 'descending' = sort columns in descending order, 'none' = no sorting
    TruncateValues: number; // truncate values to this length, 0 = no truncation
};

const MAX_TREE_LEVEL_LENGTH = 100;

/**
 * Truncates a string if it exceeds the specified maximum length.
 * @param value The string to truncate
 * @param maxLength Maximum length of the string (default: MAX_TREE_LEVEL_LENGTH)
 * @param suffix Suffix to append to truncated strings (default: "…")
 * @returns The truncated string with suffix if truncated, or original string
 */
export const truncateString = (value: string, maxLength = MAX_TREE_LEVEL_LENGTH, suffix = '…'): string => {
    if (!value) {
        return '';
    }

    if (value.length <= maxLength) {
        return value;
    }

    return value.substring(0, maxLength - suffix.length) + suffix;
};

/**
 * We can retrieve the document id to open it in a separate tab only if record contains {@link CosmosDBRecordIdentifier}
 * We can be 100% sure that all required fields for {@link CosmosDBRecordIdentifier} are present in the record
 * if query has `SELECT *` clause. So we can enable editing only in this case.
 * Based on documentation https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/select
 * '*" is allowed only if the query doesn't have any subset or joins
 * @param query
 */
export const isSelectStar = (query: string): boolean => {
    const matches = query.match(/select([\S\s]*)from[\s\S]*$/im);
    if (matches) {
        const selectClause = matches[1].split(',').map((s) => s.trim());
        return selectClause.find((s) => s.endsWith('*')) !== undefined;
    }

    return false;
};

/**
 * Get the headers for the table (don't take into account the nested objects)
 * @param documents
 * @param partitionKey
 * @param options
 */
export const getTableHeaders = (
    documents: ItemDefinition[],
    partitionKey: PartitionKeyDefinition | undefined,
    options: ColumnOptions,
): string[] => {
    const keys = new Set<string>();
    const serviceKeys = new Set<string>();

    documents.forEach((doc) => {
        Object.keys(doc).forEach((key) => {
            if (key.startsWith('_')) {
                serviceKeys.add(key);
            } else {
                keys.add(key);
            }
        });
    });

    const columns = Array.from(keys);
    const serviceColumns = Array.from(serviceKeys);
    const partitionKeyPaths = (partitionKey?.paths ?? []).map((path) => (path.startsWith('/') ? path : `/${path}`));
    const resultColumns: string[] = [];

    if (options.ShowPartitionKey === 'first') {
        // Remove partition key paths from columns, since partition key paths are always shown first
        partitionKeyPaths.forEach((path) => {
            const index = columns.indexOf(path.slice(1));
            if (index !== -1) {
                columns.splice(index, 1);
            }
        });

        // If id is not in the partition key, add it as the first column
        if (!partitionKeyPaths.includes('/id')) {
            partitionKeyPaths.unshift('id');
        }

        partitionKeyPaths.forEach((path) => resultColumns.push(path));
    }

    if (options.Sorting === 'ascending') {
        columns.sort((a, b) => a.localeCompare(b)).forEach((column) => resultColumns.push(column));
    }

    if (options.Sorting === 'descending') {
        columns.sort((a, b) => b.localeCompare(a)).forEach((column) => resultColumns.push(column));
    }

    if (options.Sorting === 'none') {
        columns.forEach((column) => resultColumns.push(column));
    }

    if (options.ShowServiceColumns === 'last') {
        if (options.Sorting === 'ascending') {
            serviceColumns.sort((a, b) => a.localeCompare(b)).forEach((column) => resultColumns.push(column));
        }
        if (options.Sorting === 'descending') {
            serviceColumns.sort((a, b) => b.localeCompare(a)).forEach((column) => resultColumns.push(column));
        }
        if (options.Sorting === 'none') {
            serviceColumns.forEach((column) => resultColumns.push(column));
        }
    }

    // Remove duplicates while keeping order
    const uniqueHeaders = new Set<string>(resultColumns);

    return Array.from(uniqueHeaders);
};
