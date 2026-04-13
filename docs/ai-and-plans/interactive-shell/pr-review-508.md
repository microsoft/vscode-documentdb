# PR #508 Final Consolidated Review — Feature: Interactive Shell 💻

> **Methodology:** Three independent reviews (Claude, GPT-4o, Gemini) merged, deduplicated, and each finding verified against the actual source code. Design decisions validated against `docs/ai-and-plans/` planning documents. Issues marked with severity, verification status, and actionable proposed solutions.

---

## Summary Assessment

| Aspect               | Rating             | Notes                                                                        |
| -------------------- | ------------------ | ---------------------------------------------------------------------------- |
| **Architecture**     | ✅ Excellent       | Clean separation: 3 standalone packages, worker isolation, message-typed IPC |
| **Type Safety**      | ✅ Excellent       | Zero `any` usage across all new code; strict readonly patterns               |
| **Test Coverage**    | ✅ Good            | 46 test files; TDD contracts for completions; structural invariant tests     |
| **Error Handling**   | ⚠️ Needs Attention | Several silent failures, missing user feedback                               |
| **Resource Cleanup** | ⚠️ Needs Attention | Fresh mode leak, no schema eviction                                          |
| **Race Conditions**  | ⚠️ Needs Attention | Concurrent shell init, interrupt/eval interleaving                           |
| **Data Quality**     | ⚠️ Needs Attention | Update operator descriptions point to wrong docs                             |
| **Legacy Cleanup**   | ✅ Complete        | All scrapbook/ANTLR code removed; no dangling references                     |

---

## 🔴 Critical Issues

---

### C1. Silent Failures: No User Feedback on Blocked Operations

| Field         | Value                                                                             |
| ------------- | --------------------------------------------------------------------------------- |
| **Reporters** | Claude (C2), Gemini (implicit)                                                    |
| **Severity**  | 🔴 Critical (UX)                                                                  |
| **Verified**  | ✅ Confirmed in code                                                              |
| **Files**     | `src/commands/playground/runAll.ts`, `runSelected.ts`, `executePlaygroundCode.ts` |

**Evidence:** Multiple early-return paths silently do nothing:

- `runAll.ts:16-18` — Wrong editor type → silent return
- `runAll.ts:28-31` — Empty code → silent return
- `runSelected.ts:21-23` — No active editor → silent return
- `executePlaygroundCode.ts:48-51` — Already executing → silent return

Users click "Run All" or "Run Selected" and **nothing happens**. No error, no warning, no feedback. This is the #1 usability issue in the PR.

**Design context:** Not addressed or deferred in any planning docs. This appears to be an oversight.

**Proposed Solutions:**

<details>
<summary><b>Option A: Add warning messages to each early exit (Recommended)</b></summary>

Add `vscode.window.showWarningMessage()` with localized strings for each case.

| Pros                                         | Cons                                                   |
| -------------------------------------------- | ------------------------------------------------------ |
| Direct user feedback on every failed attempt | Slightly more code per command                         |
| Consistent with VS Code UX patterns          | Warning popups can annoy power users who trigger often |
| Trivial implementation (~4 lines each)       | None                                                   |

```typescript
// Example for runAll.ts empty code case:
if (!code.trim()) {
  void vscode.window.showWarningMessage(vscode.l10n.t('The playground file is empty. Add some code first.'));
  return;
}
```

</details>

<details>
<summary><b>Option B: Use status bar message instead of popup</b></summary>

Use `vscode.window.setStatusBarMessage()` for transient, non-intrusive feedback.

| Pros                                          | Cons                                             |
| --------------------------------------------- | ------------------------------------------------ |
| Non-intrusive, disappears after a few seconds | Easy to miss if user isn't looking at status bar |
| Won't interrupt workflow                      | Less discoverable than a popup                   |
| Consistent with "soft" feedback patterns      | None                                             |

</details>

<details>
<summary><b>Option C: Use Information message for "already executing" only, Warning for others</b></summary>

Differentiate severity: "already executing" is informational (expected), others are warnings.

| Pros                                           | Cons                                                |
| ---------------------------------------------- | --------------------------------------------------- |
| Semantically accurate severity levels          | Slightly more code than a uniform approach          |
| "Already executing" doesn't feel like an error | None                                                |
| None                                           | Need to decide per-case, which adds review overhead |

</details>

**RESOLVED:** Option A was selected (Information Messages with friendly wording). Added `showInformationMessage` calls for: empty playground file, no code to run, no connection, and already executing. Commit: 9b956fb

---

### C2. Race Condition: Concurrent Shell Worker Initialization

| Field         | Value                                                 |
| ------------- | ----------------------------------------------------- |
| **Reporters** | Claude (C1)                                           |
| **Severity**  | 🔴 Critical                                           |
| **Verified**  | ✅ Confirmed in code                                  |
| **File**      | `src/documentdb/shell/ShellSessionManager.ts:155-159` |

**Evidence:**

```typescript
async evaluate(code: string, timeoutMs: number): Promise<SerializableExecutionResult> {
    if (!this._initialized) {
        this._callbacks?.onReconnecting?.();
        await this.initialize();  // No lock — two concurrent calls both enter here
    }
```

Two rapid `evaluate()` calls both see `_initialized=false` and both call `initialize()`. `WorkerSessionManager.ensureWorker()` does NOT protect against concurrent initialization either — it will spawn multiple workers if called simultaneously.

**Design context:** The planning docs (Step 8) describe "lazy persistent worker per session" but don't discuss concurrent initialization protection.

**Proposed Solutions:**

<details>
<summary><b>Option A: Initialization promise lock (Recommended)</b></summary>

Cache the initialization promise so concurrent callers await the same operation.

| Pros                                    | Cons                                   |
| --------------------------------------- | -------------------------------------- |
| Prevents duplicate worker spawns        | Slightly more complex state management |
| Zero-cost when already initialized      | None                                   |
| Well-known pattern for async singletons | None                                   |

```typescript
private _initPromise: Promise<void> | undefined;

async evaluate(code: string, timeoutMs: number) {
    if (!this._initialized) {
        if (!this._initPromise) {
            this._initPromise = this.initialize().finally(() => { this._initPromise = undefined; });
        }
        await this._initPromise;
    }
}
```

</details>

<details>
<summary><b>Option B: Guard in WorkerSessionManager.ensureWorker()</b></summary>

Move the lock deeper, into `ensureWorker()`, so all callers are protected.

