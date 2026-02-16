/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectId, type Document, type WithId } from 'mongodb';
import { type JSONSchema } from '../JSONSchema';
import { SchemaAnalyzer } from './SchemaAnalyzer';

/**
 * This test file investigates the array element occurrence/stats problem.
 *
 * The core issue: When an array contains mixed types (e.g., strings AND objects),
 * `x-typeOccurrence` on the items' type entries counts individual elements across
 * ALL documents, not occurrences-per-document. This makes "field presence probability"
 * for nested object properties inside arrays hard to interpret.
 *
 * Example scenario:
 *   doc1.data = ["a", "b", "c", {"value": 23}]           → 3 strings, 1 object
 *   doc2.data = ["x", "y", {"value": 42, "flag": true}]  → 2 strings, 1 object
 *   doc3.data = ["z"]                                     → 1 string, 0 objects
 *
 * After processing 3 docs:
 *   - items.anyOf[string].x-typeOccurrence = 6 (total string elements across all docs)
 *   - items.anyOf[object].x-typeOccurrence = 2 (total object elements across all docs)
 *   - items.anyOf[object].properties.value.x-occurrence = 2 (from 2 object elements)
 *   - items.anyOf[object].properties.flag.x-occurrence = 1 (from 1 object element)
 *
 * The problem: what is items.anyOf[object].properties.value's "probability"?
 *   - 2/2? (present in every object element → makes sense)
 *   - 2/3? (present in 2 of 3 documents → misleading, doc3 has no objects at all)
 *   - 2/6? (present in 2 of 6 total elements → nonsensical, mixes types)
 *
 * There's no x-documentsInspected equivalent at the array level to anchor
 * the occurrence count.
 */
