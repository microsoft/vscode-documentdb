/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { ClustersClient } from '../../../../documentdb/ClustersClient';
import { CredentialCache } from '../../../../documentdb/CredentialCache';
import { ext } from '../../../../extensionVariables';
import { type CollectionIndexCopier, type CopyIndexesOptions } from '../../data-api/indexes/CollectionIndexCopier';
import { ConflictResolutionStrategy, type DocumentReader } from '../../data-api/types';
import { type StreamingDocumentWriter } from '../../data-api/writers/StreamingDocumentWriter';
import { type TaskTelemetryContext } from '../../taskHost';
import { CopyPasteCollectionTask, SourceValidationError } from './CopyPasteCollectionTask';
import { type CopyPasteConfig } from './copyPasteConfig';

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));

vi.mock('../../../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: vi.fn() },
}));

vi.mock('../../../../documentdb/CredentialCache', () => ({
    CredentialCache: { hasCredentials: vi.fn() },
}));

vi.mock('../../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: vi.fn(),
            error: vi.fn(),
            trace: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
        },
    },
}));

vi.mock('vscode', () => ({
    l10n: {
        t: (message: string, ...args: string[]): string =>
            args.reduce((result, value, index) => result.replace(`{${index}}`, value), message),
    },
    EventEmitter: vi.fn().mockImplementation(function () {
        return {
            event: vi.fn(),
            fire: vi.fn(),
            dispose: vi.fn(),
        };
    }),
    ThemeIcon: vi.fn(),
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
    copyOperationCorrelationId: 'operation-id',
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
            copyIndexes: vi.fn().mockImplementation(async (options: CopyIndexesOptions) => {
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
        const reader = { streamDocuments: vi.fn() } as unknown as DocumentReader;
        const writer = { streamDocuments: vi.fn() } as unknown as StreamingDocumentWriter;
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0, {
            logger: ext.outputChannel,
        });
        const context = createContext();

        await task.runWorkForTest(new AbortController().signal, context);

        expect(task.progressUpdates).toContainEqual({ progress: 0, message: 'Copying 20 indexes...' });
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[CopyPasteTask] Index copy progress: 1/20 (email_1).');
        expect(indexCopier.copyIndexes).toHaveBeenCalledWith(
            expect.not.objectContaining({ sourceIndexNames: expect.anything() }),
        );
        expect(context.telemetry.measurements.selectedIndexCount).toBe(20);
        expect(context.telemetry.measurements.sourceIndexCount).toBeUndefined();
        expect(context.telemetry.properties.copyOperationCorrelationId).toBe('operation-id');
        expect(context.telemetry.properties.indexCopyFailed).toBe('false');
    });

    it('copies indexes before streaming documents', async () => {
        const calls: string[] = [];
        const indexCopier = {
            copyIndexes: vi.fn().mockImplementation(async () => {
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
            streamDocuments: vi.fn().mockImplementation(() => {
                calls.push('documents');
                return (async function* () {
                    yield { id: '1', documentContent: { _id: '1' } };
                })();
            }),
        } as unknown as DocumentReader;
        const writer = {
            streamDocuments: vi.fn().mockResolvedValue({ totalProcessed: 1, flushCount: 1, insertedCount: 1 }),
        } as unknown as StreamingDocumentWriter;
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0);
        task.setSourceDocumentCount(1);

        await task.runWorkForTest(new AbortController().signal, createContext());

        expect(calls).toEqual(['indexes', 'documents']);
    });

    it('fails before document streaming when index creation fails', async () => {
        const indexCopier = {
            copyIndexes: vi.fn().mockRejectedValue(new Error('index creation failed')),
        } as unknown as CollectionIndexCopier;
        const reader = {
            streamDocuments: vi.fn(),
        } as unknown as DocumentReader;
        const writer = {
            streamDocuments: vi.fn(),
        } as unknown as StreamingDocumentWriter;
        const context = createContext();
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0);
        task.setSourceDocumentCount(1);

        await expect(task.runWorkForTest(new AbortController().signal, context)).rejects.toThrow(
            'Failed to copy indexes before copying documents: index creation failed',
        );
        expect(reader.streamDocuments).not.toHaveBeenCalled();
        expect(context.telemetry.properties.indexCopyFailed).toBe('true');
        expect(context.telemetry.properties.indexCopyError).toBe('Error');
    });

    it('preserves cancellation without recording an index-copy failure', async () => {
        const controller = new AbortController();
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        const indexCopier = {
            copyIndexes: vi.fn().mockImplementation(async () => {
                controller.abort();
                throw abortError;
            }),
        } as unknown as CollectionIndexCopier;
        const reader = { streamDocuments: vi.fn() } as unknown as DocumentReader;
        const writer = { streamDocuments: vi.fn() } as unknown as StreamingDocumentWriter;
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
            copyIndexes: vi.fn().mockResolvedValue({
                selectedIndexCount: 1,
                createdCount: 1,
                skippedCount: 0,
                renamedCount: 0,
                conflictingCount: 0,
                cancelled: false,
            }),
        } as unknown as CollectionIndexCopier;
        const reader = { streamDocuments: vi.fn() } as unknown as DocumentReader;
        const writer = { streamDocuments: vi.fn() } as unknown as StreamingDocumentWriter;
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0);

        await task.runWorkForTest(new AbortController().signal, createContext());

        expect(indexCopier.copyIndexes).toHaveBeenCalled();
        expect(reader.streamDocuments).not.toHaveBeenCalled();
    });

    it('does not access indexes when index copying is disabled', async () => {
        const indexCopier = { copyIndexes: vi.fn() } as unknown as CollectionIndexCopier;
        const reader = { streamDocuments: vi.fn() } as unknown as DocumentReader;
        const writer = { streamDocuments: vi.fn() } as unknown as StreamingDocumentWriter;
        const task = new TestCopyPasteCollectionTask({ ...config, copyIndexes: false }, reader, writer, indexCopier, 0);

        await task.runWorkForTest(new AbortController().signal, createContext());

        expect(indexCopier.copyIndexes).not.toHaveBeenCalled();
        expect(reader.streamDocuments).not.toHaveBeenCalled();
    });
});

