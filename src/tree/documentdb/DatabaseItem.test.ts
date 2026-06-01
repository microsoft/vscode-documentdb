/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { COLLECTION_COUNT_LIMIT } from '../../constants';
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
    let countCollectionsMock: jest.Mock;
    let estimateDocumentCountMock: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        notifyChildrenChangedMock.mockReset();

        listCollectionsMock = jest.fn().mockResolvedValue([...sampleCollections]);
        countCollectionsMock = jest.fn().mockResolvedValue({ count: 3, hasMore: false });
        estimateDocumentCountMock = jest.fn().mockResolvedValue(0);

        (ClustersClient.getClient as jest.Mock).mockResolvedValue({
            listCollections: listCollectionsMock,
            countCollections: countCollectionsMock,
            estimateDocumentCount: estimateDocumentCountMock,
        });
    });

    function flushAsync(): Promise<void> {
        return new Promise((resolve) => setImmediate(resolve));
    }

    it('loadCollectionCount uses countCollections and exposes the count via description', async () => {
        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();

        expect(countCollectionsMock).toHaveBeenCalledWith('testdb', COLLECTION_COUNT_LIMIT);
        expect(listCollectionsMock).not.toHaveBeenCalled();
        expect(notifyChildrenChangedMock).toHaveBeenCalledWith(item.id);
        expect(item.getTreeItem().description).toContain('3');
    });

    it('loadCollectionCount is idempotent: a second call does not refetch', async () => {
        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();
        item.loadCollectionCount();
        await flushAsync();

        expect(countCollectionsMock).toHaveBeenCalledTimes(1);
    });

    it('shows "N+" when collection count exceeds the limit', async () => {
        countCollectionsMock.mockResolvedValue({ count: COLLECTION_COUNT_LIMIT, hasMore: true });

        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();

        const description = item.getTreeItem().description as string;
        expect(description).toContain(`${COLLECTION_COUNT_LIMIT}+`);
    });

    it('getChildren updates the count to the exact value from the full list', async () => {
        countCollectionsMock.mockResolvedValue({ count: COLLECTION_COUNT_LIMIT, hasMore: true });

        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();

        // Description shows "N+" from the cursor count
        expect(item.getTreeItem().description as string).toContain('+');

        // Now expand the node, which fetches the full list
        const children = await item.getChildren();

        expect(listCollectionsMock).toHaveBeenCalledTimes(1);
        expect(children).toHaveLength(3);
        // Description now shows exact count, no "+"
        const desc = item.getTreeItem().description as string;
        expect(desc).toContain('3');
        expect(desc).not.toContain('+');
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
