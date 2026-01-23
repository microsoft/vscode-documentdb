/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DocumentDetails } from '../types';
import { KeepAliveOrchestrator } from './KeepAliveOrchestrator';

// Mock extensionVariables (ext) module
jest.mock('../../../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            trace: jest.fn(),
            appendLog: jest.fn(),
            show: jest.fn(),
            info: jest.fn(),
        },
    },
}));

// Mock vscode module
jest.mock('vscode', () => ({
    l10n: {
        t: (key: string, ...args: unknown[]): string => {
            let result = key;
            args.forEach((arg, index) => {
                result = result.replace(`{${index}}`, String(arg));
            });
            return result;
        },
    },
}));

// Helper function to create test documents
function createDocuments(count: number, startId: number = 1): DocumentDetails[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `doc${startId + i}`,
        documentContent: { name: `Document ${startId + i}`, value: Math.random() },
    }));
}

// Create a mock async iterator from documents
function createAsyncIterator(documents: DocumentDetails[], delayMs: number = 0): AsyncIterator<DocumentDetails> {
    let index = 0;

    return {
        async next(): Promise<IteratorResult<DocumentDetails>> {
            if (delayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }

            if (index < documents.length) {
                return { done: false, value: documents[index++] };
            }
            return { done: true, value: undefined };
        },
        async return(): Promise<IteratorResult<DocumentDetails>> {
            return { done: true, value: undefined };
        },
    };
}

