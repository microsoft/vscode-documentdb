/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Formatting helpers shared by the Cluster Dashboard tiles and tables.
 *
 * `formatCount` / `formatTime` come from the Query Insights `metricsRow` package; only the
 * byte and duration formats the dashboard needs in addition live here.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * Formats a byte count with a binary-scaled unit suffix.
 *
 * @param bytes - The value to format, or `null`/`undefined` when unavailable.
 * @param placeholder - Text rendered for an unavailable value.
 * @returns A short human-readable size, e.g. `1.25 GB`.
 */
export function formatBytes(bytes: number | null | undefined, placeholder = '—'): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
        return placeholder;
    }

    if (bytes < 1024) {
        return `${Math.round(bytes)} ${BYTE_UNITS[0]}`;
    }

    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
        value /= 1024;
        unitIndex++;
    }

    return `${value.toFixed(value >= 100 ? 0 : 2)} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Rounds a count to a short magnitude, e.g. `1.2K`, `4.8M`.
 *
 * Deliberately `Intl.NumberFormat` rather than a rounding package. `notation: 'compact'` is
 * the platform's own answer, it is locale-aware where a hardcoded `K`/`M`/`B` ladder is not
 * (and this extension ships localized), and it costs no dependency. The well-known packages
 * for this — `numeral`, `humanize-plus` — predate that support and are unmaintained.
 *
 * Used for document counts because they are estimates. `collStats.count` is read from
 * collection metadata, not by counting, and diverges after an unclean shutdown; `dbStats`
 * sums those same figures. Printing `4,812,004` invites a reader to trust digits the server
 * does not stand behind, so the display rounds and the exact figure moves to the tooltip.
 *
 * @param value - The count, or `null`/`undefined` when unavailable.
 * @param placeholder - Text rendered for an unavailable value.
 */
export function formatApproximateCount(value: number | null | undefined, placeholder = '—'): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return placeholder;
    }

    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

/**
 * The full figure behind {@link formatApproximateCount}, grouped for reading.
 *
 * @param value - The count, or `null`/`undefined` when unavailable.
 */
export function formatExactCount(value: number | null | undefined): string | undefined {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return undefined;
    }

    return new Intl.NumberFormat(undefined, { useGrouping: true, maximumFractionDigits: 0 }).format(value);
}

/**
 * Formats an uptime in seconds as a compact `d/h/m` string.
 *
 * @param seconds - Uptime in seconds, or `null`/`undefined` when the server did not report it.
 * @param placeholder - Text rendered for an unavailable value.
 * @returns e.g. `3d 4h 12m`, `12m`, or the placeholder.
 */
export function formatUptime(seconds: number | null | undefined, placeholder = '—'): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
        return placeholder;
    }

    const totalMinutes = Math.floor(seconds / 60);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;

    const parts: string[] = [];
    if (days > 0) {
        parts.push(`${days}d`);
    }
    if (days > 0 || hours > 0) {
        parts.push(`${hours}h`);
    }
    parts.push(`${minutes}m`);

    return parts.join(' ');
}
