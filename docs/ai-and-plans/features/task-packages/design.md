---
feature: task-packages
kind: design
status: active
created: 2026-11-05
code:
    - src/services/taskService/**
---

# Design: Task Service and Data Transfer Packages

> Intent, not current behavior. The code and its tests are authoritative for what happens today.
> Sections 1 and 2 describe the code as analyzed on 2026-11-05; sections 3 onward describe the
> target.

## 1. How the pieces fit today

```
pasteCollection / pasteIndexes wizards (ExecuteStep is the assembly point)
   │  builds reader + writer + index copier → new CopyPasteCollectionTask(...)
   │  TaskService.registerTask(task); tree annotations; task.start()
   ▼
TaskService (singleton) ──events──► TaskProgressReportingService (VS Code notifications)
   │  registry, aggregated events, conflict queries   ◄── delete / remove / move commands
   ▼
Task (abstract): Pending → Initializing → Running → Stopping → Stopped | Completed | Failed
   │  onInitialize() → doWork(signal, telemetry context); AbortController; output channel logging
   ▼
CopyPasteCollectionTask: validate source → count → ensure target → copy indexes → stream
   │                              │
   ▼                              ▼
DocumentReader (keep-alive)   StreamingDocumentWriter (buffer, adaptive batches, retry,
                              Skip pre-filter, four conflict strategies, partial statistics)
   └── DocumentDB API implementations (ClustersClient, error codes 11000 / 16500)
```

| Layer               | Files                                                                         | Database neutral?                                                                                      |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Task core           | `taskService.ts`, `taskServiceResourceTracking.ts`                            | Logic yes; wiring no (`vscode.EventEmitter`, `l10n`, `ext.outputChannel`, azext telemetry)             |
| Presentation        | `UI/taskProgressReportingService.ts`, `resourceUsageHelper.ts`                | VS Code specific by design                                                                             |
| Engine              | `data-api/readers/Base*`, `KeepAliveOrchestrator`, `writers/Streaming*`, etc. | Algorithms yes; logging and messages through `vscode.l10n` and `ext`; `IActionContext` in public types |
| DocumentDB adapters | `DocumentDbDocumentReader`, `DocumentDbStreamingWriter`, index copier         | No: `mongodb`, `ClustersClient`                                                                        |
| Tasks               | `CopyPasteCollectionTask`, `CopyIndexesTask`, `DemoTask`                      | Partly: the copy task still calls `ClustersClient` and `CredentialCache` and clears clipboard state    |

### What the generic engine already does

All of this lives in the base classes, not in the DocumentDB adapters:

| Capability        | Behavior                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buffering         | Flushes at the current batch size or about 24 MB (estimated with `JSON.stringify(...).length * 2`)                                                                                                       |
| Adaptive batching | Fast mode: 500 → 2,000, +20% per batch without conflicts. The first throttle switches permanently to RU-limited mode: 100 → 1,000, +10%. Each throttle shrinks to the proven capacity, or halves if none |
| Throttle recovery | Extracts the partial count from the error, reports it immediately, drops the written prefix and retries the rest. The attempt counter resets on progress; it fails after 10 attempts without progress    |
| Backoff           | 100 ms × 2ⁿ, capped at 5 s, ±30% jitter, abortable. Network errors use the same backoff                                                                                                                  |
| Skip pre-filter   | Optional adapter hook, run once per batch before the retry loop so skips are not counted twice                                                                                                           |
| Conflict handling | Abort and Overwrite stop on the first conflict with `StreamingWriterError` carrying partial statistics; Skip and GenerateNewIds continue                                                                 |
| Keep-alive        | Reads one document into a buffer every 10 s while the consumer is slow, with a 10-minute limit                                                                                                           |
| Copy task         | Count, ensure target, optional index copy, stream, progress and "still working" messages, summary                                                                                                        |

An adapter implements `writeBatch` (all four strategies), `classifyError`, `extractPartialProgress`,
`ensureTargetExists`, the reader's two database hooks and, optionally, the Skip pre-filter. The
DocumentDB adapters are about 760 lines. The generic code is about 4,100 lines with about 3,600
lines of tests. That ratio is the benefit to a second consumer.

## 2. Findings that affect extraction

- **Coupling.** `vscode.l10n.t` is used in almost every file, `ext.outputChannel` even in pure
  algorithms such as `BatchSizeAdapter`, `IActionContext` appears in public types, and the services
  are module-level singletons.
- **Localization.** `npm run l10n` extracts strings from `./src` only. A package that calls
  `vscode.l10n.t` ships untranslated strings, so packages must receive their strings from the
  consumer.
- **Product hooks in the base class.** `Task` records survey activity for two hard-coded task types
  and writes ✓ ■ ! lifecycle lines to the output channel.
- **Copy task reaches into DocumentDB infrastructure** for source validation and cluster metadata
  telemetry, and clears `ext.copiedCollectionNode`. This is the open gap already recorded in
  [copy-paste-collections](../copy-paste-collections/README.md#open-gaps).
- **The writer's subclass contract is half-internal.** `StrategyBatchResult`, `ErrorType`,
  `PartialProgress` and `PreFilterResult` live in `writerTypes.internal.ts`.
- **`RetryOrchestrator` is dead code.** The writer constructs it but nothing calls it; the inline
  loop in `writeBatchWithRetry` has been the shipped retry logic since the November 2025 rewrite of
  the writer. Its defaults (1 s base, ×1.5) differ from the shipped loop (100 ms base, ×2).
- **Throttle recovery assumes an ordered prefix.** The writer drops the first _N_ documents, which
  is correct only because every DocumentDB API write uses `ordered: true`. Azure Cosmos DB for
  NoSQL bulk operations are unordered and report status per operation.
- **NoSQL bulk often does not throw on 429.** It returns failed operations, and the SDK retries
  some on its own.
- **No server-suggested wait.** The backoff ignores `retryAfterInMs` and `RetryAfterMs`.
- **Nothing is configurable.** Batch modes, the memory limit and the backoff are constants.
- **No partition key** in `DocumentDetails`, which NoSQL needs for the Skip pre-filter and Overwrite.
- **Documentation drift.** The Task Service README describes a `TaskServiceManager`, a
  `connectionId` field, conflict checks at registration, and `RetryOrchestrator` as the retry
  engine; none of that matches the code.
- **Registry housekeeping.** `deleteTask()` has no production caller, so finished tasks stay
  registered until restart. `registerTask()` does not check conflicts.

## 3. Package structure

Both packages follow the conventions of the existing packages: ESM only, `tsc` build to `dist/`,
subpath exports with `typesVersions` fallbacks, a Vitest project, `tsconfig.test.json` with
`typecheck:tests`, `publishConfig.access: public`, no product strings and no telemetry backend.

### `@microsoft/vscode-ext-tasks`

- **`.`** imports no `vscode` module:
  - `Task`, `TaskState`, `isTerminalState`, `TaskStatus`, the state change event types
  - the registry as a class or `createTaskService()` factory, never a module singleton
  - `ResourceDefinition`, `ResourceTrackingTask`, `hasResourceConflict` and the conflict queries
  - a minimal event emitter whose events match the `vscode.Event` call signature
  - injected seams: `TaskLogger` (shaped like `LogOutputChannel`), a telemetry runner (same
    pattern as `TelemetryRunner` in `@microsoft/vscode-ext-webview/host`), and `TaskStrings` with
    English defaults
  - a small `whenTerminal(task)` helper for consumers that annotate UI while a task runs
- **`./vscode`** imports `vscode`:
  - the progress notification reporter (cancel, the "Stopping" notification, final messages, a
    configurable "Show Output" action)
  - the conflict modal helper (`checkCanProceedAndInformUser`)
  - an observer that writes lifecycle lines through the injected logger
- Peers: `vscode` types only for `./vscode`. No dependency on `@microsoft/vscode-azext-utils`.

### `@microsoft/vscode-ext-tasks-data-transfer`

- **`.`** imports no `vscode` module and does not depend on `Task`:
  - `DocumentDetails`, `DocumentReader`, `BaseDocumentReader`, `KeepAliveOrchestrator`
  - `StreamingDocumentWriter`, the now-public subclass contract types, `StreamingWriterError`,
    `WriteStats`, `BatchSizeAdapter`, `computeRetryDelay`
  - `ConflictResolutionStrategy`
  - the `CollectionIndexCopier` interface and its result types
- **`./copy-collection`**: the database-neutral `CopyPasteCollectionTask` and its config type.
- Peers: `@microsoft/vscode-ext-tasks` (required). Implementation dependency: `denque`.

Adapter authors import the root; product code that wires a copy imports `./copy-collection`. The
root stays usable for a later transfer task, such as import from or export to a file.

### Consumers

This extension's host runs as ESM (build-and-test-stack decision 0007), so it imports both
packages statically. A CommonJS consumer must load them with `await import()`, as documented for
`@microsoft/vscode-ext-webview`.

### Documentation

Each package README, shipped in the npm tarball, has simple examples first, then reference
implementations in this repository, then the API and consumer responsibilities, then a **For
agents** section with the technical detail a coding agent in another repository needs to adopt the
package quickly: the adapter and wiring checklists, invariants, pitfalls, how to test, and a map
from each concept to its reference implementation. Examples are type-checked inside the package;
reference links are pinned to a release tag. See decision 0014 and step 5.3 of the
[extraction plan](./iterations/01-extraction-plan.md#53-package-documentation).

## 4. What stays in the extension

The packages own **what an option means and how it behaves**. The extension owns **how a user
chooses it and how it is worded**.

1. **Commands and wizards** (`copyCollection`, `pasteCollection`, `copyIndexes`, `pasteIndexes`):
   every prompt step, including the conflict strategy picker and its labels, the new collection
   name, index configuration and counting, the large collection warning with its threshold
   setting, and the confirmation steps. Wizard telemetry and `copyOperationCorrelationId`.
2. **Copy and paste state**: `ext.copiedCollectionNode`, `CopyPasteBufferService`, the
   `setContext` keys, and clearing a stale copied source when the task reports
   `SourceValidationError`.
3. **Assembly** in `ExecuteStep`: choosing adapters, getting clients from `ClustersClient`,
   constructing the task with injected `validateSource` (credential and existence checks) and
   `collectMetadata` hooks, registering it with the extension's own registry instance, tree
   annotations and refresh.
4. **DocumentDB API adapters**: reader, writer (error codes, `BulkWriteError` parsing, `_id`
   pre-filter, where `GenerateNewIds` keeps the original `_id`), index copier, copyability
   classification (copy-paste-collections decision 0013) and `CopyIndexesTask`. These may become a
   `./documentdb` subpath later, once a second consumer needs them.
5. **Glue**:
   - creating the registry instance and attaching the progress reporter in `ClustersExtension`
   - passing `ext.outputChannel` as the logger
   - the telemetry runner over `callWithTelemetryAndErrorHandling`
   - the survey hook, as a subscriber to task state changes
   - all localized strings, built with `vscode.l10n.t` in `src/`
   - which commands run conflict checks, their operation names, and the rule that a
     `ResourceDefinition` carries the stable `clusterId`, never `treeId`
6. **User documentation** and this feature folder. The package READMEs document the APIs.

**Telemetry continuity.** The extension's telemetry runner must keep the event names
`taskService.taskInitialization` and `taskService.taskExecution` and the `task_*` properties.
Renaming them breaks dashboard continuity, and new or renamed properties stay hidden until they are
classified.

## 5. Engine contract changes

Every new hook and setting defaults to today's behavior. The DocumentDB adapter needs no change,
and the existing writer test suite passing unchanged is the acceptance criterion.

### 5.1 Pluggable partial-write reporting (gaps 1 and 2)

Both reporting routes produce one internal shape, and the retry loop handles only that shape:

```ts
interface BatchAttemptOutcome<TId> {
    result: StrategyBatchResult<TId>; // counts written in this attempt
    remaining?: DocumentDetails[]; // what still needs writing; any subset, not necessarily a prefix
    errorType?: 'throttle' | 'network'; // why `remaining` is not empty
    retryAfterMs?: number; // the server's suggested wait, if any
}
```

- **Throwing route (DocumentDB, unchanged).** The base class builds the outcome from
  `classifyError` and `extractPartialProgress`. When the adapter reports only a count, `remaining`
  defaults to the batch minus its first `processedCount` documents, as today. `PartialProgress`
  gains an optional `remaining` for adapters that throw but write out of order.
- **Return route (new, for NoSQL bulk).** `writeBatch` may return `remaining`, `errorType` and
  `retryAfterMs` with its result instead of throwing.
- **Loop.** Add `result` to the statistics and report progress; stop if `remaining` is empty; on a
  throttle call `handleThrottle(writtenCount)`; reset the attempt counter if anything was written;
  wait; retry `remaining`.
- **`remaining` holds documents, not indices.** Scattered successes work, and the list cannot drift
  out of sync with indices.
- **Adapter guide responsibilities:** disable the SDK's own throttle retries; define Abort for an
  unordered bulk write, for example stop after the current batch and report the first conflict.

### 5.2 Settings (gap 4)

```ts
interface StreamingWriterSettings {
    batching?: {
        startMode?: 'fast' | 'ru-limited';
        fast?: Partial<ModeConfig>;
        ruLimited?: Partial<ModeConfig>;
        minBatchSize?: number;
        bufferMemoryLimitMB?: number;
    };
    retry?: {
        maxAttemptsWithoutProgress?: number;
        baseDelayMs?: number;
        multiplier?: number;
        maxDelayMs?: number;
        jitterFraction?: number;
    };
    estimateDocumentSize?: (doc: DocumentDetails) => number;
}
```

- Layering: package defaults (today's constants) < adapter defaults (protected constructor) <
  caller overrides (constructor argument).
- `startMode: 'ru-limited'` lets an adapter that knows the target is provisioned in RUs skip the
  first throttle that today only discovers RU mode.
- The delay calculation becomes the pure, separately tested function `computeRetryDelay`.
- VS Code settings exposing these values are out of scope; this is an API only.

### 5.3 Server-suggested wait (gap 3)

- Wait `max(computedBackoff, retryAfterMs ?? 0)`: never retry before the server says to. The wait
  stays abortable, and a trace line is logged when the server value wins.
- Sources: `retryAfterMs` on the return route; a new optional `getRetryAfterMs(error)` hook on the
  throwing route, returning `undefined` by default.
- No cap. Stop interrupts the wait.
- Known limitation: a suggested wait above Node's timer maximum (2,147,483,647 ms, about 24.8 days)
  is not honored; Node fires such a timer after about 1 ms. Accepted as won't-fix in the
  [iteration 01 review, F5](./iterations/01-extraction-plan-review.md#f5---an-uncapped-server-delay-can-overflow-nodes-timer);
  revisit only if a real source of such hints appears.
- Reading `RetryAfterMs=` from Azure Cosmos DB for MongoDB (RU) 16500 errors in the DocumentDB
  adapter is a separate follow-up because it changes shipped behavior, even if only by waiting
  longer.

### 5.4 Strategy capabilities

Writers declare `supportedConflictStrategies`. The extension's picker shows only what the chosen
target supports, without the package knowing about UI.

### 5.5 Deferred to the NoSQL contract review

- Partition key in `DocumentDetails`, the Skip pre-filter and Overwrite.
- The meaning of `GenerateNewIds` for `id` versus `_id`.
- Using the request charge to size batches before throttling starts (an optional improvement).
