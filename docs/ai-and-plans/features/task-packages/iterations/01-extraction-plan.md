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

> **Done (2026-11-05), commit `19004d18`:** deleted `RetryOrchestrator.ts`, its unused field,
> construction and import; the class JSDoc and the network-retry diagram now describe the inline
> loop in `writeBatchWithRetry`. No behaviour change; no new tests (writer suite unchanged and
> passing). Model: terra.

### 0.2 Correct the Task Service and Data API READMEs

Replace `TaskServiceManager` with the registry, `connectionId` with `clusterId`, remove the claim
that registration checks conflicts, describe the inline retry loop with its real defaults, and add
the index copy phase. Link both READMEs to this feature folder.

> **Done (2026-11-05), commit `78d0da80`:** both READMEs now name the `TaskService` registry,
> use `clusterId` (never `treeId`), state that `registerTask()` only rejects duplicate IDs while
> destructive commands run the conflict checks, describe the inline retry loop (100 ms × 2ⁿ, 5 s
> cap, ±30% jitter, abortable, 10 attempts without progress) and the optional index copy phase,
> and link this folder. The orchestrator restored two correct bullets the subagent had dropped
> from the `CopyPasteCollectionTask` box. Docs only. Model: luna.

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

> **Done (2026-11-05), commits `725916ae` (1.1a, task core), `0104c6a4` (1.1b, engine),
> `7f661ece` (1.1c, copy task):** split into three commits to keep each diff reviewable.
>
> - Task core: `taskHost.ts` defines `TaskLogger`, `TaskTelemetryContext`,
>   `TaskTelemetryRunner`, `TaskStrings` (English defaults) and `TaskOptions`; `events.ts` adds a
>   minimal `Emitter`/`Event` with the `vscode.Event` call signature. Like `vscode.EventEmitter`,
>   it isolates listener errors (added by the orchestrator in review). `taskService.ts` no
>   longer imports `vscode`, `ext` or azext utils. The glue in
>   `src/services/taskService/extension/` injects `ext.outputChannel`, a runner over
>   `callWithTelemetryAndErrorHandling` and `vscode.l10n.t` strings with the same keys.
> - Engine: `data-api/dataTransferHost.ts` defines `DataTransferStrings` and `DataTransferOptions`;
>   the readers, writer, `BatchSizeAdapter`, `KeepAliveOrchestrator` and `WriteStats` take them
>   through optional trailing constructor parameters. The DocumentDB adapters inject the
>   extension's logger and strings.
> - Copy task: `copyCollectionStrings.ts` holds its user-facing text; the source-validation and
>   metadata blocks keep `vscode.l10n.t` and `ext` until 1.4.
>
> Decisions made by the orchestrator:
>
> - **Log lines are plain English; only user-facing text goes through strings objects** (75%).
>   Output channel lines are diagnostics, and no translation bundles ship today
>   (`l10n/` has only `bundle.l10n.json`), so the English output is identical. It would change if
>   the extension starts shipping translations and wants translated logs.
> - **The extension's runner sets `suppressDisplay` for `taskService.taskExecution`** instead of
>   the task doing it in its catch block (75%). This keeps the context interface to `telemetry`
>   only. Display matters only when an error is thrown, so behaviour is the same.
> - **Telemetry property values are `string | { readonly value: string } | undefined`** (75%).
>   The object form is structurally `vscode.TelemetryTrustedValue<string>`, so `IActionContext`
>   satisfies `TaskTelemetryContext` without a cast, as the plan requires. The alternative, a cast
>   in the glue, would push the same cast onto every consumer.
> - **Engine hook contexts were narrowed to `TaskTelemetryContext` in 1.1a** (type-only, 90%),
>   because the task now passes that type to readers and writers.
>
> The `TaskService` singleton still uses English defaults for its two programmer-error messages
> until 1.3. Tests: `events.test.ts`, a host-options block in `taskService.test.ts`,
> `dataTransferHost.test.ts`, and an injected-strings test for the copy task. Existing writer,
> reader and keep-alive suites are unchanged; `CopyPasteCollectionTask.test.ts` only passes the
> mocked output channel as the injected logger. Models: sol (all three).

This is the largest diff, but mechanical. Afterwards, of the code that will move, only `UI/**` and
`resourceUsageHelper.ts` import `vscode`. The DocumentDB adapters and `CopyIndexesTask` stay in the
extension and may keep using `vscode.l10n.t` and `ext.outputChannel` directly.

### 1.2 Take product hooks out of `Task`

- Survey activity: subscribe to task state changes in `ClustersExtension` instead of checking two
  task types inside the base class.
- Lifecycle output lines (✓ ■ ! ○ ►): move into an observer that the extension attaches.

