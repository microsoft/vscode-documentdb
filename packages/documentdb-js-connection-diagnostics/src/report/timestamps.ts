/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Only timestamp fields are dates; identifiers that resemble dates must remain identifiers.
export const timestampFields: ReadonlySet<string> = new Set([
    'startedAt',
    'finishedAt',
    'checkedAt',
    'localTime',
    'serverTime',
    'validFrom',
    'validTo',
]);

export function reportTimestamp(value: unknown, key: string): Date | undefined {
    if (!timestampFields.has(key) || (typeof value !== 'string' && typeof value !== 'number')) {
        return undefined;
    }
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : undefined;
}
