/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Example starts here.
import {
    type AbortBatchResult,
    type BatchAttemptOutcome,
    ConflictResolutionStrategy,
    type DocumentDetails,
    type EnsureTargetExistsResult,
    type ErrorType,
    type PartialProgress,
    StreamingDocumentWriter,
    type StreamingWriterSettings,
} from '@microsoft/vscode-ext-tasks-data-transfer';

export function throttledOutcome(
    batch: DocumentDetails[],
    successfulIndexes: ReadonlySet<number>,
    retryAfterMs: number,
): BatchAttemptOutcome<string> {
    const remaining = batch.filter((_document, index) => !successfulIndexes.has(index));
    const insertedCount = batch.length - remaining.length;
    return {
        result: { processedCount: insertedCount, insertedCount, abortedCount: 0 },
        remaining,
        errorType: 'throttle',
        retryAfterMs,
    };
}

export class PartialThrottleError extends Error {
    public constructor(
        public readonly insertedCount: number,
        public readonly remaining: DocumentDetails[],
        public readonly retryAfterMs: number,
    ) {
        super('Throttled after a partial write');
    }
}

export class ThrottleAwareWriter extends StreamingDocumentWriter<string> {
    public override readonly supportedConflictStrategies = [ConflictResolutionStrategy.Abort] as const;

    public constructor(
        private readonly attempt: (
            documents: DocumentDetails[],
        ) => Promise<AbortBatchResult<string> | BatchAttemptOutcome<string>>,
        settings?: StreamingWriterSettings,
    ) {
        super('target-db', 'items', { settings });
    }

    public async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        return { targetWasCreated: false };
    }

    protected async writeBatch(
        documents: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
    ): Promise<AbortBatchResult<string> | BatchAttemptOutcome<string>> {
        if (strategy !== ConflictResolutionStrategy.Abort) {
            throw new Error('Unsupported conflict strategy');
        }
        return this.attempt(documents);
    }

    protected classifyError(error: unknown): ErrorType {
        return error instanceof PartialThrottleError ? 'throttle' : 'other';
    }

    protected extractPartialProgress(error: unknown): PartialProgress | undefined {
        if (error instanceof PartialThrottleError) {
            return {
                processedCount: error.insertedCount,
                insertedCount: error.insertedCount,
                remaining: error.remaining,
            };
        }
        return undefined;
    }

    protected override getRetryAfterMs(error: unknown): number | undefined {
        return error instanceof PartialThrottleError ? error.retryAfterMs : undefined;
    }
}
