/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../../documentdb/CredentialCache';
import { ext } from '../../../../extensionVariables';
import { type CollectionIndexCopier, type CopyIndexesOptions } from '../../data-api/indexes/CollectionIndexCopier';
import { TaskState } from '../../taskService';
import { CopyIndexesTask, type CopyIndexesConfig } from './CopyIndexesTask';

jest.mock('../../../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: jest.fn() },
}));

jest.mock('../../../../documentdb/CredentialCache', () => ({
    CredentialCache: { hasCredentials: jest.fn() },
}));

jest.mock('../../../../extensionVariables', () => ({
    ext: { outputChannel: { trace: jest.fn(), warn: jest.fn() } },
}));

class TestCopyIndexesTask extends CopyIndexesTask {
    public readonly progressUpdates: Array<{ progress: number; message?: string }> = [];

    public runInitializeForTest(signal: AbortSignal, context: IActionContext): Promise<void> {
        return this.onInitialize(signal, context);
    }

    public runWorkForTest(signal: AbortSignal, context: IActionContext): Promise<void> {
        this.updateStatus(TaskState.Running, 'running', 0);
        return this.doWork(signal, context);
    }

    protected override updateProgress(progress: number, message?: string): void {
        this.progressUpdates.push({ progress, message });
        super.updateProgress(progress, message);
    }
}

const config: CopyIndexesConfig = {
    source: { clusterId: 'source', databaseName: 'sourceDb', collectionName: 'sourceCollection' },
    target: { clusterId: 'target', databaseName: 'targetDb', collectionName: 'targetCollection' },
    sourceIndexNames: ['email_1'],
    copyScope: 'index',
    copyOperationCorrelationId: 'operation-id',
};

function createContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} } } as IActionContext;
}

