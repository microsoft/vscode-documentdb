/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import {
    type BatchAttemptOutcome,
    ConflictResolutionStrategy,
    type DocumentDetails,
    type EnsureTargetExistsResult,
    type ErrorType,
    type PartialProgress,
    type StrategyBatchResult,
    type StreamingWriterSettings,
} from '../types';
import { StreamingDocumentWriter, StreamingWriterError } from './StreamingDocumentWriter';

class OutcomeStreamingWriter extends StreamingDocumentWriter {
    constructor(settings?: StreamingWriterSettings) {
        super('testdb', 'testcollection', {
            settings: {
                ...settings,
                retry: { baseDelayMs: 1, maxDelayMs: 1, ...settings?.retry },
            },
        });
    }

    public override writeBatch = vi.fn<
        (documents: DocumentDetails[]) => Promise<StrategyBatchResult | BatchAttemptOutcome>
    >((documents): Promise<StrategyBatchResult | BatchAttemptOutcome> => {
        return Promise.resolve({ processedCount: documents.length, insertedCount: documents.length });
    });

    public override classifyError = vi.fn<(error: unknown) => ErrorType>(() => 'other');

    public override extractPartialProgress = vi.fn<(error: unknown) => PartialProgress | undefined>();

    public override async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        return { targetWasCreated: false };
    }

    public getCurrentMode(): 'fast' | 'ru-limited' {
        return this.batchSizeAdapter.getCurrentMode();
    }

    public getCurrentBatchSize(): number {
        return this.batchSizeAdapter.getCurrentBatchSize();
    }
}

function createDocuments(count: number): DocumentDetails[] {
    return Array.from({ length: count }, (_, index): DocumentDetails => ({
        id: index + 1,
        documentContent: { value: index + 1 },
    }));
}

async function* createDocumentStream(documents: DocumentDetails[]): AsyncIterable<DocumentDetails> {
    yield* documents;
}

const config = { conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds };

