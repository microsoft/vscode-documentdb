/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type MetricStatus } from '../types';

const BYTES_IN_KIB = 1024;
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Format a byte count with a localised binary unit suffix (KB/MB/GB…).
 * Mirrors the index-view formatter so size columns read consistently across
 * the extension's webviews.
 */
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

/**
 * Format an integer count for display. Returns an em dash when the value is
 * unavailable so cells stay aligned with the size column's placeholder.
 */
export function formatCount(value: number | undefined): string {
    if (value === undefined || Number.isNaN(value)) {
        return l10n.t('—');
    }
    return value.toLocaleString();
}

/**
 * Render the display string for a metric cell based on its load state.
 * `loading` shows an em dash placeholder (the table also renders a spinner),
 * `unavailable` shows an em dash, and `loaded` defers to the value formatter.
 */
export function formatMetricCell(
    status: MetricStatus,
    value: number | undefined,
    formatter: (value: number | undefined) => string,
): string {
    if (status === 'loaded') {
        return formatter(value);
    }
    return l10n.t('—');
}
