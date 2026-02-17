/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FieldEntry } from '@vscode-documentdb/schema-analyzer';
import { toFieldCompletionItems } from './toFieldCompletionItems';

describe('toFieldCompletionItems', () => {
    it('converts simple fields', () => {
        const fields: FieldEntry[] = [
            { path: 'name', type: 'string', bsonType: 'string' },
            { path: 'age', type: 'number', bsonType: 'int32' },
        ];

        const result = toFieldCompletionItems(fields);

        expect(result).toHaveLength(2);
        expect(result[0].fieldName).toBe('name');
        expect(result[0].displayType).toBe('String');
        expect(result[0].bsonType).toBe('string');
        expect(result[0].insertText).toBe('name');

        expect(result[1].fieldName).toBe('age');
        expect(result[1].displayType).toBe('Int32');
        expect(result[1].bsonType).toBe('int32');
        expect(result[1].insertText).toBe('age');
    });

    it('escapes dotted paths in insertText', () => {
        const fields: FieldEntry[] = [
            { path: 'address.city', type: 'string', bsonType: 'string' },
            { path: 'user.profile.bio', type: 'string', bsonType: 'string' },
        ];

        const result = toFieldCompletionItems(fields);

        expect(result[0].insertText).toBe('"address.city"');
        expect(result[1].insertText).toBe('"user.profile.bio"');
    });

    it('adds $ prefix to referenceText', () => {
        const fields: FieldEntry[] = [
            { path: 'age', type: 'number', bsonType: 'int32' },
            { path: 'address.city', type: 'string', bsonType: 'string' },
        ];

        const result = toFieldCompletionItems(fields);

        expect(result[0].referenceText).toBe('$age');
        expect(result[1].referenceText).toBe('$address.city');
    });

    it('preserves isSparse', () => {
        const fields: FieldEntry[] = [
            { path: 'name', type: 'string', bsonType: 'string', isSparse: false },
            { path: 'nickname', type: 'string', bsonType: 'string', isSparse: true },
            { path: 'email', type: 'string', bsonType: 'string' }, // undefined → false
        ];

        const result = toFieldCompletionItems(fields);

        expect(result[0].isSparse).toBe(false);
        expect(result[1].isSparse).toBe(true);
        expect(result[2].isSparse).toBe(false);
    });

    it('uses correct displayType', () => {
        const fields: FieldEntry[] = [
            { path: '_id', type: 'string', bsonType: 'objectid' },
            { path: 'createdAt', type: 'string', bsonType: 'date' },
            { path: 'active', type: 'boolean', bsonType: 'boolean' },
            { path: 'score', type: 'number', bsonType: 'double' },
            { path: 'tags', type: 'array', bsonType: 'array' },
        ];

        const result = toFieldCompletionItems(fields);

        expect(result[0].displayType).toBe('ObjectId');
        expect(result[1].displayType).toBe('Date');
        expect(result[2].displayType).toBe('Boolean');
        expect(result[3].displayType).toBe('Double');
        expect(result[4].displayType).toBe('Array');
    });
});
