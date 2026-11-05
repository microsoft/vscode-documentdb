---
feature: task-packages
kind: plan
status: active
created: 2026-11-05
code:
    - src/services/taskService/**
---

# Iteration 01: Extraction plan

The plan agreed on 2026-11-05 for moving the Task Service and the document transfer engine into
`@microsoft/vscode-ext-tasks` and `@microsoft/vscode-ext-tasks-data-transfer`. The target is
described in [design.md](../design.md) and the reasoning in [decisions.md](../decisions.md).

**Ground rules**

- Refactor in place in `src/` first; move folders into `packages/` only when the code no longer
  imports `vscode` (outside `./vscode`), `ext` or `@microsoft/vscode-azext-utils`.
- Every step is behavior-neutral for the DocumentDB path (decision 0008). The existing tests,
  especially `StreamingDocumentWriter.test.ts`, pass unchanged at every step.
- Verification while working: `npm run build` and the Vitest files covering the touched code.
- Record progress inline under each item when it is committed: hash, subject, what landed and why,
  and any deviation with its rejected alternatives.

Phases 0 to 3 can land as separate PRs in this order. Phase 4 needs the other team. Phase 5 moves
the code.

---

## Phase 0: Cleanup without behavior change

### 0.1 Delete `RetryOrchestrator`

Remove `writers/RetryOrchestrator.ts`, the `retryOrchestrator` field and its import from
`StreamingDocumentWriter`. Correct the class JSDoc and the diagrams that name it (decision 0007).

### 0.2 Correct the Task Service and Data API READMEs

Replace `TaskServiceManager` with the registry, `connectionId` with `clusterId`, remove the claim
that registration checks conflicts, describe the inline retry loop with its real defaults, and add
the index copy phase. Link both READMEs to this feature folder.

---

## Phase 1: Seams in place

### 1.1 Logger, telemetry runner, strings and emitter

- Introduce `TaskLogger` (shaped like `LogOutputChannel`) and pass it to `Task`, the registry,
  readers, writers, `BatchSizeAdapter` and `KeepAliveOrchestrator` instead of using `ext.outputChannel`.
- Introduce a telemetry runner for the two task phases, implemented in the extension over
  `callWithTelemetryAndErrorHandling`. Replace `IActionContext` in public types with a minimal
  telemetry context interface (`properties`, `measurements`) that `IActionContext` satisfies.
- Introduce `TaskStrings` and the engine's strings objects with English defaults; the extension
  passes `vscode.l10n.t` values (decision 0006).
- Replace `vscode.EventEmitter` with a minimal emitter whose events keep the `vscode.Event` call
  signature, so existing subscribers compile unchanged.
- Keep event names and `task_*` properties (decision 0012).

This is the largest diff, but mechanical. Afterwards, of the code that will move, only `UI/**` and
`resourceUsageHelper.ts` import `vscode`. The DocumentDB adapters and `CopyIndexesTask` stay in the
extension and may keep using `vscode.l10n.t` and `ext.outputChannel` directly.

### 1.2 Take product hooks out of `Task`

- Survey activity: subscribe to task state changes in `ClustersExtension` instead of checking two
  task types inside the base class.
- Lifecycle output lines (✓ ■ ! ○ ►): move into an observer that the extension attaches.

### 1.3 Make the registry an instance

Export the registry class or a `createTaskService()` factory; the extension creates and exports its
singleton instance. Same for the progress reporting service.

### 1.4 Remove DocumentDB calls from `CopyPasteCollectionTask`

Inject `validateSource` and `collectMetadata` hooks. The task throws `SourceValidationError`; the
command that started the paste clears `ext.copiedCollectionNode` and the context key. This closes
the open gap in [copy-paste-collections](../../copy-paste-collections/README.md#open-gaps).

### 1.5 Reader takes a client

`DocumentDbDocumentReader` receives a client instance, as the writer already does, instead of
calling `ClustersClient.getClient(clusterId)`.

### 1.6 Publish the writer's subclass contract

Move `StrategyBatchResult`, `ErrorType`, `PartialProgress`, `PreFilterResult` and the type guards
out of `writerTypes.internal.ts` into the public types.

---

## Phase 2: Engine contract

### 2.1 Writer settings

Add `StreamingWriterSettings` with defaults equal to today's constants, layered package < adapter <
caller (decision 0010). Extract `computeRetryDelay` as a pure function. Include the
`estimateDocumentSize` hook.

### 2.2 Outcome shape for both reporting routes

Add `BatchAttemptOutcome`, the return route from `writeBatch`, the optional `remaining` on
`PartialProgress`, and rewrite the retry loop to retry `remaining` (decision 0009). Prefix slicing
stays the default when only a count is reported.

### 2.3 Server-suggested wait as a floor

Add `getRetryAfterMs(error)` (default `undefined`) and `retryAfterMs` on the return route. Wait
`max(backoff, retryAfterMs)`, abortable, with a trace line (decision 0011).

### 2.4 Strategy capabilities

Add `supportedConflictStrategies` to writers; the DocumentDB writer declares all four. The paste
wizard filters its picker by it.

### 2.5 Tests

New tests for scattered `remaining` documents, the return route, the suggested wait as a floor,
settings layering and `computeRetryDelay`. The existing writer suite passes untouched.

---

## Phase 3: Registry housekeeping

### 3.1 Retention of finished tasks

Decide and implement how long terminal tasks stay registered. Open question.

### 3.2 Conflict check at registration

Decide whether `registerTask` should refuse a task whose resources conflict. Open question.

---

## Phase 4: Contract review with the NoSQL team

Walk the writer contract through with the Azure Cosmos DB for NoSQL team before extraction:

- the outcome shape and Abort semantics for unordered bulk writes;
- partition keys in `DocumentDetails`, the Skip pre-filter and Overwrite;
- `GenerateNewIds` for `id` versus `_id`;
- disabling the SDK's own throttle retries;
- optional batch sizing from the request charge.

Record the outcomes as new decisions. Until this review, the packages ship as 0.x (decision 0013).

---

## Phase 5: Extraction

### 5.1 Create the packages

Create `packages/vscode-ext-tasks` and `packages/vscode-ext-tasks-data-transfer` following the
existing package shape: ESM, `tsc -p .` to `dist/`, subpath exports with `typesVersions`, `files`,
`publishConfig.access: public`, a Vitest project in `vitest.config.ts`, `tsconfig.test.json` and
`typecheck:tests`, and a root `tsconfig.json` reference.

### 5.2 Move the code

Move the core, the presentation (`./vscode`), the engine and the copy task (`./copy-collection`)
with their tests. The DocumentDB adapters, `CopyIndexesTask`, the wizards and the glue stay in
`src/` (decision 0005). Update imports in the extension.

### 5.3 Package documentation

Documentation is part of the deliverable (decision 0014), not a follow-up. Each package README is
shipped in the npm tarball and has these parts:

1. **Simple examples first.** Short, complete snippets for the common paths:
   - tasks: a minimal task, a task with `onInitialize`, a resource-tracking task, creating the
     registry and attaching the progress notifications, the conflict check before a delete;
   - data transfer: a minimal reader and writer adapter, wiring and starting the copy task,
     writer settings, reporting a partial write on each route, the server-suggested wait.

   The snippets are kept in a type-checked examples file inside the package (as the Fluent UI
   package does with `type-tests`), so they cannot silently drift from the API.

2. **Reference implementations.** Links to this repository's code as worked examples: the
   DocumentDB reader, writer and index copier, `ExecuteStep` as the assembly point, the activation
   wiring in `ClustersExtension`, the telemetry runner, the strings objects, and the conflict
   checks in the delete and remove commands. Links are absolute GitHub URLs pinned to a release
   tag, because npm readers do not have the repository and paths on `main` move.
3. **API and consumer responsibilities**, including that CommonJS consumers load the packages with
   `await import()`.
4. **For agents.** A technical section written for coding agents working in other repositories
   that adopt the packages, so they can move faster without reading our history:
   - the subclass and adapter contract as a checklist, with its invariants: throw throttle and
     network errors or return them as an outcome, return conflicts in `errors` and never throw them,
     what `remaining` must contain, ordered versus unordered writes, disabling SDK retries;
   - the consumer wiring checklist: one registry instance, the reporter, logger, telemetry runner
     and strings injection, and stable resource IDs in `ResourceDefinition`;
   - the pitfalls: calling `vscode.l10n.t` inside package code, never calling `updateStatus`
     directly, checking the abort signal, the ESM loading rule, telemetry name continuity;
   - how to test an adapter: which fakes to use and which tests in this repository to mirror
     (for example `StreamingDocumentWriter.test.ts`, `KeepAliveOrchestrator.test.ts`);
   - a file map from each concept to its reference implementation.

   If the section outgrows the README, it moves to an `AGENTS.md` that is listed in `files` and
   linked from the README, so agents can read it from `node_modules`.

The implementation READMEs in `src/services/taskService/` move or shrink accordingly; what remains
describes only the extension-side code.

### 5.4 Publishing

Decide how the `@microsoft/vscode-ext-*` packages are published; there is no workflow for them
today.

---

# Outcome

Not started.
