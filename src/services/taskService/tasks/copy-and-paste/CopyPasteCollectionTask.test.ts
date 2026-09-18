/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ext } from '../../../../extensionVariables';
import { type CollectionIndexCopier, type CopyIndexesOptions } from '../../data-api/indexes/CollectionIndexCopier';
import { ConflictResolutionStrategy, type DocumentReader } from '../../data-api/types';
import { type StreamingDocumentWriter } from '../../data-api/writers/StreamingDocumentWriter';
import { CopyPasteCollectionTask } from './CopyPasteCollectionTask';
import { type CopyPasteConfig } from './copyPasteConfig';

jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(),
}));

jest.mock('../../../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: jest.fn() },
}));

jest.mock('../../../../documentdb/CredentialCache', () => ({
    CredentialCache: { hasCredentials: jest.fn() },
}));

jest.mock('../../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: jest.fn(),
            error: jest.fn(),
            trace: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
        },
    },
}));

jest.mock('vscode', () => ({
    l10n: {
        t: (message: string, ...args: string[]): string =>
            args.reduce((result, value, index) => result.replace(`{${index}}`, value), message),
    },
    EventEmitter: jest.fn().mockImplementation(() => ({
        event: jest.fn(),
        fire: jest.fn(),
        dispose: jest.fn(),
    })),
    ThemeIcon: jest.fn(),
}));

class TestCopyPasteCollectionTask extends CopyPasteCollectionTask {
    public readonly progressUpdates: Array<{ progress: number; message?: string }> = [];

    public runWorkForTest(signal: AbortSignal, context: IActionContext): Promise<void> {
        return this.doWork(signal, context);
    }

    public setSourceDocumentCount(count: number): void {
        (this as unknown as { sourceDocumentCount: number }).sourceDocumentCount = count;
    }

    protected override updateProgress(progress: number, message?: string): void {
        this.progressUpdates.push({ progress, message });
        super.updateProgress(progress, message);
    }
}

const config: CopyPasteConfig = {
    source: { clusterId: 'source', databaseName: 'sourceDb', collectionName: 'sourceCollection' },
    target: { clusterId: 'target', databaseName: 'targetDb', collectionName: 'targetCollection' },
    onConflict: ConflictResolutionStrategy.Abort,
    copyIndexes: true,
};

function createContext(): IActionContext {
    return {
        telemetry: { properties: {}, measurements: {} },
    } as IActionContext;
}

