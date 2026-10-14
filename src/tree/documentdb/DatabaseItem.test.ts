/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { COLLECTION_COUNT_LIMIT } from '../../constants';
import { ClustersClient, type CollectionItemModel, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { DatabaseItem } from './DatabaseItem';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: vi.fn((values: string[]) => values.join(';')),
    createGenericElement: vi.fn((opts: Record<string, unknown>) => ({
        id: opts.id,
        label: opts.label,
    })),
}));

const notifyChildrenChangedMock = vi.fn();
vi.mock('../../extensionVariables', () => ({
    ext: {
        state: {
            notifyChildrenChanged: (...args: unknown[]) => notifyChildrenChangedMock(...args),
        },
    },
}));

vi.mock('../../utils/accumulatingTelemetry', () => ({
    meterSilentCatch: vi.fn(),
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getClient: vi.fn(),
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

    let listCollectionsMock: Mock;
    let countCollectionsMock: Mock;
    let estimateDocumentCountMock: Mock;

    beforeEach(() => {
        vi.clearAllMocks();
        notifyChildrenChangedMock.mockReset();

        listCollectionsMock = vi.fn().mockResolvedValue([...sampleCollections]);
        countCollectionsMock = vi.fn().mockResolvedValue({ count: 3, hasMore: false });
        estimateDocumentCountMock = vi.fn().mockResolvedValue(0);

        (ClustersClient.getClient as Mock).mockResolvedValue({
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

    it('shows a zero count when the database has no collections', async () => {
        countCollectionsMock.mockResolvedValue({ count: 0, hasMore: false });

        const item = new DatabaseItem(cluster, databaseInfo);

        item.loadCollectionCount();
        await flushAsync();

        expect(item.getTreeItem().description as string).toContain('0');
    });

    it('does not let a slow background count overwrite the exact count from getChildren', async () => {
        // Background count stays pending until we resolve it manually.
        let resolveCount!: (value: { count: number; hasMore: boolean }) => void;
        countCollectionsMock.mockReturnValue(
            new Promise<{ count: number; hasMore: boolean }>((resolve) => {
                resolveCount = resolve;
            }),
        );

        const item = new DatabaseItem(cluster, databaseInfo);

        // Background load starts but does not resolve yet.
        item.loadCollectionCount();

        // User expands the database before the background count resolves; this
        // establishes the exact count (3).
        await item.getChildren();
        expect(item.getTreeItem().description as string).toContain('3');

        // The background count now resolves with a larger, capped value.
        resolveCount({ count: COLLECTION_COUNT_LIMIT, hasMore: true });
        await flushAsync();

        // The exact count must be preserved; it must not regress to "N+".
        const desc = item.getTreeItem().description as string;
        expect(desc).toContain('3');
        expect(desc).not.toContain('+');
    });
});
