/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '@vscode-documentdb/schema-analyzer';
import { generateDescriptions } from './generateDescriptions';

describe('generateDescriptions', () => {
    it('adds descriptions with type and percentage for simple document', () => {
        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                name: {
                    'x-occurrence': 100,
                    anyOf: [
                        {
                            type: 'string',
                            'x-bsonType': 'string',
                            'x-typeOccurrence': 100,
                        },
                    ],
                },
            },
        };

        generateDescriptions(schema);

        const nameSchema = schema.properties?.name as JSONSchema;
        expect(nameSchema.description).toBe('String · 100%');
    });

    it('includes min/max stats for numeric fields', () => {
        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                age: {
                    'x-occurrence': 95,
                    anyOf: [
                        {
                            type: 'number',
                            'x-bsonType': 'int32',
                            'x-typeOccurrence': 95,
                            'x-minValue': 18,
                            'x-maxValue': 95,
                        },
                    ],
                },
            },
        };

        generateDescriptions(schema);

        const ageSchema = schema.properties?.age as JSONSchema;
        expect(ageSchema.description).toBe('Int32 · 95% · range: 18–95');
    });

    it('includes length stats for string fields', () => {
        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                name: {
                    'x-occurrence': 100,
                    anyOf: [
                        {
                            type: 'string',
                            'x-bsonType': 'string',
                            'x-typeOccurrence': 100,
                            'x-minLength': 3,
                            'x-maxLength': 50,
                        },
                    ],
                },
            },
        };

        generateDescriptions(schema);

        const nameSchema = schema.properties?.name as JSONSchema;
        expect(nameSchema.description).toBe('String · 100% · length: 3–50');
    });

    it('includes date range stats for date fields', () => {
        const minDate = new Date('2020-01-01T00:00:00.000Z').getTime();
        const maxDate = new Date('2024-12-31T00:00:00.000Z').getTime();

        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                createdAt: {
                    'x-occurrence': 80,
                    anyOf: [
                        {
                            type: 'string',
                            'x-bsonType': 'date',
                            'x-typeOccurrence': 80,
                            'x-minDate': minDate,
                            'x-maxDate': maxDate,
                        },
                    ],
                },
            },
        };

        generateDescriptions(schema);

        const createdAtSchema = schema.properties?.createdAt as JSONSchema;
        expect(createdAtSchema.description).toBe('Date · 80% · range: 2020-01-01 – 2024-12-31');
    });

    it('includes true/false counts for boolean fields', () => {
        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                active: {
                    'x-occurrence': 100,
                    anyOf: [
                        {
                            type: 'boolean',
                            'x-bsonType': 'boolean',
                            'x-typeOccurrence': 100,
                            'x-trueCount': 80,
                            'x-falseCount': 20,
                        },
                    ],
                },
            },
        };

        generateDescriptions(schema);

        const activeSchema = schema.properties?.active as JSONSchema;
        expect(activeSchema.description).toBe('Boolean · 100% · true: 80, false: 20');
    });

    it('handles nested object fields (descriptions at nested level)', () => {
        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                address: {
                    'x-occurrence': 100,
                    anyOf: [
                        {
                            type: 'object',
                            'x-bsonType': 'object',
                            'x-typeOccurrence': 100,
                            'x-documentsInspected': 100,
                            properties: {
                                city: {
                                    'x-occurrence': 100,
                                    anyOf: [
                                        {
                                            type: 'string',
                                            'x-bsonType': 'string',
                                            'x-typeOccurrence': 100,
                                            'x-minLength': 2,
                                            'x-maxLength': 30,
                                        },
                                    ],
                                },
                            },
                        },
                    ],
                },
            },
        };

        generateDescriptions(schema);

        // The parent (address) should also get a description
        const addressSchema = schema.properties?.address as JSONSchema;
        expect(addressSchema.description).toBe('Object · 100%');

        // The nested city should get its own description
        const addressTypeEntry = (addressSchema.anyOf as JSONSchema[])[0];
        const citySchema = addressTypeEntry.properties?.city as JSONSchema;
        expect(citySchema.description).toBe('String · 100% · length: 2–30');
    });

    it('handles polymorphic fields (shows multiple types)', () => {
        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                value: {
                    'x-occurrence': 95,
                    anyOf: [
                        {
                            type: 'number',
                            'x-bsonType': 'int32',
                            'x-typeOccurrence': 60,
                            'x-minValue': 1,
                            'x-maxValue': 100,
                        },
                        {
                            type: 'string',
                            'x-bsonType': 'string',
                            'x-typeOccurrence': 35,
                        },
                    ],
                },
            },
        };

        generateDescriptions(schema);

        const valueSchema = schema.properties?.value as JSONSchema;
        // Dominant type first, then secondary
        expect(valueSchema.description).toBe('Int32 | String · 95% · range: 1–100');
    });
});
