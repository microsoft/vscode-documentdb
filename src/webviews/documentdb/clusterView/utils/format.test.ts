/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatBytes, formatCount, formatMetricCell } from './format';

describe('clusterView/format', () => {
    describe('formatBytes', () => {
        it.each<[number, string]>([
            [0, '0 B'],
            [512, '512 B'],
            [1023, '1023 B'],
            [1024, '1.0 KB'],
            [1536, '1.5 KB'],
            [1024 * 1024, '1.0 MB'],
            [1024 * 1024 * 1024, '1.0 GB'],
            [1024 * 1024 * 1024 * 1024, '1.0 TB'],
        ])('formats %d bytes as "%s"', (bytes, expected) => {
            expect(formatBytes(bytes)).toBe(expected);
        });

        it('drops the decimal once the value reaches 10 of a unit', () => {
            // 10 KB and above render without a fractional part.
            expect(formatBytes(10 * 1024)).toBe('10 KB');
            expect(formatBytes(15 * 1024)).toBe('15 KB');
        });

        it('caps the unit at TB for very large values', () => {
            // 1024 TB stays in TB rather than introducing a new unit.
            expect(formatBytes(1024 * 1024 * 1024 * 1024 * 1024)).toBe('1024 TB');
        });

        it('returns an em dash for undefined or NaN', () => {
            expect(formatBytes(undefined)).toBe('—');
            expect(formatBytes(Number.NaN)).toBe('—');
        });
    });

    describe('formatCount', () => {
        it('formats integers with locale grouping', () => {
            expect(formatCount(0)).toBe('0');
            expect(formatCount(42)).toBe('42');
            expect(formatCount(1000)).toBe((1000).toLocaleString());
        });

        it('returns an em dash for undefined or NaN', () => {
            expect(formatCount(undefined)).toBe('—');
            expect(formatCount(Number.NaN)).toBe('—');
        });
    });

    describe('formatMetricCell', () => {
        it('defers to the formatter only when loaded', () => {
            expect(formatMetricCell('loaded', 2048, formatBytes)).toBe('2.0 KB');
            expect(formatMetricCell('loaded', 7, formatCount)).toBe('7');
        });

        it('renders an em dash while loading or when unavailable', () => {
            expect(formatMetricCell('loading', 2048, formatBytes)).toBe('—');
            expect(formatMetricCell('unavailable', 2048, formatBytes)).toBe('—');
        });
    });
});
