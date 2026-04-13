/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeMarkdown } from './escapeMarkdown';

describe('escapeMarkdown', () => {
    test('returns plain text unchanged', () => {
        expect(escapeMarkdown('age')).toBe('age');
    });

    test('escapes markdown bold characters', () => {
        expect(escapeMarkdown('**bold**')).toBe('\\*\\*bold\\*\\*');
    });

    test('escapes markdown link syntax', () => {
        expect(escapeMarkdown('[click](https://evil.com)')).toBe('\\[click\\]\\(https://evil\\.com\\)');
    });

    test('escapes angle brackets (HTML tags)', () => {
        expect(escapeMarkdown('<script>alert(1)</script>')).toBe('\\<script\\>alert\\(1\\)\\</script\\>');
    });

    test('escapes backticks', () => {
        expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
    });

    test('escapes ampersands', () => {
        expect(escapeMarkdown('a&b')).toBe('a\\&b');
    });

    test('handles dotted field names', () => {
        expect(escapeMarkdown('address.street')).toBe('address\\.street');
    });

    test('passes through numbers and underscores', () => {
        // underscore IS a markdown metacharacter, so it gets escaped
        expect(escapeMarkdown('field_1')).toBe('field\\_1');
    });
});
