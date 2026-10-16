/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Denque from 'denque';
import { l10n } from 'vscode';
import { ext } from '../../../../extensionVariables';
import { type DocumentDetails } from '../types';

/**
 * Configuration for keep-alive behavior.
 */
export interface KeepAliveConfig {
    /** Interval between keep-alive reads in milliseconds (default: 10000) */
    intervalMs?: number;
    /** Maximum time allowed for keep-alive operation in milliseconds (default: 600000 = 10 minutes) */
    timeoutMs?: number;
}

/**
 * Statistics collected during keep-alive operation.
 */
export interface KeepAliveStats {
    /** Number of documents read during keep-alive intervals */
    keepAliveReadCount: number;
    /** Maximum buffer length reached during operation */
    maxBufferLength: number;
}

const DEFAULT_CONFIG: Required<KeepAliveConfig> = {
    intervalMs: 10000, // 10 seconds
    timeoutMs: 600000, // 10 minutes
};

/**
 * Isolated keep-alive orchestrator for maintaining database cursor activity.
 *
 * This class encapsulates the keep-alive buffer logic extracted from BaseDocumentReader.
 * It handles:
 * - Periodic background reads to prevent cursor timeouts
 * - Buffer management for pre-fetched documents
 * - Timeout detection for runaway operations
 * - Statistics collection for telemetry
 *
 * ## Why Keep-Alive is Needed
 *
 * Database cursors can timeout if not accessed frequently enough:
 * - MongoDB default cursor timeout: 10 minutes
 * - Azure Cosmos DB: varies by tier
 *
 * When a consumer processes documents slowly (e.g., writing to a throttled target),
 * the source cursor may timeout before all documents are read.
 *
 * The keep-alive mechanism periodically "tickles" the cursor by reading documents
 * into a buffer, keeping the cursor alive even during slow consumption.
 *
 * ## Sequence Diagram
 *
 * ```
 * Consumer                KeepAliveOrchestrator              Database Iterator
 *    │                           │                                 │
 *    │ start(iterator)           │                                 │
 *    │──────────────────────────>│                                 │
 *    │                           │ (start keep-alive timer)        │
 *    │                           │                                 │
 *    │ next()                    │                                 │
 *    │──────────────────────────>│                                 │
 *    │                           │ (buffer empty, fetch from DB)   │
 *    │                           │ iterator.next()                 │
 *    │                           │────────────────────────────────>│
 *    │                           │<──── document                   │
 *    │<── document               │                                 │
 *    │                           │                                 │
 *    │ (slow processing...)      │                                 │
 *    │                           │                                 │
 *    │                           │ [timer fires after intervalMs]  │
 *    │                           │ iterator.next() (background)    │
 *    │                           │────────────────────────────────>│
 *    │                           │<──── document                   │
 *    │                           │ (buffer document)               │
 *    │                           │                                 │
 *    │ next()                    │                                 │
 *    │──────────────────────────>│                                 │
 *    │                           │ (return from buffer)            │
 *    │<── document               │                                 │
 *    │                           │                                 │
 *    │ stop()                    │                                 │
 *    │──────────────────────────>│                                 │
 *    │                           │ (clear timer, cleanup)          │
 *    │<── KeepAliveStats         │                                 │
 * ```
 *
 * @example
 * ```typescript
 * const orchestrator = new KeepAliveOrchestrator({ intervalMs: 5000, timeoutMs: 300000 });
 *
 * // Start with a database iterator
 * orchestrator.start(dbIterator);
 *
 * // Get documents (from buffer or direct from iterator)
 * while (true) {
 *   const result = await orchestrator.next();
 *   if (result.done) break;
 *   await processDocument(result.value);
 * }
 *
 * // Stop and get stats
 * const stats = await orchestrator.stop();
 * console.log(`Keep-alive reads: ${stats.keepAliveReadCount}`);
 * ```
 */
export class KeepAliveOrchestrator {
    private readonly config: Required<KeepAliveConfig>;

    /** Buffer for documents read during keep-alive intervals */
    private readonly buffer: Denque<DocumentDetails> = new Denque();

    /** The database iterator being managed */
    private dbIterator: AsyncIterator<DocumentDetails> | null = null;

    /** Keep-alive timer handle */
    private keepAliveTimer: NodeJS.Timeout | null = null;

    /** Timestamp when the stream started (for timeout detection) */
    private streamStartTime: number = 0;

    /** Timestamp of last database read access */
    private lastDatabaseReadAccess: number = 0;

    /** Flag indicating timeout occurred */
    private timedOut: boolean = false;

    /** Statistics collected during operation */
    private stats: KeepAliveStats = {
        keepAliveReadCount: 0,
        maxBufferLength: 0,
    };

    constructor(config?: KeepAliveConfig) {
        // Filter out undefined values to ensure defaults are used
        // (object spread would overwrite defaults with undefined if keys exist)
        this.config = {
            intervalMs: config?.intervalMs ?? DEFAULT_CONFIG.intervalMs,
            timeoutMs: config?.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
        };
    }