| Pros                                          | Cons                                                           |
| --------------------------------------------- | -------------------------------------------------------------- |
| Protects all future callers of ensureWorker() | Changes a shared utility class                                 |
| Single fix point                              | May mask concurrent eval bugs at the ShellSessionManager level |
| None                                          | None                                                           |

</details>

---

**RESOLVED:** Option A was selected (initialization promise lock). Concurrent `evaluate()` calls now await the same init promise. Commit: d7eecae

### C3. Resource Leak: Fresh Context Mode Never Cleans Up

| Field         | Value                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| **Reporters** | Claude (C3)                                                               |
| **Severity**  | 🔴 Critical                                                               |
| **Verified**  | ✅ Confirmed in code                                                      |
| **File**      | `packages/documentdb-shell-runtime/src/DocumentDBShellRuntime.ts:122-160` |

**Evidence:** `evaluateFresh()` creates `DocumentDBServiceProvider`, `ShellInstanceState`, `ShellEvaluator`, and `vm.Context` — **none are disposed after use**. Each playground run in fresh mode leaks resources.

Compare to persistent mode which stores these in instance variables for reuse — still resources, but reused/disposed eventually.

**Design context:** Planning doc Step 6.2 discusses the persistent worker architecture but doesn't cover cleanup for fresh mode specifically. Fresh mode was likely added as a simpler alternative.

**Proposed Solutions:**

<details>
<summary><b>Option A: Add try/finally cleanup in evaluateFresh() (Recommended)</b></summary>

Dispose created resources in a finally block.

| Pros                            | Cons                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| Direct fix, minimal code change | Need to verify which resources have `.close()` or `.dispose()` methods |
| Prevents any memory/handle leak | None                                                                   |
| None                            | None                                                                   |

```typescript
private async evaluateFresh(...): Promise<ShellEvaluationResult> {
    const { serviceProvider, bus } = DocumentDBServiceProvider.createForDocumentDB(...);
    const instanceState = new ShellInstanceState(serviceProvider, bus);
    try {
        const evaluator = new ShellEvaluator(instanceState);
        // ... evaluate ...
        return result;
    } finally {
        await instanceState.close();
    }
}
```

</details>

<details>
<summary><b>Option B: Remove fresh mode entirely, always use persistent</b></summary>

If fresh mode isn't a key user feature, remove it and simplify.

| Pros                         | Cons                                                        |
| ---------------------------- | ----------------------------------------------------------- |
| Eliminates the leak entirely | Removes isolation between query runs (variables carry over) |
| Simplifies codebase          | May break specific use cases that need clean context        |
| None                         | Larger code change                                          |

</details>

**RESOLVED:** Option A was selected (try/finally cleanup). `evaluateFresh()` now calls `instanceState.close()` in a finally block. Commit: 9f2a544

---

## 🟠 High Severity Issues

---

### H1. Removing a Connection Leaves Playground in Stale "Connected" State

| Field         | Value                                                     |
| ------------- | --------------------------------------------------------- |
| **Reporters** | GPT (Finding 2)                                           |
| **Severity**  | 🟠 High (UX)                                              |
| **Verified**  | ✅ Confirmed in code                                      |
| **File**      | `src/commands/removeConnection/removeConnection.ts:56-70` |

**Evidence:** The `removeConnection` flow clears `CredentialCache` and `SchemaStore`, but **never calls `PlaygroundService.getInstance().clearConnection()`**. After removing the active playground connection:

1. Playground UI still shows "connected" status
2. Next execution attempt throws at `PlaygroundEvaluator.ts:191` ("No credentials found") — a confusing error
3. The extension has a first-class "disconnected" state, but this path bypasses it

**Design context:** Not addressed in planning docs. The playground connection lifecycle (setting/clearing) is tested in `PlaygroundService.test.ts`, but only for explicit `clearConnection()` calls — no test covers "removing an active connection disconnects the playground."

**Proposed Solutions:**

<details>
<summary><b>Option A: Clear playground connection in removeConnection (Recommended)</b></summary>

Check if the removed cluster matches the active playground connection and clear it.

| Pros                                      | Cons                                                     |
| ----------------------------------------- | -------------------------------------------------------- |
| Clean UX transition to disconnected state | Adds dependency on PlaygroundService in removeConnection |
| Triggers existing evaluator shutdown path | None                                                     |
| Simple, ~5 lines of code                  | None                                                     |

```typescript
// In removeConnection.ts, after SchemaStore.clearCluster:
const playgroundService = PlaygroundService.getInstance();
const conn = playgroundService.getConnection();
if (conn && conn.clusterId === node.cluster.clusterId) {
  playgroundService.clearConnection();
}
```

</details>

<details>
<summary><b>Option B: PlaygroundService listens for credential removal</b></summary>

Make PlaygroundService react to `CredentialCache` changes.

| Pros                                               | Cons                                              |
| -------------------------------------------------- | ------------------------------------------------- |
| Decoupled — no dependency injection needed         | Requires adding events to CredentialCache         |
| Catches all credential-removal paths automatically | More architectural overhead for a single use case |
| None                                               | None                                              |

</details>

**Test gap:** Add a TDD contract: "Removing the active connection must disconnect the playground and shut down its worker."

**DEFERRED:** Not fixing in this PR. Created GitHub issue #566 to address unified disconnect/remove connection experience across all views (playground, shell, collection view, document view, running tasks).

---

### H2. `parseShellBSON` Accepts Non-Object Values for Projection/Sort

| Field         | Value                                               |
| ------------- | --------------------------------------------------- |
| **Reporters** | GPT (Finding 1), Copilot PR reviewer (CP3)          |
| **Severity**  | 🟠 High (UX + Data Integrity)                       |
| **Verified**  | ✅ Confirmed in code                                |
| **File**      | `src/documentdb/ClustersClient.ts:675-720, 828-850` |

**Evidence:** `parseShellBSON()` returns `unknown`, then is immediately cast `as Document` with **no type validation**. Inputs like `1`, `[]`, or `'name'` parse successfully but produce invalid driver options. The confusing driver error surfaces instead of a clear extension-level error.

This affects both `runFindQuery()` and `streamDocumentsWithQuery()`, impacting the Collection View query bar and export/data-reader code.

**Design context:** Not discussed in planning docs. The `parseShellBSON` switch from JSON to shell BSON was documented in Step 4, but type validation post-parse was not addressed.

