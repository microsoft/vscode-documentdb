/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';

const BYTES_IN_KIB = 1024;
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
const OPS_K_THRESHOLD = 1000;
const OPS_M_THRESHOLD = 1_000_000;

/** Format a byte count with a localised unit suffix. */
export function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined || Number.isNaN(bytes)) {
        return l10n.t('—');
    }
    if (bytes < BYTES_IN_KIB) {
        return `${bytes} ${SIZE_UNITS[0]}`;
    }
    let value = bytes;
    let unitIndex = 0;
    while (value >= BYTES_IN_KIB && unitIndex < SIZE_UNITS.length - 1) {
        value /= BYTES_IN_KIB;
        unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${SIZE_UNITS[unitIndex]}`;
}

/** Format a usage operations counter (e.g. 1.2k, 3.4M). */
export function formatOps(ops: number | undefined): string {
    if (ops === undefined || Number.isNaN(ops)) {
        return l10n.t('—');
    }
    if (ops < OPS_K_THRESHOLD) {
        return String(ops);
    }
    if (ops < OPS_M_THRESHOLD) {
        return `${(ops / OPS_K_THRESHOLD).toFixed(ops >= 10_000 ? 0 : 1)}k`;
    }
    return `${(ops / OPS_M_THRESHOLD).toFixed(ops >= 10_000_000 ? 0 : 1)}M`;
}

/** Format an ISO date string as a short, locale-aware date. Returns em dash for invalid input. */
export function formatDate(iso: string | undefined): string {
    if (!iso) {
        return l10n.t('—');
    }
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return l10n.t('—');
    }
    return parsed.toLocaleDateString();
}

/** Format a date as a tooltip describing the usage measurement window. */
export function formatSinceTooltip(iso: string | undefined): string {
    if (!iso) {
        return l10n.t('Usage statistics are not available for this index.');
    }
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) {
        return l10n.t('Usage statistics are not available for this index.');
    }
    return l10n.t('Usage counted since {0}', parsed.toLocaleString());
}

/** A JS identifier that can appear unquoted as an object key (e.g. `locale`, `$eq`). */
const IDENTIFIER_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Single-quote a string value, escaping backslashes and single quotes. */
function singleQuote(value: string): string {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * Render a value as a compact, shell-style object literal that is easier to
 * read than raw `JSON.stringify` output — e.g. `{ locale: 'en', strength: 2 }`
 * instead of `{"locale":"en","strength":2}`.
 *
 * Formatting rules (single line, no indentation):
 * - object keys are left unquoted when they are valid identifiers, otherwise
 *   single-quoted;
 * - string values are single-quoted;
 * - numbers, booleans and `null` are printed verbatim;
 * - objects render as `{ k: v, ... }` and arrays as `[a, b, ...]`, with empty
 *   containers collapsing to `{}` / `[]`.
 *
 * This is display-only (not a parser round-trip) and intentionally shallow on
 * exotic types: anything it does not recognise falls back to `JSON.stringify`.
 */
export function formatShellJson(value: unknown): string {
    if (value === null) {
        return 'null';
    }
    if (typeof value === 'string') {
        return singleQuote(value);
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (Array.isArray(value)) {
        if (value.length === 0) {
            return '[]';
        }
        return `[${value.map((item) => formatShellJson(item)).join(', ')}]`;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) {
            return '{}';
        }
        const parts = entries.map(([key, val]) => {
            const renderedKey = IDENTIFIER_KEY.test(key) ? key : singleQuote(key);
            return `${renderedKey}: ${formatShellJson(val)}`;
        });
        return `{ ${parts.join(', ')} }`;
    }
    // Unknown / exotic type (undefined, function, symbol, bigint): best effort.
    return JSON.stringify(value) ?? String(value);
}