describe('CopyPasteCollectionTask injected strings', () => {
    it('overrides the task name and a progress message with partial strings', async () => {
        const indexCopier = {
            copyIndexes: vi.fn().mockImplementation(async (options: CopyIndexesOptions) => {
                options.onStart?.(20);
                return {
                    selectedIndexCount: 20,
                    createdCount: 0,
                    skippedCount: 20,
                    renamedCount: 0,
                    conflictingCount: 0,
                    cancelled: false,
                };
            }),
        } as unknown as CollectionIndexCopier;
        const reader = { streamDocuments: vi.fn() } as unknown as DocumentReader;
        const writer = { streamDocuments: vi.fn() } as unknown as StreamingDocumentWriter;
        const task = new TestCopyPasteCollectionTask(config, reader, writer, indexCopier, 0, {
            copyCollectionStrings: {
                taskName: (
                    sourceCollection: string,
                    sourceDatabase: string,
                    targetDatabase: string,
                    targetCollection: string,
                ): string => `Transfer ${sourceDatabase}/${sourceCollection} to ${targetDatabase}/${targetCollection}`,
                copyingIndexes: (total: string): string => `Preparing ${total} indexes`,
            },
        });

        await task.runWorkForTest(new AbortController().signal, createContext());

        expect(task.name).toBe('Transfer sourceDb/sourceCollection to targetDb/targetCollection');
        expect(task.progressUpdates).toContainEqual({ progress: 0, message: 'Preparing 20 indexes' });
        expect(task.progressUpdates).toContainEqual({ progress: 100, message: 'Source collection is empty.' });
    });
});

describe('CopyPasteCollectionTask injected hooks', () => {
    class InitializableCopyPasteCollectionTask extends CopyPasteCollectionTask {
        public runInitializeForTest(signal: AbortSignal, context?: TaskTelemetryContext): Promise<void> {
            return this.onInitialize(signal, context);
        }
    }

    const reader = { countDocuments: vi.fn().mockResolvedValue(3) } as unknown as DocumentReader;
    const writer = {
        ensureTargetExists: vi.fn().mockResolvedValue({ targetWasCreated: false }),
    } as unknown as StreamingDocumentWriter;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('rethrows source validation errors unchanged before counting documents', async () => {
        const error = new SourceValidationError('source is unavailable');
        const validateSource = vi.fn().mockRejectedValue(error);
        const task = new InitializableCopyPasteCollectionTask(config, reader, writer, undefined, undefined, {
            validateSource,
        });
        const signal = new AbortController().signal;
        const context = createContext();

        await expect(task.runInitializeForTest(signal, context)).rejects.toBe(error);

        expect(validateSource).toHaveBeenCalledWith(signal, context);
        expect(task.getStatus().message).toBe('Validating source collection...');
        expect(reader.countDocuments).not.toHaveBeenCalled();
        expect(writer.ensureTargetExists).not.toHaveBeenCalled();
    });

    it.each([new Error('connection failed'), 'connection failed'])(
        'wraps unexpected validation failures: %s',
        async (error) => {
            const task = new InitializableCopyPasteCollectionTask(config, reader, writer, undefined, undefined, {
                validateSource: vi.fn().mockRejectedValue(error),
            });

            await expect(task.runInitializeForTest(new AbortController().signal, createContext())).rejects.toThrow(
                'Failed to validate source collection: connection failed',
            );
        },
    );

    it('ignores metadata hook errors and continues initialization', async () => {
        const context = createContext();
        const collectMetadata = vi.fn().mockRejectedValue(new Error('metadata unavailable'));
        const task = new InitializableCopyPasteCollectionTask(config, reader, writer, undefined, undefined, {
            collectMetadata,
        });
        const signal = new AbortController().signal;

        await expect(task.runInitializeForTest(signal, context)).resolves.toBeUndefined();

        expect(collectMetadata).toHaveBeenCalledWith(context);
        expect(reader.countDocuments).toHaveBeenCalledWith(signal, context);
        expect(writer.ensureTargetExists).toHaveBeenCalledOnce();
        expect(context.telemetry.properties).toMatchObject({
            onConflict: config.onConflict,
            copyIndexes: 'true',
            isCrossConnection: 'true',
        });
    });

    it('initializes without hooks or DocumentDB infrastructure access', async () => {
        const task = new InitializableCopyPasteCollectionTask(config, reader, writer);
        const signal = new AbortController().signal;
        const context = createContext();

        await expect(task.runInitializeForTest(signal, context)).resolves.toBeUndefined();

        expect(ClustersClient.getClient).not.toHaveBeenCalled();
        expect(CredentialCache.hasCredentials).not.toHaveBeenCalled();
        expect(reader.countDocuments).toHaveBeenCalledWith(signal, context);
        expect(writer.ensureTargetExists).toHaveBeenCalledOnce();
    });
});
