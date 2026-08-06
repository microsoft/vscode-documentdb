/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type MongoClient } from 'mongodb';
import { QueryInsightsApis } from './QueryInsightsApis';

describe('QueryInsightsApis', () => {
    it('limits explain execution to 30 seconds', async () => {
        const explain = jest.fn().mockResolvedValue({});
        const maxTimeMS = jest.fn();
        const cursor = {
            maxTimeMS,
            explain,
        };
        const client = {
            db: jest.fn().mockReturnValue({
                collection: jest.fn().mockReturnValue({
                    find: jest.fn().mockReturnValue(cursor),
                }),
            }),
        } as unknown as MongoClient;

        const result = await new QueryInsightsApis(client).explainFind('database', 'collection', {} as Document, {
            verbosity: 'executionStats',
        });

        expect(maxTimeMS).toHaveBeenCalledWith(30_000);
        expect(explain).toHaveBeenCalledWith('executionStats');
        expect(result).toEqual({});
    });
});
