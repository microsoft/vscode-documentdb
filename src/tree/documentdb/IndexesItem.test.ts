/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    ClustersClient,
    type CollectionItemModel,
    type DatabaseItemModel,
    type IndexItemModel,
} from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { compareIndexNames, IndexesItem } from './IndexesItem';

jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: jest.fn((values: string[]) => values.join(';')),
}));

const notifyChildrenChangedMock = jest.fn();
jest.mock('../../extensionVariables', () => ({
    ext: {
        state: {
            notifyChildrenChanged: (...args: unknown[]) => notifyChildrenChangedMock(...args),
        },
    },
}));

jest.mock('../../utils/callWithAccumulatingTelemetry', () => ({
    meterSilentCatch: jest.fn(),
}));

jest.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getClient: jest.fn(),
    },
}));

describe('compareIndexNames', () => {
    it('places _id_ before any other index', () => {
        const names = ['age_1', '_id_', 'name_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted[0]).toBe('_id_');
    });

    it('keeps _id_ first when it is already first', () => {
        const names = ['_id_', 'age_1', 'name_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted[0]).toBe('_id_');
    });

    it('places _id_ first when it is last in the list', () => {
        const names = ['age_1', 'name_1', '_id_'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted[0]).toBe('_id_');
    });

    it('sorts remaining indexes alphabetically after _id_', () => {
        const names = ['status_1', '_id_', 'age_1', 'name_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted).toEqual(['_id_', 'age_1', 'name_1', 'status_1']);
    });

    it('places _id_ first even when other indexes start with uppercase letters', () => {
        // Without the fix, 'A' (ASCII 65) sorts before '_' (ASCII 95) in naive
        // locale-aware comparisons, so uppercase-named indexes could appear before _id_.
        const names = ['Zebra_1', '_id_', 'Alpha_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted[0]).toBe('_id_');
        expect(sorted[1]).toBe('Alpha_1');
        expect(sorted[2]).toBe('Zebra_1');
    });

    it('applies numeric sort to the non-_id_ indexes', () => {
        const names = ['field_10', '_id_', 'field_2', 'field_1'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted).toEqual(['_id_', 'field_1', 'field_2', 'field_10']);
    });

    it('handles a single-element list containing only _id_', () => {
        expect(['_id_'].sort(compareIndexNames)).toEqual(['_id_']);
    });

    it('sorts a list without _id_ alphabetically', () => {
        const names = ['z_index', 'a_index', 'm_index'];
        const sorted = [...names].sort(compareIndexNames);
        expect(sorted).toEqual(['a_index', 'm_index', 'z_index']);
    });

    it('returns 0 when both arguments are equal', () => {
        expect(compareIndexNames('_id_', '_id_')).toBe(0);
        expect(compareIndexNames('age_1', 'age_1')).toBe(0);
    });
});

describe('IndexesItem - async index loading', () => {
    const cluster = {
        treeId: 'cluster1',
        clusterId: 'cluster1',
        dbExperience: { api: 'MongoDB' } as unknown as Experience,
    } as TreeCluster<BaseClusterModel>;
    const databaseInfo: DatabaseItemModel = { name: 'db1' };
    const collectionInfo: CollectionItemModel = { name: 'coll1' };

    const sampleIndexes: IndexItemModel[] = [
        { name: '_id_', key: { _id: 1 } } as unknown as IndexItemModel,
        { name: 'age_1', key: { age: 1 } } as unknown as IndexItemModel,
        { name: 'name_1', key: { name: 1 } } as unknown as IndexItemModel,
    ];

    let listIndexesMock: jest.Mock;
    let listSearchIndexesMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        notifyChildrenChangedMock.mockReset();

        listIndexesMock = jest.fn().mockResolvedValue([...sampleIndexes]);
        listSearchIndexesMock = jest.fn().mockRejectedValue(new Error('not supported'));

        (ClustersClient.getClient as jest.Mock).mockResolvedValue({
            listIndexes: listIndexesMock,
            listSearchIndexesForAtlas: listSearchIndexesMock,
        });
    });

    function flushAsync(): Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }

    it('loadIndexCount fetches indexes once and exposes the count via description', async () => {
        const item = new IndexesItem(cluster, databaseInfo, collectionInfo);

        item.loadIndexCount();
        await flushAsync();

        expect(listIndexesMock).toHaveBeenCalledTimes(1);
        expect(notifyChildrenChangedMock).toHaveBeenCalledWith(item.id);
        expect(item.getTreeItem().description).toBe('3');
    });

    it('loadIndexCount is idempotent: a second call does not refetch', async () => {
        const item = new IndexesItem(cluster, databaseInfo, collectionInfo);

        item.loadIndexCount();
        await flushAsync();
        item.loadIndexCount();
        await flushAsync();

        expect(listIndexesMock).toHaveBeenCalledTimes(1);
    });

    it('getChildren reuses indexes already fetched by loadIndexCount (no second API call)', async () => {
        const item = new IndexesItem(cluster, databaseInfo, collectionInfo);

        item.loadIndexCount();
        await flushAsync();

        const children = await item.getChildren();

        expect(listIndexesMock).toHaveBeenCalledTimes(1);
        expect(children).toHaveLength(3);
    });
});
