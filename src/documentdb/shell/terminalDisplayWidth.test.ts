/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { clipToDisplayWidth, terminalDisplayWidth } from './terminalDisplayWidth';

describe('terminalDisplayWidth', () => {
    it.each([
        ['ASCII', 'restaurants', 11],
        ['CJK', '日本語', 6],
        ['combining mark', 'café', 4],
        ['text-default shell marker', '🛈', 1],
        ['emoji presentation', '📦', 2],
        ['emoji with VS16', '⚠️', 2],
        ['realistic collection name', '📦 inventory', 12],
    ])('measures %s text by terminal columns', (_description, text, expected) => {
        expect(terminalDisplayWidth(text)).toBe(expected);
    });
});

describe('clipToDisplayWidth', () => {
    it.each([
        ['ASCII', 'restaurants', 5, 'resta'],
        ['CJK', '日本語', 4, '日本'],
        ['combining mark', 'café menu', 4, 'café'],
        ['emoji presentation', '📦 inventory', 4, '📦 i'],
        ['emoji with VS16', '⚠️ alert', 3, '⚠️ '],
    ])('clips %s text on grapheme boundaries', (_description, text, maxWidth, expected) => {
        expect(clipToDisplayWidth(text, maxWidth)).toBe(expected);
        expect(terminalDisplayWidth(expected)).toBeLessThanOrEqual(maxWidth);
    });
});
