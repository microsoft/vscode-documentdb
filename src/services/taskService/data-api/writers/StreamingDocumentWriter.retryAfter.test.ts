/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noopDataTransferLogger } from '../dataTransferHost';
import {
    type BatchAttemptOutcome,
    ConflictResolutionStrategy,
    type DocumentDetails,
    type EnsureTargetExistsResult,
    type ErrorType,
    type PartialProgress,
    type StrategyBatchResult,
    type StreamingWriterOptions,
} from '../types';
import { StreamingDocumentWriter } from './StreamingDocumentWriter';

class RetryAfterStreamingWriter extends StreamingDocumentWriter {
    constructor(options?: StreamingWriterOptions) {
        super('testdb', 'testcollection', {
            ...options,
            settings: { retry: { jitterFraction: 0 } },
        });
    }

    public override writeBatch = vi
        .fn<() => Promise<StrategyBatchResult | BatchAttemptOutcome>>()
        .mockResolvedValue({ processedCount: 1, insertedCount: 1 });

    public override classifyError = vi.fn<(error: unknown) => ErrorType>(() => 'throttle');

    public override extractPartialProgress = vi.fn<(error: unknown) => PartialProgress | undefined>();

    public override async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        return { targetWasCreated: false };
    }
}

class SuggestedRetryAfterStreamingWriter extends RetryAfterStreamingWriter {
    public override getRetryAfterMs = vi.fn<(error: unknown) => number | undefined>(() => 60_000);
}

const documents: DocumentDetails[] = [{ id: 1, documentContent: { value: 1 } }];
const config = { conflictResolutionStrategy: ConflictResolutionStrategy.GenerateNewIds };

async function* createDocumentStream(): AsyncIterable<DocumentDetails> {
    yield* documents;
}

describe('StreamingDocumentWriter server-suggested retry wait', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        { retryAfterMs: 60_000, expectedDelay: 60_000 },
        { retryAfterMs: 100, expectedDelay: 200 },
        { retryAfterMs: 200, expectedDelay: 200 },
        { retryAfterMs: 0, expectedDelay: 200 },
        { retryAfterMs: undefined, expectedDelay: 200 },
        { retryAfterMs: Number.NaN, expectedDelay: 200 },
        { retryAfterMs: Number.POSITIVE_INFINITY, expectedDelay: 200 },
        { retryAfterMs: Number.NEGATIVE_INFINITY, expectedDelay: 200 },
        { retryAfterMs: -1, expectedDelay: 200 },
    ])('waits $expectedDelay ms for a returned retryAfterMs=$retryAfterMs', async ({ retryAfterMs, expectedDelay }) => {
        const trace = vi.fn<(message: string) => void>();
        const writer = new RetryAfterStreamingWriter({ logger: { ...noopDataTransferLogger, trace } });
        writer.writeBatch.mockResolvedValueOnce({
            result: { processedCount: 0, insertedCount: 0 },
            remaining: documents,
            errorType: 'throttle',
            retryAfterMs,
        });

        const writing = writer.streamDocuments(createDocumentStream(), config);
        await vi.advanceTimersByTimeAsync(0);
        expect(writer.writeBatch).toHaveBeenCalledTimes(1);
        if (expectedDelay > 200) {
            expect(trace).toHaveBeenCalledWith(
                '[StreamingWriter] Waiting 60000 ms as suggested by the server (computed backoff 200 ms)',
            );
            expect(trace.mock.calls.filter(([message]) => message.includes('as suggested by the server'))).toHaveLength(
                1,
            );
        } else {
            expect(trace).not.toHaveBeenCalledWith(expect.stringContaining('as suggested by the server'));
        }

        await vi.advanceTimersByTimeAsync(expectedDelay - 1);
        expect(writer.writeBatch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        const result = await writing;

        expect(writer.writeBatch).toHaveBeenCalledTimes(2);
        expect(result).toMatchObject({ totalProcessed: 1, insertedCount: 1 });
    });

    it.each(['throttle', 'network'] as const)(
        'honours the retry-wait hook for a thrown %s error',
        async (errorType) => {
            const writer = new SuggestedRetryAfterStreamingWriter();
            const error = new Error(errorType);
            writer.classifyError.mockReturnValue(errorType);
            writer.writeBatch.mockRejectedValueOnce(error);

            const writing = writer.streamDocuments(createDocumentStream(), config);
            await vi.advanceTimersByTimeAsync(0);
            expect(writer.getRetryAfterMs).toHaveBeenCalledExactlyOnceWith(error);
            await vi.advanceTimersByTimeAsync(59_999);
            expect(writer.writeBatch).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            const result = await writing;

            expect(writer.writeBatch).toHaveBeenCalledTimes(2);
            expect(result).toMatchObject({ totalProcessed: 1, insertedCount: 1 });
        },
    );

    it('resolves promptly when aborted during a long suggested wait', async () => {
        const writer = new RetryAfterStreamingWriter();
        const controller = new AbortController();
        writer.writeBatch.mockResolvedValueOnce({
            result: { processedCount: 0, insertedCount: 0 },
            remaining: documents,
            errorType: 'throttle',
            retryAfterMs: 120_000,
        });

        const writing = writer.streamDocuments(createDocumentStream(), config, { abortSignal: controller.signal });
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1_000);
        controller.abort();
        const result = await writing;

        expect(writer.writeBatch).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(result.totalProcessed).toBe(0);
    });

    it('does not wait when aborted while the write was in flight', async () => {
        const writer = new RetryAfterStreamingWriter();
        const controller = new AbortController();
        writer.writeBatch.mockImplementationOnce(async () => {
            controller.abort();
            return {
                result: { processedCount: 0, insertedCount: 0 },
                remaining: documents,
                errorType: 'throttle',
                retryAfterMs: 120_000,
            };
        });

        const writing = writer.streamDocuments(createDocumentStream(), config, { abortSignal: controller.signal });
        await vi.advanceTimersByTimeAsync(0);
        const result = await writing;

        expect(writer.writeBatch).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(result.totalProcessed).toBe(0);
    });

    it.each(['throttle', 'network'] as const)(
        'preserves the computed backoff without a hook override for a thrown %s error',
        async (errorType) => {
            const writer = new RetryAfterStreamingWriter();
            writer.classifyError.mockReturnValue(errorType);
            writer.writeBatch.mockRejectedValueOnce(new Error(errorType));

            const writing = writer.streamDocuments(createDocumentStream(), config);
            await vi.advanceTimersByTimeAsync(0);
            await vi.advanceTimersByTimeAsync(199);
            expect(writer.writeBatch).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            const result = await writing;

            expect(writer.writeBatch).toHaveBeenCalledTimes(2);
            expect(result).toMatchObject({ totalProcessed: 1, insertedCount: 1 });
        },
    );
});
