/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectId, type Document, type WithId } from 'mongodb';
import { type JSONSchema } from '../JSONSchema';
import { SchemaAnalyzer } from './SchemaAnalyzer';

// ------------------------------------------------------------------
// Test fixtures
// ------------------------------------------------------------------

function makeDoc(fields: Record<string, unknown> = {}): WithId<Document> {
    return { _id: new ObjectId(), ...fields };
}

// ------------------------------------------------------------------
// Version counter
// ------------------------------------------------------------------
describe('SchemaAnalyzer version counter', () => {
    it('starts at 0 for a new analyzer', () => {
        const analyzer = new SchemaAnalyzer();
        expect(analyzer.version).toBe(0);
    });

    it('increments on addDocument()', () => {
        const analyzer = new SchemaAnalyzer();
        analyzer.addDocument(makeDoc({ a: 1 }));
        expect(analyzer.version).toBe(1);

        analyzer.addDocument(makeDoc({ b: 2 }));
        expect(analyzer.version).toBe(2);
    });

    it('increments only once for addDocuments() (batch)', () => {
        const analyzer = new SchemaAnalyzer();
        const docs = [makeDoc({ a: 1 }), makeDoc({ b: 2 }), makeDoc({ c: 3 })];

        analyzer.addDocuments(docs);
        expect(analyzer.version).toBe(1);
    });

    it('increments on reset()', () => {
        const analyzer = SchemaAnalyzer.fromDocument(makeDoc({ x: 1 }));
        expect(analyzer.version).toBe(1);

        analyzer.reset();
        expect(analyzer.version).toBe(2);
    });

    it('cloned analyzer starts with version 0 (independent from original)', () => {
        const original = new SchemaAnalyzer();
        original.addDocument(makeDoc({ a: 1 }));
        original.addDocument(makeDoc({ b: 2 }));
        expect(original.version).toBe(2);

        const cloned = original.clone();
        expect(cloned.version).toBe(0);

        // Mutating the clone does not affect the original's version
        cloned.addDocument(makeDoc({ c: 3 }));
        expect(cloned.version).toBe(1);
        expect(original.version).toBe(2);
    });

    it('accumulates across mixed operations', () => {
        const analyzer = new SchemaAnalyzer();
        // addDocument +1
        analyzer.addDocument(makeDoc());
        expect(analyzer.version).toBe(1);

        // addDocuments +1 (batch)
        analyzer.addDocuments([makeDoc(), makeDoc()]);
        expect(analyzer.version).toBe(2);

        // reset +1
        analyzer.reset();
        expect(analyzer.version).toBe(3);

        // addDocument after reset +1
        analyzer.addDocument(makeDoc());
        expect(analyzer.version).toBe(4);
    });

    it('fromDocument() factory yields version 1', () => {
        const analyzer = SchemaAnalyzer.fromDocument(makeDoc({ a: 1 }));
        expect(analyzer.version).toBe(1);
    });

    it('fromDocuments() factory yields version 1', () => {
        const analyzer = SchemaAnalyzer.fromDocuments([makeDoc(), makeDoc(), makeDoc()]);
        expect(analyzer.version).toBe(1);
    });
});

