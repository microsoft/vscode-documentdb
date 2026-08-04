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
