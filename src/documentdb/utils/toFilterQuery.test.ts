/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Binary, Decimal128, Int32, Long, ObjectId, Timestamp } from 'bson';
import { MaxKey, MinKey } from 'mongodb';
import { QueryError } from '../errors/QueryError';
import { toFilterQueryObj } from './toFilterQuery';

// Mock vscode
jest.mock('vscode', () => ({
    l10n: {
        t: (message: string, ...args: unknown[]) => {
            let result = message;
            args.forEach((arg, index) => {
                result = result.replace(`{${index}}`, String(arg));
            });
            return result;
        },
    },
}));

// Mock extensionVariables
jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            trace: jest.fn(),
        },
    },
}));

describe('toFilterQuery', () => {
    describe('basic queries', () => {
        test('empty string returns empty object', () => {
            expect(toFilterQueryObj('')).toEqual({});
        });

        test('whitespace-only returns empty object', () => {
            expect(toFilterQueryObj('   ')).toEqual({});
        });

        test('empty object returns empty object', () => {
            expect(toFilterQueryObj('{ }')).toEqual({});
        });

        test('simple string filter', () => {
            expect(toFilterQueryObj('{ "name": "John" }')).toEqual({ name: 'John' });
        });

        test('filter with query operator', () => {
            expect(toFilterQueryObj('{ "age": { "$gt": 30 } }')).toEqual({ age: { $gt: 30 } });
        });

        test('combined filter', () => {
            expect(toFilterQueryObj('{ "name": "John", "age": { "$gt": 30 } }')).toEqual({
                name: 'John',
                age: { $gt: 30 },
            });
        });
    });

    describe('relaxed syntax (new with shell-bson-parser)', () => {
        test('unquoted keys', () => {
            expect(toFilterQueryObj('{ count: 42 }')).toEqual({ count: 42 });
        });

        test('single-quoted strings', () => {
            expect(toFilterQueryObj("{ name: 'Alice' }")).toEqual({ name: 'Alice' });
        });

        test('Math.min expression', () => {
            const result = toFilterQueryObj('{ rating: Math.min(1.7, 2) }');
            expect(result).toEqual({ rating: 1.7 });
        });

        test('unquoted keys with nested operators', () => {
            expect(toFilterQueryObj('{ age: { $gt: 25 } }')).toEqual({ age: { $gt: 25 } });
        });

        test('mixed quoted and unquoted keys', () => {
            expect(toFilterQueryObj('{ name: "Alice", "age": 30 }')).toEqual({ name: 'Alice', age: 30 });
        });
    });

    describe('BSON constructor support', () => {
        test('UUID constructor', () => {
            const result = toFilterQueryObj('{ id: UUID("123e4567-e89b-12d3-a456-426614174000") }');
            expect(result).toHaveProperty('id');
            // shell-bson-parser returns Binary subtype 4 for UUID
            expect(result.id).toBeInstanceOf(Binary);
            expect((result.id as Binary).sub_type).toBe(Binary.SUBTYPE_UUID);
        });

        test('UUID with new keyword', () => {
            const result = toFilterQueryObj('{ userId: new UUID("550e8400-e29b-41d4-a716-446655440000") }');
            expect(result).toHaveProperty('userId');
            expect(result.userId).toBeInstanceOf(Binary);
            expect((result.userId as Binary).sub_type).toBe(Binary.SUBTYPE_UUID);
        });

        test('MinKey constructor', () => {
            const result = toFilterQueryObj('{ start: MinKey() }');
            expect(result).toHaveProperty('start');
            expect(result.start).toBeInstanceOf(MinKey);
        });

        test('MaxKey constructor', () => {
            const result = toFilterQueryObj('{ end: MaxKey() }');
            expect(result).toHaveProperty('end');
            expect(result.end).toBeInstanceOf(MaxKey);
        });

        test('Date constructor', () => {
            const result = toFilterQueryObj('{ created: new Date("2023-01-01") }');
            expect(result).toHaveProperty('created');
            expect(result.created).toBeInstanceOf(Date);
            expect((result.created as Date).toISOString()).toBe('2023-01-01T00:00:00.000Z');
        });

        test('ObjectId constructor', () => {
            const result = toFilterQueryObj('{ _id: ObjectId("507f1f77bcf86cd799439011") }');
            expect(result).toHaveProperty('_id');
            expect(result._id).toBeInstanceOf(ObjectId);
        });

        test('ISODate constructor', () => {
            const result = toFilterQueryObj('{ ts: ISODate("2024-01-01") }');
            expect(result).toHaveProperty('ts');
            expect(result.ts).toBeInstanceOf(Date);
        });

        test('Decimal128 constructor', () => {
            const result = toFilterQueryObj('{ val: Decimal128("1.23") }');
            expect(result).toHaveProperty('val');
            expect(result.val).toBeInstanceOf(Decimal128);
        });

        test('NumberInt constructor', () => {
            const result = toFilterQueryObj('{ n: NumberInt(42) }');
            expect(result).toHaveProperty('n');
            expect(result.n).toBeInstanceOf(Int32);
        });

        test('NumberLong constructor', () => {
            const result = toFilterQueryObj('{ n: NumberLong(42) }');
            expect(result).toHaveProperty('n');
            expect(result.n).toBeInstanceOf(Long);
        });

        test('Timestamp constructor', () => {
            const result = toFilterQueryObj('{ ts: Timestamp(1, 1) }');
            expect(result).toHaveProperty('ts');
            expect(result.ts).toBeInstanceOf(Timestamp);
        });
    });

    describe('mixed BSON types', () => {
        test('multiple BSON constructors in one query', () => {
            const result = toFilterQueryObj(
                '{ id: UUID("123e4567-e89b-12d3-a456-426614174000"), start: MinKey(), end: MaxKey(), created: new Date("2023-01-01") }',
            );

            expect(result.id).toBeInstanceOf(Binary);
            expect((result.id as Binary).sub_type).toBe(Binary.SUBTYPE_UUID);
            expect(result.start).toBeInstanceOf(MinKey);
            expect(result.end).toBeInstanceOf(MaxKey);
            expect(result.created).toBeInstanceOf(Date);
        });

        test('nested BSON constructors', () => {
            const result = toFilterQueryObj(
                '{ range: { start: MinKey(), end: MaxKey() }, timestamp: new Date("2023-01-01") }',
            );

            expect(result.range.start).toBeInstanceOf(MinKey);
            expect(result.range.end).toBeInstanceOf(MaxKey);
            expect(result.timestamp).toBeInstanceOf(Date);
        });
    });

    describe('error handling', () => {
        test('throws QueryError for invalid syntax', () => {
            expect(() => toFilterQueryObj('{ invalid json }')).toThrow(QueryError);
        });

        test('throws QueryError with INVALID_FILTER code', () => {
            let thrownError: QueryError | undefined;
            try {
                toFilterQueryObj('not valid at all');
            } catch (error) {
                thrownError = error as QueryError;
            }
            expect(thrownError).toBeDefined();
            expect(thrownError?.name).toBe('QueryError');
            expect(thrownError?.code).toBe('INVALID_FILTER');
        });

        test('error message contains "Invalid filter syntax"', () => {
            let thrownError: QueryError | undefined;
            try {
                toFilterQueryObj('not valid');
            } catch (error) {
                thrownError = error as QueryError;
            }
            expect(thrownError).toBeDefined();
            expect(thrownError?.message).toContain('Invalid filter syntax');
        });

        test('error message contains helpful example', () => {
            let thrownError: QueryError | undefined;
            try {
                toFilterQueryObj('not valid');
            } catch (error) {
                thrownError = error as QueryError;
            }
            expect(thrownError).toBeDefined();
            expect(thrownError?.message).toContain('name: "value"');
        });
    });
});
