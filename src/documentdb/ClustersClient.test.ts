/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient, getIndexExclusionReason, type IndexItemModel } from './ClustersClient';

describe('ClustersClient', () => {
    it('should be defined', () => {
        expect(ClustersClient).toBeDefined();
    });
});

describe('getIndexExclusionReason', () => {
    it('classifies the built-in _id index', () => {
        expect(getIndexExclusionReason(createIndex({ key: { _id: 1 } }))).toBe('builtInId');
    });

    it('classifies a keyless vector search index as not copyable', () => {
        expect(getIndexExclusionReason(createIndex({ type: 'vectorSearch', key: undefined }))).toBe('notCopyable');
    });

    it('allows an ordinary DocumentDB vector index', () => {
        expect(
            getIndexExclusionReason(
                createIndex({
                    key: { embedding: 'cosmosSearch' },
                    cosmosSearchOptions: { kind: 'vector-ivf' },
                }),
            ),
        ).toBeUndefined();
    });

    it('allows a hidden ordinary index', () => {
        expect(getIndexExclusionReason(createIndex({ key: { customerId: 1 }, hidden: true }))).toBeUndefined();
    });
});

function createIndex(overrides: Partial<IndexItemModel>): IndexItemModel {
    return {
        name: 'test_index',
        type: 'traditional',
        ...overrides,
    };
}
