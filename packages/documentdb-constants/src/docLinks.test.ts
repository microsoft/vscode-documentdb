/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Unit tests for docLinks.ts — URL generation for DocumentDB operator docs.
 */

import { getDocBase, getDocLink } from './index';

describe('docLinks', () => {
    test('getDocBase returns the expected base URL', () => {
        expect(getDocBase()).toBe('https://learn.microsoft.com/en-us/azure/documentdb/operators');
    });

    describe('getDocLink', () => {
        test('generates correct URL for comparison query operator', () => {
            const link = getDocLink('$eq', 'query:comparison');
            expect(link).toBe('https://learn.microsoft.com/en-us/azure/documentdb/operators/comparison-query/$eq');
        });

        test('generates correct URL for aggregation stage', () => {
            const link = getDocLink('$match', 'stage');
            expect(link).toBe('https://learn.microsoft.com/en-us/azure/documentdb/operators/aggregation/$match');
        });

        test('generates correct URL for accumulator', () => {
            const link = getDocLink('$sum', 'accumulator');
            expect(link).toBe('https://learn.microsoft.com/en-us/azure/documentdb/operators/accumulators/$sum');
        });

        test('generates correct URL for field update operator', () => {
            const link = getDocLink('$set', 'update:field');
            expect(link).toBe('https://learn.microsoft.com/en-us/azure/documentdb/operators/field-update/$set');
        });

        test('generates correct URL for array expression operator', () => {
            const link = getDocLink('$filter', 'expr:array');
            expect(link).toBe('https://learn.microsoft.com/en-us/azure/documentdb/operators/array-expression/$filter');
        });

        test('generates correct URL for type expression operator (nested dir)', () => {
            const link = getDocLink('$convert', 'expr:type');
            expect(link).toBe(
                'https://learn.microsoft.com/en-us/azure/documentdb/operators/aggregation/type-expression/$convert',
            );
        });

        test('generates correct URL for window operator', () => {
            const link = getDocLink('$rank', 'window');
            expect(link).toBe('https://learn.microsoft.com/en-us/azure/documentdb/operators/window-operators/$rank');
        });

        test('lowercases operator names in URLs', () => {
            const link = getDocLink('$AddFields', 'stage');
            expect(link).toBe('https://learn.microsoft.com/en-us/azure/documentdb/operators/aggregation/$addfields');
        });

        test('returns undefined for unknown meta tag', () => {
            expect(getDocLink('$eq', 'unknown:tag')).toBeUndefined();
        });

        test('returns undefined for BSON meta tag (no docs directory)', () => {
            expect(getDocLink('ObjectId', 'bson')).toBeUndefined();
        });

        test('returns undefined for variable meta tag (no docs directory)', () => {
            expect(getDocLink('$$NOW', 'variable')).toBeUndefined();
        });
    });
});