describe('CopyPasteCollectionTask index phase', () => {
    it('shows a stable index count and traces per-index progress', async () => {
        const indexCopier = {
            copyIndexes: jest.fn().mockImplementation(async (options: CopyIndexesOptions) => {
                options.onStart?.(20);
                options.onProgress?.({ completed: 1, total: 20, indexName: 'email_1' });
                return {
                    selectedIndexCount: 20,
                    createdCount: 0,
                    skippedCount: 1,
                    renamedCount: 0,
                    conflictingCount: 0,
                    cancelled: false,
                };
            }),
        } as unknown as CollectionIndexCopier;
        const reader = { streamDocuments: jest.fn() } as unknown as DocumentReader;
        const writer = { streamDocuments: jest.fn() } as unknown as StreamingDocumentWriter;
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0);
        const context = createContext();

        await task.runWorkForTest(new AbortController().signal, context);

        expect(task.progressUpdates).toContainEqual({ progress: 0, message: 'Copying 20 indexes...' });
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[CopyPasteTask] Index copy progress: 1/20 (email_1).');
        expect(indexCopier.copyIndexes).toHaveBeenCalledWith(
            expect.not.objectContaining({ sourceIndexNames: expect.anything() }),
        );
        expect(context.telemetry.measurements.selectedIndexCount).toBe(20);
        expect(context.telemetry.measurements.sourceIndexCount).toBeUndefined();
    });

    it('copies indexes before streaming documents', async () => {
        const calls: string[] = [];
        const indexCopier = {
            copyIndexes: jest.fn().mockImplementation(async () => {
                calls.push('indexes');
                return {
                    selectedIndexCount: 1,
                    createdCount: 1,
                    skippedCount: 0,
                    renamedCount: 0,
                    conflictingCount: 0,
                    cancelled: false,
                };
            }),
        } as unknown as CollectionIndexCopier;
        const reader = {
            streamDocuments: jest.fn().mockImplementation(() => {
                calls.push('documents');
                return (async function* () {
                    yield { id: '1', documentContent: { _id: '1' } };
                })();
            }),
        } as unknown as DocumentReader;
        const writer = {
            streamDocuments: jest.fn().mockResolvedValue({ totalProcessed: 1, flushCount: 1, insertedCount: 1 }),
        } as unknown as StreamingDocumentWriter;
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0);
        task.setSourceDocumentCount(1);

        await task.runWorkForTest(new AbortController().signal, createContext());

        expect(calls).toEqual(['indexes', 'documents']);
    });

    it('fails before document streaming when index creation fails', async () => {
        const indexCopier = {
            copyIndexes: jest.fn().mockRejectedValue(new Error('index creation failed')),
        } as unknown as CollectionIndexCopier;
        const reader = {
            streamDocuments: jest.fn(),
        } as unknown as DocumentReader;
        const writer = {
            streamDocuments: jest.fn(),
        } as unknown as StreamingDocumentWriter;
        const context = createContext();
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0);
        task.setSourceDocumentCount(1);

        await expect(task.runWorkForTest(new AbortController().signal, context)).rejects.toThrow(
            'Failed to copy indexes before copying documents: index creation failed',
        );
        expect(reader.streamDocuments).not.toHaveBeenCalled();
        expect(context.telemetry.properties.indexCopyFailed).toBe('true');
        expect(context.telemetry.properties.indexCopyError).toBe('copyIndexesFailed');
    });

    it('preserves cancellation without recording an index-copy failure', async () => {
        const controller = new AbortController();
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        const indexCopier = {
            copyIndexes: jest.fn().mockImplementation(async () => {
                controller.abort();
                throw abortError;
            }),
        } as unknown as CollectionIndexCopier;
        const reader = { streamDocuments: jest.fn() } as unknown as DocumentReader;
        const writer = { streamDocuments: jest.fn() } as unknown as StreamingDocumentWriter;
        const context = createContext();
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0);
        task.setSourceDocumentCount(1);

        await expect(task.runWorkForTest(controller.signal, context)).rejects.toBe(abortError);

        expect(reader.streamDocuments).not.toHaveBeenCalled();
        expect(context.telemetry.properties.indexCopyFailed).toBeUndefined();
        expect(context.telemetry.properties.indexCopyError).toBeUndefined();
    });

    it('copies indexes when the source collection is empty', async () => {
        const indexCopier = {
            copyIndexes: jest.fn().mockResolvedValue({
                selectedIndexCount: 1,
                createdCount: 1,
                skippedCount: 0,
                renamedCount: 0,
                conflictingCount: 0,
                cancelled: false,
            }),
        } as unknown as CollectionIndexCopier;
        const reader = { streamDocuments: jest.fn() } as unknown as DocumentReader;
        const writer = { streamDocuments: jest.fn() } as unknown as StreamingDocumentWriter;
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0);

        await task.runWorkForTest(new AbortController().signal, createContext());

        expect(indexCopier.copyIndexes).toHaveBeenCalled();
        expect(reader.streamDocuments).not.toHaveBeenCalled();
    });

    it('does not access indexes when index copying is disabled', async () => {
        const indexCopier = { copyIndexes: jest.fn() } as unknown as CollectionIndexCopier;
        const reader = { streamDocuments: jest.fn() } as unknown as DocumentReader;
        const writer = { streamDocuments: jest.fn() } as unknown as StreamingDocumentWriter;
        const task = new TestCopyPasteCollectionTask({ ...config, copyIndexes: false }, reader, writer, indexCopier, 0);

        await task.runWorkForTest(new AbortController().signal, createContext());

        expect(indexCopier.copyIndexes).not.toHaveBeenCalled();
        expect(reader.streamDocuments).not.toHaveBeenCalled();
    });
});
