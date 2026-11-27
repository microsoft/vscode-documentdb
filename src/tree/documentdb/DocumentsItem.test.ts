/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

import { type CollectionItemModel, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { type CollectionItem } from './CollectionItem';
import { DocumentsItem } from './DocumentsItem';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    createContextValue: (values: string[]) => values.join(';'),
}));

vi.mock('@vscode/l10n', () => ({
    t: (message: string): string => message,
}));

vi.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
}));

const cluster = {
    treeId: 'cluster-tree-id',
    clusterId: 'cluster-id',
    name: 'Cluster',
    viewId: 'connectionsView',
    dbExperience: DocumentDBExperience,
} as TreeCluster<BaseClusterModel>;
const databaseInfo: DatabaseItemModel = { name: 'database' };
const collectionInfo: CollectionItemModel = { name: 'collection' };
const parentCollectionNode = {} as CollectionItem;

describe('DocumentsItem accessibility', () => {
    it('includes the visible label in its accessible name', () => {
        const treeItem = new DocumentsItem(
            cluster,
            databaseInfo,
            collectionInfo,
            parentCollectionNode,
        ).getTreeItem();

        expect(treeItem.label).toBe('Documents');
        expect(treeItem.accessibilityInformation?.label).toContain(treeItem.label as string);
    });

    it('retains the hover tooltip', () => {
        const treeItem = new DocumentsItem(
            cluster,
            databaseInfo,
            collectionInfo,
            parentCollectionNode,
        ).getTreeItem();

        expect(treeItem.tooltip).toBe('Click to open the collection view');
    });
});
