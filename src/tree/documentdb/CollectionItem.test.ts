/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionItem } from './CollectionItem';

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string) => message),
}));

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    TreeItemCollapsibleState: {
        None: 0,
        Collapsed: 1,
        Expanded: 2,
    },
    MarkdownString: class MarkdownString {
        public isTrusted = false;
        private readonly chunks: string[] = [];

        public appendMarkdown(value: string): void {
            this.chunks.push(value);
        }

        public toString(): string {
            return this.chunks.join('');
        }
    },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (parts: string[]) => parts.join(';'),
}));

jest.mock('../../extensionVariables', () => ({
    ext: {
        state: {
            notifyChildrenChanged: jest.fn(),
        },
    },
}));

jest.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getClient: jest.fn(),
    },
}));

describe('CollectionItem', () => {
    const cluster = {
        treeId: 'connectionsView/cluster-1',
        clusterId: 'cluster-1',
        dbExperience: { api: 'documentDB' },
        name: 'Cluster 1',
        viewId: 'connectionsView',
    };
    const databaseInfo = { name: 'db1' };
    const collectionInfo = { name: 'coll1', type: 'collection' };

    it('opens the collection view directly from the collection node', () => {
        const item = new CollectionItem(cluster as never, databaseInfo as never, collectionInfo as never);
        const treeItem = item.getTreeItem();

        expect(treeItem.collapsibleState).toBe(1);
        expect(treeItem.command).toEqual({
            title: 'Open Collection',
            command: 'vscode-documentdb.command.containerView.open',
            arguments: [item],
        });
    });

    it('keeps Documents and Indexes child nodes available', async () => {
        const item = new CollectionItem(cluster as never, databaseInfo as never, collectionInfo as never);

        const children = await item.getChildren();

        expect(children).toHaveLength(2);
        expect(children[0].id).toBe('connectionsView/cluster-1/db1/coll1/documents');
        expect(children[1].id).toBe('connectionsView/cluster-1/db1/coll1/indexes');
    });
});
