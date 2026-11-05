/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import {
    ConflictResolutionStrategy,
    type DocumentDetails,
    type EnsureTargetExistsResult,
    type ErrorType,
    type PartialProgress,
    type StrategyBatchResult,
    type StreamingWriterOptions,
} from '../types';
import { BatchSizeAdapter } from './BatchSizeAdapter';
import { StreamingDocumentWriter } from './StreamingDocumentWriter';

class ThrottleError extends Error {
    constructor(public readonly processedCount: number = 0) {
        super('throttle');
    }
}

class TestStreamingWriter extends StreamingDocumentWriter<string> {
    public readonly write = vi.fn(
        async (documents: DocumentDetails[]): Promise<StrategyBatchResult<string>> => ({
            processedCount: documents.length,
            insertedCount: documents.length,
            abortedCount: 0,
        }),
    );

    constructor(options?: StreamingWriterOptions) {
        super('database', 'collection', options);
    }

    public async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        return { targetWasCreated: false };
    }

    protected writeBatch(documents: DocumentDetails[]): Promise<StrategyBatchResult<string>> {
        return this.write(documents);
    }

    protected classifyError(error: unknown): ErrorType {
        if (error instanceof ThrottleError) {
            return 'throttle';
        }
        return error instanceof Error && error.message === 'network' ? 'network' : 'other';
    }

    protected extractPartialProgress(error: unknown): PartialProgress | undefined {
        return error instanceof ThrottleError
            ? { processedCount: error.processedCount, insertedCount: error.processedCount }
            : undefined;
    }
}

async function* documents(count: number): AsyncIterable<DocumentDetails> {
    for (let id = 0; id < count; id++) {
        yield { id: String(id), documentContent: { _id: String(id) } };
    }
}

const config = { conflictResolutionStrategy: ConflictResolutionStrategy.Abort };

describe('StreamingDocumentWriter settings', () => {
    it('starts in RU-limited mode at 100 documents and grows by 10 percent', async () => {
        const writer = new TestStreamingWriter({ settings: { batching: { startMode: 'ru-limited' } } });

        const result = await writer.streamDocuments(documents(210), config);

        expect(writer.write.mock.calls.map(([batch]): number => batch.length)).toEqual([100, 110]);
        expect(result.totalProcessed).toBe(210);
        expect(result.flushCount).toBe(2);
    });

    it('applies adapter defaults before caller overrides in the writer constructor', async () => {
        const writer = new TestStreamingWriter({
            adapterDefaults: { batching: { fast: { initialBatchSize: 2, maxBatchSize: 8, growthFactor: 2 } } },
            settings: { batching: { fast: { growthFactor: 1.5 } } },
        });

        await writer.streamDocuments(documents(5), config);

        expect(writer.write.mock.calls.map(([batch]): number => batch.length)).toEqual([2, 3]);
    });

    it('flushes at the memory limit using the custom document size estimator', async () => {
        const estimateDocumentSize = vi.fn((_document: DocumentDetails): number => 600);
        const writer = new TestStreamingWriter({
            settings: { batching: { bufferMemoryLimitMB: 1 / 1024 }, estimateDocumentSize },
        });

        const result = await writer.streamDocuments(documents(5), config);

        expect(writer.write.mock.calls.map(([batch]): number => batch.length)).toEqual([2, 2, 1]);
        expect(estimateDocumentSize).toHaveBeenCalledTimes(5);
        expect(estimateDocumentSize).toHaveBeenCalledWith({ id: '0', documentContent: { _id: '0' } });
        expect(result.totalProcessed).toBe(5);
        expect(result.flushCount).toBe(3);
    });

    it.each([new Error('network'), new ThrottleError()])(
        'honours the retry attempt limit for $message errors',
        async (error) => {
            const writer = new TestStreamingWriter({
                settings: {
                    retry: { maxAttemptsWithoutProgress: 3, baseDelayMs: 1, maxDelayMs: 1, jitterFraction: 0 },
                },
            });
            writer.write.mockRejectedValue(error);

            await expect(writer.streamDocuments(documents(1), config)).rejects.toThrow(
                'Failed to complete operation after 3 attempts',
            );
            expect(writer.write).toHaveBeenCalledTimes(3);
        },
    );

    it('resets the configured retry attempt counter when a throttle makes progress', async () => {
        const writer = new TestStreamingWriter({
            settings: {
                retry: { maxAttemptsWithoutProgress: 2, baseDelayMs: 1, maxDelayMs: 1, jitterFraction: 0 },
            },
        });
        writer.write
            .mockRejectedValueOnce(new ThrottleError())
            .mockRejectedValueOnce(new ThrottleError(1))
            .mockRejectedValueOnce(new ThrottleError());

        const result = await writer.streamDocuments(documents(2), config);

        expect(writer.write).toHaveBeenCalledTimes(4);
        expect(writer.write.mock.calls.map(([batch]): number => batch.length)).toEqual([2, 2, 1, 1]);
        expect(result.totalProcessed).toBe(2);
        expect(result.insertedCount).toBe(2);
    });
});

describe('BatchSizeAdapter settings', () => {
    it('keeps the existing default construction behaviour', () => {
        const adapter = new BatchSizeAdapter();

        expect(adapter.getCurrentMode()).toBe('fast');
        expect(adapter.getBufferConstraints()).toEqual({ optimalDocumentCount: 500, maxMemoryMB: 24 });
        adapter.grow();
        expect(adapter.getCurrentBatchSize()).toBe(600);
    });

    it('does not switch modes on the first throttle when starting RU-limited', () => {
        const adapter = new BatchSizeAdapter({ startMode: 'ru-limited' });

        expect(adapter.getCurrentMode()).toBe('ru-limited');
        expect(adapter.getCurrentBatchSize()).toBe(100);
        adapter.grow();
        expect(adapter.getCurrentBatchSize()).toBe(110);
        adapter.handleThrottle(0);
        expect(adapter.getCurrentMode()).toBe('ru-limited');
        expect(adapter.getCurrentBatchSize()).toBe(55);
        adapter.reset();
        expect(adapter.getCurrentMode()).toBe('ru-limited');
        expect(adapter.getCurrentBatchSize()).toBe(100);
    });

    it('uses configured mode growth, maximums, minimum batch size and memory limit', () => {
        const adapter = new BatchSizeAdapter({
            fast: { initialBatchSize: 3, maxBatchSize: 4, growthFactor: 2 },
            ruLimited: { initialBatchSize: 5, maxBatchSize: 8, growthFactor: 1.5 },
            minBatchSize: 2,
            bufferMemoryLimitMB: 1,
        });

        expect(adapter.getBufferConstraints()).toEqual({ optimalDocumentCount: 3, maxMemoryMB: 1 });
        adapter.grow();
        expect(adapter.getCurrentBatchSize()).toBe(4);
        adapter.handleThrottle(0);
        expect(adapter.getCurrentMode()).toBe('ru-limited');
        expect(adapter.getCurrentBatchSize()).toBe(2);
        adapter.grow();
        expect(adapter.getCurrentBatchSize()).toBe(3);
        adapter.grow();
        adapter.grow();
        adapter.grow();
        expect(adapter.getCurrentBatchSize()).toBe(8);
        adapter.reset();
        expect(adapter.getCurrentMode()).toBe('fast');
        expect(adapter.getCurrentBatchSize()).toBe(3);
    });
});