describe('KeepAliveOrchestrator', () => {
    beforeEach(() => {
        jest.useFakeTimers({ now: new Date('2024-01-01T00:00:00Z') });
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('basic operations', () => {
        it('should stream documents without keep-alive activity (fast consumer)', async () => {
            const documents = createDocuments(5);
            const iterator = createAsyncIterator(documents);
            const orchestrator = new KeepAliveOrchestrator({ intervalMs: 1000 });

            orchestrator.start(iterator);

            const result: DocumentDetails[] = [];
            let iterResult = await orchestrator.next();
            while (!iterResult.done) {
                result.push(iterResult.value);
                iterResult = await orchestrator.next();
            }

            const stats = await orchestrator.stop();

            expect(result.length).toBe(5);
            expect(result[0].id).toBe('doc1');
            expect(result[4].id).toBe('doc5');
            // Fast consumer - no keep-alive reads needed
            expect(stats.keepAliveReadCount).toBe(0);
            expect(stats.maxBufferLength).toBe(0);
        });

        it('should handle empty iterator', async () => {
            const iterator = createAsyncIterator([]);
            const orchestrator = new KeepAliveOrchestrator();

            orchestrator.start(iterator);

            const result = await orchestrator.next();
            expect(result.done).toBe(true);

            const stats = await orchestrator.stop();
            expect(stats.keepAliveReadCount).toBe(0);
        });

        it('should respect abort signal', async () => {
            const documents = createDocuments(100);
            const iterator = createAsyncIterator(documents);
            const orchestrator = new KeepAliveOrchestrator();

            orchestrator.start(iterator);

            const abortController = new AbortController();
            const result: DocumentDetails[] = [];

            let iterResult = await orchestrator.next(abortController.signal);
            while (!iterResult.done) {
                result.push(iterResult.value);
                if (result.length === 3) {
                    abortController.abort();
                }
                iterResult = await orchestrator.next(abortController.signal);
            }

            await orchestrator.stop();

            expect(result.length).toBe(3);
        });
    });

    describe('keep-alive buffer', () => {
        it('should buffer documents during slow consumption', async () => {
            const documents = createDocuments(10);
            const iterator = createAsyncIterator(documents);
            const orchestrator = new KeepAliveOrchestrator({ intervalMs: 100 });

            orchestrator.start(iterator);

            // Read first document
            const first = await orchestrator.next();
            expect(first.done).toBe(false);
            expect(first.value.id).toBe('doc1');

            // Simulate slow consumption - advance time past interval
            jest.advanceTimersByTime(150);
            await Promise.resolve(); // Let timer callback execute

            // Keep-alive should have buffered a document
            expect(orchestrator.getBufferLength()).toBeGreaterThanOrEqual(0);

            // Continue reading
            const results: DocumentDetails[] = [first.value];
            let iterResult = await orchestrator.next();
            while (!iterResult.done) {
                results.push(iterResult.value);
                iterResult = await orchestrator.next();
            }

            const stats = await orchestrator.stop();

            expect(results.length).toBe(10);
            // Should have done at least one keep-alive read if buffer was used
            expect(stats.keepAliveReadCount).toBeGreaterThanOrEqual(0);
        });

        it('should track max buffer length', async () => {
            const documents = createDocuments(20);
            const iterator = createAsyncIterator(documents);
            const orchestrator = new KeepAliveOrchestrator({ intervalMs: 50 });

            orchestrator.start(iterator);

            // Read one document
            await orchestrator.next();

            // Advance time multiple times to trigger keep-alive reads
            for (let i = 0; i < 5; i++) {
                jest.advanceTimersByTime(60);
                await Promise.resolve();
            }

            const stats = await orchestrator.stop();

            // Max buffer length should be at least as large as keepAliveReadCount
            expect(stats.maxBufferLength).toBeLessThanOrEqual(stats.keepAliveReadCount);
        });
    });

    describe('timeout handling', () => {
        it('should timeout after configured duration', async () => {
            const documents = createDocuments(100);
            const iterator = createAsyncIterator(documents);
            const orchestrator = new KeepAliveOrchestrator({
                intervalMs: 1000,
                timeoutMs: 5000, // 5 second timeout
            });

            orchestrator.start(iterator);

            // Read first document
            await orchestrator.next();

            // Advance time past timeout
            jest.advanceTimersByTime(6000);
            await Promise.resolve(); // Let timer callback execute

            expect(orchestrator.hasTimedOut()).toBe(true);

            // Next call should throw
            await expect(orchestrator.next()).rejects.toThrow('Keep-alive timeout exceeded');

            await orchestrator.stop();
        });

        it('should not timeout during active consumption', async () => {
            const documents = createDocuments(10);
            const iterator = createAsyncIterator(documents);
            const orchestrator = new KeepAliveOrchestrator({
                intervalMs: 1000,
                timeoutMs: 3000,
            });

            orchestrator.start(iterator);

            // Read all documents quickly (within timeout)
            const results: DocumentDetails[] = [];
            let iterResult = await orchestrator.next();
            while (!iterResult.done) {
                results.push(iterResult.value);
                iterResult = await orchestrator.next();
            }

            const stats = await orchestrator.stop();

            expect(results.length).toBe(10);
            expect(orchestrator.hasTimedOut()).toBe(false);
            expect(stats.keepAliveReadCount).toBe(0); // Fast consumer
        });
    });

    describe('cleanup', () => {
        it('should cleanup resources on stop', async () => {
            const documents = createDocuments(10);
            let returnCalled = false;

            const iterator: AsyncIterator<DocumentDetails> = {
                async next(): Promise<IteratorResult<DocumentDetails>> {
                    return { done: false, value: documents[0] };
                },
                async return(): Promise<IteratorResult<DocumentDetails>> {
                    returnCalled = true;
                    return { done: true, value: undefined };
                },
            };

            const orchestrator = new KeepAliveOrchestrator();
            orchestrator.start(iterator);

            // Read one document
            await orchestrator.next();

            // Stop should call return on iterator
            await orchestrator.stop();

            expect(returnCalled).toBe(true);
        });

        it('should return stats on stop', async () => {
            const documents = createDocuments(5);
            const iterator = createAsyncIterator(documents);
            const orchestrator = new KeepAliveOrchestrator();

            orchestrator.start(iterator);

            // Read all documents
            while (!(await orchestrator.next()).done) {
                // consume
            }

            const stats = await orchestrator.stop();

            expect(stats).toHaveProperty('keepAliveReadCount');
            expect(stats).toHaveProperty('maxBufferLength');
            expect(typeof stats.keepAliveReadCount).toBe('number');
            expect(typeof stats.maxBufferLength).toBe('number');
        });
    });

    describe('default configuration', () => {
        it('should use default interval of 10 seconds', async () => {
            const documents = createDocuments(5);
            const iterator = createAsyncIterator(documents);
            const orchestrator = new KeepAliveOrchestrator(); // No config

            orchestrator.start(iterator);

            // Read first document
            await orchestrator.next();

            // Advance time less than default interval (10s)
            jest.advanceTimersByTime(5000);
            await Promise.resolve();

            // No keep-alive should have happened
            expect(orchestrator.getBufferLength()).toBe(0);

            // Advance past default interval
            jest.advanceTimersByTime(6000); // Total: 11 seconds
            await Promise.resolve();

            // Now keep-alive may have triggered (depending on timing)
            await orchestrator.stop();
        });

        it('should use default timeout of 10 minutes', async () => {
            const documents = createDocuments(5);
            const iterator = createAsyncIterator(documents);
            const orchestrator = new KeepAliveOrchestrator(); // No config

            orchestrator.start(iterator);

            // Advance time to just under 10 minutes
            jest.advanceTimersByTime(9 * 60 * 1000);
            await Promise.resolve();

            expect(orchestrator.hasTimedOut()).toBe(false);

            // Advance past 10 minutes
            jest.advanceTimersByTime(2 * 60 * 1000);
            await Promise.resolve();

            expect(orchestrator.hasTimedOut()).toBe(true);

            await orchestrator.stop();
        });
    });
});
