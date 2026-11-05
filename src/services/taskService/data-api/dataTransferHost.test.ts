/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { type TaskLogger } from '../taskHost';
import { type DataTransferOptions } from './dataTransferHost';
import { BaseDocumentReader } from './readers/BaseDocumentReader';
import {
    ConflictResolutionStrategy,
    type DocumentDetails,
    type EnsureTargetExistsResult,
    type ErrorType,
    type PartialProgress,
    type StrategyBatchResult,
} from './types';
import { StreamingDocumentWriter } from './writers/StreamingDocumentWriter';

const document: DocumentDetails = { id: '1', documentContent: { _id: '1' } };
const config = { conflictResolutionStrategy: ConflictResolutionStrategy.Abort };

class TestReader extends BaseDocumentReader {
    constructor(options?: DataTransferOptions) {
        super('database', 'collection', options);
    }

    protected async *streamDocumentsFromDatabase(): AsyncIterable<DocumentDetails> {
        yield document;
    }

    protected async countDocumentsInDatabase(): Promise<number> {
        return 1;
    }
}

class TestWriter extends StreamingDocumentWriter {
    constructor(
        options?: DataTransferOptions,
        private readonly fail: boolean = false,
    ) {
        super('database', 'collection', options);
    }

    public async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        return { targetWasCreated: false };
    }

    protected async writeBatch(documents: DocumentDetails[]): Promise<StrategyBatchResult<unknown>> {
        if (this.fail) {
            throw new Error('test failure');
        }
        return { processedCount: documents.length, insertedCount: documents.length, abortedCount: 0 };
    }

    protected classifyError(): ErrorType {
        return 'other';
    }

    protected extractPartialProgress(): PartialProgress | undefined {
        return undefined;
    }
}

describe('data transfer host injection', () => {
    it('sends writer, batch adapter and reader traces to the injected logger', async () => {
        const logger: TaskLogger = {
            appendLine: vi.fn(),
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        const reader = new TestReader({ logger });
        const writer = new TestWriter({ logger });

        await reader.countDocuments();
        await writer.streamDocuments(reader.streamDocuments(), config);

        expect(logger.trace).toHaveBeenCalledWith('[Reader] Counting documents in database.collection');
        expect(logger.trace).toHaveBeenCalledWith('[Reader] Document count result: 1 documents');
        expect(logger.trace).toHaveBeenCalledWith('[StreamingWriter] Starting document streaming with abort strategy');
        expect(logger.trace).toHaveBeenCalledWith(
            '[BatchSizeAdapter] Success: Growing batch size 500 → 600 (mode: fast, growth: 20.0%)',
        );
    });

    it('overrides a thrown writer error with partial strings', async () => {
        const writer = new TestWriter(
            { strings: { writeOperationFailed: (message: string): string => `Custom failure: ${message}` } },
            true,
        );

        await expect(writer.streamDocuments(new TestReader().streamDocuments(), config)).rejects.toThrow(
            'Custom failure: test failure',
        );
    });

    it('passes a partial progress string override to WriteStats and retains defaults', async () => {
        const options: DataTransferOptions = { strings: { inserted: (count: string): string => `Added ${count}` } };
        const writer = new TestWriter(options);
        const onProgress = vi.fn();

        await writer.streamDocuments(new TestReader().streamDocuments(), config, { onProgress });

        expect(onProgress).toHaveBeenCalledWith(1, 'Added 1');
        await expect(
            new TestWriter(options, true).streamDocuments(new TestReader().streamDocuments(), config),
        ).rejects.toThrow('Write operation failed: test failure');
    });
});