describe('Array element occurrence analysis', () => {
    it('counts element types across multiple documents', () => {
        const analyzer = new SchemaAnalyzer();

        const doc1: WithId<Document> = {
            _id: new ObjectId(),
            data: ['a', 'b', 'c', { value: 23 }],
        };
        const doc2: WithId<Document> = {
            _id: new ObjectId(),
            data: ['x', 'y', { value: 42, flag: true }],
        };
        const doc3: WithId<Document> = {
            _id: new ObjectId(),
            data: ['z'],
        };

        analyzer.addDocument(doc1);
        analyzer.addDocument(doc2);
        analyzer.addDocument(doc3);
        const schema = analyzer.getSchema();

        // data field: array seen in 3 docs
        const dataField = schema.properties?.['data'] as JSONSchema;
        expect(dataField['x-occurrence']).toBe(3);

        // The array type entry
        const arrayTypeEntry = dataField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;
        expect(arrayTypeEntry).toBeDefined();
        expect(arrayTypeEntry['x-typeOccurrence']).toBe(3);

        // Array items
        const itemsSchema = arrayTypeEntry.items as JSONSchema;
        const stringEntry = itemsSchema.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'string') as JSONSchema;
        const objectEntry = itemsSchema.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'object') as JSONSchema;

        // String elements: "a","b","c","x","y","z" = 6 total
        expect(stringEntry['x-typeOccurrence']).toBe(6);

        // Object elements: {value:23}, {value:42,flag:true} = 2 total
        expect(objectEntry['x-typeOccurrence']).toBe(2);

        // Properties inside the object elements
        const valueField = objectEntry.properties?.['value'] as JSONSchema;
        const flagField = objectEntry.properties?.['flag'] as JSONSchema;

        // "value" appeared in both objects → x-occurrence = 2
        expect(valueField['x-occurrence']).toBe(2);

        // "flag" appeared in 1 object → x-occurrence = 1
        expect(flagField['x-occurrence']).toBe(1);

        // THE CORE QUESTION: What is the denominator for probability?
        //
        // We know objectEntry['x-typeOccurrence'] = 2 (2 objects total across all arrays).
        // So valueField probability = 2/2 = 100% (correct: every object had "value")
        // And flagField probability = 1/2 = 50% (correct: half of objects had "flag")
        //
        // BUT: there is NO x-documentsInspected on objectEntry to formally define
        // the denominator. The consumer has to know to use x-typeOccurrence as the
        // denominator for nested properties inside array elements.
        //
        // This actually WORKS — the semantics are:
        //   "of the N objects observed inside this array, M had this property"
        //
        // It just isn't obvious from the schema structure.
    });

    it('tracks min/max array lengths across documents', () => {
        const analyzer = new SchemaAnalyzer();

        const doc1: WithId<Document> = {
            _id: new ObjectId(),
            tags: ['a', 'b', 'c'],
        };
        const doc2: WithId<Document> = {
            _id: new ObjectId(),
            tags: ['x'],
        };
        const doc3: WithId<Document> = {
            _id: new ObjectId(),
            tags: ['p', 'q', 'r', 's', 't'],
        };

        analyzer.addDocument(doc1);
        analyzer.addDocument(doc2);
        analyzer.addDocument(doc3);
        const schema = analyzer.getSchema();

        const tagsField = schema.properties?.['tags'] as JSONSchema;
        const arrayEntry = tagsField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;

        expect(arrayEntry['x-minItems']).toBe(1);
        expect(arrayEntry['x-maxItems']).toBe(5);
    });

    it('accumulates nested object properties from objects inside arrays across documents', () => {
        const analyzer = new SchemaAnalyzer();

        // doc1 has two objects with different properties in the items array
        const doc1: WithId<Document> = {
            _id: new ObjectId(),
            items: [
                { name: 'Laptop', price: 999 },
                { name: 'Mouse', price: 29, discount: true },
            ],
        };

        // doc2 has one object with yet another property
        const doc2: WithId<Document> = {
            _id: new ObjectId(),
            items: [{ name: 'Desk', weight: 50 }],
        };

        analyzer.addDocument(doc1);
        analyzer.addDocument(doc2);
        const schema = analyzer.getSchema();

        const itemsField = schema.properties?.['items'] as JSONSchema;
        const arrayEntry = itemsField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;
        const objEntry = (arrayEntry.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;

        const props = objEntry.properties as JSONSchema;

        // "name" appeared in all 3 object elements
        expect((props['name'] as JSONSchema)['x-occurrence']).toBe(3);

        // "price" appeared in 2 of 3 object elements
        expect((props['price'] as JSONSchema)['x-occurrence']).toBe(2);

        // "discount" appeared in 1 of 3 object elements
        expect((props['discount'] as JSONSchema)['x-occurrence']).toBe(1);

        // "weight" appeared in 1 of 3 object elements
        expect((props['weight'] as JSONSchema)['x-occurrence']).toBe(1);

        // Total object elements = 3 (2 from doc1 + 1 from doc2)
        expect(objEntry['x-typeOccurrence']).toBe(3);

        // So probability interpretations:
        //   name: 3/3 = 100%
        //   price: 2/3 = 67%
        //   discount: 1/3 = 33%
        //   weight: 1/3 = 33%
        //
        // This is correct! x-typeOccurrence serves as the denominator.
    });

    it('handles arrays that ONLY contain primitives (no occurrence complexity)', () => {
        const analyzer = new SchemaAnalyzer();

        const doc1: WithId<Document> = {
            _id: new ObjectId(),
            scores: [90, 85, 78],
        };
        const doc2: WithId<Document> = {
            _id: new ObjectId(),
            scores: [100, 55],
        };

        analyzer.addDocument(doc1);
        analyzer.addDocument(doc2);
        const schema = analyzer.getSchema();

        const scoresField = schema.properties?.['scores'] as JSONSchema;
        const arrayEntry = scoresField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;

        const numEntry = (arrayEntry.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'double',
        ) as JSONSchema;

        // 5 total numeric elements
        expect(numEntry['x-typeOccurrence']).toBe(5);

        // Stats across all elements
        expect(numEntry['x-minValue']).toBe(55);
        expect(numEntry['x-maxValue']).toBe(100);

        // Array length stats
        expect(arrayEntry['x-minItems']).toBe(2);
        expect(arrayEntry['x-maxItems']).toBe(3);
    });

    it('verifies that encounteredMongoTypes map is per-document', () => {
        // The encounteredMongoTypes map is created inside the Array case handler.
        // It controls whether initializeStatsForValue or aggregateStatsForValue is called.
        // If it's per-array-occurrence (per document), stats should initialize fresh for each doc.
        //
        // BUT WAIT: The map is local to the switch case, which processes ONE array per queue item.
        // Multiple documents contribute different queue items, and the map is re-created for each.
        // However, the stats update goes to the SAME itemEntry across documents (because
        // findTypeEntry finds the existing entry). So:
        //
        // doc1.scores = [10, 20]  → first array processing, encounteredMongoTypes fresh
        //   - element 10: initializeStatsForValue (sets x-minValue=10, x-maxValue=10)
        //   - element 20: aggregateStatsForValue (updates x-maxValue=20)
        //
        // doc2.scores = [5, 30]   → second array processing, encounteredMongoTypes fresh
        //   - element 5: initializeStatsForValue ← BUT x-minValue is already 10 from doc1!
        //     initializeStatsForValue OVERWRITES x-minValue to 5 (correct by accident here)
        //     Actually let's check... initializeStatsForValue sets x-maxValue = 5
        //     and x-minValue = 5. So the 20 from doc1 would be lost!
        //
        // This is a REAL BUG: initializeStatsForValue is called for the first occurrence
        // per array, but the typeEntry already has stats from previous arrays.

        const analyzer = new SchemaAnalyzer();

        const doc1: WithId<Document> = {
            _id: new ObjectId(),
            scores: [10, 20, 30],
        };
        const doc2: WithId<Document> = {
            _id: new ObjectId(),
            scores: [5, 15],
        };

        analyzer.addDocument(doc1);
        analyzer.addDocument(doc2);
        const schema = analyzer.getSchema();

        const scoresField = schema.properties?.['scores'] as JSONSchema;
        const arrayEntry = scoresField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;

        const numEntry = (arrayEntry.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'double',
        ) as JSONSchema;

        // Expected correct values:
        // All 5 elements: 10, 20, 30, 5, 15
        // Global min = 5, global max = 30

        // If there's a bug, doc2 processing re-initializes:
        //   after doc1: min=10, max=30
        //   doc2 first element (5): initializeStatsForValue → sets min=5, max=5
        //   doc2 second element (15): aggregateStatsForValue → max becomes 15
        //   final: min=5, max=15 ← WRONG (lost 30 from doc1)

        // Let's check what actually happens:
        console.log('numEntry x-minValue:', numEntry['x-minValue']);
        console.log('numEntry x-maxValue:', numEntry['x-maxValue']);

        // This test documents the actual behavior (might be buggy):
        expect(numEntry['x-minValue']).toBe(5);
        // If the bug exists, this will be 15 instead of 30:
        expect(numEntry['x-maxValue']).toBe(30); // should be 30 if correct
    });
});

