/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Example starts here.
import {
    type AbortBatchResult,
    BaseDocumentReader,
    ConflictResolutionStrategy,
    type DocumentDetails,
    type EnsureTargetExistsResult,
    type ErrorType,
    type PartialProgress,
    StreamingDocumentWriter,
    type StreamingWriterSettings,
} from '@microsoft/vscode-ext-tasks-data-transfer';

export class MemoryReader extends BaseDocumentReader {
    public constructor(private readonly documents: readonly DocumentDetails[]) {
        super('source-db', 'items');
    }

    protected async *streamDocumentsFromDatabase(signal?: AbortSignal): AsyncIterable<DocumentDetails> {
        for (const document of this.documents) {
            if (signal?.aborted) {
                return;
            }
            yield document;
        }
    }

    protected async countDocumentsInDatabase(): Promise<number> {
        return this.documents.length;
    }
}

export class MemoryWriter extends StreamingDocumentWriter<string> {
    public override readonly supportedConflictStrategies = [ConflictResolutionStrategy.Abort] as const;

    public constructor(
        private readonly target: Map<string, unknown>,
        settings?: StreamingWriterSettings,
    ) {
        super('target-db', 'items', {
            adapterDefaults: { batching: { startMode: 'ru-limited', ruLimited: { initialBatchSize: 64 } } },
            settings,
        });
    }

    public async ensureTargetExists(): Promise<EnsureTargetExistsResult> {
        return { targetWasCreated: false };
    }

    protected async writeBatch(
        documents: DocumentDetails[],
        strategy: ConflictResolutionStrategy,
    ): Promise<AbortBatchResult<string>> {
        if (strategy !== ConflictResolutionStrategy.Abort) {
            throw new Error('Unsupported conflict strategy');
        }
        const validDocuments = documents.map(({ id, documentContent }) => {
            if (typeof id !== 'string') {
                throw new Error('Expected a string document ID');
            }
            return { id, documentContent };
        });
        let insertedCount = 0;
        for (const document of validDocuments) {
            if (this.target.has(document.id)) {
                return {
                    processedCount: insertedCount + 1,
                    insertedCount,
                    abortedCount: 1,
                    errors: [{ documentId: document.id, error: new Error('Document already exists') }],
                };
            }
            this.target.set(document.id, document.documentContent);
            insertedCount++;
        }
        return { processedCount: insertedCount, insertedCount, abortedCount: 0 };
    }

    protected classifyError(_error: unknown): ErrorType {
        return 'other';
    }

    protected extractPartialProgress(_error: unknown): PartialProgress | undefined {
        return undefined;
    }
}

export function createTunedWriter(target: Map<string, unknown>): MemoryWriter {
    return new MemoryWriter(target, {
        batching: { ruLimited: { initialBatchSize: 32 } },
        retry: { baseDelayMs: 200, maxAttemptsWithoutProgress: 8 },
    });
}
