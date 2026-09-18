/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { CopyPasteBufferService } from '../../services/CopyPasteBufferService';
import { type TreeElement } from '../../tree/TreeElement';
import { IndexItem } from '../../tree/documentdb/IndexItem';
import { type IndexesItem } from '../../tree/documentdb/IndexesItem';
import { copyIndex, copyIndexes } from './copyIndexes';

const showInformationMessage = vscode.window.showInformationMessage as unknown as jest.MockedFunction<
    (message: string, ...items: string[]) => Thenable<string | undefined>
>;

jest.mock('../../services/CopyPasteBufferService', () => ({
    CopyPasteBufferService: {
        setIndexes: jest.fn().mockResolvedValue(undefined),
        clearIndexes: jest.fn().mockResolvedValue(undefined),
    },
}));

function createContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} } } as IActionContext;
}

function createIndexNode(
    indexInfo: IndexItem['indexInfo'],
    overrides?: { clusterId?: string; databaseName?: string; collectionName?: string },
): IndexItem {
    const node = {
        cluster: { clusterId: 'stable-cluster', treeId: 'folder/stable-cluster', name: 'Connection' },
        databaseInfo: { name: 'database' },
        collectionInfo: { name: 'collection' },
        indexInfo,
    } as unknown as IndexItem;
    Object.setPrototypeOf(node, IndexItem.prototype);
    Object.assign(node.cluster, { clusterId: overrides?.clusterId ?? node.cluster.clusterId });
    Object.assign(node.databaseInfo, { name: overrides?.databaseName ?? node.databaseInfo.name });
    Object.assign(node.collectionInfo, { name: overrides?.collectionName ?? node.collectionInfo.name });
    return node;
}

function createIndexesNode(): IndexesItem {
    return {
        cluster: { clusterId: 'stable-cluster', treeId: 'folder/stable-cluster', name: 'Connection' },
        databaseInfo: { name: 'database' },
        collectionInfo: { name: 'collection' },
    } as unknown as IndexesItem;
}

describe('copyIndexes commands', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        showInformationMessage.mockResolvedValue(undefined);
    });

    it('stores one copyable index using a stable source descriptor', async () => {
        const context = createContext();
        const node = createIndexNode({ name: 'email_1', type: 'traditional', key: { email: 1 } });

        await copyIndex(context, node);

        expect(CopyPasteBufferService.setIndexes).toHaveBeenCalledWith({
            source: {
                clusterId: 'stable-cluster',
                databaseName: 'database',
                collectionName: 'collection',
            },
            sourceConnectionName: 'Connection',
            scope: { kind: 'index', indexName: 'email_1' },
        });
        expect(context.telemetry.properties.copyScope).toBe('index');
        expect(context.telemetry.properties.copyCancelled).toBe('false');
    });

    it.each(['built-in _id', 'search'] as const)(
        'stores copyable selected indexes when invoked from a %s index',
        async (clickedIndexType) => {
            const context = createContext();
            const emailIndex = createIndexNode({ name: 'email_1', type: 'traditional', key: { email: 1 } });
            const regionIndex = createIndexNode({ name: 'region_1', type: 'traditional', key: { region: 1 } });
            const idIndex = createIndexNode({ name: '_id_', type: 'traditional', key: { _id: 1 } });
            const searchIndex = createIndexNode({ name: 'search', type: 'search' });
            const expandedField = { id: `${emailIndex.id}/email`, getTreeItem: jest.fn() } as unknown as TreeElement;
            const clickedNode = clickedIndexType === 'built-in _id' ? idIndex : searchIndex;

            await copyIndex(context, clickedNode, [emailIndex, expandedField, idIndex, regionIndex, searchIndex]);

            expect(CopyPasteBufferService.setIndexes).toHaveBeenCalledWith(
                expect.objectContaining({
                    scope: { kind: 'indexes', indexNames: ['email_1', 'region_1'] },
                }),
            );
            expect(context.telemetry.properties.copyScope).toBe('indexes');
            expect(showInformationMessage).toHaveBeenCalledWith(
                '2 indexes from collection "collection" are ready to paste.',
                'Cancel Copy',
            );
        },
    );

    it('rejects selected indexes from different collections', async () => {
        const emailIndex = createIndexNode({ name: 'email_1', type: 'traditional', key: { email: 1 } });
        const otherIndex = createIndexNode(
            { name: 'region_1', type: 'traditional', key: { region: 1 } },
            { collectionName: 'otherCollection' },
        );

        await expect(copyIndex(createContext(), emailIndex, [emailIndex, otherIndex])).rejects.toThrow(
            'Select indexes from only one collection before copying.',
        );
        expect(CopyPasteBufferService.setIndexes).not.toHaveBeenCalled();
    });

    it('stores an all-indexes scope without expanding the parent', async () => {
        const context = createContext();
        const node = createIndexesNode();
        const getChildren = jest.fn();
        Object.assign(node, { getChildren });

        await copyIndexes(context, node);

        expect(CopyPasteBufferService.setIndexes).toHaveBeenCalledWith(
            expect.objectContaining({ scope: { kind: 'allIndexes' } }),
        );
        expect(getChildren).not.toHaveBeenCalled();
        expect(context.telemetry.properties.copyScope).toBe('allIndexes');
    });

    it.each([
        [{ name: '_id_', type: 'traditional', key: { _id: 1 } }, 'built-in _id index cannot be copied'],
        [{ name: 'search', type: 'vectorSearch' }, 'not supported by Copy/Paste Indexes'],
    ] as const)('rejects a non-copyable index defensively', async (indexInfo, message) => {
        await expect(copyIndex(createContext(), createIndexNode(indexInfo))).rejects.toThrow(message);
        expect(CopyPasteBufferService.setIndexes).not.toHaveBeenCalled();
    });

    it('clears only the index buffer when Cancel Copy is selected', async () => {
        showInformationMessage.mockResolvedValue('Cancel Copy');
        const context = createContext();

        await copyIndexes(context, createIndexesNode());

        expect(CopyPasteBufferService.clearIndexes).toHaveBeenCalledTimes(1);
        expect(context.telemetry.properties.copyCancelled).toBe('true');
    });
});
