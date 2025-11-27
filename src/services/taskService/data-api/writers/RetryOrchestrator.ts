/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';
import { type ErrorType } from './writerTypes.internal';

/**
 * Result of a retry-able operation.
 */
export interface RetryOperationResult<T> {
    /** The result of the operation if successful */
    result: T;
    /** Whether the operation was throttled at any point */
    wasThrottled: boolean;
    /** Whether the operation was cancelled via abort signal */
    wasCancelled?: boolean;
}

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
    /** Maximum number of retry attempts before giving up (default: 10) */
    maxAttempts?: number;
    /** Base delay in milliseconds for exponential backoff (default: 1000) */
    baseDelayMs?: number;
    /** Multiplier for exponential backoff (default: 1.5) */
    backoffMultiplier?: number;
    /** Maximum delay in milliseconds (default: 5000) */
    maxDelayMs?: number;
    /** Jitter range as a fraction of the delay (default: 0.3 = ±30%) */
    jitterFraction?: number;
}

/**
 * Handlers for different error types during retry.
 */
export interface RetryHandlers {
    /** Called when a throttle error is encountered. Return true to continue retrying, false to abort. */
    onThrottle: (error: unknown) => boolean;
    /** Called when a network error is encountered. Return true to continue retrying, false to abort. */
    onNetwork: (error: unknown) => boolean;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
    maxAttempts: 10,
    baseDelayMs: 1000,
    backoffMultiplier: 1.5,
    maxDelayMs: 5000,
    jitterFraction: 0.3,
};

/**
 * Isolated retry orchestrator with exponential backoff.
 *
 * This class encapsulates the retry logic extracted from BaseDocumentWriter.writeBatchWithRetry().
 * It handles:
 * - Retry attempts with configurable limits
 * - Exponential backoff with jitter
 * - Abort signal support
 * - Error type classification via callback
 *
 * The orchestrator is stateless and can be reused across multiple operations.
 *
 * @example
 * const orchestrator = new RetryOrchestrator({ maxAttempts: 5 });
 *
 * const result = await orchestrator.execute(
 *   () => writeDocuments(batch),
 *   (error) => classifyError(error),
 *   {
 *     onThrottle: (error) => { shrinkBatchSize(); return true; },
 *     onNetwork: (error) => { return true; },
 *   },
 *   abortSignal
 * );
 */
export class RetryOrchestrator {
    private readonly config: Required<RetryConfig>;

    constructor(config?: RetryConfig) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Executes an operation with automatic retry on transient failures.
     *
     * @param operation The async operation to execute
     * @param classifier Function to classify errors into retry categories
     * @param handlers Callbacks for handling specific error types
     * @param abortSignal Optional signal to cancel the operation
     * @returns The operation result wrapped with throttle information
     * @throws The original error if max attempts exceeded or non-retryable error
     */
    async execute<T>(
        operation: () => Promise<T>,
        classifier: (error: unknown) => ErrorType,
        handlers: RetryHandlers,
        abortSignal?: AbortSignal,
    ): Promise<RetryOperationResult<T>> {
        let attempt = 0;
        let wasThrottled = false;

        while (attempt < this.config.maxAttempts) {
            if (abortSignal?.aborted) {
                // Return cancelled result gracefully (not an error)
                return { result: undefined as unknown as T, wasThrottled, wasCancelled: true };
            }

            try {
                const result = await operation();
                return { result, wasThrottled, wasCancelled: false };
            } catch (error) {
                const errorType = classifier(error);

                if (errorType === 'throttle') {
                    wasThrottled = true;
                    const shouldContinue = handlers.onThrottle(error);
                    if (shouldContinue) {
                        attempt++;
                        await this.delay(attempt, abortSignal);
                        continue;
                    }
                    // Handler returned false - abort retries
                    throw error;
                }

                if (errorType === 'network') {
                    const shouldContinue = handlers.onNetwork(error);
                    if (shouldContinue) {
                        attempt++;
                        await this.delay(attempt, abortSignal);
                        continue;
                    }
                    // Handler returned false - abort retries
                    throw error;
                }

                // For 'conflict', 'validator', and 'other' - don't retry, throw immediately
                throw error;
            }
        }

        throw new Error(l10n.t('Failed to complete operation after {0} attempts', this.config.maxAttempts.toString()));
    }