**Proposed Solutions:**

<details>
<summary><b>Option A: Add plain-object type guard after parse (Recommended)</b></summary>

Validate that the parsed result is a plain object before using it.

| Pros                                             | Cons                              |
| ------------------------------------------------ | --------------------------------- |
| Clear error before the driver sees invalid input | Slightly more code per parse site |
| Reusable guard function                          | None                              |
| Consistent with existing `QueryError` pattern    | None                              |

```typescript
function assertDocument(value: unknown, errorCode: 'INVALID_PROJECTION' | 'INVALID_SORT'): Document {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new QueryError(errorCode, l10n.t('Expected a document object like { field: 1 }, got: {0}', typeof value));
  }
  return value as Document;
}
```

</details>

<details>
<summary><b>Option B: Validate at the UI layer before sending to ClustersClient</b></summary>

Add validation in the Collection View webview before submitting queries.

| Pros                              | Cons                                     |
| --------------------------------- | ---------------------------------------- |
| Immediate feedback to user        | Doesn't protect programmatic/API callers |
| Can show inline validation errors | Duplicates validation logic              |
| None                              | Misses the streaming/export path         |

</details>

**Test gap:** Add a TDD contract: "Projection/sort must reject non-object values (scalars, arrays) before reaching the driver."

**RESOLVED:** Option A was selected (plain-object type guard). Added `assertDocumentObject()` validation after `parseShellBSON()` in both `runFindQuery()` and `streamDocumentsWithQuery()`. Commit: bc2fcd6

---

### H3. Update Operator Descriptions Point to Wrong Documentation

| Field         | Value                                                  |
| ------------- | ------------------------------------------------------ |
| **Reporters** | GPT (Finding 4), Gemini, Copilot PR reviewer (CP4)     |
| **Severity**  | 🟠 High (UX — Misleading content)                      |
| **Verified**  | ✅ Confirmed in code                                   |
| **File**      | `packages/documentdb-constants/src/updateOperators.ts` |

**Evidence:** Multiple update-operator entries have descriptions and links from the wrong category:

| Operator | Problem                                             | Line |
| -------- | --------------------------------------------------- | ---- |
| `$min`   | Links to accumulator page, not update operator      | ~45  |
| `$max`   | Described as accumulator, links to accumulator docs | ~50  |
| `$set`   | Links to aggregation `$set` stage                   | ~73  |
| `$unset` | Described as "aggregation pipeline stage"           | ~79  |
| `$slice` | Links to array-expression page, not update modifier | ~153 |
| `$sort`  | Described as "aggregation pipeline stage"           | ~159 |

Users hovering these operators in the editor get **confidently wrong documentation**.

**Design context:** The pipeline for operator data is: scraper → `operator-overrides.md` → generated TypeScript. The `KNOWN_SCRAPER_MISMATCHES` in `operatorReference.test.ts` acknowledges the issue exists but doesn't fix it.

**Proposed Solutions:**

<details>
<summary><b>Option A: Add overrides in `operator-overrides.md` and regenerate (Recommended)</b></summary>

Fix the descriptions and links via the existing override mechanism.

| Pros                                          | Cons                                        |
| --------------------------------------------- | ------------------------------------------- |
| Uses existing infrastructure (override file)  | Need to write correct descriptions manually |
| Regeneration validates against tests          | Need to re-run the generation step          |
| Fixes the root cause for future regenerations | None                                        |

</details>

<details>
<summary><b>Option B: Manually edit updateOperators.ts directly</b></summary>

Fix the generated file by hand.

| Pros                | Cons                                       |
| ------------------- | ------------------------------------------ |
| Fastest path to fix | Gets overwritten on next generation run    |
| None                | Doesn't fix the root cause in the scraper  |
| None                | Diverges generated output from source data |

</details>

**Test gap:** Add a structural invariant test that verifies update operators don't reference "accumulator" or "aggregation" in their descriptions.

**DEFERRED:** Created GitHub issue #570. After fetching each published doc page, the documentation is actually correct — pages like `accumulators/$min` cover both the accumulator AND field update use cases (syntax, parameters, examples 4-8). The problem is only the scraped hover description, which uses the page's opening sentence (accumulator/aggregation-biased). Fix: add description overrides in `operator-overrides.md` for 5 operators (`$set` is already correct). Links should be kept as-is. Only `$unset` is a genuine doc gap (page only covers aggregation pipeline, not update syntax).

---

### H4. Stale ClustersClient Cache After Create/Delete

| Field         | Value                                      |
| ------------- | ------------------------------------------ |
| **Reporters** | Gemini, Copilot PR reviewer (CP1)          |
| **Severity**  | 🟠 High (UX)                               |
| **Verified**  | ✅ Confirmed in code                       |
| **File**      | `src/documentdb/ClustersClient.ts:155-157` |

**Evidence:** `_databasesCache` and `_collectionsCache` are populated on first `listDatabases(useCached:true)` / `listCollections(useCached:true)` call. However, `createCollection()`, `createDatabase()`, `deleteDatabase()`, `deleteCollection()` commands **do not invalidate** these caches. Users see stale entries in autocomplete and tree views until reconnect.

**Design context:** SchemaStore invalidation was implemented properly (planning doc 6.1), but ClustersClient caching is newer and invalidation was not wired in.

**Proposed Solutions:**

<details>
<summary><b>Option A: Add invalidation methods and call from CRUD commands (Recommended)</b></summary>

Add `clearDatabasesCache()` and `clearCollectionsCache(dbName?)` methods, call them from create/delete commands.

| Pros                                             | Cons                                        |
| ------------------------------------------------ | ------------------------------------------- |
| Precise invalidation                             | Need to add calls in multiple command files |
| No unnecessary round-trips                       | None                                        |
| Follows existing pattern (SchemaStore does this) | None                                        |

</details>

<details>
<summary><b>Option B: Always bypass cache with `useCached: false` after mutations</b></summary>

After any create/delete, force the next list call to refresh.

| Pros              | Cons                                                   |
| ----------------- | ------------------------------------------------------ |
| No new API needed | Caller must know to pass `useCached: false`            |
| None              | Cache stays stale until specific callers force refresh |
| None              | Inconsistent UX across surfaces                        |

</details>

**RESOLVED:** Option A was selected (cache invalidation in CRUD methods). `dropCollection`/`createCollection` clear collections cache, `dropDatabase`/`createDatabase` clear databases cache. Commit: 78d719f

