/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type JSONSchema } from '../../JSONSchema';
import { toTypeScriptDefinition } from './toTypeScriptDefinition';

describe('toTypeScriptDefinition', () => {
    it('generates basic interface with primitive types', () => {
        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                _id: {
                    'x-occurrence': 100,
                    anyOf: [
                        {
                            type: 'string',
                            'x-bsonType': 'objectid',
                            'x-typeOccurrence': 100,
                        },
                    ],
                },
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
                age: {
                    'x-occurrence': 100,
                    anyOf: [
                        {
                            type: 'number',
                            'x-bsonType': 'int32',
                            'x-typeOccurrence': 100,
                        },
                    ],
                },
            },
        };

        const result = toTypeScriptDefinition(schema, 'users');

        expect(result).toContain('interface UsersDocument {');
        expect(result).toContain('    _id: ObjectId;');
        expect(result).toContain('    name: string;');
        expect(result).toContain('    age: number;');
        expect(result).toContain('}');
    });

    it('marks optional fields with ?', () => {
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
                nickname: {
                    'x-occurrence': 50,
                    anyOf: [
                        {
                            type: 'string',
                            'x-bsonType': 'string',
                            'x-typeOccurrence': 50,
                        },
                    ],
                },
            },
        };

        const result = toTypeScriptDefinition(schema, 'users');

        expect(result).toContain('    name: string;');
        expect(result).toContain('    nickname?: string;');
    });

    it('handles nested objects as inline blocks', () => {
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
                                        },
                                    ],
                                },
                                zip: {
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
                        },
                    ],
                },
            },
        };

        const result = toTypeScriptDefinition(schema, 'users');

        expect(result).toContain('    address: {');
        expect(result).toContain('        city: string;');
        expect(result).toContain('        zip: string;');
        expect(result).toContain('    };');
    });

    it('handles arrays with element types', () => {
        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                tags: {
                    'x-occurrence': 100,
                    anyOf: [
                        {
                            type: 'array',
                            'x-bsonType': 'array',
                            'x-typeOccurrence': 100,
                            items: {
                                anyOf: [
                                    {
                                        type: 'string',
                                        'x-bsonType': 'string',
                                        'x-typeOccurrence': 100,
                                    },
                                ],
                            },
                        },
                    ],
                },
            },
        };

        const result = toTypeScriptDefinition(schema, 'posts');

        expect(result).toContain('    tags: string[];');
    });

    it('handles polymorphic fields as unions', () => {
        const schema: JSONSchema = {
            'x-documentsInspected': 100,
            properties: {
                metadata: {
                    'x-occurrence': 80,
                    anyOf: [
                        {
                            type: 'string',
                            'x-bsonType': 'string',
                            'x-typeOccurrence': 50,
                        },
                        {
                            type: 'number',
                            'x-bsonType': 'int32',
                            'x-typeOccurrence': 20,
                        },
                        {
                            type: 'null',
                            'x-bsonType': 'null',
                            'x-typeOccurrence': 10,
                        },
                    ],
                },
            },
        };

        const result = toTypeScriptDefinition(schema, 'items');

        expect(result).toContain('    metadata?: string | number | null;');
    });

    it('PascalCase conversion for collection name', () => {
        expect(toTypeScriptDefinition({ 'x-documentsInspected': 0 }, 'users')).toContain('interface UsersDocument');
        expect(toTypeScriptDefinition({ 'x-documentsInspected': 0 }, 'order_items')).toContain(
            'interface OrderItemsDocument',
        );
        expect(toTypeScriptDefinition({ 'x-documentsInspected': 0 }, 'my-awesome-collection')).toContain(
            'interface MyAwesomeCollectionDocument',
        );
    });
});
