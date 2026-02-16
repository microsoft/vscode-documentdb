/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema, type JSONSchemaMap, type JSONSchemaRef } from '../JSONSchema';
import { getPropertyNamesAtLevel, SchemaAnalyzer } from './SchemaAnalyzer';
import {
    arraysWithDifferentDataTypes,
    complexDocument,
    complexDocumentsArray,
    complexDocumentWithOddTypes,
    embeddedDocumentOnly,
    flatDocument,
    sparseDocumentsArray,
} from './mongoTestDocuments';

describe('DocumentDB Schema Analyzer', () => {
    it('prints out schema for testing', () => {
        const analyzer = SchemaAnalyzer.fromDocument(embeddedDocumentOnly);
        const schema = analyzer.getSchema();
        console.log(JSON.stringify(schema, null, 2));
        expect(schema).toBeDefined();
    });

    it('supports many documents', () => {
        const analyzer = SchemaAnalyzer.fromDocuments(sparseDocumentsArray);
        const schema = analyzer.getSchema();
        expect(schema).toBeDefined();

        // Check that 'x-documentsInspected' is correct
        expect(schema['x-documentsInspected']).toBe(sparseDocumentsArray.length);

        // Check that the schema has the correct root properties
        const expectedRootProperties = new Set(['_id', 'name', 'age', 'email', 'isActive', 'score', 'description']);

        expect(Object.keys(schema.properties || {})).toEqual(
            expect.arrayContaining(Array.from(expectedRootProperties)),
        );

        // Check that the 'name' field is detected correctly
        const nameField = schema.properties?.['name'] as JSONSchema;
        expect(nameField).toBeDefined();
        expect(nameField?.['x-occurrence']).toBeGreaterThan(0);

        // Access 'anyOf' to get the type entries
        const nameFieldTypes = nameField.anyOf?.map((typeEntry) => (typeEntry as JSONSchema)['type']);
        expect(nameFieldTypes).toContain('string');

        // Check that the 'age' field has the correct type
        const ageField = schema.properties?.['age'] as JSONSchema;
        expect(ageField).toBeDefined();
        const ageFieldTypes = ageField.anyOf?.map((typeEntry) => (typeEntry as JSONSchema)['type']);
        expect(ageFieldTypes).toContain('number');

        // Check that the 'isActive' field is a boolean
        const isActiveField = schema.properties?.['isActive'] as JSONSchema;
        expect(isActiveField).toBeDefined();
        const isActiveTypes = isActiveField.anyOf?.map((typeEntry) => (typeEntry as JSONSchema)['type']);
        expect(isActiveTypes).toContain('boolean');

        // Check that the 'description' field is optional (occurs in some documents)
        const descriptionField = schema.properties?.['description'] as JSONSchema | undefined;
        expect(descriptionField).toBeDefined();
        expect(descriptionField?.['x-occurrence']).toBeLessThan(sparseDocumentsArray.length);
    });

    it('detects all BSON types from flatDocument', () => {
        const analyzer = SchemaAnalyzer.fromDocument(flatDocument);
        const schema = analyzer.getSchema();

        // Check that all fields are detected
        const expectedFields = Object.keys(flatDocument);
        expect(Object.keys(schema.properties || {})).toEqual(expect.arrayContaining(expectedFields));

        // Helper function to get the 'x-bsonType' from a field
        function getBsonType(fieldName: string): string | undefined {
            const field = schema.properties?.[fieldName] as JSONSchema | undefined;
            const anyOf = field?.anyOf;
            return anyOf && (anyOf[0] as JSONSchema | undefined)?.['x-bsonType'];
        }

        // Check that specific BSON types are correctly identified
        expect(getBsonType('int32Field')).toBe('int32');
        expect(getBsonType('doubleField')).toBe('double');
        expect(getBsonType('decimalField')).toBe('decimal128');
        expect(getBsonType('dateField')).toBe('date');
        expect(getBsonType('objectIdField')).toBe('objectid');
        expect(getBsonType('codeField')).toBe('code');
        expect(getBsonType('uuidField')).toBe('uuid');
        expect(getBsonType('uuidLegacyField')).toBe('uuid-legacy');
    });

    it('detects embedded objects correctly', () => {
        const analyzer = SchemaAnalyzer.fromDocument(embeddedDocumentOnly);
        const schema = analyzer.getSchema();

        // Check that the root properties are detected
        expect(schema.properties).toHaveProperty('personalInfo');
        expect(schema.properties).toHaveProperty('jobInfo');

        // Access 'personalInfo' properties
        const personalInfoAnyOf =
            schema.properties && (schema.properties['personalInfo'] as JSONSchema | undefined)?.anyOf;
        const personalInfoProperties = (personalInfoAnyOf?.[0] as JSONSchema | undefined)?.properties;
        expect(personalInfoProperties).toBeDefined();
        expect(personalInfoProperties).toHaveProperty('name');
        expect(personalInfoProperties).toHaveProperty('age');
        expect(personalInfoProperties).toHaveProperty('married');
        expect(personalInfoProperties).toHaveProperty('address');

        // Access 'address' properties within 'personalInfo'
        const addressAnyOf = ((personalInfoProperties as JSONSchemaMap)['address'] as JSONSchema).anyOf;
        const addressProperties = (addressAnyOf?.[0] as JSONSchema | undefined)?.properties;
        expect(addressProperties).toBeDefined();
        expect(addressProperties).toHaveProperty('street');
        expect(addressProperties).toHaveProperty('city');
        expect(addressProperties).toHaveProperty('zip');
    });

    it('detects arrays and their element types correctly', () => {
        const analyzer = SchemaAnalyzer.fromDocument(arraysWithDifferentDataTypes);
        const schema = analyzer.getSchema();

        // Check that arrays are detected
        expect(schema.properties).toHaveProperty('integersArray');
        expect(schema.properties).toHaveProperty('stringsArray');
        expect(schema.properties).toHaveProperty('booleansArray');
        expect(schema.properties).toHaveProperty('mixedArray');
        expect(schema.properties).toHaveProperty('datesArray');

        // Helper function to get item types from an array field
        function getArrayItemTypes(fieldName: string): string[] | undefined {
            const field = schema.properties?.[fieldName] as JSONSchema | undefined;
            const anyOf = field?.anyOf;
            const itemsAnyOf: JSONSchemaRef[] | undefined = (
                (anyOf?.[0] as JSONSchema | undefined)?.items as JSONSchema | undefined
            )?.anyOf;
            return itemsAnyOf?.map((typeEntry) => (typeEntry as JSONSchema)['type'] as string);
        }

        // Check that 'integersArray' has elements of type 'number'
        const integerItemTypes = getArrayItemTypes('integersArray');
        expect(integerItemTypes).toContain('number');

        // Check that 'stringsArray' has elements of type 'string'
        const stringItemTypes = getArrayItemTypes('stringsArray');
        expect(stringItemTypes).toContain('string');

        // Check that 'mixedArray' contains multiple types
        const mixedItemTypes = getArrayItemTypes('mixedArray');
        expect(mixedItemTypes).toEqual(expect.arrayContaining(['number', 'string', 'boolean', 'object', 'null']));
    });

    it('handles arrays within objects and objects within arrays', () => {
        const analyzer = SchemaAnalyzer.fromDocument(complexDocument);
        const schema = analyzer.getSchema();

        // Access 'user.profile.hobbies'
        const user = schema.properties?.['user'] as JSONSchema | undefined;
        const userProfile = (user?.anyOf?.[0] as JSONSchema | undefined)?.properties?.['profile'] as
            | JSONSchema
            | undefined;
        const hobbies = (userProfile?.anyOf?.[0] as JSONSchema | undefined)?.properties?.['hobbies'] as
            | JSONSchema
            | undefined;
        const hobbiesItems = (hobbies?.anyOf?.[0] as JSONSchema | undefined)?.items as JSONSchema | undefined;
        const hobbiesItemTypes = hobbiesItems?.anyOf?.map((typeEntry) => (typeEntry as JSONSchema).type);
        expect(hobbiesItemTypes).toContain('string');

        // Access 'user.profile.addresses'
        const addresses = (userProfile?.anyOf?.[0] as JSONSchema | undefined)?.properties?.['addresses'] as
            | JSONSchema
            | undefined;
        const addressesItems = (addresses?.anyOf?.[0] as JSONSchema | undefined)?.items as JSONSchema | undefined;
        const addressItemTypes = addressesItems?.anyOf?.map((typeEntry) => (typeEntry as JSONSchema).type);
        expect(addressItemTypes).toContain('object');

        // Check that 'orders' is an array
        const orders = schema.properties?.['orders'] as JSONSchema | undefined;
        expect(orders).toBeDefined();
        const ordersType = (orders?.anyOf?.[0] as JSONSchema | undefined)?.type;
        expect(ordersType).toBe('array');

        // Access 'items' within 'orders'
        const orderItemsParent = (orders?.anyOf?.[0] as JSONSchema | undefined)?.items as JSONSchema | undefined;
        const orderItems = (orderItemsParent?.anyOf?.[0] as JSONSchema | undefined)?.properties?.['items'] as
            | JSONSchema
            | undefined;
        const orderItemsType = (orderItems?.anyOf?.[0] as JSONSchema | undefined)?.type;
        expect(orderItemsType).toBe('array');
    });

    it('updates schema correctly when processing multiple documents', () => {
        const analyzer = SchemaAnalyzer.fromDocuments(complexDocumentsArray);
        const schema = analyzer.getSchema();

        // Check that 'x-documentsInspected' is correct
        expect(schema['x-documentsInspected']).toBe(complexDocumentsArray.length);

        // Check that some fields are present from different documents
        expect(schema.properties).toHaveProperty('stringField');
        expect(schema.properties).toHaveProperty('personalInfo');
        expect(schema.properties).toHaveProperty('integersArray');
        expect(schema.properties).toHaveProperty('user');

        // Check that 'integersArray' has correct min and max values
        const integersArray = schema.properties?.['integersArray'] as JSONSchema | undefined;
        const integerItemType = ((integersArray?.anyOf?.[0] as JSONSchema | undefined)?.items as JSONSchema | undefined)
            ?.anyOf?.[0] as JSONSchema | undefined;
        expect(integerItemType?.['x-minValue']).toBe(1);
        expect(integerItemType?.['x-maxValue']).toBe(5);

        // Check that 'orders.items.price' is detected as Decimal128
        const orders2 = schema.properties?.['orders'] as JSONSchema | undefined;
        const orderItemsParent2 = (orders2?.anyOf?.[0] as JSONSchema | undefined)?.items as JSONSchema | undefined;
        const orderItems = (orderItemsParent2?.anyOf?.[0] as JSONSchema | undefined)?.properties?.['items'] as
            | JSONSchema
            | undefined;
        const priceFieldParent = ((orderItems?.anyOf?.[0] as JSONSchema | undefined)?.items as JSONSchema | undefined)
            ?.anyOf?.[0] as JSONSchema | undefined;
        const priceField = priceFieldParent?.properties?.['price'] as JSONSchema | undefined;
        const priceFieldType = priceField?.anyOf?.[0] as JSONSchema | undefined;
        expect(priceFieldType?.['x-bsonType']).toBe('decimal128');
    });

    describe('traverses schema', () => {
        it('with valid paths', () => {
            const analyzer = SchemaAnalyzer.fromDocument(complexDocument);
            const schema = analyzer.getSchema();

            let propertiesAtRoot = getPropertyNamesAtLevel(schema, []);
            expect(propertiesAtRoot).toHaveLength(4);

            propertiesAtRoot = getPropertyNamesAtLevel(schema, ['user']);
            expect(propertiesAtRoot).toHaveLength(3);

            propertiesAtRoot = getPropertyNamesAtLevel(schema, ['user', 'profile']);
            expect(propertiesAtRoot).toHaveLength(4);
        });

        it('with broken paths', () => {
            const analyzer = SchemaAnalyzer.fromDocument(complexDocument);
            const schema = analyzer.getSchema();

            const propertiesAtRoot = getPropertyNamesAtLevel(schema, []);
            expect(propertiesAtRoot).toHaveLength(4);

            expect(() => getPropertyNamesAtLevel(schema, ['no-entry'])).toThrow();

            expect(() => getPropertyNamesAtLevel(schema, ['user', 'no-entry'])).toThrow();
        });

        it('with sparse docs and mixed types', () => {
            const analyzer = new SchemaAnalyzer();
            analyzer.addDocument(complexDocument);
            analyzer.addDocument(complexDocumentWithOddTypes);
            const schema = analyzer.getSchema();

            let propertiesAtRoot = getPropertyNamesAtLevel(schema, []);
            expect(propertiesAtRoot).toHaveLength(4);

            propertiesAtRoot = getPropertyNamesAtLevel(schema, ['user']);
            expect(propertiesAtRoot).toHaveLength(3);
            expect(propertiesAtRoot).toEqual(['email', 'profile', 'username']);

            propertiesAtRoot = getPropertyNamesAtLevel(schema, ['user', 'profile']);
            expect(propertiesAtRoot).toHaveLength(4);
            expect(propertiesAtRoot).toEqual(['addresses', 'firstName', 'hobbies', 'lastName']);

            propertiesAtRoot = getPropertyNamesAtLevel(schema, ['history']);
            expect(propertiesAtRoot).toHaveLength(6);
        });
    });

    describe('SchemaAnalyzer class methods', () => {
        it('clone() creates an independent deep copy', () => {
            // Use embeddedDocumentOnly (plain JS types) to avoid structuredClone issues with BSON types
            const original = SchemaAnalyzer.fromDocument(embeddedDocumentOnly);
            const cloned = original.clone();

            // Clone has the same document count
            expect(cloned.getDocumentCount()).toBe(1);

            // Clone has the same properties
            const originalProps = Object.keys(original.getSchema().properties || {});
            const clonedProps = Object.keys(cloned.getSchema().properties || {});
            expect(clonedProps).toEqual(originalProps);

            // Add another document to the original only
            original.addDocument(arraysWithDifferentDataTypes);
            expect(original.getDocumentCount()).toBe(2);
            expect(cloned.getDocumentCount()).toBe(1);

            // Clone's schema was NOT affected by the mutation
            const originalPropsAfter = Object.keys(original.getSchema().properties || {});
            const clonedPropsAfter = Object.keys(cloned.getSchema().properties || {});
            expect(originalPropsAfter).toContain('integersArray');
            expect(originalPropsAfter).toContain('stringsArray');
            expect(clonedPropsAfter).not.toContain('integersArray');
            expect(clonedPropsAfter).not.toContain('stringsArray');
        });

        it('reset() clears all accumulated state', () => {
            const analyzer = SchemaAnalyzer.fromDocument(flatDocument);
            expect(analyzer.getDocumentCount()).toBeGreaterThan(0);
            expect(Object.keys(analyzer.getSchema().properties || {})).not.toHaveLength(0);

            analyzer.reset();

            expect(analyzer.getDocumentCount()).toBe(0);
            const schema = analyzer.getSchema();
            expect(schema.properties).toBeUndefined();
            expect(schema['x-documentsInspected']).toBeUndefined();
        });

        it('fromDocument() creates analyzer with single document', () => {
            const analyzer = SchemaAnalyzer.fromDocument(flatDocument);
            expect(analyzer.getDocumentCount()).toBe(1);

            const schema = analyzer.getSchema();
            const expectedFields = Object.keys(flatDocument);
            expect(Object.keys(schema.properties || {})).toEqual(expect.arrayContaining(expectedFields));
        });

        it('fromDocuments() creates analyzer with multiple documents', () => {
            const analyzer = SchemaAnalyzer.fromDocuments(sparseDocumentsArray);
            expect(analyzer.getDocumentCount()).toBe(sparseDocumentsArray.length);

            // Compare with manually-built analyzer
            const manual = new SchemaAnalyzer();
            manual.addDocuments(sparseDocumentsArray);

            expect(JSON.stringify(analyzer.getSchema())).toBe(JSON.stringify(manual.getSchema()));
        });

        it('addDocuments() is equivalent to multiple addDocument() calls', () => {
            const batch = new SchemaAnalyzer();
            batch.addDocuments(complexDocumentsArray);

            const sequential = new SchemaAnalyzer();
            for (const doc of complexDocumentsArray) {
                sequential.addDocument(doc);
            }

            expect(batch.getDocumentCount()).toBe(sequential.getDocumentCount());
            expect(JSON.stringify(batch.getSchema())).toBe(JSON.stringify(sequential.getSchema()));
        });
    });
});