describe('Array probability denominator problem', () => {
    it('reproduces the >100% probability bug: empty array + large array', () => {
        // User scenario:
        //   doc1: a = []                             → 0 objects
        //   doc2: a = [{b:1}, {b:2}, ..., {b:100}]   → 100 objects
        //
        // Naively computing probability as:
        //   occurrence_of_b / root.x-documentsInspected = 100 / 2 = 5000%
        //
        // The correct probability should be:
        //   occurrence_of_b / objectEntry.x-typeOccurrence = 100 / 100 = 100%
        //
        // FIX: Set x-documentsInspected on the object type entry so the uniform
        //      formula `x-occurrence / parent.x-documentsInspected` works at every
        //      nesting level.

        const analyzer = new SchemaAnalyzer();

        const doc1: WithId<Document> = {
            _id: new ObjectId(),
            a: [], // empty array
        };

        // doc2: 100 objects, each with property "b"
        const objectElements: Record<string, unknown>[] = [];
        for (let i = 1; i <= 100; i++) {
            objectElements.push({ b: i });
        }
        const doc2: WithId<Document> = {
            _id: new ObjectId(),
            a: objectElements,
        };

        analyzer.addDocument(doc1);
        analyzer.addDocument(doc2);
        const schema = analyzer.getSchema();

        // Root level
        expect(schema['x-documentsInspected']).toBe(2);

        // Navigate to the object type entry inside the array
        const aField = schema.properties?.['a'] as JSONSchema;
        expect(aField['x-occurrence']).toBe(2); // both docs have 'a'

        const arrayEntry = aField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;
        const objectEntry = (arrayEntry.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;

        // 100 object elements total
        expect(objectEntry['x-typeOccurrence']).toBe(100);

        // Property "b" appears in all 100 objects
        const bField = objectEntry.properties?.['b'] as JSONSchema;
        expect(bField['x-occurrence']).toBe(100);

        // THE FIX: objectEntry should have x-documentsInspected = 100
        // so that the uniform formula works:
        //   probability = b.x-occurrence / objectEntry.x-documentsInspected
        //              = 100 / 100 = 100%
        expect(objectEntry['x-documentsInspected']).toBe(100);
    });

    it('correctly computes probability for sparse properties in array objects', () => {
        // doc1: items = [{name:"A", price:10}, {name:"B"}]  → 2 objects, name in both, price in 1
        // doc2: items = [{name:"C", discount:true}]          → 1 object
        //
        // Total objects = 3
        // name: 3/3 = 100%
        // price: 1/3 = 33%
        // discount: 1/3 = 33%

        const analyzer = new SchemaAnalyzer();

        const doc1: WithId<Document> = {
            _id: new ObjectId(),
            items: [{ name: 'A', price: 10 }, { name: 'B' }],
        };
        const doc2: WithId<Document> = {
            _id: new ObjectId(),
            items: [{ name: 'C', discount: true }],
        };

        analyzer.addDocument(doc1);
        analyzer.addDocument(doc2);
        const schema = analyzer.getSchema();

        const itemsField = schema.properties?.['items'] as JSONSchema;
        const arrayEntry = itemsField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;
        const objectEntry = (arrayEntry.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;

        // The object type entry should have x-documentsInspected = 3
        expect(objectEntry['x-documentsInspected']).toBe(3);

        const props = objectEntry.properties as Record<string, JSONSchema>;

        // Probability = x-occurrence / x-documentsInspected (uniform formula)
        expect(props['name']['x-occurrence']).toBe(3); // 3/3 = 100%
        expect(props['price']['x-occurrence']).toBe(1); // 1/3 = 33%
        expect(props['discount']['x-occurrence']).toBe(1); // 1/3 = 33%
    });

    it('sets x-documentsInspected on nested objects at all levels', () => {
        // items: [{address: {city: "NY", zip: "10001"}}, {address: {city: "LA"}}]
        //
        // At items.anyOf[object] level: x-documentsInspected = 2
        // At address.anyOf[object] level: x-documentsInspected = 2
        //   city: 2/2 = 100%, zip: 1/2 = 50%

        const analyzer = new SchemaAnalyzer();

        const doc: WithId<Document> = {
            _id: new ObjectId(),
            items: [{ address: { city: 'NY', zip: '10001' } }, { address: { city: 'LA' } }],
        };

        analyzer.addDocument(doc);
        const schema = analyzer.getSchema();

        const itemsField = schema.properties?.['items'] as JSONSchema;
        const arrayEntry = itemsField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'array') as JSONSchema;
        const objectEntry = (arrayEntry.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;

        // 2 objects in the array
        expect(objectEntry['x-documentsInspected']).toBe(2);

        // address.anyOf[object] — the nested object type
        const addressProp = objectEntry.properties?.['address'] as JSONSchema;
        const addressObjEntry = addressProp.anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;

        // Both objects had address, and both addresses were objects
        expect(addressObjEntry['x-documentsInspected']).toBe(2);

        const addrProps = addressObjEntry.properties as Record<string, JSONSchema>;
        expect(addrProps['city']['x-occurrence']).toBe(2); // 2/2 = 100%
        expect(addrProps['zip']['x-occurrence']).toBe(1); // 1/2 = 50%
    });

    it('does NOT change x-documentsInspected at root level (root keeps document count)', () => {
        const analyzer = new SchemaAnalyzer();

        const doc1: WithId<Document> = {
            _id: new ObjectId(),
            name: 'Alice',
            address: { city: 'NY' },
        };
        const doc2: WithId<Document> = {
            _id: new ObjectId(),
            name: 'Bob',
            address: { city: 'LA', zip: '90001' },
        };

        analyzer.addDocument(doc1);
        analyzer.addDocument(doc2);
        const schema = analyzer.getSchema();

        // Root x-documentsInspected is document count, not affected by the fix
        expect(schema['x-documentsInspected']).toBe(2);

        // Root-level probability still works: name.occurrence(2) / documentsInspected(2) = 100%
        const nameField = schema.properties?.['name'] as JSONSchema;
        expect(nameField['x-occurrence']).toBe(2);

        // Nested object: address.anyOf[object] should have x-documentsInspected = 2
        const addressField = schema.properties?.['address'] as JSONSchema;
        const addressObjEntry = addressField.anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;
        expect(addressObjEntry['x-documentsInspected']).toBe(2);

        const addrProps = addressObjEntry.properties as Record<string, JSONSchema>;
        expect(addrProps['city']['x-occurrence']).toBe(2); // 2/2 = 100%
        expect(addrProps['zip']['x-occurrence']).toBe(1); // 1/2 = 50%
    });
});
