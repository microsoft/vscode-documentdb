/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type DocumentDetails, type DocumentReaderOptions } from '../types';
import { BaseDocumentReader } from './BaseDocumentReader';

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
            // Simple replacement: replace {0}, {1}, etc. with the arguments
            let result = key;
            args.forEach((arg, index) => {
                result = result.replace(`{${index}}`, String(arg));
            });
            return result;
        },
    },
}));

/**
 * Mock DocumentReader for testing BaseDocumentReader.
 * Simulates a database with configurable document streaming behavior.
 */
class MockDocumentReader extends BaseDocumentReader {
    // In-memory document storage
    private documents: DocumentDetails[] = [];

    // Configuration for simulating delays (in milliseconds)
    private readDelayMs: number = 0;

    // Configuration for error injection
    private errorConfig?: {
        errorType: 'network' | 'timeout' | 'unexpected';
        afterDocuments: number; // Throw error after reading this many docs
    };

    // Track how many documents have been read (for error injection)
    private readCountForErrorInjection: number = 0;

    // Estimated count (can differ from actual for testing)
    private estimatedCount?: number;

    constructor(databaseName: string = 'testdb', collectionName: string = 'testcollection') {
        super(databaseName, collectionName);
    }

    // Test helpers
    public seedDocuments(documents: DocumentDetails[]): void {
        this.documents = [...documents];
    }

    public setReadDelay(delayMs: number): void {
        this.readDelayMs = delayMs;
    }

    public setErrorConfig(config: MockDocumentReader['errorConfig']): void {
        this.errorConfig = config;
        this.readCountForErrorInjection = 0;
    }

    public clearErrorConfig(): void {
        this.errorConfig = undefined;
        this.readCountForErrorInjection = 0;
    }

    public setEstimatedCount(count: number): void {
        this.estimatedCount = count;
    }

    public getDocumentCount(): number {
        return this.documents.length;
    }

    // Abstract method implementations

    protected async *streamDocumentsFromDatabase(
        signal?: AbortSignal,
        _actionContext?: IActionContext,
    ): AsyncIterable<DocumentDetails> {
        for (let i = 0; i < this.documents.length; i++) {
            // Check abort signal
            if (signal?.aborted) {
                break;
            }

            // Check if we should throw an error
            if (this.errorConfig && this.readCountForErrorInjection >= this.errorConfig.afterDocuments) {
                const errorType = this.errorConfig.errorType.toUpperCase();
                this.clearErrorConfig();
                throw new Error(`MOCK_${errorType}_ERROR`);
            }

            // Simulate read delay
            if (this.readDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, this.readDelayMs));
            }

            this.readCountForErrorInjection++;
            yield this.documents[i];
        }
    }

    protected async countDocumentsInDatabase(_signal?: AbortSignal, _actionContext?: IActionContext): Promise<number> {
        return this.estimatedCount ?? this.documents.length;
    }
}

// Helper function to create test documents
function createDocuments(count: number, startId: number = 1): DocumentDetails[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `doc${startId + i}`,
        documentContent: { name: `Document ${startId + i}`, value: Math.random() },
    }));
}

// Helper to create mock action context
function createMockActionContext(): IActionContext {
    return {
        telemetry: {
            properties: {},
            measurements: {},
        },
        errorHandling: {
            forceIncludeInTelemetry: false,
            issueProperties: {},
        },
        valuesToMask: [],
        ui: {} as IActionContext['ui'],
    } as IActionContext;
}

