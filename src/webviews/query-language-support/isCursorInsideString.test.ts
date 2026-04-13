/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isCursorInsideString } from './isCursorInsideString';

describe('isCursorInsideString', () => {
    test('returns false for empty text', () => {
        expect(isCursorInsideString('', 0)).toBe(false);
    });

    test('returns false when cursor is outside any string', () => {
        const text = '{ name: "Alice", age: 30 }';
        // cursor after the comma, outside the string
        const cursorOffset = text.indexOf(',') + 1;
        expect(isCursorInsideString(text, cursorOffset)).toBe(false);
    });

    test('returns true when cursor is inside a double-quoted string', () => {
        const text = '{ name: "Ali';
        expect(isCursorInsideString(text, text.length)).toBe(true);
    });

    test('returns true when cursor is inside a single-quoted string', () => {
        const text = "{ name: 'Ali";
        expect(isCursorInsideString(text, text.length)).toBe(true);
    });

    test('returns false when cursor is after a closed string', () => {
        const text = '{ name: "Alice" }';
        // cursor at the space after closing quote
        const cursorOffset = text.indexOf('"', 9) + 1;
        expect(isCursorInsideString(text, cursorOffset)).toBe(false);
    });

    test('handles escaped quotes inside strings', () => {
        const text = '{ name: "has\\"quote';
        // cursor is still inside the string (the \" is escaped)
        expect(isCursorInsideString(text, text.length)).toBe(true);
    });

    test('returns false after escaped quote followed by closing quote', () => {
        const text = '{ name: "has\\"quote" }';
        // cursor after the closing quote
        const closingQuoteIdx = text.lastIndexOf('"');
        expect(isCursorInsideString(text, closingQuoteIdx + 1)).toBe(false);
    });

    // Edge cases from the plan
    test('{ name: "Alice", | } — cursor outside string after comma', () => {
        const text = '{ name: "Alice", ';
        expect(isCursorInsideString(text, text.length)).toBe(false);
    });

    test('{ name: "has:colon" } — cursor inside string at colon', () => {
        const text = '{ name: "has:';
        expect(isCursorInsideString(text, text.length)).toBe(true);
    });

    test('{ name: "has:colon", | } — cursor outside string after comma', () => {
        const text = '{ name: "has:colon", ';
        expect(isCursorInsideString(text, text.length)).toBe(false);
    });

    test('{ tags: ["a", | ] } — cursor outside string in array', () => {
        const text = '{ tags: ["a", ';
        expect(isCursorInsideString(text, text.length)).toBe(false);
    });

    test('{ msg: "has[bracket" } — cursor inside string at bracket', () => {
        const text = '{ msg: "has[';
        expect(isCursorInsideString(text, text.length)).toBe(true);
    });

    test('{ $and: [ | ] } — cursor outside string in array', () => {
        const text = '{ $and: [ ';
        expect(isCursorInsideString(text, text.length)).toBe(false);
    });

    test('handles mixed quote types correctly', () => {
        const text = '{ name: "it\'s" }';
        // The single quote inside double quotes doesn't close anything
        const cursorAfterClosingDouble = text.indexOf('"', 9) + 1;
        expect(isCursorInsideString(text, cursorAfterClosingDouble)).toBe(false);
    });
});