> **Done (2026-11-05), commit `01da044a`:** `ClustersExtension` records survey activity from
> `TaskService.onDidChangeTaskState` for the two copy task types (both are always registered before
> they start). `UI/taskLifecycleLogObserver.ts` writes the same lines for registered tasks, and
> its subscription is disposed with the extension context. The ○ line is now written just after
> the Initializing transition instead of just before it; nothing runs in between. `taskService.ts`
> imports only its own modules. Tests: observer tests replace the 1.1a lifecycle tests, plus one
> test that `Task` itself writes no lifecycle lines. No unit test for the survey wiring, because
> activation has no unit coverage. The orchestrator reverted a progress paragraph the subagent
> added to `design.md`. Model: sol.

### 1.3 Make the registry an instance

Export the registry class or a `createTaskService()` factory; the extension creates and exports its
singleton instance. Same for the progress reporting service.

> **Done (2026-11-05), commit `236b4b66`:** `createTaskService()` and
> `createTaskProgressReportingService()` replace the module singletons. The extension creates
> both instances in `src/services/taskService/extension/taskServiceInstance.ts`, with localized
> registry strings, and call sites only changed their import path.
> `checkCanProceedAndInformUser` takes the registry as its first parameter, because it is
> presentation code that will move and cannot import the extension's instance. Test changes are
> limited to `vi.mock` paths and per-file `createTaskService()` instances, plus one isolation
> test. Model: sol.

### 1.4 Remove DocumentDB calls from `CopyPasteCollectionTask`

