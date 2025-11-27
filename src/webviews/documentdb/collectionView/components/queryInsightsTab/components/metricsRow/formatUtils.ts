/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Format time value in milliseconds to human-readable string
 * DataDog/New Relic style with 2 decimal places (rounded)
 *
 * @param ms - Time in milliseconds
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted time string (e.g., "2.33 ms", "1.23 s", "2m 15s")
 */
export function formatTime(ms: number, decimals: number = 2): string {
    if (ms < 1000) {
        // Less than 1 second: show in milliseconds
        return `${ms.toFixed(decimals)} ms`;
    } else if (ms < 100000) {
        // 1s to 100s: show in seconds
        const seconds = ms / 1000;
        return `${seconds.toFixed(decimals)} s`;
    } else {
        // 100s+: show as "Xm Ys"
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}m ${seconds}s`;
    }
}

/**
 * Format count value with optional grouping and compact mode
 *
 * @param value - The count value
 * @param options - Formatting options
 * @returns Formatted count string (e.g., "10,000", "1.2M")
 */
export function formatCount(
    value: number,
    options: {
        useGrouping?: boolean;
        compact?: boolean;
        threshold?: number; // When to switch to compact (default: 1,000,000)
    } = {},
): string {
    const { useGrouping = true, compact = false, threshold = 1000000 } = options;

    // Use compact notation for large numbers if enabled
    if (compact && value >= threshold) {
        if (value >= 1000000000) {
            return `${(value / 1000000000).toFixed(1)}B`;
        } else if (value >= 1000000) {
            return `${(value / 1000000).toFixed(1)}M`;
        } else if (value >= 1000) {
            return `${(value / 1000).toFixed(1)}K`;
        }
    }

    // Standard formatting with grouping
    return value.toLocaleString(undefined, {
        useGrouping,
        maximumFractionDigits: 0,
    });
}

/**
 * Format ratio/percentage value
 *
 * @param ratio - The ratio value (0-1 for percentages, or any number for ratios)
 * @param format - Output format ('percent' | 'decimal' | 'ratio')
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted ratio string
 */
export function formatRatio(
    ratio: number,
    format: 'percent' | 'decimal' | 'ratio' = 'percent',
    decimals: number = 2,
): string {
    switch (format) {
        case 'percent':
            return `${(ratio * 100).toFixed(decimals)}%`;
        case 'decimal':
            return ratio.toFixed(decimals);
        case 'ratio':
            return `${ratio.toFixed(decimals)}:1`;
        default:
            return ratio.toString();
    }
}