---

### H5. SchemaStore Unbounded Growth

| Field         | Value                              |
| ------------- | ---------------------------------- |
| **Reporters** | Claude (H5), Gemini                |
| **Severity**  | 🟡 Medium (was High, downgraded)   |
| **Verified**  | ✅ Confirmed — no eviction policy  |
| **File**      | `src/documentdb/SchemaStore.ts:49` |

**Evidence:** The `_analyzers` Map grows without bound. However, cleanup does exist when connections are explicitly removed (`clearCluster()`, `clearDatabase()`). The issue only manifests for power users with many open connections over long sessions.

**Design context:** Planning doc 6.1 explicitly describes the accumulation model as intentional ("knowledge only grows"). Schema persistence across sessions was listed as P2 future work. An eviction policy was not discussed.

**Proposed Solutions:**

<details>
<summary><b>Option A: Add LRU eviction with configurable limit (Recommended for future)</b></summary>

| Pros                      | Cons                              |
| ------------------------- | --------------------------------- |
| Prevents unbounded growth | Additional complexity             |
| Configurable per user     | Need to pick a reasonable default |
| None                      | Evicted schemas require re-scan   |

</details>

<details>
<summary><b>Option B: Defer — document as known limitation</b></summary>

| Pros                                 | Cons                         |
| ------------------------------------ | ---------------------------- |
| No code change needed                | Risk remains for power users |
| Matches planning docs' stated intent | None                         |
| None                                 | None                         |

</details>

**RESOLVED:** Option B was selected (known limitation). Schema accumulation is intentional per planning doc 6.1. Unbounded growth only affects power users with many connections over long sessions.

---

## 🟡 Medium Severity Issues

---

### M1. Interrupt/Evaluate Race Condition in Shell PTY

| Field         | Value                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| **Reporters** | Claude (C4), GPT (Finding 3)                                                   |
| **Severity**  | 🟡 Medium (was Critical in some reviews, downgraded after verification)        |
| **Verified**  | ⚠️ Partially confirmed — race exists but mitigated by JS single-threaded model |
| **File**      | `src/documentdb/shell/DocumentDBShellPty.ts:205-245, 388-407`                  |

**Evidence:** Both `handleInterrupt()` and the `handleLineInput()` finally block manipulate `_evaluating`, `_interrupted`, and `_inputHandler.setEnabled()`. However:

- Both run on the **same JavaScript event loop thread** — they can't execute simultaneously
- `handleInterrupt()` sets `_interrupted = true` **synchronously** before the next await point in `handleLineInput()`
- The finally block correctly checks `if (!this._interrupted)` before showing a duplicate prompt

**However**, there IS a timing window: after `handleInterrupt()` shows a new prompt and re-enables input, a user can type a new command and submit it. The old `evaluateInput()` promise (killed worker) will reject, and its finally block may interfere with the new command's state.

**Design context:** Planning doc Step 8 discusses the PTY architecture but doesn't address interrupt edge cases. The Ctrl+C test only covers "idle" state.

**Proposed Solutions:**

<details>
<summary><b>Option A: Generation/token-based evaluation tracking (Recommended)</b></summary>

Assign a unique generation token to each evaluation. The finally block ignores stale tokens.

| Pros                                  | Cons                         |
| ------------------------------------- | ---------------------------- |
| Eliminates stale cleanup interference | Slightly more state to track |
| Per-evaluation isolation              | None                         |
| None                                  | None                         |

```typescript
private _evalGeneration = 0;

private async handleLineInput(line: string) {
    const myGeneration = ++this._evalGeneration;
    try {
        await this.evaluateInput(trimmed);
    } finally {
        if (this._evalGeneration === myGeneration) {
            // This evaluation is still current, safe to update state
        }
    }
}
```

</details>

<details>
<summary><b>Option B: Accept as-is with better test coverage</b></summary>

The single-threaded model makes the worst outcomes unlikely. Add TDD tests for the edge case.

| Pros                         | Cons                                   |
| ---------------------------- | -------------------------------------- |
| No code change               | Rare duplicate prompt possible         |
| Risk is very low in practice | None                                   |
| None                         | Doesn't eliminate the theoretical race |

</details>

**Test gap:** Add a TDD contract: "Ctrl+C during evaluation, then immediately submit another command, must not produce duplicate prompts."

**REVISITED:** The option to revisit after progress animation changes was selected. After reviewing the current code with spinner/progress animation changes, the race condition is now well-mitigated:
- `handleInterrupt()` sets `_interrupted = true` synchronously and kills the worker. The `finally` block in `handleLineInput()` checks `!this._interrupted` and skips duplicate prompt/state cleanup.
- The spinner is null-checked (`_spinner?.stop()`) so both paths safely stop it.
- `_evaluating` is set to `false` by the interrupt handler *before* the `finally` block runs, so no conflicting state.
- The `_interrupted` flag is reset to `false` at the end of `finally`, which is after the old evaluation's cleanup — by then, any new command from re-enabled input processes in a separate async event loop turn.

The theoretical window (stale `finally` interfering with new command state) is prevented by the `_interrupted` guard. The generation-token approach would add defense-in-depth but is not strictly necessary given the current guards. **Leaving as-is; can add generation tokens as a hardening pass if needed.**

---

### M2. No Shell Initialization Timeout

| Field         | Value                                                 |
| ------------- | ----------------------------------------------------- |
| **Reporters** | Claude (M3)                                           |
| **Severity**  | 🟡 Medium                                             |
| **Verified**  | ✅ Confirmed in code                                  |
| **File**      | `src/documentdb/shell/ShellSessionManager.ts:138-156` |

**Evidence:** `initialize()` calls `ensureWorker()` without a timeout. If the worker fails to spawn or the connection hangs, the shell tab hangs indefinitely. Unlike `evaluate()` which has a `timeoutMs` parameter, initialization has no timeout protection.

**Design context:** Planning doc Step 8 specifies timeouts for evaluation but not for initialization.

**Proposed Solutions:**

<details>
<summary><b>Option A: Add initialization timeout (Recommended)</b></summary>

Wrap `initialize()` with a `Promise.race()` against a timeout.

| Pros                                | Cons                                     |
| ----------------------------------- | ---------------------------------------- |
| Prevents indefinite hangs           | Need to choose a sensible default (30s?) |
| Consistent with evaluate() behavior | None                                     |
| None                                | None                                     |

</details>

