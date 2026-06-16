/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { resolveConfirmationWord } from './getConfirmation';

describe('resolveConfirmationWord', () => {
    describe('when no fallback is provided', () => {
        it('returns the original word regardless of length', () => {
            expect(resolveConfirmationWord('myDatabase')).toBe('myDatabase');
            expect(resolveConfirmationWord('a-very-long-name-that-exceeds-the-default-limit')).toBe(
                'a-very-long-name-that-exceeds-the-default-limit',
            );
        });

        it('returns the original word even when it contains non-alpha characters', () => {
            expect(resolveConfirmationWord('my-collection_2024')).toBe('my-collection_2024');
        });
    });

    describe('when a fallback is provided', () => {
        it('returns the original word when it is short and alphabetic only', () => {
            expect(resolveConfirmationWord('myDatabase', { fallbackWord: 'delete' })).toBe('myDatabase');
            expect(resolveConfirmationWord('delete', { fallbackWord: 'remove' })).toBe('delete');
        });

        it('returns the fallback when the word exceeds the default maxLength of 16', () => {
            const longWord = 'averylongdatabasename'; // 21 chars, all alpha
            expect(resolveConfirmationWord(longWord, { fallbackWord: 'delete' })).toBe('delete');
        });

        it('returns the word when it is exactly at the default maxLength limit', () => {
            const exactWord = 'abcdefghijklmnop'; // 16 chars
            expect(resolveConfirmationWord(exactWord, { fallbackWord: 'delete' })).toBe(exactWord);
        });

        it('returns the fallback when the word contains non-alphabetic characters', () => {
            expect(resolveConfirmationWord('my-collection', { fallbackWord: 'delete' })).toBe('delete');
            expect(resolveConfirmationWord('db_2024', { fallbackWord: 'delete' })).toBe('delete');
            expect(resolveConfirmationWord('name with spaces', { fallbackWord: 'delete' })).toBe('delete');
            expect(resolveConfirmationWord('507f1f77bcf86cd799439011', { fallbackWord: 'delete' })).toBe('delete');
        });

        it('respects a custom maxLength', () => {
            const word = 'abcde'; // 5 chars, all alpha
            expect(resolveConfirmationWord(word, { fallbackWord: 'delete', maxLength: 4 })).toBe('delete');
            expect(resolveConfirmationWord(word, { fallbackWord: 'delete', maxLength: 5 })).toBe(word);
            expect(resolveConfirmationWord(word, { fallbackWord: 'delete', maxLength: 10 })).toBe(word);
        });
    });
});
