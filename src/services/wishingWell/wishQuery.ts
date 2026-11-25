/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Decimal128 } from 'bson';

const OBJECT_ID = /^[0-9a-f]{24}$/i;
const INTEGER = /^[-+]?\d+$/;
const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
/** The driver writes a JS `s` flag as nothing and `g` as BSON `s`, so only these survive the trip. */
const REGEX_OPTIONS = /^[im]*$/;
const LONG_MIN = -(BigInt(2) ** BigInt(63));
const LONG_MAX = BigInt(2) ** BigInt(63) - BigInt(1);
/** Keys {@link wrapperToShell} converts. One that fails keeps its value as written, so a second pass changes nothing. */
const WRAPPER_KEYS = new Set([
    '$date',
    '$oid',
    '$numberLong',
    '$numberDecimal',
    '$numberInt',
    '$numberDouble',
    '$regularExpression',
    '$uuid',
]);

/** A JS string literal the shell parser reads; it rejects raw line and paragraph separators. */
function quote(text: string): string {
    return JSON.stringify(text)
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function hasOnlyKeys(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
    const keys = Object.keys(value);
    return (
        required.every((key) => keys.includes(key)) &&
        keys.every((key) => required.includes(key) || optional.includes(key))
    );
}

/** The ISO text `ISODate` accepts, read the way `EJSON.parse` reads `$date`. */
function isoDate(value: unknown): string | undefined {
    let time: number | undefined;
    if (typeof value === 'string') {
        time = Date.parse(value);
    } else if (typeof value === 'number') {
        time = value;
    } else if (typeof value === 'object' && value !== null && hasOnlyKeys(value, ['$numberLong'])) {
        const long = (value as { $numberLong: unknown }).$numberLong;
        time = typeof long === 'string' && INTEGER.test(long) ? Number(long) : undefined;
    }
    if (time === undefined || !Number.isSafeInteger(time)) {
        return undefined;
    }
    const date = new Date(time);
    const year = date.getUTCFullYear();
    return year >= 0 && year <= 9999 ? date.toISOString() : undefined;
}

/** A 64-bit integer; NumberLong wraps anything wider into a different value. */
function isLong(text: string | undefined): text is string {
    if (!text || !INTEGER.test(text)) {
        return false;
    }
    const value = BigInt(text);
    return value >= LONG_MIN && value <= LONG_MAX;
}

function isDecimal(value: unknown): value is string {
    if (typeof value !== 'string') {
        return false;
    }
    try {
        Decimal128.fromString(value);
        return true;
    } catch {
        return false;
    }
}

function regExp(value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null || !hasOnlyKeys(value, ['pattern'], ['options'])) {
        return undefined;
    }
    const { pattern, options = '' } = value as { pattern: unknown; options?: unknown };
    if (typeof pattern !== 'string' || typeof options !== 'string' || !REGEX_OPTIONS.test(options)) {
        return undefined;
    }
    try {
        new RegExp(pattern, options);
    } catch {
        return undefined;
    }
    return `RegExp(${quote(pattern)},${quote(options)})`;
}

/** Shell syntax for an object that is exactly one Extended JSON wrapper, else `undefined`. */
function wrapperToShell(value: object): string | undefined {
    const keys = Object.keys(value);
    if (keys.length !== 1) {
        return undefined;
    }
    const inner: unknown = (value as Record<string, unknown>)[keys[0]];
    const text = typeof inner === 'string' ? inner : undefined;
    switch (keys[0]) {
        case '$date': {
            const iso = isoDate(inner);
            return iso ? `ISODate(${quote(iso)})` : undefined;
        }
        case '$oid':
            return text && OBJECT_ID.test(text) ? `ObjectId(${quote(text)})` : undefined;
        case '$numberLong':
            return isLong(text) ? `NumberLong(${quote(text)})` : undefined;
        case '$numberDecimal':
            return isDecimal(inner) ? `NumberDecimal(${quote(inner)})` : undefined;
        case '$numberInt':
        case '$numberDouble':
            return text && NUMBER.test(text) && Number.isFinite(Number(text))
                ? JSON.stringify(Number(text))
                : undefined;
        case '$regularExpression':
            return regExp(inner);
        case '$uuid':
            return text && UUID.test(text) ? `UUID(${quote(text)})` : undefined;
        default:
            return undefined;
    }
}

/** JSON writes Infinity as null, which would compare against null instead. */
function primitive(value: unknown): string {
    if (typeof value === 'string') {
        return quote(value);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
        return value > 0 ? 'Infinity' : '-Infinity';
    }
    return JSON.stringify(value);
}

function render(value: unknown, convert: boolean = true): { text: string; converted: boolean } {
    if (Array.isArray(value)) {
        const items = value.map((item: unknown) => render(item, convert));
        return {
            text: `[${items.map((item) => item.text).join(',')}]`,
            converted: items.some((item) => item.converted),
        };
    }
    if (typeof value === 'object' && value !== null) {
        const shell = convert ? wrapperToShell(value) : undefined;
        if (shell !== undefined) {
            return { text: shell, converted: true };
        }
        const keys = Object.keys(value);
        const failedWrapper = keys.length === 1 && WRAPPER_KEYS.has(keys[0]);
        const entries = Object.entries(value).map(([key, inner]) => ({
            key,
            ...render(inner, convert && !failedWrapper),
        }));
        return {
            text: `{${entries.map((entry) => `${quote(entry.key)}:${entry.text}`).join(',')}}`,
            converted: entries.some((entry) => entry.converted),
        };
    }
    return { text: primitive(value), converted: false };
}

/**
 * Strict JSON with Extended JSON wrappers ({"$date": …}, {"$oid": …}) as the shell syntax that find
 * filters and the collection view parse, where a wrapper would stay a plain sub-document and match
 * nothing. Text that is not JSON is already shell syntax and comes back as it is.
 */
export function toShellQuery(text: string): string;
export function toShellQuery(text: string | undefined): string | undefined;
export function toShellQuery(text: string | undefined): string | undefined {
    if (text === undefined || text.trim().length === 0) {
        return text;
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return text;
    }
    let rendered: { text: string; converted: boolean };
    try {
        rendered = render(value);
    } catch {
        // Nested deeper than the stack: the read's own parser then says what is wrong with it.
        return text;
    }
    return rendered.converted || /[\u2028\u2029]/.test(text) ? rendered.text : text;
}
