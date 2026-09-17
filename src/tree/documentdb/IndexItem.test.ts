/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type CollectionItemModel, type DatabaseItemModel, type IndexItemModel } from '../../documentdb/ClustersClient';
import { type Experience } from '../../DocumentDBExperiences';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { IndexItem } from './IndexItem';

jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (values: string[]) => values.join(';'),
    createGenericElement: (value: unknown) => value,
}));

const cluster = {
    treeId: 'tree',
    clusterId: 'cluster',
    dbExperience: { api: 'MongoDB' } as unknown as Experience,
} as TreeCluster<BaseClusterModel>;
const database: DatabaseItemModel = { name: 'database' };
const collection: CollectionItemModel = { name: 'collection' };

function createItem(overrides: Partial<IndexItemModel>): IndexItem {
    return new IndexItem(cluster, database, collection, {
        name: 'test_index',
        type: 'traditional',
        key: { customerId: 1 },
        ...overrides,
    });
}

describe('IndexItem copy presentation', () => {
    it('marks hidden ordinary indexes as copyable', () => {
        const item = createItem({ hidden: true });

        expect(item.contextValue).toContain('state_copyable');
        expect(item.contextValue).toContain('state_hidden');
        expect(item.getTreeItem().description).toBe('(hidden)');
    });

    it('keeps the built-in _id index out of the copyable state', () => {
        const item = createItem({ name: '_id_', key: { _id: 1 } });

        expect(item.contextValue).toContain('state_default');
        expect(item.contextValue).not.toContain('state_copyable');
    });

    it('explains and collapses a keyless vector search index', async () => {
        const item = createItem({
            type: 'vectorSearch',
            key: undefined,
            hidden: true,
            status: 'READY',
            queryable: true,
        });
        const treeItem = item.getTreeItem();
        const tooltip = treeItem.tooltip as vscode.MarkdownString;

        expect(item.contextValue).not.toContain('state_copyable');
        expect(treeItem.description).toBe('(vector search, hidden)');
        expect(treeItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
        expect(tooltip.value).toContain('This vector search index cannot be copied by Copy/Paste Indexes.');
        expect(tooltip.value).toContain('**Status:** READY');
        expect(tooltip.value).toContain('**Queryable:** Yes');
        await expect(item.getChildren()).resolves.toEqual([]);
    });
});