describe('StreamingDocumentWriter batch attempt outcomes', () => {
    it('retries exactly the scattered remaining documents from a returned outcome', async () => {
        const writer = new OutcomeStreamingWriter();
        const documents = createDocuments(10);
        const remaining = documents.filter((document) => [2, 5, 9].includes(Number(document.id)));
        const onProgress = vi.fn();
        writer.writeBatch.mockResolvedValueOnce({
            result: { processedCount: 7, insertedCount: 7 },
            remaining,
            errorType: 'throttle',
        });

        const result = await writer.streamDocuments(createDocumentStream(documents), config, { onProgress });

        expect(writer.writeBatch).toHaveBeenCalledTimes(2);
        expect(writer.writeBatch.mock.calls[0][0]).toEqual(documents);
        expect(writer.writeBatch.mock.calls[1][0]).toBe(remaining);
        expect(result).toMatchObject({ totalProcessed: 10, insertedCount: 10, flushCount: 1 });
        expect(onProgress.mock.calls.map(([count]) => count)).toEqual([7, 3]);
        expect(writer.classifyError).not.toHaveBeenCalled();
        expect(writer.extractPartialProgress).not.toHaveBeenCalled();
    });

    it('stops on an Abort conflict in a returned partial throttle outcome', async () => {
        const writer = new OutcomeStreamingWriter();
        const documents = createDocuments(3);
        const duplicateError = new Error('Duplicate document');
        const onProgress = vi.fn();
        writer.writeBatch.mockResolvedValueOnce({
            result: {
                processedCount: 2,
                insertedCount: 1,
                abortedCount: 1,
                errors: [{ documentId: documents[1].id, error: duplicateError }],
            },
            remaining: documents.slice(2),
            errorType: 'throttle',
        });

        const write = writer.streamDocuments(
            createDocumentStream(documents),
            { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
            { onProgress },
        );

        await expect(write).rejects.toBeInstanceOf(StreamingWriterError);
        await expect(write).rejects.toMatchObject({
            cause: duplicateError,
            partialStats: { totalProcessed: 2, insertedCount: 1, abortedCount: 1 },
        });
        expect(writer.writeBatch).toHaveBeenCalledTimes(1);
        expect(onProgress.mock.calls.map(([count]) => count)).toEqual([2]);
    });

    it('preserves earlier partial progress when an Abort conflict stops a later throttle outcome', async () => {
        const writer = new OutcomeStreamingWriter();
        const documents = createDocuments(4);
        const duplicateError = new Error('Duplicate document');
        const onProgress = vi.fn();
        writer.writeBatch.mockResolvedValueOnce({
            result: { processedCount: 1, insertedCount: 1, abortedCount: 0 },
            remaining: documents.slice(1),
            errorType: 'throttle',
        });
        writer.writeBatch.mockResolvedValueOnce({
            result: {
                processedCount: 2,
                insertedCount: 1,
                abortedCount: 1,
                errors: [{ documentId: documents[2].id, error: duplicateError }],
            },
            remaining: documents.slice(3),
            errorType: 'throttle',
        });

        const write = writer.streamDocuments(
            createDocumentStream(documents),
            { conflictResolutionStrategy: ConflictResolutionStrategy.Abort },
            { onProgress },
        );

        await expect(write).rejects.toBeInstanceOf(StreamingWriterError);
        await expect(write).rejects.toMatchObject({
            cause: duplicateError,
            partialStats: { totalProcessed: 3, insertedCount: 2, abortedCount: 1 },
        });
        expect(writer.writeBatch).toHaveBeenCalledTimes(2);
        expect(writer.writeBatch.mock.calls[1][0]).toEqual(documents.slice(1));
        expect(onProgress.mock.calls.map(([count]) => count)).toEqual([1, 2]);
    });

    it.each([
        { route: 'return', written: 7 },
        { route: 'throw', written: 7 },
        { route: 'return', written: 0 },
        { route: 'throw', written: 0 },
    ])('adapts the batch size on $route throttle with $written written', async ({ route, written }) => {
        const writer = new OutcomeStreamingWriter();
        const documents = createDocuments(10);
        const remaining = documents.slice(written);
        const initialBatchSize = writer.getCurrentBatchSize();
        const expectedBatchSize = written || 1;
        if (route === 'return') {
            writer.writeBatch.mockResolvedValueOnce({
                result: { processedCount: written, insertedCount: written },
                remaining,
                errorType: 'throttle',
            });
        } else {
            writer.writeBatch.mockRejectedValueOnce(new Error('throttle'));
            writer.classifyError.mockReturnValue('throttle');
            writer.extractPartialProgress.mockReturnValue({ processedCount: written, insertedCount: written });
        }
        writer.writeBatch.mockImplementationOnce((batch): Promise<StrategyBatchResult> => {
            expect(batch).toEqual(remaining);
            expect(writer.getCurrentMode()).toBe('ru-limited');
            expect(writer.getCurrentBatchSize()).toBe(expectedBatchSize);
            expect(writer.getCurrentBatchSize()).toBeLessThan(initialBatchSize);
            return Promise.resolve({ processedCount: batch.length, insertedCount: batch.length });
        });
        const onProgress = vi.fn((): void => {
            expect(writer.getCurrentMode()).toBe('ru-limited');
        });

        const result = await writer.streamDocuments(createDocumentStream(documents), config, { onProgress });

        expect(writer.writeBatch).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ totalProcessed: 10, insertedCount: 10 });
    });

    it('retries the explicit non-prefix remaining documents extracted from a thrown throttle', async () => {
        const writer = new OutcomeStreamingWriter();
        const documents = createDocuments(10);
        const remaining = documents.filter((document) => [2, 5, 9].includes(Number(document.id)));
        const error = new Error('throttle');
        writer.writeBatch.mockRejectedValueOnce(error);
        writer.classifyError.mockReturnValue('throttle');
        writer.extractPartialProgress.mockReturnValue({ processedCount: 7, insertedCount: 7, remaining });

        const result = await writer.streamDocuments(createDocumentStream(documents), config);

        expect(writer.writeBatch).toHaveBeenCalledTimes(2);
        expect(writer.writeBatch.mock.calls[1][0]).toBe(remaining);
        expect(writer.extractPartialProgress).toHaveBeenCalledExactlyOnceWith(error, undefined);
        expect(result).toMatchObject({ totalProcessed: 10, insertedCount: 10 });
    });

    it('keeps prefix slicing for thrown throttle progress containing only counts', async () => {
        const writer = new OutcomeStreamingWriter();
        const documents = createDocuments(10);
        writer.writeBatch.mockRejectedValueOnce(new Error('throttle'));
        writer.classifyError.mockReturnValue('throttle');
        writer.extractPartialProgress.mockReturnValue({ processedCount: 4, insertedCount: 4 });

        const result = await writer.streamDocuments(createDocumentStream(documents), config);

        expect(writer.writeBatch).toHaveBeenCalledTimes(2);
        expect(writer.writeBatch.mock.calls[1][0]).toEqual(documents.slice(4));
        expect(result).toMatchObject({ totalProcessed: 10, insertedCount: 10 });
    });

    it('retries only the unwritten suffix for returned throttle progress containing only counts', async () => {
        const writer = new OutcomeStreamingWriter();
        const documents = createDocuments(10);
        const onProgress = vi.fn();
        writer.writeBatch.mockResolvedValueOnce({
            result: { processedCount: 4, insertedCount: 4 },
            errorType: 'throttle',
        });

        const result = await writer.streamDocuments(createDocumentStream(documents), config, { onProgress });

        expect(writer.writeBatch).toHaveBeenCalledTimes(2);
        expect(writer.writeBatch.mock.calls[0][0]).toEqual(documents);
        expect(writer.writeBatch.mock.calls[1][0]).toEqual(documents.slice(4));
        expect(result).toMatchObject({ totalProcessed: 10, insertedCount: 10 });
        expect(onProgress.mock.calls.map(([count]) => count)).toEqual([4, 6]);
    });

    it('waits and exhausts the retry limit for a returned throttle without progress or remaining documents', async () => {
        vi.useFakeTimers();
        try {
            const writer = new OutcomeStreamingWriter({ retry: { maxAttemptsWithoutProgress: 2 } });
            const documents = createDocuments(1);
            const onProgress = vi.fn();
            writer.writeBatch.mockResolvedValue({
                result: { processedCount: 0, insertedCount: 0 },
                errorType: 'throttle',
                retryAfterMs: 10,
            });

            const write = writer.streamDocuments(createDocumentStream(documents), config, { onProgress });
            const rejection = expect(write).rejects.toThrow('Failed to complete operation after 2 attempts');

            await vi.advanceTimersByTimeAsync(0);
            expect(writer.writeBatch).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(9);
            expect(writer.writeBatch).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            expect(writer.writeBatch).toHaveBeenCalledTimes(2);
            expect(writer.writeBatch.mock.calls[1][0]).toEqual(documents);
            await vi.advanceTimersByTimeAsync(10);
            await rejection;

            expect(writer.writeBatch).toHaveBeenCalledTimes(2);
            expect(onProgress).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(['throttle', undefined] as const)(
        'exhausts the retry limit for returned remaining documents without progress (errorType: %s)',
        async (errorType) => {
            const writer = new OutcomeStreamingWriter({ retry: { maxAttemptsWithoutProgress: 2 } });
            const documents = createDocuments(10);
            const onProgress = vi.fn();
            writer.writeBatch.mockResolvedValue({
                result: { processedCount: 0, insertedCount: 0 },
                remaining: documents,
                errorType,
            });

            await expect(
                writer.streamDocuments(createDocumentStream(documents), config, { onProgress }),
            ).rejects.toThrow('Failed to complete operation after 2 attempts');

            expect(writer.writeBatch).toHaveBeenCalledTimes(2);
            expect(writer.writeBatch.mock.calls[1][0]).toBe(documents);
            expect(onProgress).not.toHaveBeenCalled();
        },
    );

    it('retries a returned network outcome without changing the batch mode or size', async () => {
        const writer = new OutcomeStreamingWriter();
        const documents = createDocuments(10);
        const initialBatchSize = writer.getCurrentBatchSize();
        writer.writeBatch.mockResolvedValueOnce({
            result: { processedCount: 0, insertedCount: 0 },
            remaining: documents,
            errorType: 'network',
        });
        writer.writeBatch.mockImplementationOnce((batch): Promise<StrategyBatchResult> => {
            expect(batch).toBe(documents);
            expect(writer.getCurrentMode()).toBe('fast');
            expect(writer.getCurrentBatchSize()).toBe(initialBatchSize);
            return Promise.resolve({ processedCount: batch.length, insertedCount: batch.length });
        });

        const result = await writer.streamDocuments(createDocumentStream(documents), config);

        expect(writer.writeBatch).toHaveBeenCalledTimes(2);
        expect(writer.getCurrentMode()).toBe('fast');
        expect(writer.extractPartialProgress).not.toHaveBeenCalled();
        expect(result).toMatchObject({ totalProcessed: 10, insertedCount: 10 });
    });

    it.each([{ remaining: undefined }, { remaining: [] }])(
        'accepts a successful returned outcome with remaining=$remaining',
        async ({ remaining }) => {
            const writer = new OutcomeStreamingWriter();
            const documents = createDocuments(10);
            writer.writeBatch.mockResolvedValueOnce({
                result: { processedCount: 10, insertedCount: 10 },
                remaining,
            });

            const result = await writer.streamDocuments(createDocumentStream(documents), config);

            expect(writer.writeBatch).toHaveBeenCalledTimes(1);
            expect(result).toMatchObject({ totalProcessed: 10, insertedCount: 10 });
        },
    );

    it('counts completed throttle progress once when no documents remain', async () => {
        const writer = new OutcomeStreamingWriter();
        const documents = createDocuments(10);
        const onProgress = vi.fn();
        writer.writeBatch.mockResolvedValueOnce({
            result: { processedCount: 10, insertedCount: 10 },
            remaining: [],
            errorType: 'throttle',
        });

        const result = await writer.streamDocuments(createDocumentStream(documents), config, { onProgress });

        expect(writer.writeBatch).toHaveBeenCalledTimes(1);
        expect(result).toMatchObject({ totalProcessed: 10, insertedCount: 10 });
        expect(onProgress.mock.calls.map(([count]) => count)).toEqual([10]);
    });
});
