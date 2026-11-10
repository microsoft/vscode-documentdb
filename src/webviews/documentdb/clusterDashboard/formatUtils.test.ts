/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { formatApproximateCount, formatBytes, formatExactCount, formatUptime } from './formatUtils';

describe('formatBytes', () => {
    it.each([
        [0, '0 B'],
        [1023, '1023 B'],
        [1024, '1.00 KB'],
        [1536, '1.50 KB'],
        [1024 * 1024, '1.00 MB'],
        [100 * 1024, '100 KB'],
    ])('formats %p as %s', (value, expected) => {
        expect(formatBytes(value)).toBe(expected);
    });

    it.each([undefined, null, NaN, Infinity])('uses the placeholder for %p', (value) => {
        expect(formatBytes(value)).toBe('—');
        expect(formatBytes(value, 'unavailable')).toBe('unavailable');
    });
});

describe('count formatting', () => {
    it('uses platform number formatting for approximate and exact counts', () => {
        const value = 4812004;
        expect(formatApproximateCount(value)).toBe(
            new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value),
        );
        expect(formatExactCount(value)).toBe(
            new Intl.NumberFormat(undefined, { useGrouping: true, maximumFractionDigits: 0 }).format(value),
        );
    });

    it.each([undefined, null, NaN, Infinity])('omits unavailable counts %p', (value) => {
        expect(formatApproximateCount(value)).toBe('—');
        expect(formatApproximateCount(value, 'unavailable')).toBe('unavailable');
        expect(formatExactCount(value)).toBeUndefined();
    });
});

describe('formatUptime', () => {
    it.each([
        [0, '0m'],
        [59, '0m'],
        [60, '1m'],
        [3600, '1h 0m'],
        [86400, '1d 0h 0m'],
        [3 * 86400 + 4 * 3600 + 12 * 60, '3d 4h 12m'],
    ])('formats %p as %s', (value, expected) => {
        expect(formatUptime(value)).toBe(expected);
    });

    it.each([undefined, null, NaN, Infinity, -1])('uses the placeholder for %p', (value) => {
        expect(formatUptime(value)).toBe('—');
        expect(formatUptime(value, 'unavailable')).toBe('unavailable');
    });
});
