/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const textLimit = 8192;
const listLimit = 32;
const depthLimit = 8;

export function sanitizeValue(value: unknown): unknown {
    return sanitize(value, 0);
}

function sanitize(value: unknown, depth: number): unknown {
    if (typeof value === 'string') {
        if (depth > depthLimit) {
            return '[depth limit]';
        }
        const clean = value.replace(/\p{Cc}/gu, (character): string =>
            character === '\t' || character === '\n' ? character : '',
        );
        return clean.length <= textLimit
            ? clean
            : `${clean.slice(0, textLimit)} [truncated ${clean.length - textLimit} characters]`;
    }
    if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
        return depth > depthLimit ? '[depth limit]' : value;
    }
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        return undefined;
    }
    if (depth > depthLimit) {
        return '[depth limit]';
    }
    if (array) {
        const entries: unknown[] = [];
        for (const entry of (value as unknown[]).slice(0, listLimit)) {
            const clean = sanitize(entry, depth + 1);
            if (clean !== undefined) {
                entries.push(clean);
            }
        }
        if (value.length > listLimit) {
            entries.push(`[${value.length - listLimit} more omitted]`);
        }
        return entries;
    }
    return Object.fromEntries(
        Object.entries(value).flatMap(([key, entry]): [string, unknown][] => {
            if (key.length > 128) {
                return [];
            }
            const clean = sanitize(entry, depth + 1);
            return clean === undefined ? [] : [[key, clean]];
        }),
    );
}
