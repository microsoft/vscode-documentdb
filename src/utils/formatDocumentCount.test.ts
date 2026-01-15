/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { formatDocumentCount } from './formatDocumentCount';

describe('formatDocumentCount', () => {
    describe('when count is less than 1000', () => {
        it('should format small numbers as-is with "docs" suffix', () => {
            expect(formatDocumentCount(0)).toBe('0 docs');
            expect(formatDocumentCount(1)).toBe('1 docs');
            expect(formatDocumentCount(42)).toBe('42 docs');
            expect(formatDocumentCount(999)).toBe('999 docs');
        });
    });

    describe('when count is 1000 or more', () => {
        it('should format thousands with K suffix', () => {
            expect(formatDocumentCount(1000)).toBe('1K docs');
            expect(formatDocumentCount(1500)).toBe('1.5K docs');
            expect(formatDocumentCount(10000)).toBe('10K docs');
            expect(formatDocumentCount(99999)).toBe('100K docs');
        });

        it('should format millions with M suffix', () => {
            expect(formatDocumentCount(1000000)).toBe('1M docs');
            expect(formatDocumentCount(1500000)).toBe('1.5M docs');
            expect(formatDocumentCount(10000000)).toBe('10M docs');
        });

        it('should format billions with B suffix', () => {
            expect(formatDocumentCount(1000000000)).toBe('1B docs');
            expect(formatDocumentCount(2500000000)).toBe('2.5B docs');
        });
    });
});
