/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getHoverContent } from './documentdbQueryHoverProvider';

describe('documentdbQueryHoverProvider', () => {
    describe('getHoverContent', () => {
        test('returns hover for known operator $gt', () => {
            const hover = getHoverContent('$gt');
            expect(hover).not.toBeNull();
            expect(hover!.contents).toHaveLength(1);

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**$gt**');
        });

        test('returns hover with description for $eq', () => {
            const hover = getHoverContent('$eq');
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**$eq**');
            // It should have a description line
            expect(content.split('\n').length).toBeGreaterThan(1);
        });

        test('returns hover for BSON constructor ObjectId', () => {
            const hover = getHoverContent('ObjectId');
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**ObjectId**');
        });

        test('returns null for unknown word', () => {
            const hover = getHoverContent('foo');
            expect(hover).toBeNull();
        });

        test('returns null for arbitrary text that is not an operator', () => {
            const hover = getHoverContent('somethingRandom123');
            expect(hover).toBeNull();
        });

        test('word without $ prefix matches operator when prefixed', () => {
            // When cursor is on "gt" (after $ was already output), try $gt
            const hover = getHoverContent('gt');
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**$gt**');
        });

        test('includes doc link when available', () => {
            const hover = getHoverContent('$gt');
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            // $gt is a well-known operator that should have a doc link
            expect(content).toContain('[DocumentDB Docs]');
        });

        test('returns hover for UUID constructor', () => {
            const hover = getHoverContent('UUID');
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**UUID**');
        });
    });
});