describe('CopyIndexesTask', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.mocked(CredentialCache.hasCredentials).mockReturnValue(true);
        jest.mocked(ClustersClient.getClient).mockResolvedValue({
            listCollections: jest.fn().mockResolvedValue([{ name: 'sourceCollection' }]),
        } as unknown as ClustersClient);
    });

    it('validates source credentials and collection existence', async () => {
        const task = new TestCopyIndexesTask(config, {} as CollectionIndexCopier);
        const signal = new AbortController().signal;

        const context = createContext();
        await task.runInitializeForTest(signal, context);

        expect(CredentialCache.hasCredentials).toHaveBeenCalledWith('source');
        expect(ClustersClient.getClient).toHaveBeenCalledWith('source', signal);
        expect(context.telemetry.properties.copyOperationCorrelationId).toBe('operation-id');
    });

    it('rejects a disconnected source', async () => {
        jest.mocked(CredentialCache.hasCredentials).mockReturnValue(false);
        const context = createContext();
        const task = new TestCopyIndexesTask(config, {} as CollectionIndexCopier);

        await expect(task.runInitializeForTest(new AbortController().signal, context)).rejects.toThrow(
            'source connection is no longer available',
        );
        expect(context.telemetry.properties.sourceClusterDisconnected).toBe('true');
    });

    it('rejects a missing source collection', async () => {
        jest.mocked(ClustersClient.getClient).mockResolvedValue({
            listCollections: jest.fn().mockResolvedValue([]),
        } as unknown as ClustersClient);
        const context = createContext();
        const task = new TestCopyIndexesTask(config, {} as CollectionIndexCopier);

        await expect(task.runInitializeForTest(new AbortController().signal, context)).rejects.toThrow(
            'source collection "sourceCollection" no longer exists',
        );
        expect(context.telemetry.properties.sourceCollectionNotFound).toBe('true');
    });

    it('maps created and skipped indexes to determinate progress and telemetry', async () => {
        const copier = {
            copyIndexes: jest.fn().mockImplementation(async (options: CopyIndexesOptions) => {
                options.onStart?.(3);
                options.onProgress?.({ completed: 1, total: 3, indexName: 'email_1' });
                options.onProgress?.({ completed: 2, total: 3, indexName: 'status_1' });
                options.onProgress?.({ completed: 3, total: 3, indexName: 'region_copy' });
                return {
                    selectedIndexCount: 3,
                    createdCount: 2,
                    skippedCount: 1,
                    renamedCount: 1,
                    conflictingCount: 1,
                    cancelled: false,
                };
            }),
        } as unknown as CollectionIndexCopier;
        const context = createContext();
        const task = new TestCopyIndexesTask(config, copier);

        await task.runWorkForTest(new AbortController().signal, context);

        expect(copier.copyIndexes).toHaveBeenCalledWith(
            expect.objectContaining({ sourceIndexNames: ['email_1'], allowDocumentAffectingIndexes: true }),
        );
        expect(task.progressUpdates.map((update) => update.progress)).toEqual([0, 33, 66, 100, 100]);
        expect(task.progressUpdates.at(-1)?.message).toBe(
            '2 indexes created, 1 equivalent indexes skipped, 1 option conflicts skipped, 1 renamed.',
        );
        expect(context.telemetry.measurements).toMatchObject({
            selectedIndexCount: 3,
            createdIndexCount: 2,
            skippedIndexCount: 1,
            renamedIndexCount: 1,
            conflictingIndexCount: 1,
        });
        expect(context.telemetry.properties).toMatchObject({
            isCrossConnection: 'true',
            isCrossDatabase: 'true',
            copyScope: 'index',
            copyOperationCorrelationId: 'operation-id',
            indexCopyCancelled: 'false',
        });
    });

    it('completes an empty all-indexes selection at 100 percent', async () => {
        const copier = {
            copyIndexes: jest.fn().mockImplementation(async (options: CopyIndexesOptions) => {
                options.onStart?.(0);
                return {
                    selectedIndexCount: 0,
                    createdCount: 0,
                    skippedCount: 0,
                    renamedCount: 0,
                    conflictingCount: 0,
                    cancelled: false,
                };
            }),
        } as unknown as CollectionIndexCopier;
        const task = new TestCopyIndexesTask(
            { ...config, sourceIndexNames: undefined, copyScope: 'allIndexes' },
            copier,
        );
        const context = createContext();

        await task.runWorkForTest(new AbortController().signal, context);

        expect(task.progressUpdates.every((update) => update.progress === 100)).toBe(true);
        expect(context.telemetry.properties.copyScope).toBe('allIndexes');
        expect(copier.copyIndexes).toHaveBeenCalledWith(expect.objectContaining({ sourceIndexNames: undefined }));
    });

    it('records same-connection and same-database telemetry', async () => {
        const copier = {
            copyIndexes: jest.fn().mockResolvedValue({
                selectedIndexCount: 0,
                createdCount: 0,
                skippedCount: 0,
                renamedCount: 0,
                conflictingCount: 0,
                cancelled: false,
            }),
        } as unknown as CollectionIndexCopier;
        const sameLocationConfig: CopyIndexesConfig = {
            ...config,
            target: {
                clusterId: config.source.clusterId,
                databaseName: config.source.databaseName,
                collectionName: 'otherCollection',
            },
        };
        const task = new TestCopyIndexesTask(sameLocationConfig, copier);
        const context = createContext();

        await task.runWorkForTest(new AbortController().signal, context);

        expect(context.telemetry.properties.isCrossConnection).toBe('false');
        expect(context.telemetry.properties.isCrossDatabase).toBe('false');
    });

    it('records a named subset copy scope', async () => {
        const copier = {
            copyIndexes: jest.fn().mockResolvedValue({
                selectedIndexCount: 2,
                createdCount: 2,
                skippedCount: 0,
                renamedCount: 0,
                conflictingCount: 0,
                cancelled: false,
            }),
        } as unknown as CollectionIndexCopier;
        const task = new TestCopyIndexesTask(
            { ...config, sourceIndexNames: ['email_1', 'region_1'], copyScope: 'indexes' },
            copier,
        );
        const context = createContext();

        await task.runWorkForTest(new AbortController().signal, context);

        expect(context.telemetry.properties.copyScope).toBe('indexes');
    });

    it('reports cancellation with partial progress', async () => {
        const copier = {
            copyIndexes: jest.fn().mockImplementation(async (options: CopyIndexesOptions) => {
                options.onStart?.(4);
                options.onProgress?.({ completed: 1, total: 4, indexName: 'one' });
                options.onProgress?.({ completed: 2, total: 4, indexName: 'two' });
                return {
                    selectedIndexCount: 4,
                    createdCount: 2,
                    skippedCount: 0,
                    renamedCount: 0,
                    conflictingCount: 0,
                    cancelled: true,
                };
            }),
        } as unknown as CollectionIndexCopier;
        const task = new TestCopyIndexesTask(config, copier);
        const context = createContext();

        await task.runWorkForTest(new AbortController().signal, context);

        expect(task.progressUpdates.at(-1)).toEqual({
            progress: 50,
            message: 'Stopped after 2/4 indexes. Created indexes remain on the target.',
        });
        expect(context.telemetry.properties.indexCopyCancelled).toBe('true');
        expect(ext.outputChannel.warn).toHaveBeenCalled();
    });

    it('preserves a signal-driven cancellation without classifying it as a copy failure', async () => {
        const controller = new AbortController();
        const cancellation = new Error('cancelled');
        cancellation.name = 'AbortError';
        const copier = {
            copyIndexes: jest.fn().mockImplementation(async (options: CopyIndexesOptions) => {
                options.onStart?.(3);
                controller.abort(cancellation);
                throw cancellation;
            }),
        } as unknown as CollectionIndexCopier;
        const task = new TestCopyIndexesTask(config, copier);
        const context = createContext();

        await expect(task.runWorkForTest(controller.signal, context)).rejects.toBe(cancellation);
        expect(context.telemetry.properties.indexCopyCancelled).toBe('true');
        expect(context.telemetry.properties.indexCopyFailed).toBe('false');
        expect(context.telemetry.properties.indexCopyError).toBeUndefined();
        expect(context.telemetry.measurements.selectedIndexCount).toBe(3);
    });

    it('preserves the copier failure as the cause and classifies telemetry', async () => {
        const cause = new Error('create failed');
        cause.name = 'IndexCreationError';
        const copier = { copyIndexes: jest.fn().mockRejectedValue(cause) } as unknown as CollectionIndexCopier;
        const task = new TestCopyIndexesTask(config, copier);
        const context = createContext();

        const operation = task.runWorkForTest(new AbortController().signal, context);

        await expect(operation).rejects.toMatchObject({ cause });
        await expect(operation).rejects.toThrow('Failed to copy indexes: create failed');
        expect(context.telemetry.properties.indexCopyError).toBe('IndexCreationError');
    });

    it('declares source and target collections as stable resources', () => {
        const task = new TestCopyIndexesTask(config, {} as CollectionIndexCopier);

        expect(task.getUsedResources()).toEqual([config.source, config.target]);
    });
});