Inject `validateSource` and `collectMetadata` hooks. The task throws `SourceValidationError`; the
command that started the paste clears `ext.copiedCollectionNode` and the context key. This closes
the open gap in [copy-paste-collections](../../copy-paste-collections/README.md#open-gaps).

> **Done (2026-11-05), commit `264cb88b`:** both hooks are options of the copy task;
> `SourceValidationError` is exported. `src/commands/pasteCollection/copyPasteCollectionHooks.ts`
> holds the moved code unchanged in behaviour, and `ExecuteStep` supplies the hooks. The task
> rethrows `SourceValidationError` unchanged, wraps other errors as before, and ignores
> `collectMetadata` failures. The open gap in copy-paste-collections is removed.
>
> Decision made by the orchestrator (85%): **the paste command's `validateSource` hook clears the
> clipboard before throwing**, instead of a subscriber to the Failed state. The extension's
> telemetry runner (`callWithTelemetryAndErrorHandling`) swallows initialization errors, so a
> Failed state is not guaranteed. Clearing inside the hook keeps today's timing exactly. The
> "Validating source collection..." status now appears just before the credential check instead
> of just after it; both are instant. Tests: hook handling in `CopyPasteCollectionTask.test.ts`
> and `copyPasteCollectionHooks.test.ts`. Model: sol.

### 1.5 Reader takes a client

`DocumentDbDocumentReader` receives a client instance, as the writer already does, instead of
calling `ClustersClient.getClient(clusterId)`.

> **Deferred (2026-11-05), escalated to the operator.** As written, `ExecuteStep` would call
> `ClustersClient.getClient(source)` eagerly. If the source was disconnected after Copy, the paste
> would then fail inside the wizard with the raw client error, before the task's friendly
> `SourceValidationError` and the clipboard clearing (decision 0008). The behaviour-neutral option
> is a lazy client provider (`() => Promise<ClustersClient>`), which deviates from the wording
> "receives a client instance". The reader stays in the extension either way.

### 1.6 Publish the writer's subclass contract

Move `StrategyBatchResult`, `ErrorType`, `PartialProgress`, `PreFilterResult` and the type guards
out of `writerTypes.internal.ts` into the public types.

> **Done (2026-11-05), commit `6a871bd0`:** the strategy batch results, the type guards,
> `PreFilterResult`, `PartialProgress` and `ErrorType` moved to `data-api/types.ts` unchanged
> (`BaseBatchResult` stays unexported). Only the batch mode configuration stayed in
> `writerTypes.internal.ts` (2.1 later replaced its constants). Test changes are import lines
> only. Model: terra.

---

## Phase 2: Engine contract

### 2.1 Writer settings

Add `StreamingWriterSettings` with defaults equal to today's constants, layered package < adapter <
caller (decision 0010). Extract `computeRetryDelay` as a pure function. Include the
`estimateDocumentSize` hook.

> **Done (2026-11-05), commit `6101f6cb`:** `StreamingWriterSettings`, `ModeConfig` and
> `StreamingWriterOptions` (`adapterDefaults`, `settings`) are public in `data-api/types.ts`.
> `writers/streamingWriterSettings.ts` holds the defaults (today's constants), the pure
> `resolveStreamingWriterSettings` (field-by-field merge) and `computeRetryDelay` (injectable
> randomness). `BatchSizeAdapter` takes the resolved batching config, including
> `startMode: 'ru-limited'`. `DocumentDbStreamingWriter` accepts optional caller settings and has
> no adapter defaults. Tests: `streamingWriterSettings.test.ts` and
> `StreamingDocumentWriter.settings.test.ts`; the existing writer suite is unchanged. Model: sol.

### 2.2 Outcome shape for both reporting routes

Add `BatchAttemptOutcome`, the return route from `writeBatch`, the optional `remaining` on
`PartialProgress`, and rewrite the retry loop to retry `remaining` (decision 0009). Prefix slicing
stays the default when only a count is reported.

> **Done (2026-11-05), commit `74fde43c`:** `BatchAttemptOutcome` and `isBatchAttemptOutcome`
> are public, `PartialProgress.remaining` is optional, and `writeBatch` may return either a result
> or an outcome. `writeBatchWithRetry` turns both routes into one outcome. The throwing route keeps
> its order of side effects and prefix slicing when only a count is reported.
>
> Decisions made by the orchestrator:
>
> - **`writeBatch` returns `StrategyBatchResult | BatchAttemptOutcome`**, told apart by the
>   `result` property (75%). The documented outcome shape stays as designed until the NoSQL
>   review.
> - **An outcome with remaining documents but no `errorType` is retried like a network error**
>   (70%): no batch shrink, attempt counted unless something was written.
>
> One timing-only difference: when a throttle error reports the whole batch written, the loop now
> returns without one extra backoff wait. Tests: `StreamingDocumentWriter.outcome.test.ts`
> (scattered `remaining` on both routes, count-only prefix slicing, throttle adaptation from the
> return route, attempt exhaustion, network). Model: sol.

### 2.3 Server-suggested wait as a floor

Add `getRetryAfterMs(error)` (default `undefined`) and `retryAfterMs` on the return route. Wait
`max(backoff, retryAfterMs)`, abortable, with a trace line (decision 0011).

> **Done (2026-11-05), commit `d0a1df09`:** the wait is `max(computeRetryDelay(...),
> retryAfterMs)`, with no cap. Values that are not finite or are negative are ignored, and a
> trace line is written when the server value wins. The DocumentDB adapter is unchanged (reading
> `RetryAfterMs` from 16500 errors stays a follow-up). The orchestrator added an early return
> when the signal is already aborted, plus a test. Before this, a Stop pressed during an
> in-flight write let the uncapped wait run in full, because the `abort` event had already
> fired. Tests: `StreamingDocumentWriter.retryAfter.test.ts`. Model: sol.

### 2.4 Strategy capabilities

Add `supportedConflictStrategies` to writers; the DocumentDB writer declares all four. The paste
wizard filters its picker by it.

> **Done (2026-11-05), commit `485524ca`:** the base writer defaults to all four strategies. The
> property is not abstract, so existing test subclasses compile unchanged (orchestrator decision,
> 70%); a new adapter that forgets to override it claims all four. `DocumentDbStreamingWriter`
> declares `documentDbSupportedConflictStrategies`. The conflict picker filters by that constant,
> because the writer is only built after the picker runs. Item ids are now the enum values, which
> equal the previous literals, so the selection and its telemetry are unchanged. Tests:
> `PromptConflictResolutionStep.test.ts`, `supportedConflictStrategies.test.ts`. Model: terra.

### 2.5 Tests

New tests for scattered `remaining` documents, the return route, the suggested wait as a floor,
settings layering and `computeRetryDelay`. The existing writer suite passes untouched.

> **Done (2026-11-05), no separate commit:** these tests landed with 2.1 to 2.3. The original
> `StreamingDocumentWriter.test.ts` has changed only in its import lines (1.6), and it passes,
> as do the reader and keep-alive suites, which are unchanged.

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

**In progress (2026-11-05).** Phases 0, 1 and 2 landed in place on `dev/tnaum/npm-task-engine`,
except 1.5, which is deferred pending an operator decision (see its note). All steps are
behaviour-neutral for the DocumentDB path. After this round, the code that will move imports
`vscode` or `ext` only in `UI/**` and `resourceUsageHelper.ts`, as planned. Phase 3 (open
questions), Phase 4 (the NoSQL team's review) and Phase 5 (extraction, which waits for Phase 4)
have not started.

Found while working, not changed:

- `callWithTelemetryAndErrorHandling` swallows errors thrown by `onInitialize`, so a task whose
  initialization fails (for example with `SourceValidationError`) shows the error and then still
  moves to Running and runs `doWork`. This happens today and is unchanged.
- `TaskProgressReportingService.detach()` destructures task-ID strings and uses only their first
  character.
- `UI/**` and `resourceUsageHelper.ts` still call `vscode.l10n.t` and use `ext`. Under decision
  0006 they need injected strings before they move to `./vscode` in step 5.2.
