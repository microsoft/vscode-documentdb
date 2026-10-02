/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { CollectionItem } from './CollectionItem';

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string) => message),
}));

vi.mock('vscode', () => ({
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

vi.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (parts: string[]) => parts.join(';'),
    callWithTelemetryAndErrorHandling: vi.fn(async (_callbackId: string, callback: (context: unknown) => unknown) => {
        const context = {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: { suppressDisplay: false, rethrow: false },
            ui: undefined,
            valuesToMask: [],
        };
        return await callback(context);
    }),
}));

vi.mock('../../extensionVariables', () => ({
    ext: {
        state: {
            notifyChildrenChanged: vi.fn(),
        },
    },
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getClient: vi.fn(),
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

    it('does not attach a command to the collection node (expand-only)', () => {
        const item = new CollectionItem(cluster as never, databaseInfo as never, collectionInfo as never);
        const treeItem = item.getTreeItem();

        expect(treeItem.collapsibleState).toBe(1);
        expect(treeItem.command).toBeUndefined();
    });

    it('keeps Documents and Indexes child nodes available', async () => {
        const item = new CollectionItem(cluster as never, databaseInfo as never, collectionInfo as never);

        const children = await item.getChildren();

        expect(children).toHaveLength(2);
        expect(children[0].id).toBe('connectionsView/cluster-1/db1/coll1/documents');
        expect(children[1].id).toBe('connectionsView/cluster-1/db1/coll1/indexes');
    });
});