<details>
<summary><b>Option B: Rely on the worker spawn timeout already in Node.js</b></summary>

| Pros           | Cons                                                |
| -------------- | --------------------------------------------------- |
| No code change | Node.js doesn't have a default worker spawn timeout |
| None           | Connection hangs won't be caught                    |
| None           | User sees an indefinitely spinning tab              |

</details>

**RESOLVED:** Option A was selected (initialization timeout, configurable via settings). Added `documentDB.shell.initTimeout` setting (default: 60s). Commit: 8c3b760

---

### M3. Playground Diagnostics: No Debouncing (O(n) per Keystroke)

| Field         | Value                                                      |
| ------------- | ---------------------------------------------------------- |
| **Reporters** | Claude (M12)                                               |
| **Severity**  | 🟡 Medium                                                  |
| **Verified**  | ✅ Confirmed — NO debouncing at all                        |
| **File**      | `src/documentdb/playground/PlaygroundDiagnostics.ts:35-45` |

**Evidence:** `onDidChangeTextDocument` calls `analyzeDocument()` directly on every keystroke. The method performs a full regex scan and comment-range parsing of the entire document. No debouncing, no throttling.

For small files this is unnoticeable. For large playground files (1000+ lines), every keystroke triggers an O(n) scan that could cause perceptible lag.

**Design context:** Not discussed in planning docs.

**Proposed Solutions:**

<details>
<summary><b>Option A: Add debounce (300ms) on change handler (Recommended)</b></summary>

| Pros                                                                            | Cons                                  |
| ------------------------------------------------------------------------------- | ------------------------------------- |
| Standard pattern used elsewhere in the extension (SchemaStore uses 1s debounce) | 300ms delay before diagnostics update |
| Eliminates keystroke-driven performance issues                                  | None                                  |
| None                                                                            | None                                  |

</details>

<details>
<summary><b>Option B: Defer — unlikely to matter for typical playground sizes</b></summary>

| Pros           | Cons                                      |
| -------------- | ----------------------------------------- |
| No code change | Performance will degrade with large files |
| None           | None                                      |
| None           | None                                      |

</details>

**RESOLVED:** Option A was selected (300ms debounce). Added `debouncedAnalyze()` method to `PlaygroundDiagnostics`. Commit: 20f608c

---

### M4. `scanCollectionSchema` Leaves Stale Schema on Empty Collection

| Field         | Value                                                   |
| ------------- | ------------------------------------------------------- |
| **Reporters** | Claude (M4), Gemini (Schema Accumulation)               |
| **Severity**  | 🟡 Medium (UX)                                          |
| **Verified**  | ✅ Confirmed — stale schema persists                    |
| **File**      | `src/commands/playground/scanCollectionSchema.ts:27-45` |

**Evidence:** When a collection is empty, the command shows a warning and returns — but does NOT clear existing stale schema data from `SchemaStore`. Additionally, when `validDocs.length === 0` (all sampled docs lack `_id`), the function returns silently with no message at all.

**Design context:** Planning doc 6.1 describes the monotonic accumulation model ("knowledge only grows") as intentional. However, the `scanCollectionSchema` command should arguably provide a "fresh scan" experience since the user explicitly triggered it.

**Proposed Solutions:**

<details>
<summary><b>Option A: Clear schema before scanning (Recommended)</b></summary>

Make `scanCollectionSchema` clear the existing schema for that collection, then add the new sample. This gives users a predictable "fresh scan" experience.

| Pros                                             | Cons                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| Predictable behavior — user gets fresh schema    | Loses accumulated knowledge from previous scans |
| Matches user mental model of "rescan"            | Conflicts with monotonic accumulation design    |
| Simple implementation — one `clearSchema()` call | None                                            |

</details>

<details>
<summary><b>Option B: Add a "Clear Schema" command separately</b></summary>

Keep scan as accumulative, add explicit "Clear Collection Schema" to context menu.

| Pros                                 | Cons                               |
| ------------------------------------ | ---------------------------------- |
| Preserves accumulation behavior      | User must discover the new command |
| Gives users an explicit escape hatch | Two commands to do "rescan"        |
| None                                 | None                               |

</details>

**RESOLVED:** Option A was selected (clear schema before scanning). `scanCollectionSchema()` now calls `SchemaStore.clearSchema()` before adding new samples. Commit: 20f608c

---

### M5. `toLocaleString()` in Playground Filename Is Locale-Dependent

| Field         | Value                                            |
| ------------- | ------------------------------------------------ |
| **Reporters** | GPT (Finding 5), Copilot PR reviewer (CP5)       |
| **Severity**  | 🟡 Medium                                        |
| **Verified**  | ✅ Confirmed in code                             |
| **File**      | `src/commands/playground/newPlayground.ts:51-56` |

