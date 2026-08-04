/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type DocumentDbIndexService } from '../../data-api/indexes/DocumentDbIndexService';
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
    public runWorkForTest(signal: AbortSignal, context: IActionContext): Promise<void> {
        return this.doWork(signal, context);
    }

    public setSourceDocumentCount(count: number): void {
        (this as unknown as { sourceDocumentCount: number }).sourceDocumentCount = count;
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
    it('copies indexes before streaming documents', async () => {
        const calls: string[] = [];
        const sourceIndexes = {
            copyIndexesTo: jest.fn().mockImplementation(async () => {
                calls.push('indexes');
                return { sourceIndexCount: 1, createdCount: 1, skippedCount: 0, renamedCount: 0 };
            }),
        } as unknown as DocumentDbIndexService;
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
        const task = new TestCopyPasteCollectionTask(config, reader, writer, {
            source: sourceIndexes,
            target: {} as DocumentDbIndexService,
            presentationDelayMs: 0,
        });
        task.setSourceDocumentCount(1);

        await task.runWorkForTest(new AbortController().signal, createContext());

        expect(calls).toEqual(['indexes', 'documents']);
    });

    it('fails before document streaming when index creation fails', async () => {
        const sourceIndexes = {
            copyIndexesTo: jest.fn().mockRejectedValue(new Error('index creation failed')),
        } as unknown as DocumentDbIndexService;
        const reader = {
            streamDocuments: jest.fn(),
        } as unknown as DocumentReader;
        const writer = {
            streamDocuments: jest.fn(),
        } as unknown as StreamingDocumentWriter;
        const context = createContext();
        const task = new TestCopyPasteCollectionTask(config, reader, writer, {
            source: sourceIndexes,
            target: {} as DocumentDbIndexService,
            presentationDelayMs: 0,
        });
        task.setSourceDocumentCount(1);

        await expect(task.runWorkForTest(new AbortController().signal, context)).rejects.toThrow(
            'Failed to copy indexes before copying documents.',
        );
        expect(reader.streamDocuments).not.toHaveBeenCalled();
        expect(context.telemetry.properties.indexCopyFailed).toBe('true');
    });
});
