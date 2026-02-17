/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type FieldEntry, getKnownFields, SchemaAnalyzer } from '@vscode-documentdb/schema-analyzer';
import { ObjectId } from 'bson';

describe('getKnownFields', () => {
    it('returns bsonType for primitive fields', () => {
        const analyzer = SchemaAnalyzer.fromDocument({
            _id: new ObjectId(),
            name: 'Alice',
            age: 42,
            score: 3.14,
            active: true,
        });
        const fields = getKnownFields(analyzer.getSchema());

        const nameField = fields.find((f: FieldEntry) => f.path === 'name');
        expect(nameField?.type).toBe('string');
        expect(nameField?.bsonType).toBe('string');

        const ageField = fields.find((f: FieldEntry) => f.path === 'age');
        expect(ageField?.type).toBe('number');
        // bsonType could be 'double' or 'int32' depending on JS runtime
        expect(['double', 'int32']).toContain(ageField?.bsonType);

        const activeField = fields.find((f: FieldEntry) => f.path === 'active');
        expect(activeField?.type).toBe('boolean');
        expect(activeField?.bsonType).toBe('boolean');
    });

    it('returns _id first and sorts alphabetically', () => {
        const analyzer = SchemaAnalyzer.fromDocument({
            _id: new ObjectId(),
            zebra: 1,
            apple: 2,
            mango: 3,
        });
        const fields = getKnownFields(analyzer.getSchema());
        const paths = fields.map((f: FieldEntry) => f.path);

        expect(paths[0]).toBe('_id');
        // Remaining should be alphabetical
        expect(paths.slice(1)).toEqual(['apple', 'mango', 'zebra']);
    });

    it('detects optional fields', () => {
        const analyzer = new SchemaAnalyzer();
        analyzer.addDocument({ _id: new ObjectId(), name: 'Alice', age: 30 });
        analyzer.addDocument({ _id: new ObjectId(), name: 'Bob' }); // no 'age'

        const fields = getKnownFields(analyzer.getSchema());

        const nameField = fields.find((f: FieldEntry) => f.path === 'name');
        expect(nameField?.isSparse).toBeUndefined(); // present in all docs

        const ageField = fields.find((f: FieldEntry) => f.path === 'age');
        expect(ageField?.isSparse).toBe(true); // missing in doc2
    });

    it('returns bsonTypes for polymorphic fields', () => {
        const analyzer = new SchemaAnalyzer();
        analyzer.addDocument({ _id: new ObjectId(), value: 'hello' });
        analyzer.addDocument({ _id: new ObjectId(), value: 42 });

        const fields = getKnownFields(analyzer.getSchema());
        const valueField = fields.find((f: FieldEntry) => f.path === 'value');

        expect(valueField?.bsonTypes).toBeDefined();
        expect(valueField?.bsonTypes).toHaveLength(2);
        expect(valueField?.bsonTypes).toContain('string');
        // Could be 'double' or 'int32'
        expect(valueField?.bsonTypes?.some((t: string) => ['double', 'int32'].includes(t))).toBe(true);
    });

    it('returns arrayItemBsonType for array fields', () => {
        const analyzer = SchemaAnalyzer.fromDocument({
            _id: new ObjectId(),
            tags: ['a', 'b', 'c'],
            scores: [10, 20, 30],
        });
        const fields = getKnownFields(analyzer.getSchema());

        const tagsField = fields.find((f: FieldEntry) => f.path === 'tags');
        expect(tagsField?.type).toBe('array');
        expect(tagsField?.bsonType).toBe('array');
        expect(tagsField?.arrayItemBsonType).toBe('string');

        const scoresField = fields.find((f: FieldEntry) => f.path === 'scores');
        expect(scoresField?.type).toBe('array');
        expect(scoresField?.arrayItemBsonType).toBeDefined();
    });

    it('handles nested object fields', () => {
        const analyzer = SchemaAnalyzer.fromDocument({
            _id: new ObjectId(),
            user: {
                name: 'Alice',
                profile: {
                    bio: 'hello',
                },
            },
        });
        const fields = getKnownFields(analyzer.getSchema());
        const paths = fields.map((f: FieldEntry) => f.path);

        // Objects are expanded, not leaf nodes
        expect(paths).not.toContain('user');
        expect(paths).toContain('user.name');
        expect(paths).toContain('user.profile.bio');
    });

    it('detects optional nested fields', () => {
        const analyzer = new SchemaAnalyzer();
        analyzer.addDocument({ _id: new ObjectId(), user: { name: 'Alice', age: 30 } });
        analyzer.addDocument({ _id: new ObjectId(), user: { name: 'Bob' } }); // no age in nested obj

        const fields = getKnownFields(analyzer.getSchema());

        const nameField = fields.find((f: FieldEntry) => f.path === 'user.name');
        expect(nameField?.isSparse).toBeUndefined(); // present in both objects

        const ageField = fields.find((f: FieldEntry) => f.path === 'user.age');
        expect(ageField?.isSparse).toBe(true); // missing in doc2's user object
    });
});