// ------------------------------------------------------------------
// Version-based caching (getKnownFields cache)
// ------------------------------------------------------------------
describe('SchemaAnalyzer getKnownFields cache', () => {
    it('is populated on first call to getKnownFields()', () => {
        const analyzer = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice', age: 30 }));
        const fields = analyzer.getKnownFields();

        expect(fields.length).toBeGreaterThan(0);
        // Should contain _id, age, name
        const paths = fields.map((f) => f.path);
        expect(paths).toContain('_id');
        expect(paths).toContain('name');
        expect(paths).toContain('age');
    });

    it('is reused when version has not changed (same reference)', () => {
        const analyzer = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
        const first = analyzer.getKnownFields();
        const second = analyzer.getKnownFields();

        // Same array reference — cache was reused, not recomputed
        expect(second).toBe(first);
    });

    it('is invalidated when addDocument() is called', () => {
        const analyzer = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
        const before = analyzer.getKnownFields();

        analyzer.addDocument(makeDoc({ name: 'Bob', email: 'bob@test.com' }));
        const after = analyzer.getKnownFields();

        // Different reference — cache was recomputed
        expect(after).not.toBe(before);
        // New field should be present
        expect(after.map((f) => f.path)).toContain('email');
    });

    it('is invalidated when addDocuments() is called', () => {
        const analyzer = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
        const before = analyzer.getKnownFields();

        analyzer.addDocuments([makeDoc({ score: 42 }), makeDoc({ level: 7 })]);
        const after = analyzer.getKnownFields();

        expect(after).not.toBe(before);
        const paths = after.map((f) => f.path);
        expect(paths).toContain('score');
        expect(paths).toContain('level');
    });

    it('is invalidated when reset() is called', () => {
        const analyzer = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
        const before = analyzer.getKnownFields();
        expect(before.length).toBeGreaterThan(0);

        analyzer.reset();
        const after = analyzer.getKnownFields();

        expect(after).not.toBe(before);
        // After reset the schema is empty so no fields
        expect(after).toHaveLength(0);
    });

    it('returns updated results after cache invalidation', () => {
        const analyzer = new SchemaAnalyzer();
        // Empty analyzer → no known fields
        expect(analyzer.getKnownFields()).toHaveLength(0);

        // Add first doc
        analyzer.addDocument(makeDoc({ x: 1 }));
        const fields1 = analyzer.getKnownFields();
        expect(fields1.map((f) => f.path)).toEqual(expect.arrayContaining(['_id', 'x']));

        // Add second doc with new field
        analyzer.addDocument(makeDoc({ x: 2, y: 'hello' }));
        const fields2 = analyzer.getKnownFields();
        expect(fields2).not.toBe(fields1);
        expect(fields2.map((f) => f.path)).toContain('y');
    });

    it('clone gets its own independent cache', () => {
        const original = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
        const originalFields = original.getKnownFields();

        const cloned = original.clone();
        const clonedFields = cloned.getKnownFields();

        // Both should have the same content but be independent objects
        expect(clonedFields).not.toBe(originalFields);
        expect(clonedFields.map((f) => f.path)).toEqual(originalFields.map((f) => f.path));

        // Mutating the clone should not affect the original cache
        cloned.addDocument(makeDoc({ extra: true }));
        const clonedFieldsAfter = cloned.getKnownFields();
        expect(clonedFieldsAfter.map((f) => f.path)).toContain('extra');
        expect(original.getKnownFields().map((f) => f.path)).not.toContain('extra');
    });
});