    /**
     * Executes an operation with retry, allowing progress to be made on partial success.
     *
     * This is a more sophisticated version of execute() that allows handlers to report
     * partial progress. When progress is made (even during throttle/network errors),
     * the attempt counter is reset.
     *
     * @param operation The async operation to execute
     * @param classifier Function to classify errors into retry categories
     * @param handlers Callbacks for handling specific error types, returning progress made
     * @param abortSignal Optional signal to cancel the operation
     * @returns The operation result wrapped with throttle information
     * @throws The original error if max attempts exceeded without progress or non-retryable error
     */
    async executeWithProgress<T>(
        operation: () => Promise<T>,
        classifier: (error: unknown) => ErrorType,
        handlers: {
            onThrottle: (error: unknown) => { continue: boolean; progressMade: boolean };
            onNetwork: (error: unknown) => { continue: boolean; progressMade: boolean };
        },
        abortSignal?: AbortSignal,
    ): Promise<RetryOperationResult<T>> {
        let attempt = 0;
        let wasThrottled = false;

        while (attempt < this.config.maxAttempts) {
            if (abortSignal?.aborted) {
                // Return cancelled result gracefully (not an error)
                return { result: undefined as unknown as T, wasThrottled, wasCancelled: true };
            }

            try {
                const result = await operation();
                return { result, wasThrottled, wasCancelled: false };
            } catch (error) {
                const errorType = classifier(error);

                if (errorType === 'throttle') {
                    wasThrottled = true;
                    const { continue: shouldContinue, progressMade } = handlers.onThrottle(error);

                    if (progressMade) {
                        attempt = 0; // Reset attempts when progress is made
                    } else {
                        attempt++;
                    }

                    if (shouldContinue) {
                        await this.delay(attempt, abortSignal);
                        continue;
                    }
                    throw error;
                }

                if (errorType === 'network') {
                    const { continue: shouldContinue, progressMade } = handlers.onNetwork(error);

                    if (progressMade) {
                        attempt = 0;
                    } else {
                        attempt++;
                    }

                    if (shouldContinue) {
                        await this.delay(attempt, abortSignal);
                        continue;
                    }
                    throw error;
                }

                // For 'conflict', 'validator', and 'other' - don't retry
                throw error;
            }
        }

        throw new Error(
            l10n.t(
                'Failed to complete operation after {0} attempts without progress',
                this.config.maxAttempts.toString(),
            ),
        );
    }

    /**
     * Calculates the delay before the next retry attempt using exponential backoff.
     *
     * Formula: base * (multiplier ^ attempt) + jitter
     * Jitter prevents thundering herd when multiple clients retry simultaneously.
     *
     * @param attempt Current retry attempt number (1-based for delay calculation)
     * @returns Delay in milliseconds
     */
    calculateDelayMs(attempt: number): number {
        const { baseDelayMs, backoffMultiplier, maxDelayMs, jitterFraction } = this.config;

        const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, attempt);
        const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
        const jitterRange = cappedDelay * jitterFraction;
        const jitter = Math.random() * jitterRange * 2 - jitterRange;

        return Math.floor(cappedDelay + jitter);
    }

    /**
     * Creates an abortable delay that can be interrupted by an abort signal.
     */
    private async delay(attempt: number, abortSignal?: AbortSignal): Promise<void> {
        if (abortSignal?.aborted) {
            return;
        }

        const ms = this.calculateDelayMs(attempt);

        return new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
                cleanup();
                resolve();
            }, ms);

            let cleanup: () => void;

            if (abortSignal) {
                const abortHandler = (): void => {
                    clearTimeout(timeoutId);
                    cleanup();
                    resolve();
                };

                abortSignal.addEventListener('abort', abortHandler, { once: true });

                cleanup = (): void => {
                    abortSignal.removeEventListener('abort', abortHandler);
                };
            } else {
                cleanup = (): void => {
                    // No-op when no abort signal
                };
            }
        });
    }
}
