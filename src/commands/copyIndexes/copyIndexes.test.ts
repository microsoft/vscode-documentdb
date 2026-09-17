import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { CopyPasteBufferService } from '../../services/CopyPasteBufferService';
import { type IndexItem } from '../../tree/documentdb/IndexItem';
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

function createNode(indexInfo?: IndexItem['indexInfo']): IndexItem | IndexesItem {
    return {
        cluster: { clusterId: 'stable-cluster', treeId: 'folder/stable-cluster', name: 'Connection' },
        databaseInfo: { name: 'database' },
        collectionInfo: { name: 'collection' },
        indexInfo,
    } as unknown as IndexItem | IndexesItem;
}

describe('copyIndexes commands', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        showInformationMessage.mockResolvedValue(undefined);
    });

    it('stores one copyable index using a stable source descriptor', async () => {
        const context = createContext();
        const node = createNode({ name: 'email_1', type: 'traditional', key: { email: 1 } }) as IndexItem;

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

    it('stores an all-indexes scope without expanding the parent', async () => {
        const context = createContext();
        const node = createNode() as IndexesItem;
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
        await expect(copyIndex(createContext(), createNode(indexInfo) as IndexItem)).rejects.toThrow(message);
        expect(CopyPasteBufferService.setIndexes).not.toHaveBeenCalled();
    });

    it('clears only the index buffer when Cancel Copy is selected', async () => {
        showInformationMessage.mockResolvedValue('Cancel Copy');
        const context = createContext();

        await copyIndexes(context, createNode() as IndexesItem);

        expect(CopyPasteBufferService.clearIndexes).toHaveBeenCalledTimes(1);
        expect(context.telemetry.properties.copyCancelled).toBe('true');
    });
});