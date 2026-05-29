/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient } from './ClustersClient';
import { EJSON } from 'bson';
import { parseProjectionOrSortQuery } from './utils/parseProjectionOrSortQuery';

describe('ClustersClient', () => {
    it('should be defined', () => {
        expect(ClustersClient).toBeDefined();
    });

    describe('strict EJSON parser compatibility', () => {
        const fixtures = [
            {
                name: 'projection with canonical date',
                input: '{ "createdAt": { "$date": "2024-01-01T00:00:00Z" } }',
            },
            {
                name: 'sort with numeric direction',
                input: '{ "_id": -1 }',
            },
            {
                name: 'nested numberLong predicate',
                input: '{ "$gt": { "$numberLong": "9007199254740992" } }',
            },
            {
                name: 'empty document',
                input: '{}',
            },
        ];

        it.each(fixtures)('parses $name the same as EJSON.parse', ({ input }) => {
            expect(parseProjectionOrSortQuery(input)).toEqual(EJSON.parse(input));
        });

        it('still parses loose shell BSON syntax', () => {
            expect(parseProjectionOrSortQuery('{ name: 1 }')).toEqual({ name: 1 });
        });
    });
});