**Evidence:** `toLocaleString()` produces locale-dependent output (Arabic numerals, RTL marks, locale-specific separators). The regex replacement only handles `/`, `\`, `:`, and `,` — other locale-specific characters pass through untouched.

**Design context:** Not discussed in planning docs.

**Proposed Solutions:**

<details>
<summary><b>Option A: Use toISOString() (Recommended)</b></summary>

```typescript
const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-').replace('T', '_').replace('Z', '');
```

| Pros                                  | Cons                                      |
| ------------------------------------- | ----------------------------------------- |
| Locale-independent, filesystem-safe   | Less human-readable than localized format |
| Deterministic across all environments | None                                      |
| None                                  | None                                      |

</details>

<details>
<summary><b>Option B: Use Intl.DateTimeFormat with explicit locale 'en-US'</b></summary>

| Pros                          | Cons                     |
| ----------------------------- | ------------------------ |
| More readable than ISO format | Hardcodes English locale |
| Predictable output            | None                     |
| None                          | None                     |

</details>

**RESOLVED:** Option A was selected (toISOString). Playground filenames now use locale-independent ISO 8601 format. Commit: d60288b

---

### M6. Missing Credential Display Name in Error Message

| Field         | Value                                                      |
| ------------- | ---------------------------------------------------------- |
| **Reporters** | Claude (M7)                                                |
| **Severity**  | 🟡 Medium (UX)                                             |
| **Verified**  | ✅ Confirmed                                               |
| **File**      | `src/documentdb/playground/PlaygroundEvaluator.ts:189-193` |

**Evidence:** Error message shows internal `clusterId` instead of a human-readable connection display name:

```typescript
throw new Error(l10n.t('No credentials found for cluster {0}', connection.clusterId));
```

The `PlaygroundConnection` type likely has access to a display name via the connection model, but it's not used here.

**Proposed Solutions:**

<details>
<summary><b>Option A: Use connection display name in error (Recommended)</b></summary>

| Pros                                             | Cons                                                         |
| ------------------------------------------------ | ------------------------------------------------------------ |
| User can identify which connection failed        | Need to verify PlaygroundConnection has a display name field |
| Consistent with user-facing error best practices | None                                                         |
| None                                             | None                                                         |

</details>

<details>
<summary><b>Option B: Show both display name and clusterId for debugging</b></summary>

| Pros                         | Cons                             |
| ---------------------------- | -------------------------------- |
| Useful for support scenarios | Longer error message             |
| None                         | May expose internal IDs to users |
| None                         | None                             |

</details>

**RESOLVED:** Option A was selected (use connection display name). Error message now shows `clusterDisplayName` instead of internal `clusterId`. Commit: d1ad9b1

---

### M7. `localeCompare` with Base Sensitivity for Query Cache Keys

| Field         | Value                                   |
| ------------- | --------------------------------------- |
| **Reporters** | Claude (M11)                            |
| **Severity**  | 🟡 Medium                               |
| **Verified**  | ✅ Confirmed at `ClusterSession.ts:160` |
| **File**      | `src/documentdb/ClusterSession.ts:160`  |

**Evidence:**

```typescript
if (previousQueryKey.localeCompare(userQueryKey, undefined, { sensitivity: 'base' }) === 0) {
```

`sensitivity: 'base'` ignores accents and case. A filter with field `café` and one with `cafe` would be treated as the same query, producing incorrect cached results. For JSON/BSON query comparison, strict `===` equality is appropriate.

**Design context:** Not discussed in planning docs. Likely an incorrect API usage.

**Proposed Solutions:**

<details>
<summary><b>Option A: Use strict equality (Recommended)</b></summary>

Replace `localeCompare(...)` with `previousQueryKey === userQueryKey`.

| Pros                                      | Cons                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Semantically correct for query comparison | May cause unnecessary cache misses for whitespace differences (but JSON.stringify normalizes) |
| No locale surprises                       | None                                                                                          |
| None                                      | None                                                                                          |

</details>

**RESOLVED:** Option A was selected (strict equality). Replaced `localeCompare` with `===`. Commit: d60288b

---

### M8. AST Walk Errors Silently Swallowed

| Field         | Value                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| **Reporters** | Claude (M1)                                                               |
| **Severity**  | 🟡 Medium                                                                 |
| **Verified**  | ✅ Confirmed                                                              |
| **File**      | `src/webviews/query-language-support/documentdbQueryValidator.ts:198-230` |

**Evidence:** `walk.simple()` is wrapped in a bare `catch {}` that silently swallows ALL errors, not just `SyntaxError`. Bugs in the walker handlers would produce no diagnostics output and be invisible.

**Proposed Solutions:**

<details>
<summary><b>Option A: Log unexpected errors, only catch SyntaxError silently (Recommended)</b></summary>

```typescript
catch (error) {
    if (!(error instanceof SyntaxError)) {
        console.error('Unexpected error during AST walk:', error);
    }
}
```

| Pros                                   | Cons                        |
| -------------------------------------- | --------------------------- |
| Bugs become visible in developer tools | Slightly more verbose catch |
| SyntaxErrors still handled gracefully  | None                        |
| None                                   | None                        |

</details>

**RESOLVED:** Option A was selected (log unexpected errors). Now logs non-SyntaxError exceptions via `console.error`. Commit: d60288b

---

### M9. Non-Null Assertion Abuse in Shell Runtime Persistent Mode

| Field         | Value                                                                     |
| ------------- | ------------------------------------------------------------------------- |
| **Reporters** | Claude (C5)                                                               |
| **Severity**  | 🟡 Medium (was Critical, downgraded)                                      |
| **Verified**  | ✅ Confirmed — `!` assertions used                                        |
| **File**      | `packages/documentdb-shell-runtime/src/DocumentDBShellRuntime.ts:197-226` |

**Evidence:** Multiple `!` assertions on `_persistentInstanceState!`, `_persistentEvaluator!`, `_persistentVmContext!`. If initialization partially fails (e.g., error between assigning `_persistentInstanceState` and setting `_persistentInitialized = true`), retry would use incomplete state.

**Design context:** Per copilot-instructions.md, `nonNullProp()` should be used instead. The persistent mode architecture was designed in Step 6.2.

**Proposed Solutions:**

<details>
<summary><b>Option A: Consolidate into single compound object (Recommended)</b></summary>

```typescript
private _persistent: {
    instanceState: ShellInstanceState;
    evaluator: ShellEvaluator;
    vmContext: vm.Context;
} | undefined;
```

| Pros                                   | Cons           |
| -------------------------------------- | -------------- |
| Eliminates partial initialization risk | Minor refactor |
| No individual `!` assertions needed    | None           |
| Follows codebase conventions           | None           |

</details>

**RESOLVED:** Option A was selected (single compound object). Replaced four nullable fields + flag with `_persistent?: { instanceState, evaluator, context, vmContext }`. Commit: c6d0558

---

### M10. Inconsistent Parameter Naming: `clusterId` vs `credentialId`

| Field         | Value                                  |
| ------------- | -------------------------------------- |
| **Reporters** | Copilot PR reviewer (CP2)              |
| **Severity**  | 🟡 Medium (Code Quality)               |
| **Verified**  | ✅ Confirmed                           |
| **File**      | `src/documentdb/ClustersClient.ts:431` |

**Evidence:** `getExistingClient(clusterId)` uses `clusterId` naming while other methods use `credentialId` for the same map key. Per copilot-instructions.md, `clusterId` is the correct stable key.

**Proposed Solutions:**

<details>
<summary><b>Option A: Unify all parameter names to `clusterId` (Recommended)</b></summary>

| Pros                                     | Cons                             |
| ---------------------------------------- | -------------------------------- |
| Consistent with copilot-instructions.md  | Rename touch in multiple methods |
| Eliminates confusion about key semantics | None                             |
| None                                     | None                             |

</details>

**INVESTIGATED:** Per copilot-instructions.md, `clusterId` is the correct name for cache keys. `CredentialCache.ts` consistently uses `clusterId` (10+ methods). `ClustersClient.ts` has 2 methods (`exists`, `deleteClient`) using `credentialId` while 2 others (`getClient`, `getExistingClient`) correctly use `clusterId`. This is a naming inconsistency, not a functional bug. Created GitHub issue #567 for the rename.

---

### M11. Shell Input: Bare `\n` (Unix) Silently Dropped on Paste

| Field         | Value                                               |
| ------------- | --------------------------------------------------- |
| **Reporters** | Gemini (Multi-line input), verified in detail       |
| **Severity**  | 🟡 Medium (UX)                                      |
| **Verified**  | ✅ Confirmed                                        |
| **File**      | `src/documentdb/shell/ShellInputHandler.ts:117-172` |

**Evidence:** `processCharacter()` only handles `\r` (0x0D) as Enter. `\n` (0x0A) is < `0x20` (space) so it fails the `if (ch >= ' ')` check and is **silently dropped**. Pasted text with Unix line endings loses all newlines — everything becomes one concatenated line.

**Design context:** Planning doc Step 8 acknowledges multi-line input as future work. However, the silent dropping of newlines in pasted text is worse than expected — it corrupts the pasted content rather than processing it as a single command.

**Proposed Solutions:**

<details>
<summary><b>Option A: Treat `\n` as `\r` (Enter) (Recommended for now)</b></summary>

Map newlines to Enter, executing each pasted line sequentially.

| Pros                                           | Cons                                               |
| ---------------------------------------------- | -------------------------------------------------- |
| Pasted multi-line scripts execute line by line | Multi-line constructs (functions) still won't work |
| Matches user expectation from other shells     | None                                               |
| Simple one-line fix                            | None                                               |

</details>

<details>
<summary><b>Option B: Queue pasted lines and execute sequentially</b></summary>

| Pros                                    | Cons                             |
| --------------------------------------- | -------------------------------- |
| Better control over execution order     | More complex implementation      |
| Can add confirmation for multiple lines | User might not want confirmation |
| None                                    | None                             |

</details>

**DEFERRED:** Multi-line support needs to be revisited in general; there are other related issues. Created GitHub issue #569 (assigned to milestone 0.8.0) to track multi-line input support including paste handling, interactive continuation prompts, and bracket matching.

---

### M12. Word Navigation Only Uses Space as Delimiter

| Field         | Value                                               |
| ------------- | --------------------------------------------------- |
| **Reporters** | Claude (M10), Gemini                                |
| **Severity**  | 🟢 Low (UX polish)                                  |
| **Verified**  | ✅ Confirmed                                        |
| **File**      | `src/documentdb/shell/ShellInputHandler.ts:292-310` |

**Evidence:** Ctrl+Left/Right only uses space as word boundary. `db.collection.find()` requires multiple Ctrl+Left presses.

**Design context:** Planning doc Step 8 lists shell UX polish items as P3 future work.

**Proposed Solutions:**

<details>
<summary><b>Option A: Use regex word boundaries (Recommended)</b></summary>

Replace space check with `/\b/` or common separator set (`.`, `_`, `-`, `(`, `)`).

| Pros                                 | Cons                                   |
| ------------------------------------ | -------------------------------------- |
| Matches common shell/editor behavior | Slightly different from some terminals |
| More efficient navigation            | None                                   |
| None                                 | None                                   |

</details>

**RESOLVED:** Option A was selected (regex word boundaries). Word navigation now uses `[a-zA-Z0-9_$]` pattern. Commit: 2a0f689

---

## 🟢 Low Severity Issues

---

### L1. `HELP_PATTERN` Regex Matches Multi-line Tagged Templates

| Field         | Value                                                            |
| ------------- | ---------------------------------------------------------------- |
| **Reporters** | Claude (M9)                                                      |
| **Severity**  | 🟢 Low                                                           |
| **Verified**  | ✅ Confirmed                                                     |
| **File**      | `packages/documentdb-shell-runtime/src/CommandInterceptor.ts:24` |

**Analysis:** `` help`\ndb.dropDatabase()` `` would be intercepted as help instead of evaluated. However, this is an extremely unlikely user input pattern. **No action needed** unless reported.

**IGNORED:** Extremely unlikely edge case. Multi-line execution will be addressed holistically in issue #569 (milestone 0.8.0).

---

### L2. Playground Diagnostics `.toArray()` Check Doesn't Exclude Comments

| Field         | Value                                                      |
| ------------- | ---------------------------------------------------------- |
| **Reporters** | Claude (M5)                                                |
| **Severity**  | 🟢 Low                                                     |
| **Verified**  | ✅ Confirmed — crude string check                          |
| **File**      | `src/documentdb/playground/PlaygroundDiagnostics.ts:83-84` |

**Analysis:** `lineText.includes('.toArray()')` would suppress the warning if `.toArray()` appears in a comment on the same line. Edge case, unlikely to confuse users.

**IGNORED:** Non-critical edge case — the warning is about `.limit()` exceeding batch size, and false suppression from a comment is harmless.

---

### L3. Unsafe Array Index Access in registerLanguage.ts

| Field         | Value                                                         |
| ------------- | ------------------------------------------------------------- |
| **Reporters** | Claude (M2)                                                   |
| **Severity**  | 🟢 Low                                                        |
| **Verified**  | ⚠️ Works accidentally — `lineContent[-1]` returns `undefined` |
| **File**      | `src/webviews/query-language-support/registerLanguage.ts:116` |

**Analysis:** When `wordInfo.startColumn = 1`, `lineContent[-1]` returns `undefined`, which is `!== '$'`, so the code works. But it relies on JavaScript's undefined array access — fragile.

**RESOLVED:** Added explicit bounds check (`charBeforeIndex >= 0`) instead of relying on undefined array access. Commit: 3a47dbb

---

### L4. Various Minor Items (Previously Enumerated)

The following items from the original review are confirmed as low-severity and can be deferred:

- **L1 (original):** Token error loses root cause type — missing error code
- **L2 (original):** Triple-fallback EJSON→JSON→string without logging
- **L3 (original):** History off-by-one (temporary `_maxHistory + 1` entries)
- **L4 (original):** `randomSample` safe but confusing when `count > array.length`
- **L5 (original):** Levenshtein distance not cached (acceptable for small inputs)
- **L6 (original):** Terminal resize not handled (no multi-line editing yet)
- **L7 (original):** Unused `standalone` field in operator entries — **false positive**, field is actively used in 12 locations

**RESOLVED (partial):** Fixed `randomSample` to clamp `count` to `array.length` (L4 original). History off-by-one (L3 original) is actually correct — temporary overshoot of 1 entry is immediately trimmed. Other items deferred as acceptable.

---

## Issues from External Reviews: Dismissed After Verification

### ❌ H1 (original): Unbounded Input Buffer — FALSE POSITIVE

The `_buffer` field in `ShellInputHandler` is per-line, reset on each Enter press via `resetLine()`. It does not accumulate across the session. A single-line paste would be bounded by terminal IO throughput. **Not a real issue.**

### ❌ H3 (original): Double-Click Timer Leaks — FALSE POSITIVE

The timer in `registerDoubleClickCommand` properly self-clears via `pendingTimer = undefined` when timeout fires, and is cleared via `clearTimeout()` on second click. **No leak.**

### ❌ H4 (original): Playground Result Content Leak — FALSE POSITIVE

Result content in `PlaygroundResultProvider` is properly cleaned up via `onDidCloseTextDocument` listener which calls `_contents.delete()`. **Not a leak.**

### ❌ H6 (original): Connection Race During Query — FALSE POSITIVE

Connection is validated synchronously at function entry in `executePlaygroundCode.ts` before any async operations. **No race.**

### ⚠️ GPT-3/C4: Ctrl+C Race — DOWNGRADED

The `_interrupted` flag is set synchronously, and both paths run on the same JS event loop thread. The race is theoretical (stale finally-block after worker kill), not a practical crash risk. **Downgraded to Medium.**

### ⚠️ H2 (original): No Output Size Limit — DOWNGRADED

`EJSON.stringify` has no limit, but output goes to a terminal which has its own rendering constraints. Risk is low in practice. **Downgraded to Low, backlog item.**

---

## Known Limitations vs. Findings

Several review findings align with **intentionally deferred items** documented in `docs/ai-and-plans/`:

| Finding                               | Planning Decision                                                             | Status                     |
| ------------------------------------- | ----------------------------------------------------------------------------- | -------------------------- |
| No multi-line input (Gemini)          | Step 8: "Reserved for future multi-line wrapping support"                     | ✅ Known (P3 future work)  |
| No tab completion (Gemini)            | Blocked by VS Code `TerminalCompletionProvider` API (proposed, not finalized) | ✅ Known (blocked)         |
| Schema accumulation/no reset (Gemini) | Step 6.1: "Knowledge only grows" — intentional trade-off                      | ✅ Known (design decision) |
| No aggregation completions            | Step 7: "Intentional scope boundary; deliverable separately"                  | ✅ Known (P1 future work)  |
| Single global connection (Gemini)     | Step 6: Deferred as P2, requires PlaygroundService refactor                   | ✅ Known (P2 future work)  |

These are **not bugs** — they are documented scope decisions and don't need to be addressed in this PR.

---

## TDD Contract Recommendations

> **Deferred:** These TDD contracts are pushed back to a dedicated testing iteration where we will also add integration tests. Integration tests are still missing and have higher priority — they will be addressed first before adding granular TDD contracts for individual fixes.

Based on this review, the following new TDD contracts would add the most protection:

### Priority 1: Critical Behavioral Contracts

1. **Projection/sort type validation**: Non-object values (scalars, arrays) must be rejected before reaching the driver
2. **Connection removal → playground disconnection**: Removing the active connection must trigger `PlaygroundService.clearConnection()`
3. **Ctrl+C then immediate new input**: Must not produce duplicate prompts or stale cleanup side effects

### Priority 2: Data Quality Contracts

4. **Update operator descriptions**: A curated set of high-risk operators must NOT reference "accumulator" or "aggregation stage" in descriptions
5. **Cache invalidation**: After `createCollection` / `deleteCollection`, `listCollections(useCached: true)` must return updated data

### Priority 3: Lifecycle Contracts

6. **Shell initialization timeout**: Initialize must complete or throw within a configurable timeout
7. **Fresh mode cleanup**: `evaluateFresh()` must not leak resources between runs

---

## Summary: Action Priority

| Priority | Issue                                              | Effort      |
| -------- | -------------------------------------------------- | ----------- |
| 🔴 P0    | C1: Silent failures — add warning messages         | 30 min      |
| 🔴 P0    | C2: Shell init race — add promise lock             | 30 min      |
| 🔴 P0    | C3: Fresh mode resource leak — add finally cleanup | 30 min      |
| 🟠 P1    | H1: Remove connection → clear playground           | 15 min      |
| 🟠 P1    | H2: parseShellBSON type validation                 | 30 min      |
| 🟠 P1    | H3: Update operator descriptions — fix overrides   | 1 hr        |
| 🟠 P1    | H4: ClustersClient cache invalidation              | 1 hr        |
| 🟡 P2    | M1: Interrupt race — generation tokens             | 30 min      |
| 🟡 P2    | M3: Playground diagnostics debouncing              | 15 min      |
| 🟡 P2    | M5: toLocaleString → toISOString                   | 10 min      |
| 🟡 P2    | M7: localeCompare → strict equality                | 5 min       |
| 🟡 P2    | M11: Handle `\n` in pasted input                   | 10 min      |
| 🟡 P3    | M2: Shell init timeout                             | 15 min      |
| 🟡 P3    | M4: Schema scan clear-before-scan                  | 15 min      |
| 🟡 P3    | M6/M8/M9/M10: Minor fixes                          | 30 min each |

---

## Positive Highlights

1. **Zero `any` types** across the entire PR — exceptional TypeScript discipline
2. **Worker isolation architecture** is well-designed: separate threads for eval, IPC with typed messages, UUID-based request correlation
3. **Legacy cleanup is thorough** — no dangling references to removed scrapbook/ANTLR code
4. **Completion data pipeline** is elegant: `documentdb-constants` → CompletionStore → CompletionItemProvider with URI-based routing
5. **Schema sharing** via `SchemaStore` singleton with debounced notifications is a solid pattern
6. **Credential handling** is secure — credentials never logged, tokens requested via VS Code auth API
7. **EJSON serialization** across worker boundary preserves BSON types correctly
8. **Structural invariant tests** for operator data prevent silent data corruption
9. **Worker termination** is robust — traced 3 shutdown paths (close, Ctrl+C, timeout) all correctly terminate
10. **Snippet session cancellation** in QueryEditor prevents the "ghost selection" bug
