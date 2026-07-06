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