// ------------------------------------------------------------------
// Instances and types counting
// ------------------------------------------------------------------
describe('SchemaAnalyzer instances and types counting', () => {
    describe('x-occurrence (field instance counting)', () => {
        it('counts 1 for a field present in a single document', () => {
            const analyzer = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
            const schema = analyzer.getSchema();
            const nameField = schema.properties?.['name'] as JSONSchema;
            expect(nameField['x-occurrence']).toBe(1);
        });

        it('counts correctly across multiple documents', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ name: 'Alice', age: 30 }));
            analyzer.addDocument(makeDoc({ name: 'Bob', age: 25 }));
            analyzer.addDocument(makeDoc({ name: 'Carol' })); // no age

            const schema = analyzer.getSchema();
            expect((schema.properties?.['name'] as JSONSchema)['x-occurrence']).toBe(3);
            expect((schema.properties?.['age'] as JSONSchema)['x-occurrence']).toBe(2);
        });

        it('counts sparse fields correctly (field missing in some documents)', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ a: 1, b: 2, c: 3 }));
            analyzer.addDocument(makeDoc({ a: 10 })); // only 'a'
            analyzer.addDocument(makeDoc({ a: 100, c: 300 })); // 'a' and 'c'

            const schema = analyzer.getSchema();
            expect((schema.properties?.['a'] as JSONSchema)['x-occurrence']).toBe(3);
            expect((schema.properties?.['b'] as JSONSchema)['x-occurrence']).toBe(1);
            expect((schema.properties?.['c'] as JSONSchema)['x-occurrence']).toBe(2);
        });

        it('counts occurrences for nested object properties', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ user: { name: 'Alice', age: 30 } }));
            analyzer.addDocument(makeDoc({ user: { name: 'Bob' } })); // no age

            const schema = analyzer.getSchema();
            const userField = schema.properties?.['user'] as JSONSchema;
            const objectEntry = userField.anyOf?.find((e) => (e as JSONSchema).type === 'object') as JSONSchema;

            expect((objectEntry.properties?.['name'] as JSONSchema)['x-occurrence']).toBe(2);
            expect((objectEntry.properties?.['age'] as JSONSchema)['x-occurrence']).toBe(1);
        });
    });

    describe('x-typeOccurrence (type counting)', () => {
        it('counts type occurrences for a single-type field', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ name: 'Alice' }));
            analyzer.addDocument(makeDoc({ name: 'Bob' }));
            analyzer.addDocument(makeDoc({ name: 'Carol' }));

            const schema = analyzer.getSchema();
            const nameField = schema.properties?.['name'] as JSONSchema;
            const stringEntry = nameField.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'string',
            ) as JSONSchema;

            expect(stringEntry['x-typeOccurrence']).toBe(3);
        });

        it('counts type occurrences for polymorphic fields', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ value: 'hello' }));
            analyzer.addDocument(makeDoc({ value: 42 }));
            analyzer.addDocument(makeDoc({ value: 'world' }));
            analyzer.addDocument(makeDoc({ value: true }));

            const schema = analyzer.getSchema();
            const valueField = schema.properties?.['value'] as JSONSchema;

            const stringEntry = valueField.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'string',
            ) as JSONSchema;
            const booleanEntry = valueField.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'boolean',
            ) as JSONSchema;

            // 2 strings, 1 number, 1 boolean
            expect(stringEntry['x-typeOccurrence']).toBe(2);
            expect(booleanEntry['x-typeOccurrence']).toBe(1);

            // total x-occurrence should equal sum of x-typeOccurrence values
            const totalTypeOccurrence = (valueField.anyOf as JSONSchema[]).reduce(
                (sum, entry) => sum + ((entry['x-typeOccurrence'] as number) ?? 0),
                0,
            );
            expect(valueField['x-occurrence']).toBe(totalTypeOccurrence);
        });

        it('counts array element types across documents', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ tags: ['a', 'b'] })); // 2 strings
            analyzer.addDocument(makeDoc({ tags: ['c', 42] })); // 1 string + 1 number
            analyzer.addDocument(makeDoc({ tags: [true] })); // 1 boolean

            const schema = analyzer.getSchema();
            const tagsField = schema.properties?.['tags'] as JSONSchema;
            const arrayEntry = tagsField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;
            const itemsSchema = arrayEntry.items as JSONSchema;

            const stringEntry = itemsSchema.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'string',
            ) as JSONSchema;
            const booleanEntry = itemsSchema.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'boolean',
            ) as JSONSchema;

            // 3 string elements total: "a", "b", "c"
            expect(stringEntry['x-typeOccurrence']).toBe(3);

            // 1 boolean element
            expect(booleanEntry['x-typeOccurrence']).toBe(1);
        });

        it('type occurrence count equals field occurrence for a single-type field', () => {
            const analyzer = new SchemaAnalyzer();
            for (let i = 0; i < 5; i++) {
                analyzer.addDocument(makeDoc({ score: i * 10 }));
            }

            const schema = analyzer.getSchema();
            const scoreField = schema.properties?.['score'] as JSONSchema;
            const typeEntries = scoreField.anyOf as JSONSchema[];

            // Only one type, so its typeOccurrence should equal the field occurrence
            expect(typeEntries).toHaveLength(1);
            expect(typeEntries[0]['x-typeOccurrence']).toBe(scoreField['x-occurrence']);
        });
    });

    describe('x-documentsInspected counting', () => {
        it('tracks document count at root level', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ a: 1 }));
            analyzer.addDocument(makeDoc({ b: 2 }));
            analyzer.addDocument(makeDoc({ c: 3 }));

            expect(analyzer.getSchema()['x-documentsInspected']).toBe(3);
            expect(analyzer.getDocumentCount()).toBe(3);
        });

        it('tracks object instances for nested objects', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ info: { x: 1 } }));
            analyzer.addDocument(makeDoc({ info: { x: 2, y: 3 } }));

            const schema = analyzer.getSchema();
            const infoField = schema.properties?.['info'] as JSONSchema;
            const objectEntry = infoField.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'object',
            ) as JSONSchema;

            expect(objectEntry['x-documentsInspected']).toBe(2);
        });

        it('tracks object instances inside arrays accurately', () => {
            const analyzer = new SchemaAnalyzer();
            // doc1: array with 2 objects
            analyzer.addDocument(makeDoc({ items: [{ a: 1 }, { a: 2 }] }));
            // doc2: array with 1 object
            analyzer.addDocument(makeDoc({ items: [{ a: 3, b: 4 }] }));

            const schema = analyzer.getSchema();
            const itemsField = schema.properties?.['items'] as JSONSchema;
            const arrayEntry = itemsField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;
            const objectEntry = (arrayEntry.items as JSONSchema).anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'object',
            ) as JSONSchema;

            // 3 objects total (2 from doc1, 1 from doc2)
            expect(objectEntry['x-documentsInspected']).toBe(3);
            // "a" appears in all 3 objects
            expect((objectEntry.properties?.['a'] as JSONSchema)['x-occurrence']).toBe(3);
            // "b" appears in 1 of 3 objects
            expect((objectEntry.properties?.['b'] as JSONSchema)['x-occurrence']).toBe(1);
        });

        it('resets to 0 after reset()', () => {
            const analyzer = SchemaAnalyzer.fromDocuments([makeDoc({ a: 1 }), makeDoc({ b: 2 })]);
            expect(analyzer.getDocumentCount()).toBe(2);

            analyzer.reset();
            expect(analyzer.getDocumentCount()).toBe(0);
        });
    });

    describe('probability correctness (occurrence / documentsInspected)', () => {
        it('yields 100% for fields present in every document', () => {
            const analyzer = new SchemaAnalyzer();
            for (let i = 0; i < 10; i++) {
                analyzer.addDocument(makeDoc({ name: `user-${i}` }));
            }

            const schema = analyzer.getSchema();
            const occurrence = (schema.properties?.['name'] as JSONSchema)['x-occurrence'] as number;
            const total = schema['x-documentsInspected'] as number;
            expect(occurrence / total).toBe(1);
        });

        it('yields correct fraction for sparse fields', () => {
            const analyzer = new SchemaAnalyzer();
            // 3 docs with 'a', 1 doc with 'b'
            analyzer.addDocument(makeDoc({ a: 1, b: 10 }));
            analyzer.addDocument(makeDoc({ a: 2 }));
            analyzer.addDocument(makeDoc({ a: 3 }));

            const schema = analyzer.getSchema();
            const total = schema['x-documentsInspected'] as number;
            const aOccurrence = (schema.properties?.['a'] as JSONSchema)['x-occurrence'] as number;
            const bOccurrence = (schema.properties?.['b'] as JSONSchema)['x-occurrence'] as number;

            expect(aOccurrence / total).toBe(1); // 3/3
            expect(bOccurrence / total).toBeCloseTo(1 / 3); // 1/3
        });

        it('yields correct fraction for nested objects inside arrays', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(
                makeDoc({
                    items: [
                        { name: 'A', price: 10 },
                        { name: 'B' }, // no price
                    ],
                }),
            );
            analyzer.addDocument(makeDoc({ items: [{ name: 'C', price: 20 }] }));

            const schema = analyzer.getSchema();
            const itemsField = schema.properties?.['items'] as JSONSchema;
            const arrayEntry = itemsField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;
            const objectEntry = (arrayEntry.items as JSONSchema).anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'object',
            ) as JSONSchema;

            const denominator = objectEntry['x-documentsInspected'] as number;
            const nameOccurrence = (objectEntry.properties?.['name'] as JSONSchema)['x-occurrence'] as number;
            const priceOccurrence = (objectEntry.properties?.['price'] as JSONSchema)['x-occurrence'] as number;

            expect(denominator).toBe(3); // 3 objects total
            expect(nameOccurrence / denominator).toBe(1); // 3/3
            expect(priceOccurrence / denominator).toBeCloseTo(2 / 3); // 2/3
        });
    });

    describe('array and nested array counting', () => {
        it('counts x-typeOccurrence for the array type entry across documents', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ tags: ['a'] }));
            analyzer.addDocument(makeDoc({ tags: ['b', 'c'] }));
            analyzer.addDocument(makeDoc({ tags: 42 })); // not an array

            const schema = analyzer.getSchema();
            const tagsField = schema.properties?.['tags'] as JSONSchema;

            // Field seen 3 times total
            expect(tagsField['x-occurrence']).toBe(3);

            const arrayEntry = tagsField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;

            // Array type seen 2 out of 3 times
            expect(arrayEntry['x-typeOccurrence']).toBe(2);

            // x-minItems / x-maxItems tracked across array instances
            expect(arrayEntry['x-minItems']).toBe(1);
            expect(arrayEntry['x-maxItems']).toBe(2);
        });

        it('counts x-minItems / x-maxItems for arrays across documents', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ nums: [1, 2, 3] })); // length 3
            analyzer.addDocument(makeDoc({ nums: [10] })); // length 1
            analyzer.addDocument(makeDoc({ nums: [4, 5, 6, 7, 8] })); // length 5

            const schema = analyzer.getSchema();
            const numsField = schema.properties?.['nums'] as JSONSchema;
            const arrayEntry = numsField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;

            expect(arrayEntry['x-minItems']).toBe(1);
            expect(arrayEntry['x-maxItems']).toBe(5);
            expect(arrayEntry['x-typeOccurrence']).toBe(3);
        });

        it('counts nested arrays (arrays within arrays)', () => {
            const analyzer = new SchemaAnalyzer();
            // matrix is an array of arrays of numbers
            analyzer.addDocument(
                makeDoc({
                    matrix: [
                        [1, 2],
                        [3, 4, 5],
                    ],
                }),
            );
            analyzer.addDocument(makeDoc({ matrix: [[10]] }));

            const schema = analyzer.getSchema();
            const matrixField = schema.properties?.['matrix'] as JSONSchema;
            const outerArrayEntry = matrixField.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'array',
            ) as JSONSchema;

            // Outer array seen in 2 documents
            expect(outerArrayEntry['x-typeOccurrence']).toBe(2);
            // doc1 has 2 inner arrays, doc2 has 1
            expect(outerArrayEntry['x-minItems']).toBe(1);
            expect(outerArrayEntry['x-maxItems']).toBe(2);

            // Inner arrays: items type should be 'array'
            const innerArrayEntry = (outerArrayEntry.items as JSONSchema).anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'array',
            ) as JSONSchema;
            expect(innerArrayEntry).toBeDefined();
            // 3 inner arrays total: [1,2], [3,4,5], [10]
            expect(innerArrayEntry['x-typeOccurrence']).toBe(3);
            // inner array lengths: 2, 3, 1
            expect(innerArrayEntry['x-minItems']).toBe(1);
            expect(innerArrayEntry['x-maxItems']).toBe(3);

            // Elements inside inner arrays are numbers
            const numberEntry = (innerArrayEntry.items as JSONSchema).anyOf?.find(
                (e) => (e as JSONSchema).type === 'number',
            ) as JSONSchema;
            expect(numberEntry).toBeDefined();
            // 6 numbers total: 1,2,3,4,5,10
            expect(numberEntry['x-typeOccurrence']).toBe(6);
        });

        it('counts objects within arrays within objects (deep nesting)', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(
                makeDoc({
                    company: {
                        departments: [
                            { name: 'Eng', employees: [{ role: 'Dev' }, { role: 'QA', level: 3 }] },
                            { name: 'Sales' },
                        ],
                    },
                }),
            );
            analyzer.addDocument(
                makeDoc({
                    company: {
                        departments: [{ name: 'HR', employees: [{ role: 'Recruiter' }] }],
                    },
                }),
            );

            const schema = analyzer.getSchema();

            // company is an object
            const companyField = schema.properties?.['company'] as JSONSchema;
            const companyObj = companyField.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'object',
            ) as JSONSchema;
            expect(companyObj['x-documentsInspected']).toBe(2);

            // departments is an array inside company
            const deptField = companyObj.properties?.['departments'] as JSONSchema;
            const deptArrayEntry = deptField.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'array',
            ) as JSONSchema;
            expect(deptArrayEntry['x-typeOccurrence']).toBe(2);

            // department objects: 2 from doc1 + 1 from doc2 = 3
            const deptObjEntry = (deptArrayEntry.items as JSONSchema).anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'object',
            ) as JSONSchema;
            expect(deptObjEntry['x-documentsInspected']).toBe(3);
            expect(deptObjEntry['x-typeOccurrence']).toBe(3);

            // "name" in all 3 department objects, "employees" in 2 of 3
            expect((deptObjEntry.properties?.['name'] as JSONSchema)['x-occurrence']).toBe(3);
            expect((deptObjEntry.properties?.['employees'] as JSONSchema)['x-occurrence']).toBe(2);

            // employees is an array inside department objects
            const empField = deptObjEntry.properties?.['employees'] as JSONSchema;
            const empArrayEntry = empField.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'array',
            ) as JSONSchema;
            expect(empArrayEntry['x-typeOccurrence']).toBe(2);

            // employee objects: 2 from first dept + 1 from HR = 3
            const empObjEntry = (empArrayEntry.items as JSONSchema).anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'object',
            ) as JSONSchema;
            expect(empObjEntry['x-documentsInspected']).toBe(3);

            // "role" in all 3 employee objects, "level" in 1
            expect((empObjEntry.properties?.['role'] as JSONSchema)['x-occurrence']).toBe(3);
            expect((empObjEntry.properties?.['level'] as JSONSchema)['x-occurrence']).toBe(1);
        });

        it('tracks mixed types inside arrays (objects + primitives)', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(makeDoc({ data: ['hello', { key: 'val' }, 42] }));
            analyzer.addDocument(makeDoc({ data: [{ key: 'v2', extra: true }] }));

            const schema = analyzer.getSchema();
            const dataField = schema.properties?.['data'] as JSONSchema;
            const arrayEntry = dataField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;
            const itemsSchema = arrayEntry.items as JSONSchema;

            // string: 1, object: 2, number: 1
            const stringEntry = itemsSchema.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'string',
            ) as JSONSchema;
            const objectEntry = itemsSchema.anyOf?.find(
                (e) => (e as JSONSchema)['x-bsonType'] === 'object',
            ) as JSONSchema;

            expect(stringEntry['x-typeOccurrence']).toBe(1);
            expect(objectEntry['x-typeOccurrence']).toBe(2);
            expect(objectEntry['x-documentsInspected']).toBe(2);

            // "key" in both objects, "extra" in 1
            expect((objectEntry.properties?.['key'] as JSONSchema)['x-occurrence']).toBe(2);
            expect((objectEntry.properties?.['extra'] as JSONSchema)['x-occurrence']).toBe(1);
        });
    });

    describe('addDocuments vs sequential addDocument equivalence', () => {
        it('produces identical occurrence counts', () => {
            const docs = [makeDoc({ a: 1, b: 'x' }), makeDoc({ a: 2 }), makeDoc({ a: 3, c: true })];

            const batch = new SchemaAnalyzer();
            batch.addDocuments(docs);

            const sequential = new SchemaAnalyzer();
            for (const doc of docs) {
                sequential.addDocument(doc);
            }

            const batchSchema = batch.getSchema();
            const seqSchema = sequential.getSchema();

            // Root counts match
            expect(batchSchema['x-documentsInspected']).toBe(seqSchema['x-documentsInspected']);

            // Field-level occurrence counts match
            for (const key of Object.keys(batchSchema.properties ?? {})) {
                const batchField = batchSchema.properties?.[key] as JSONSchema;
                const seqField = seqSchema.properties?.[key] as JSONSchema;
                expect(batchField['x-occurrence']).toBe(seqField['x-occurrence']);
            }
        });

        it('produces identical type occurrence counts', () => {
            const docs = [makeDoc({ value: 'hello' }), makeDoc({ value: 42 }), makeDoc({ value: 'world' })];

            const batch = new SchemaAnalyzer();
            batch.addDocuments(docs);

            const sequential = new SchemaAnalyzer();
            for (const doc of docs) {
                sequential.addDocument(doc);
            }

            // Stringify the schemas to compare their full type entry structures
            expect(JSON.stringify(batch.getSchema())).toBe(JSON.stringify(sequential.getSchema()));
        });
    });
});
