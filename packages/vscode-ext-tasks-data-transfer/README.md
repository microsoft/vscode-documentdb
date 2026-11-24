# @microsoft/vscode-ext-tasks-data-transfer

Database-neutral document streaming, adaptive batching, retries, and collection-copy tasks. This
0.x package is not published yet; the API may change after the planned NoSQL contract review. It
requires `@microsoft/vscode-ext-tasks` as a peer.

The examples are type-checked during the package build, and repository tests check that the
snippets match the example files.

## Reader and writer adapters

This in-memory adapter supports only the Abort conflict strategy. Real adapters use their database
SDK for counting, streaming, target creation, and writes. The writer demonstrates adapter defaults
and caller settings. It validates every ID in a batch before writing, so invalid IDs cannot leave
unreported partial inserts.

<!-- example:memory-adapters -->
```typescript
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
```
<!-- endexample -->

## Run a copy task

Pass adapters configured for the endpoints and the extension's shared task registry. Replace the
example IDs with stable connection IDs. Supply a `CollectionIndexCopier` when `copyIndexes` is
true.

<!-- example:copy-task -->
```typescript
import { type TaskService, type TaskStatus, whenTerminal } from '@microsoft/vscode-ext-tasks';
import {
    ConflictResolutionStrategy,
    type DocumentReader,
    type StreamingDocumentWriter,
} from '@microsoft/vscode-ext-tasks-data-transfer';
import { CopyPasteCollectionTask } from '@microsoft/vscode-ext-tasks-data-transfer/copy-collection';

export async function copyCollection(
    service: TaskService,
    reader: DocumentReader,
    writer: StreamingDocumentWriter,
): Promise<TaskStatus> {
    const task = new CopyPasteCollectionTask(
        {
            copyOperationCorrelationId: crypto.randomUUID(),
            source: { clusterId: 'source-id', databaseName: 'source-db', collectionName: 'items' },
            target: { clusterId: 'target-id', databaseName: 'target-db', collectionName: 'items' },
            onConflict: ConflictResolutionStrategy.Abort,
            copyIndexes: false,
        },
        reader,
        writer,
    );
    service.registerTask(task);
    await task.start();
    await whenTerminal(task);
    return task.getStatus();
}
```
<!-- endexample -->

`start()` only waits for initialization. Inspect the terminal status for failure or cancellation.
The task validates the source if a host hook is supplied, counts documents, ensures the target
exists, optionally copies indexes, and then streams documents.

## Report partial writes and server waits

The `attempt` callback represents one SDK batch call. It can return `throttledOutcome(...)` when
the SDK reports a partial result, or throw `PartialThrottleError` when the SDK exposes that
information as an exception. In either case, calculate `remaining` from the exact documents not
written; the example allows successes anywhere in the batch.

<!-- example:partial-writes -->
```typescript
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
```
<!-- endexample -->

A returned outcome can also report `errorType: 'network'`. For a **thrown** network error the
engine retries the whole current batch and does not call `extractPartialProgress`; return an
outcome instead when known network partial progress must be preserved. If the outcome is unknown,
design the adapter's writes for safe retry or reconciliation.

## API and host responsibilities

- The root entry exports reader and writer contracts, settings, result types, and the optional
  index copier contract. `/copy-collection` exports `CopyPasteCollectionTask` and its options.
- Settings are merged field by field: package defaults, then adapter defaults, then caller
  overrides. The default writer starts with a 500-document fast batch, grows up to 2,000, uses a
  24 MB buffer estimate, and switches to RU-limited mode on throttle. It retries up to 10 attempts
  without progress, using 100 ms exponential backoff (factor 2, 5 s cap before 30% jitter).
- Return conflicts in the strategy result's `errors` array rather than throwing them. Restrict
  `supportedConflictStrategies` to implemented strategies and have the consumer choose a
  supported one; the adapter should also reject an unsupported strategy.
- The result types distinguish `Abort` (inserted/aborted), `Skip` (inserted/skipped), `Overwrite`
  (replaced/created), and `GenerateNewIds` (inserted). A writer can override
  `preFilterForSkipStrategy` to find existing IDs once before the retry loop; it must still handle
  races with other writers.
- A valid, non-negative `retryAfterMs` is an uncapped floor over computed backoff. For thrown
  throttle or network errors, expose the server wait through `getRetryAfterMs`. Cancellation
  interrupts the delay, but `writeBatch` itself does not receive an abort signal.
- `BaseDocumentReader` can keep a cursor active while consumption is slow. Enable `keepAlive` in
  reader options when needed; its default interval is 10 seconds and its timeout is 10 minutes.
  `StreamingWriterError.partialStats` describes progress made before a failed write.
- Supply host logger and localized strings through `DataTransferOptions`, and task telemetry,
  logging, and copy-task strings through task options. Defaults use a no-op logger and English
  strings.
- The package is ESM. A CommonJS host must load it with `await import(...)` inside an async
  function.

## For agents

1. Implement streaming and counting with the provider's client; honor cancellation and avoid
   materializing the full source. Opt into the provided keep-alive only when the cursor needs it.
2. Implement `ensureTargetExists`, `writeBatch`, `classifyError`, and `extractPartialProgress`.
   Return accurate strategy-specific counts and conflicts. Throw throttle/network errors or
   return a `BatchAttemptOutcome`; do not classify conflicts as retryable errors.
3. If `remaining` is omitted, the engine assumes a successfully processed **prefix** and retries
   the suffix. For unordered or scattered successes, always supply the exact remaining documents
   on both returned and thrown-throttle routes. Track counts consistently with those documents.
4. Disable SDK-level automatic retries where possible so the engine owns retry policy. If the SDK
   cannot disable them, account for that layer explicitly. Test throttles, network failures,
   partial writes, duplicate/conflict handling, cancellation, and server waits with fakes.
5. Use the same task package instance and registry as the host. Inject localized strings and
   logger rather than importing `vscode`, `vscode.l10n.t`, or extension globals into an adapter
   intended for reuse. Preserve existing telemetry names when integrating the task.

## Reference implementations

The links below point to an immutable development snapshot. Before publishing, replace the
snapshot with a release tag containing these files.

- [DocumentDB API reader](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/services/taskService/data-api/readers/DocumentDbDocumentReader.ts),
  [writer](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/services/taskService/data-api/writers/DocumentDbStreamingWriter.ts),
  and [index copier](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier.ts)
- [Copy task assembly](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/commands/pasteCollection/ExecuteStep.ts),
  [transfer options](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/services/taskService/extension/extensionDataTransferOptions.ts),
  and [copy-task strings](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/services/taskService/extension/extensionCopyCollectionStrings.ts)
- [Writer tests](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/packages/vscode-ext-tasks-data-transfer/src/data-api/writers/StreamingDocumentWriter.test.ts),
  [partial-outcome tests](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/packages/vscode-ext-tasks-data-transfer/src/data-api/writers/StreamingDocumentWriter.outcome.test.ts),
  [server-wait tests](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/packages/vscode-ext-tasks-data-transfer/src/data-api/writers/StreamingDocumentWriter.retryAfter.test.ts),
  and [keep-alive tests](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/packages/vscode-ext-tasks-data-transfer/src/data-api/readers/KeepAliveOrchestrator.test.ts)
