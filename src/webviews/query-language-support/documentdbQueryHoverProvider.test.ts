/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FieldCompletionData } from '../../utils/json/data-api/autocomplete/toFieldCompletionItems';
import { getHoverContent, type FieldDataLookup } from './documentdbQueryHoverProvider';

/** Creates a mock field lookup function from an array of fields. */
function createFieldLookup(fields: FieldCompletionData[]): FieldDataLookup {
    return (word: string) => fields.find((f) => f.fieldName === word);
}

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
            const hover = getHoverContent('gt');
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**$gt**');
        });

        test('includes doc link when available', () => {
            const hover = getHoverContent('$gt');
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('Documentation]');
        });

        test('operator hover has isTrusted set for clickable links', () => {
            const hover = getHoverContent('$gt');
            expect(hover).not.toBeNull();

            const hoverContent = hover!.contents[0] as { isTrusted?: boolean };
            expect(hoverContent.isTrusted).toBe(true);
        });

        test('returns hover for UUID constructor', () => {
            const hover = getHoverContent('UUID');
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**UUID**');
        });
    });

    describe('field hover', () => {
        const fields: FieldCompletionData[] = [
            {
                fieldName: 'age',
                displayType: 'Number',
                bsonType: 'int32',
                isSparse: false,
                insertText: 'age',
                referenceText: '$age',
            },
            {
                fieldName: 'nickname',
                displayType: 'String',
                bsonType: 'string',
                isSparse: true,
                insertText: 'nickname',
                referenceText: '$nickname',
            },
            {
                fieldName: 'rating',
                displayType: 'Double',
                bsonType: 'double',
                bsonTypes: ['double', 'int32'],
                displayTypes: ['Double', 'Int32'],
                isSparse: true,
                insertText: 'rating',
                referenceText: '$rating',
            },
        ];

        test('returns hover for a known field name', () => {
            const hover = getHoverContent('age', createFieldLookup(fields));
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**age**');
        });

        test('shows "Inferred Type" section with type list', () => {
            const hover = getHoverContent('age', createFieldLookup(fields));
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('Inferred Type');
            expect(content).toContain('Number');
        });

        test('shows multiple types for polymorphic fields', () => {
            const hover = getHoverContent('rating', createFieldLookup(fields));
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('Inferred Type');
            expect(content).toContain('Double');
            expect(content).toContain('Int32');
        });

        test('shows sparse indicator for sparse fields', () => {
            const hover = getHoverContent('nickname', createFieldLookup(fields));
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**nickname**');
            expect(content).toContain('sparse');
            expect(content).toContain('not present in all documents');
        });

        test('does NOT show sparse indicator for non-sparse fields', () => {
            const hover = getHoverContent('age', createFieldLookup(fields));
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).not.toContain('sparse');
        });

        test('field hover does NOT set isTrusted (user data is not trusted)', () => {
            const hover = getHoverContent('age', createFieldLookup(fields));
            expect(hover).not.toBeNull();

            const hoverContent = hover!.contents[0] as { isTrusted?: boolean };
            expect(hoverContent.isTrusted).toBeUndefined();
        });

        test('returns null for unknown field when no operator match', () => {
            const hover = getHoverContent('unknownField', createFieldLookup(fields));
            expect(hover).toBeNull();
        });

        test('operators take priority over field names', () => {
            const fieldsWithOperatorName: FieldCompletionData[] = [
                {
                    fieldName: 'gt',
                    displayType: 'String',
                    bsonType: 'string',
                    isSparse: false,
                    insertText: 'gt',
                    referenceText: '$gt',
                },
            ];

            const hover = getHoverContent('gt', createFieldLookup(fieldsWithOperatorName));
            expect(hover).not.toBeNull();

            const content = (hover!.contents[0] as { value: string }).value;
            expect(content).toContain('**$gt**');
        });

        test('returns null for field when no fieldLookup provided', () => {
            const hover = getHoverContent('age');
            expect(hover).toBeNull();
        });
    });
});
