/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient, type CollectionItemModel, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { DatabaseItem } from './DatabaseItem';

jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: jest.fn((values: string[]) => values.join(';')),
    createGenericElement: jest.fn((opts: Record<string, unknown>) => ({
        id: opts.id,
        label: opts.label,
    })),
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

describe('DatabaseItem - async collection count loading', () => {
    const cluster = {
        treeId: 'cluster1',
        clusterId: 'cluster1',
        dbExperience: { api: 'MongoDB' } as unknown as Experience,
    } as TreeCluster<BaseClusterModel>;
    const databaseInfo: DatabaseItemModel = { name: 'testdb' };

    const sampleCollections: CollectionItemModel[] = [
        { name: 'users' },
        { name: 'orders' },
        { name: 'products' },
    ] as CollectionItemModel[];

    let listCollectionsMock: jest.Mock;
    let estimateDocumentCountMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        notifyChildrenChangedMock.mockReset();

        listCollectionsMock = jest.fn().mockResolvedValue([...sampleCollections]);
        estimateDocumentCountMock = jest.fn().mockResolvedValue(0);

        (ClustersClient.getClient as jest.Mock).mockResolvedValue({
            listCollections: listCollectionsMock,
            estimateDocumentCount: estimateDocumentCountMock,
        });
    });

    function flushAsync(): Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }

    it('loadCollectionCount fetches collections once and exposes the count via description', async () => {
        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();

        expect(listCollectionsMock).toHaveBeenCalledTimes(1);
        expect(notifyChildrenChangedMock).toHaveBeenCalledWith(item.id);
        expect(item.getTreeItem().description).toContain('3');
    });

    it('loadCollectionCount is idempotent: a second call does not refetch', async () => {
        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();
        item.loadCollectionCount();
        await flushAsync();

        expect(listCollectionsMock).toHaveBeenCalledTimes(1);
    });

    it('getChildren reuses collections already fetched by loadCollectionCount (no second API call)', async () => {
        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();

        const children = await item.getChildren();

        // Only one listCollections call total (from loadCollectionCount, reused by getChildren)
        expect(listCollectionsMock).toHaveBeenCalledTimes(1);
        expect(children).toHaveLength(3);
    });

    it('invalidateChildrenCache clears the cache so next call refetches', async () => {
        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();
        expect(listCollectionsMock).toHaveBeenCalledTimes(1);

        item.invalidateChildrenCache();

        await item.getChildren();
        // Second fetch after invalidation
        expect(listCollectionsMock).toHaveBeenCalledTimes(2);
    });

    it('includes collection count in tooltip when loaded', async () => {
        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();

        const treeItem = item.getTreeItem();
        const tooltip = treeItem.tooltip as { value: string };
        expect(tooltip.value).toContain('3');
    });
});
