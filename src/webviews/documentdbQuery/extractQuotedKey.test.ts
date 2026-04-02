/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extractQuotedKey } from './shared/extractQuotedKey';

describe('extractQuotedKey', () => {
    test('extracts double-quoted key when cursor is inside', () => {
        const line = '{ "address.street": "value" }';
        //             01234567890123456789
        const col = 5; // on 'a' of address
        const result = extractQuotedKey(line, col);
        expect(result).not.toBeNull();
        expect(result!.key).toBe('address.street');
    });

    test('extracts single-quoted key when cursor is inside', () => {
        const line = "{ 'address.street': 'value' }";
        const col = 5;
        const result = extractQuotedKey(line, col);
        expect(result).not.toBeNull();
        expect(result!.key).toBe('address.street');
    });

    test('returns null when cursor is not inside quotes', () => {
        const line = '{ name: "value" }';
        const col = 3; // on 'a' of name (unquoted)
        const result = extractQuotedKey(line, col);
        expect(result).toBeNull();
    });

    test('returns null when cursor is on a structural character', () => {
        const line = '{ "key": "value" }';
        const col = 0; // on '{'
        const result = extractQuotedKey(line, col);
        expect(result).toBeNull();
    });

    test('returns correct start/end for range highlighting', () => {
        const line = '{ "address.street": 1 }';
        //            0123456789012345678
        const col = 10; // somewhere inside the quoted string
        const result = extractQuotedKey(line, col);
        expect(result).not.toBeNull();
        expect(result!.start).toBe(2); // position of opening "
        expect(result!.end).toBe(18); // position after closing "
        expect(result!.key).toBe('address.street');
    });

    test('handles escaped quotes inside key', () => {
        const line = '{ "key\\"name": 1 }';
        const col = 5;
        const result = extractQuotedKey(line, col);
        expect(result).not.toBeNull();
        expect(result!.key).toBe('key\\"name');
    });

    test('cursor on opening quote still works', () => {
        const line = '{ "address.street": 1 }';
        const col = 2; // on the opening "
        const result = extractQuotedKey(line, col);
        expect(result).not.toBeNull();
        expect(result!.key).toBe('address.street');
    });

    test('cursor on closing quote still works', () => {
        const line = '{ "address.street": 1 }';
        const col = 17; // on the closing "
        const result = extractQuotedKey(line, col);
        expect(result).not.toBeNull();
        expect(result!.key).toBe('address.street');
    });

    test('returns null for empty line', () => {
        const result = extractQuotedKey('', 0);
        expect(result).toBeNull();
    });
});