    /**
     * Starts the keep-alive orchestrator with the given database iterator.
     *
     * @param iterator The async iterator from the database to manage
     */
    start(iterator: AsyncIterator<DocumentDetails>): void {
        this.dbIterator = iterator;
        this.streamStartTime = Date.now();
        this.lastDatabaseReadAccess = Date.now();
        this.timedOut = false;
        this.stats = { keepAliveReadCount: 0, maxBufferLength: 0 };

        // Start keep-alive timer
        this.keepAliveTimer = setInterval(() => {
            void this.keepAliveTick();
        }, this.config.intervalMs);
    }

    /**
     * Gets the next document, either from buffer or directly from the database.
     *
     * @param abortSignal Optional signal to abort the operation
     * @returns Iterator result with the next document or done flag
     * @throws Error if timeout has been exceeded
     */
    async next(abortSignal?: AbortSignal): Promise<IteratorResult<DocumentDetails>> {
        if (abortSignal?.aborted) {
            return { done: true, value: undefined };
        }

        // Check for timeout from keep-alive callback
        if (this.timedOut) {
            throw new Error(l10n.t('Keep-alive timeout exceeded'));
        }

        // 1. Try buffer first (already pre-fetched by keep-alive)
        if (!this.buffer.isEmpty()) {
            const doc = this.buffer.shift();
            if (doc) {
                ext.outputChannel.trace(
                    l10n.t('[KeepAlive] Read from buffer, remaining: {0} documents', this.buffer.length.toString()),
                );
                return { done: false, value: doc };
            }
        }

        // 2. Buffer empty, fetch directly from database
        if (!this.dbIterator) {
            return { done: true, value: undefined };
        }

        const result = await this.dbIterator.next();
        if (!result.done) {
            this.lastDatabaseReadAccess = Date.now();
        }

        return result;
    }

    /**
     * Stops the keep-alive orchestrator and cleans up resources.
     *
     * @returns Statistics collected during the operation
     */
    async stop(): Promise<KeepAliveStats> {
        // Clear timer
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }

        // Close iterator
        if (this.dbIterator) {
            await this.dbIterator.return?.();
            this.dbIterator = null;
        }

        return { ...this.stats };
    }

    /**
     * Checks if the orchestrator has timed out.
     */
    hasTimedOut(): boolean {
        return this.timedOut;
    }

    /**
     * Gets the current buffer length.
     */
    getBufferLength(): number {
        return this.buffer.length;
    }

    /**
     * Keep-alive timer tick - reads a document to keep the cursor alive.
     */
    private async keepAliveTick(): Promise<void> {
        if (!this.dbIterator) {
            return;
        }

        // Check if keep-alive has been running too long
        const keepAliveElapsedMs = Date.now() - this.streamStartTime;
        if (keepAliveElapsedMs >= this.config.timeoutMs) {
            // Keep-alive timeout exceeded - abort the operation
            await this.dbIterator.return?.();
            const errorMessage = l10n.t(
                'Keep-alive timeout exceeded: stream has been running for {0} seconds (limit: {1} seconds)',
                Math.floor(keepAliveElapsedMs / 1000).toString(),
                Math.floor(this.config.timeoutMs / 1000).toString(),
            );
            ext.outputChannel.error(l10n.t('[KeepAlive] {0}', errorMessage));
            this.timedOut = true;
            return;
        }

        // Fetch if enough time has passed since last yield (regardless of buffer state)
        // This ensures we "tickle" the database cursor regularly to prevent timeouts
        const timeSinceLastRead = Date.now() - this.lastDatabaseReadAccess;
        if (timeSinceLastRead >= this.config.intervalMs) {
            try {
                const result = await this.dbIterator.next();
                if (!result.done) {
                    this.buffer.push(result.value);
                    this.stats.keepAliveReadCount++;
                    this.lastDatabaseReadAccess = Date.now();

                    // Track maximum buffer length
                    const currentBufferLength = this.buffer.length;
                    if (currentBufferLength > this.stats.maxBufferLength) {
                        this.stats.maxBufferLength = currentBufferLength;
                    }

                    ext.outputChannel.trace(
                        l10n.t(
                            '[KeepAlive] Background read: count={0}, buffer length={1}',
                            this.stats.keepAliveReadCount.toString(),
                            currentBufferLength.toString(),
                        ),
                    );
                }
            } catch {
                // Silently ignore background fetch errors
                // Persistent errors will surface when consumer calls next()
            }
        } else {
            ext.outputChannel.trace(
                l10n.t(
                    '[KeepAlive] Skipped: only {0}s since last read (interval: {1}s)',
                    Math.floor(timeSinceLastRead / 1000).toString(),
                    Math.floor(this.config.intervalMs / 1000).toString(),
                ),
            );
        }
    }
}
