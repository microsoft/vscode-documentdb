/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toHexColor } from './toHexColor';

describe('toHexColor', () => {
    describe('passes hex through', () => {
        it.each([
            ['#abc', '#abc'],
            ['#abcd', '#abcd'],
            ['#1e1e1e', '#1e1e1e'],
            ['#1E1E1E', '#1e1e1e'],
            ['#1e1e1e80', '#1e1e1e80'],
            ['  #1e1e1e  ', '#1e1e1e'],
        ])('%s', (input, expected) => {
            expect(toHexColor(input)).toBe(expected);
        });
    });

    describe('converts rgb()', () => {
        it.each([
            ['rgb(30, 30, 30)', '#1e1e1e'],
            ['rgb(30 30 30)', '#1e1e1e'],
            ['rgba(30, 30, 30, 1)', '#1e1e1e'],
            ['rgba(30, 30, 30, 0.5)', '#1e1e1e80'],
            ['rgb(30 30 30 / 50%)', '#1e1e1e80'],
            ['rgb(100%, 0%, 0%)', '#ff0000'],
        ])('%s', (input, expected) => {
            expect(toHexColor(input)).toBe(expected);
        });

        // The extension's converter ran `parseFloat(…).toString(16)` with no rounding, so a
        // fractional channel produced a hex fragment like `e.4ccccccccccccd`, which Monaco then
        // rendered red.
        it('rounds fractional channels instead of emitting a fractional hex digit', () => {
            expect(toHexColor('rgba(228.4, 228.4, 228.4, 1)')).toBe('#e4e4e4');
        });

        it('clamps out-of-range channels', () => {
            expect(toHexColor('rgb(300, -20, 30)')).toBe('#ff001e');
        });
    });

    // Returning undefined is what keeps Monaco's `parseHex(value) || Color.red` from painting red.
    describe('rejects what it cannot read', () => {
        it.each([
            ['', 'the id the theme does not publish'],
            ['   ', 'whitespace only'],
            ['transparent', 'a named color'],
            ['hsl(0, 100%, 50%)', 'a color space it does not parse'],
            ['color-mix(in srgb, red 50%, blue)', 'a computed color-mix'],
            ['#12345', 'a hex of invalid length'],
            ['#gggggg', 'a hex with non-hex digits'],
            ['rgb(30, 30)', 'too few channels'],
            ['rgb(30, 30, 30, 1, 1)', 'too many channels'],
            ['rgb(a, b, c)', 'non-numeric channels'],
        ])('%s - %s', (input) => {
            expect(toHexColor(input)).toBeUndefined();
        });
    });
});