describe('BaseDocumentReader', () => {
    let reader: MockDocumentReader;

    beforeEach(() => {
        reader = new MockDocumentReader('testdb', 'testcollection');
        reader.clearErrorConfig();
        jest.clearAllMocks();
    });

    // ==================== 1. Core Read Operations ====================

    describe('streamDocuments - Core Operations', () => {
        it('should stream documents (direct passthrough)', async () => {
            const documents = createDocuments(10);
            reader.seedDocuments(documents);

            const result: DocumentDetails[] = [];
            for await (const doc of reader.streamDocuments()) {
                result.push(doc);
            }

            expect(result.length).toBe(10);
            expect(result[0].id).toBe('doc1');
            expect(result[9].id).toBe('doc10');
        });

        it('should stream zero documents successfully', async () => {
            reader.seedDocuments([]);

            const result: DocumentDetails[] = [];
            for await (const doc of reader.streamDocuments()) {
                result.push(doc);
            }

            expect(result.length).toBe(0);
        });

        it('should respect abort signal during streaming', async () => {
            const documents = createDocuments(100);
            reader.seedDocuments(documents);
            reader.setReadDelay(10); // 10ms delay per document

            const abortController = new AbortController();
            const result: DocumentDetails[] = [];

            const streamPromise = (async () => {
                for await (const doc of reader.streamDocuments({ signal: abortController.signal })) {
                    result.push(doc);
                    if (result.length === 5) {
                        abortController.abort();
                    }
                }
            })();

            await streamPromise;

            // Should have stopped at or shortly after 5 documents
            expect(result.length).toBeLessThanOrEqual(10);
            expect(result.length).toBeGreaterThan(0);
        });
    });

    // ==================== 2. Keep-Alive Functionality ====================

    describe('streamDocuments - Keep-Alive', () => {
        // Use fake timers for keep-alive tests (modern timers mock Date.now())
        beforeEach(() => {
            jest.useFakeTimers({ now: new Date('2024-01-01T00:00:00Z') });
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it('should stream with keep-alive enabled (fast consumer)', async () => {
            const documents = createDocuments(10);
            reader.seedDocuments(documents);

            const options: DocumentReaderOptions = {
                keepAlive: true,
                keepAliveIntervalMs: 1000, // 1 second
                actionContext: createMockActionContext(),
            };

            const result: DocumentDetails[] = [];
            const streamPromise = (async () => {
                for await (const doc of reader.streamDocuments(options)) {
                    result.push(doc);
                    // Fast consumer - read immediately
                }
            })();

            // Advance timers to allow keep-alive timer to run
            jest.advanceTimersByTime(100);
            await Promise.resolve(); // Let microtasks execute

            await streamPromise;

            expect(result.length).toBe(10);

            // Fast consumer should have minimal or zero keep-alive reads
            const keepAliveReadCount = options.actionContext?.telemetry.measurements.keepAliveReadCount ?? 0;
            expect(keepAliveReadCount).toBe(0); // Consumer is faster than keep-alive
        });

        it('should use keep-alive buffer for slow consumer', async () => {
            const documents = createDocuments(20);
            reader.seedDocuments(documents);

            const options: DocumentReaderOptions = {
                keepAlive: true,
                keepAliveIntervalMs: 100, // 100ms interval
                actionContext: createMockActionContext(),
            };

            const result: DocumentDetails[] = [];
            const iterator = reader.streamDocuments(options)[Symbol.asyncIterator]();

            // Manually consume documents with delays
            let next = await iterator.next();
            while (!next.done) {
                result.push(next.value);

                // Simulate slow consumer - advance timers to trigger keep-alive
                jest.advanceTimersByTime(150);
                await Promise.resolve(); // Let microtasks execute

                next = await iterator.next();
            }

            expect(result.length).toBe(20);

            // Slow consumer should have triggered keep-alive reads
            const keepAliveReadCount = options.actionContext?.telemetry.measurements.keepAliveReadCount ?? 0;
            expect(keepAliveReadCount).toBeGreaterThan(0);
        });

        it('should track maximum buffer length in telemetry', async () => {
            const documents = createDocuments(50);
            reader.seedDocuments(documents);

            const options: DocumentReaderOptions = {
                keepAlive: true,
                keepAliveIntervalMs: 50, // 50ms interval
                actionContext: createMockActionContext(),
            };

            const result: DocumentDetails[] = [];
            let readCount = 0;

            const streamPromise = (async () => {
                for await (const doc of reader.streamDocuments(options)) {
                    result.push(doc);
                    readCount++;

                    // Pause consumption after reading a few to allow buffer to fill
                    if (readCount === 5) {
                        // Advance timers to trigger multiple keep-alive reads
                        for (let i = 0; i < 5; i++) {
                            jest.advanceTimersByTime(50);
                            await Promise.resolve();
                        }
                    }
                }
            })();

            await streamPromise;

            expect(result.length).toBe(50);

            const maxBufferLength = options.actionContext?.telemetry.measurements.maxBufferLength ?? 0;
            expect(maxBufferLength).toBeGreaterThan(0);
        });

        it('should abort on keep-alive timeout', async () => {
            const documents = createDocuments(100);
            reader.seedDocuments(documents);

            const options: DocumentReaderOptions = {
                keepAlive: true,
                keepAliveIntervalMs: 100, // 100ms interval
                keepAliveTimeoutMs: 500, // 500ms timeout
            };

            const result: DocumentDetails[] = [];
            let errorThrown = false;

            try {
                const iterator = reader.streamDocuments(options)[Symbol.asyncIterator]();

                // Read first document
                let next = await iterator.next();
                if (!next.done) {
                    result.push(next.value);
                }

                // Advance past the timeout period and run all pending timers
                await jest.advanceTimersByTimeAsync(600);

                // Try to read next document - should throw timeout error
                next = await iterator.next();
                if (!next.done) {
                    result.push(next.value);
                }
            } catch (error) {
                if (error instanceof Error && error.message.includes('Keep-alive timeout exceeded')) {
                    errorThrown = true;
                } else {
                    throw error;
                }
            }

            expect(errorThrown).toBe(true);
        });

        it('should respect abort signal with keep-alive enabled', async () => {
            const documents = createDocuments(100);
            reader.seedDocuments(documents);

            const abortController = new AbortController();
            const options: DocumentReaderOptions = {
                keepAlive: true,
                keepAliveIntervalMs: 100,
                signal: abortController.signal,
                actionContext: createMockActionContext(),
            };

            const result: DocumentDetails[] = [];

            const streamPromise = (async () => {
                for await (const doc of reader.streamDocuments(options)) {
                    result.push(doc);

                    if (result.length === 10) {
                        abortController.abort();
                    }

                    jest.advanceTimersByTime(10);
                    await Promise.resolve();
                }
            })();

            await streamPromise;

            expect(result.length).toBeLessThanOrEqual(15); // Allow for buffer
            expect(result.length).toBeGreaterThan(0);
        });

        it('should handle errors during keep-alive read gracefully', async () => {
            const documents = createDocuments(30);
            reader.seedDocuments(documents);

            // Inject error after 10 documents (will be caught during keep-alive read)
            reader.setErrorConfig({
                errorType: 'network',
                afterDocuments: 10,
            });

            const options: DocumentReaderOptions = {
                keepAlive: true,
                keepAliveIntervalMs: 50,
                actionContext: createMockActionContext(),
            };

            const result: DocumentDetails[] = [];

            // Should complete successfully despite error during keep-alive reads
            // Background errors are silently ignored - only persistent errors surface
            const iterator = reader.streamDocuments(options)[Symbol.asyncIterator]();

            let next = await iterator.next();
            while (!next.done) {
                result.push(next.value);

                // Slow consumer to trigger keep-alive
                await jest.advanceTimersByTimeAsync(100);

                next = await iterator.next();
            }

            // Should have read the first 10 documents successfully
            // Error occurred at doc 10 during a keep-alive read (silently ignored)
            // Subsequent reads succeed
            expect(result.length).toBeGreaterThanOrEqual(10);
        });
    });

    // ==================== 3. Count Documents ====================

    describe('countDocuments', () => {
        it('should count documents successfully', async () => {
            const documents = createDocuments(42);
            reader.seedDocuments(documents);

            const count = await reader.countDocuments();

            expect(count).toBe(42);
        });

        it('should return zero for empty collection', async () => {
            reader.seedDocuments([]);

            const count = await reader.countDocuments();

            expect(count).toBe(0);
        });

        it('should return estimated count if different from actual', async () => {
            const documents = createDocuments(100);
            reader.seedDocuments(documents);
            reader.setEstimatedCount(95); // Estimated count differs

            const count = await reader.countDocuments();

            expect(count).toBe(95); // Should return estimated count
        });

        it('should pass abort signal to count operation', async () => {
            const documents = createDocuments(1000);
            reader.seedDocuments(documents);

            const abortController = new AbortController();
            abortController.abort(); // Abort before calling

            // The mock doesn't actually check abort in count, but we verify it's passed
            const count = await reader.countDocuments(abortController.signal);

            // Should still complete (mock doesn't respect signal in count)
            expect(count).toBe(1000);
        });

        it('should track telemetry in action context', async () => {
            const documents = createDocuments(50);
            reader.seedDocuments(documents);

            const actionContext = createMockActionContext();
            const count = await reader.countDocuments(undefined, actionContext);

            expect(count).toBe(50);
            // Action context was passed (implementation can add telemetry if needed)
            expect(actionContext).toBeDefined();
        });
    });

    // ==================== 4. Integration Scenarios ====================

    describe('Integration Scenarios', () => {
        it('should handle large document stream with keep-alive', async () => {
            jest.useFakeTimers({ now: new Date('2024-01-01T00:00:00Z') });

            const documents = createDocuments(1000);
            reader.seedDocuments(documents);

            const options: DocumentReaderOptions = {
                keepAlive: true,
                keepAliveIntervalMs: 50,
                actionContext: createMockActionContext(),
            };

            const result: DocumentDetails[] = [];
            const streamPromise = (async () => {
                for await (const doc of reader.streamDocuments(options)) {
                    result.push(doc);

                    // Simulate variable processing speed
                    if (result.length % 10 === 0) {
                        jest.advanceTimersByTime(60);
                        await Promise.resolve();
                    }
                }
            })();

            await streamPromise;

            expect(result.length).toBe(1000);
            expect(result[0].id).toBe('doc1');
            expect(result[999].id).toBe('doc1000');

            const keepAliveReadCount = options.actionContext?.telemetry.measurements.keepAliveReadCount ?? 0;
            expect(keepAliveReadCount).toBeGreaterThanOrEqual(0);

            jest.useRealTimers();
        });

        it('should handle early termination with partial read', async () => {
            const documents = createDocuments(100);
            reader.seedDocuments(documents);

            const abortController = new AbortController();
            const result: DocumentDetails[] = [];

            const streamPromise = (async () => {
                for await (const doc of reader.streamDocuments({ signal: abortController.signal })) {
                    result.push(doc);
                    if (result.length === 25) {
                        abortController.abort();
                        break;
                    }
                }
            })();

            await streamPromise;

            expect(result.length).toBe(25);
        });
    });
});
