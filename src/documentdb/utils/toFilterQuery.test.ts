/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MaxKey, MinKey, UUID } from 'mongodb';
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

// Basic query examples
const basicQueries = [
    { input: '{ }', expected: {} },
    { input: '{ "name": "John" }', expected: { name: 'John' } },
    { input: '{ "name": "John", "age": { "$gt": 30 } }', expected: { name: 'John', age: { $gt: 30 } } },
];

// BSON function examples with different variations
const bsonFunctionTestCases = [
    // UUID cases
    {
        type: 'UUID',
        input: '{ "id": UUID("123e4567-e89b-12d3-a456-426614174000") }',
        property: 'id',
        expectedClass: UUID,
        expectedValue: '123e4567-e89b-12d3-a456-426614174000',
    },
    {
        type: 'UUID with new',
        input: '{ "userId": new UUID("550e8400-e29b-41d4-a716-446655440000") }',
        property: 'userId',
        expectedClass: UUID,
        expectedValue: '550e8400-e29b-41d4-a716-446655440000',
    },
    {
        type: 'UUID with single quotes',
        input: '{ "id": UUID(\'123e4567-e89b-12d3-a456-426614174000\') }',
        property: 'id',
        expectedClass: UUID,
        expectedValue: '123e4567-e89b-12d3-a456-426614174000',
    },
    // MinKey cases
    {
        type: 'MinKey',
        input: '{ "start": MinKey() }',
        property: 'start',
        expectedClass: MinKey,
    },
    {
        type: 'MinKey with new',
        input: '{ "min": new MinKey() }',
        property: 'min',
        expectedClass: MinKey,
    },
    // MaxKey cases
    {
        type: 'MaxKey',
        input: '{ "end": MaxKey() }',
        property: 'end',
        expectedClass: MaxKey,
    },
    {
        type: 'MaxKey with new',
        input: '{ "max": new MaxKey() }',
        property: 'max',
        expectedClass: MaxKey,
    },
    // Date cases
    {
        type: 'Date',
        input: '{ "created": new Date("2023-01-01") }',
        property: 'created',
        expectedClass: Date,
        expectedValue: '2023-01-01T00:00:00.000Z',
    },
    {
        type: 'Date without new',
        input: '{ "updated": Date("2023-12-31T23:59:59.999Z") }',
        property: 'updated',
        expectedClass: Date,
        expectedValue: '2023-12-31T23:59:59.999Z',
    },
];

// Examples of mixed BSON types
const mixedQuery =
    '{ "id": UUID("123e4567-e89b-12d3-a456-426614174000"), "start": MinKey(), "end": MaxKey(), "created": new Date("2023-01-01") }';

// Complex nested query
const complexQuery =
    '{ "range": { "start": MinKey(), "end": MaxKey() }, "timestamp": new Date("2023-01-01"), "ids": [UUID("123e4567-e89b-12d3-a456-426614174000")] }';

// String that contains BSON function syntax but should be treated as plain text
const textWithFunctionSyntax = '{ "userName": "A user with UUID()name and Date() format", "status": "active" }';

// Error test cases
const errorTestCases = [
    { description: 'invalid JSON', input: '{ invalid json }' },
    { description: 'invalid UUID', input: '{ "id": UUID("invalid-uuid") }' },
    { description: 'invalid Date', input: '{ "date": new Date("invalid-date") }' },
    { description: 'missing parameter', input: '{ "key": UUID() }' },
];

describe('toFilterQuery', () => {
    it('converts basic query strings to objects', () => {
        basicQueries.forEach((testCase) => {
            expect(toFilterQueryObj(testCase.input)).toEqual(testCase.expected);
        });
    });

    describe('BSON function support', () => {
        test.each(bsonFunctionTestCases)('converts $type', ({ input, property, expectedClass, expectedValue }) => {
            const result = toFilterQueryObj(input);

            expect(result).toHaveProperty(property);
            expect(result[property]).toBeInstanceOf(expectedClass);

            if (expectedValue) {
                if (result[property] instanceof UUID) {
                    // eslint-disable-next-line jest/no-conditional-expect
                    expect(result[property].toString()).toBe(expectedValue);
                } else if (result[property] instanceof Date) {
                    // eslint-disable-next-line jest/no-conditional-expect
                    expect(result[property].toISOString()).toBe(expectedValue);
                }
            }
        });
    });

    it('handles mixed BSON types in the same query', () => {
        const result = toFilterQueryObj(mixedQuery);

        expect(result.id).toBeInstanceOf(UUID);
        expect(result.start).toBeInstanceOf(MinKey);
        expect(result.end).toBeInstanceOf(MaxKey);
        expect(result.created).toBeInstanceOf(Date);

        expect((result.id as UUID).toString()).toBe('123e4567-e89b-12d3-a456-426614174000');
        expect((result.created as Date).toISOString()).toBe('2023-01-01T00:00:00.000Z');
    });

    it('handles complex nested queries with multiple BSON types', () => {
        const result = toFilterQueryObj(complexQuery);

        expect(result.range.start).toBeInstanceOf(MinKey);
        expect(result.range.end).toBeInstanceOf(MaxKey);
        expect(result.timestamp).toBeInstanceOf(Date);
        expect(result.ids[0]).toBeInstanceOf(UUID);
    });

    it('does not process BSON function calls within string values', () => {
        const result = toFilterQueryObj(textWithFunctionSyntax);
        expect(result).toEqual({
            userName: 'A user with UUID()name and Date() format',
            status: 'active',
        });
    });

    describe('error handling', () => {
        test.each(errorTestCases)('throws QueryError for $description', ({ input }) => {
            expect(() => toFilterQueryObj(input)).toThrow(QueryError);
        });

        it('throws QueryError with INVALID_FILTER code for invalid JSON', () => {
            let thrownError: QueryError | undefined;
            try {
                toFilterQueryObj('{ invalid json }');
            } catch (error) {
                thrownError = error as QueryError;
            }
            expect(thrownError).toBeDefined();
            expect(thrownError?.name).toBe('QueryError');
            expect(thrownError?.code).toBe('INVALID_FILTER');
        });

        it('throws QueryError with INVALID_FILTER code for invalid UUID', () => {
            let thrownError: QueryError | undefined;
            try {
                toFilterQueryObj('{ "id": UUID("invalid-uuid") }');
            } catch (error) {
                thrownError = error as QueryError;
            }
            expect(thrownError).toBeDefined();
            expect(thrownError?.name).toBe('QueryError');
            expect(thrownError?.code).toBe('INVALID_FILTER');
        });

        it('includes original error message in QueryError message', () => {
            let thrownError: QueryError | undefined;
            try {
                toFilterQueryObj('{ invalid json }');
            } catch (error) {
                thrownError = error as QueryError;
            }
            expect(thrownError).toBeDefined();
            expect(thrownError?.message).toContain('Invalid filter syntax');
        });

        it('includes helpful JSON example in error message', () => {
            let thrownError: QueryError | undefined;
            try {
                toFilterQueryObj('{ invalid json }');
            } catch (error) {
                thrownError = error as QueryError;
            }
            expect(thrownError).toBeDefined();
            expect(thrownError?.message).toContain('Please use valid JSON');
            expect(thrownError?.message).toContain('"name": "value"');
        });
    });
});
