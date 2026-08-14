# Multi-Connection Playgrounds — Pre-Review: Corner Cases

> Review of [multi-connection-playgrounds.md](multi-connection-playgrounds.md) plan vs implementation.
> Focus: connection failures, worker crashes, recovery paths.

## Recovery Model Summary

The connection metadata (`PlaygroundConnection`: clusterId, clusterDisplayName, databaseName) is stored in `PlaygroundService._connections` keyed by document URI. This map is **independent** of the worker lifecycle — worker crashes, timeouts, and network errors do **not** remove the connection. The connection is only removed when the document itself is closed (`onDidCloseTextDocument`).

This means that for most failure scenarios, the user simply re-runs and a fresh worker spawns automatically. The system is more resilient than it first appears.

---

## Issues

### HIGH Severity

#### 1. `shutdownOrphanedEvaluators()` can kill a running worker

**Trigger:** User closes the last playground tab for a cluster while execution is in progress.

**Sequence:**

1. `onDidCloseTextDocument` fires → removes connection from `PlaygroundService._connections`
2. `onDidChangeTabs` fires → `shutdownOrphanedEvaluators()` finds no active playgrounds for that cluster
3. Evaluator receives `shutdown()` → worker is terminated (5s graceful, then force-kill)
4. The pending `evaluate()` promise rejects with "Worker terminated" or "Worker exited unexpectedly"
5. `finally` block in `executePlaygroundCode` resets `isExecuting` → system is **not** stuck

**Impact:** The execution errors cleanly, but the error message is generic ("Worker exited unexpectedly"). The user has no indication they caused it by closing the tab. The result panel may or may not still be visible.

**Mitigation idea:** `shutdownOrphanedEvaluators()` could skip evaluators whose `workerState === 'executing'` and defer cleanup to after the execution completes.

---

### MEDIUM Severity

#### 2. Global `isExecuting` blocks all playgrounds across all clusters

**Code:** `executePlaygroundCode.ts` lines 93-96 — when one playground is executing, all others are blocked with "A playground is already running."

**Impact:** The core value proposition of multi-connection playgrounds is running against different clusters. But a slow operation on Cluster A blocks the user from running anything on Cluster B for up to 30 seconds (the default timeout). Combined with the timeout behavior (issue #3), this can be frustrating.

**Plan acknowledgment:** The plan documents this as intentional ("Decision: kept global `isExecuting` — simpler, prevents resource exhaustion"). This is a reasonable v1 tradeoff but worth revisiting if users report friction.

---

#### 3. Timeout kills the worker — no distinction between "slow query" and "infinite loop"

**Trigger:** Any operation exceeding `documentDB.shell.timeout` (default 30s).

**Behavior:**

1. `WorkerSessionManager.sendRequest()` timeout fires
2. `killWorker()` terminates the worker immediately
3. User sees `SettingsHintError` with link to increase timeout
4. **On next run: worker respawns, re-authenticates, and re-connects** (auto-recovery works)

**Impact:** For legitimate slow operations (large aggregations, cross-shard queries), the user must:

1. Increase the timeout setting
2. Re-run (worker respawns automatically)

The MongoDB server-side operation may continue running even after the worker is killed. There is no `killOp` or similar cleanup.

**Not an issue for recovery:** The connection metadata survives; re-running works. The issue is purely about server-side operation cleanup and the UX of having to adjust settings.

PROMPT: this is fine.
the playground shows the message about a timeout, but the message in the shell output is more helpufl, attempt to say more about the settings, or even, if possible, offer simiar link to the settigns as we do in the shell.

---

#### 4. Saved `.documentdb.js` files lose their connection on reopen

**Trigger:** User saves a playground file, closes it, then reopens it (or reopens across VS Code sessions).

**Behavior:** The `PlaygroundService._connections` map is in-memory only. On reopen, the file loads from disk with all content intact but shows "Not connected." The header comment (e.g. `// Connected to MyCluster / mydb`) is the only record of which connection was used.

**Impact:** The user must create a new playground from the tree panel and copy their code over. For untitled documents, once closed, they're gone entirely (VS Code behavior).

**Mitigation idea:** Persist the connection metadata (clusterId + databaseName) in the document's header comment or in workspace state, and attempt to restore it on reopen.

PROMPT: not now. create an issue for the future as enhancement

---

#### 5. Worker `error` event logged but doesn't reject pending requests

**Code:** `WorkerSessionManager.ts` line 211 — `this._worker.on('error', ...)` only logs.

**Behavior:** If a worker emits an `error` event **without** immediately exiting (possible in some Node.js edge cases), the pending eval request will hang until the eval timeout fires (up to 30s). The `exit` handler does properly reject all pending requests, but `error` alone doesn't.

**Impact:** In practice, most worker errors are followed by an exit event, so this is low-probability. When it does happen, the timeout catches it — just with a misleading "timed out" message instead of the actual error.

**Fix:** Add `entry.reject(error)` for all pending requests in the `error` handler, similar to `handleWorkerExit()`.

---

### LOW Severity

#### 6. Uncaught exceptions in worker are not surfaced to the user

**Code:** `playgroundWorker.ts` lines 349-358 — `process.on('uncaughtException')` logs to the output channel but doesn't send the error back to the main thread.

**Behavior:** The worker crashes after the uncaught exception. The main thread sees "Worker exited unexpectedly" instead of the actual exception. The root cause is only visible in the "DocumentDB Query Playground Output" channel.

**Impact:** Makes debugging harder. The user sees a generic error and has no idea what went wrong without checking the output channel.

**Fix:** Before logging, send an `evalError` message to the parent port with the exception details, then let the worker exit.

---

#### 7. No connection health check between runs

**Behavior:** Once a worker is in `ready` state, there's no heartbeat. If the MongoDB server goes down between runs, the user discovers this only on the next Run attempt (which fails with a driver timeout, then the worker respawns on the subsequent run).

**Impact:** No proactive "connection lost" indicator. The CodeLens still shows `$(plug) ClusterName / DatabaseName` even if the server is unreachable. Minor UX issue — the second run after the failure succeeds (fresh worker).

PROMPT: yes, ignore.

---

#### 8. Duplicate evaluator race window (theoretical)

**Code:** `executePlaygroundCode.ts` lines 106-110 — `evaluators.get()` / `evaluators.set()` without synchronization.

**Behavior:** If the global `isExecuting` guard were ever removed to enable concurrent runs (issue #2), two rapid runs on the same cluster could create duplicate evaluators before the first `set()` completes.

**Impact:** Purely theoretical today since `isExecuting` prevents concurrent execution. Documenting for future-proofing.

PROMPT: ignore

---

## Summary

| #   | Issue                                        | Severity   | Auto-recoverable?                       |
| --- | -------------------------------------------- | ---------- | --------------------------------------- |
| 1   | Orphan cleanup kills running worker          | **HIGH**   | Errors cleanly but confusing            |
| 2   | Global `isExecuting` blocks all clusters     | **MEDIUM** | N/A — design tradeoff                   |
| 3   | Timeout kills worker, no server-side cleanup | **MEDIUM** | Yes — worker respawns on next run       |
| 4   | Saved files reopen without connection        | **MEDIUM** | No — connection not persisted           |
| 5   | Worker `error` event doesn't reject pending  | **MEDIUM** | Timeout catches it (delayed)            |
| 6   | Uncaught exceptions not surfaced             | **LOW**    | Worker respawns; info in output channel |
| 7   | No health check between runs                 | **LOW**    | Failure-then-respawn on next run        |
| 8   | Duplicate evaluator race (theoretical)       | **LOW**    | Guarded by `isExecuting` today          |

---

## Copilot Reviewer Comments (PR #583)

All 4 threads are **open/unresolved**.

### CR-1. Result routing uses `activeTextEditor` instead of `documentUri` — cross-document contamination (HIGH)

**File:** `src/commands/playground/executePlaygroundCode.ts` line 142
**Thread:** [PRRT_kwDOODtcO857MYPB](https://github.com/microsoft/vscode-documentdb/pull/583#pullrequestreview-thread-PRRT_kwDOODtcO857MYPB)

`executePlaygroundCode` accepts `documentUri` but then reads `sourceUri` from `vscode.window.activeTextEditor?.document.uri`. If the user switches editors while a run is in progress, results are written to the wrong playground.

```typescript
// Current (line 142):
const sourceUri = vscode.window.activeTextEditor?.document.uri;

// Should be:
const sourceUri = documentUri;
```

**Verdict:** Valid bug. The `documentUri` parameter exists for exactly this purpose. Simple fix.

---

### CR-2. `CollectionNameCache` warming comment is misleading (LOW)

**File:** `src/documentdb/query-language/playground-completions/CollectionNameCache.ts`
**Thread:** [PRRT_kwDOODtcO857MYPq](https://github.com/microsoft/vscode-documentdb/pull/583#pullrequestreview-thread-PRRT_kwDOODtcO857MYPq)

Comment says cache is warmed "for all connected databases" but implementation only warms the active editor's connection. Either update the comment or iterate all playground connections.

**Verdict:** Valid — comment/code mismatch. Updating the comment is the minimal fix; iterating all connections would be a nice-to-have but not required for correctness.

---

### CR-3. `ShellTerminalInfo` should use string-literal union types (LOW)

**File:** `src/documentdb/shell/ShellTerminalLinkProvider.ts`
**Thread:** [PRRT_kwDOODtcO857MYP8](https://github.com/microsoft/vscode-documentdb/pull/583#pullrequestreview-thread-PRRT_kwDOODtcO857MYP8)

`workerState` and `authMethod` are typed as `string` / `string | undefined` instead of literal unions. Suggestion to use `'idle' | 'spawning' | 'ready' | 'executing'` and `'NativeAuth' | 'MicrosoftEntraID' | undefined`.

**Verdict:** Good hygiene suggestion. Low impact — these fields are only used in debug stats display. Worth doing but not a bug.

PROMPT: yes

---

### CR-4. Missing test for `onDidCloseTextDocument` cleanup path (MEDIUM)

**File:** `src/documentdb/playground/PlaygroundService.ts`
**Thread:** [PRRT_kwDOODtcO857MYQR](https://github.com/microsoft/vscode-documentdb/pull/583#pullrequestreview-thread-PRRT_kwDOODtcO857MYQR)

`PlaygroundService` relies on `onDidCloseTextDocument` to remove per-document connections, but no test covers this cleanup path. Should verify the connection is removed and `onDidChangeState` fires.

**Verdict:** Valid — this is a critical code path (the only way connections are cleaned up) and should have test coverage.

---

## Combined Summary

| #    | Source  | Issue                                        | Severity   | Auto-recoverable?                       |
| ---- | ------- | -------------------------------------------- | ---------- | --------------------------------------- |
| 1    | Review  | Orphan cleanup kills running worker          | **HIGH**   | Errors cleanly but confusing            |
| CR-1 | Copilot | `activeTextEditor` result routing bug        | **HIGH**   | No — results go to wrong panel          |
| 2    | Review  | Global `isExecuting` blocks all clusters     | **MEDIUM** | N/A — design tradeoff                   |
| 3    | Review  | Timeout kills worker, no server-side cleanup | **MEDIUM** | Yes — worker respawns on next run       |
| 4    | Review  | Saved files reopen without connection        | **MEDIUM** | No — connection not persisted           |
| 5    | Review  | Worker `error` event doesn't reject pending  | **MEDIUM** | Timeout catches it (delayed)            |
| CR-4 | Copilot | Missing test for document close cleanup      | **MEDIUM** | N/A — test coverage gap                 |
| 6    | Review  | Uncaught exceptions not surfaced             | **LOW**    | Worker respawns; info in output channel |
| 7    | Review  | No health check between runs                 | **LOW**    | Failure-then-respawn on next run        |
| 8    | Review  | Duplicate evaluator race (theoretical)       | **LOW**    | Guarded by `isExecuting` today          |
| CR-2 | Copilot | Cache warming comment mismatch               | **LOW**    | N/A — misleading comment                |
| CR-3 | Copilot | `ShellTerminalInfo` string types             | **LOW**    | N/A — type hygiene                      |

## Key Architectural Strength

The separation of `PlaygroundConnection` (metadata, survives all errors) from `PlaygroundEvaluator` (worker, disposable/respawnable) means the system **self-heals** for the most common failure scenarios. Worker crashes, timeouts, and transient network errors all resolve on the next Run — the worker respawns, re-authenticates, and the user's code + connection metadata are intact.

---

## Follow-up Discoveries (Second Strict Pass)

A stricter pass against the implementation uncovered several additional issues that were not captured above.

### 9. Saving a newly created playground can drop its connection immediately — **Severity: HIGH (Bug)**

**Files:** `src/commands/playground/newPlayground.ts`, `src/documentdb/playground/PlaygroundService.ts`

The playground binding is keyed by `uri.toString()`, and `newPlayground()` stores the connection against the **untitled** document URI. `PlaygroundService` then removes the binding on `onDidCloseTextDocument`.

That becomes a problem on the first **Save**: VS Code closes the `untitled:` document and reopens it as a `file:` document. The old URI mapping is removed, but there is no code to migrate the connection to the new URI.

**Impact:** A playground can become `Not connected` immediately after its first save, while the document is still open. This is a direct violation of the feature's core guarantee that a playground remains bound to the cluster/database it was created for.

**Fix:** Migrate the connection on untitled→file URI transitions (or persist the binding independently of the transient URI).

---

### 10. The context menu exposes "New Query Playground" on cluster nodes, but the handler assumes a database/collection node — **Severity: HIGH (Bug)**

**Files:** `package.json`, `src/commands/playground/newPlayground.ts`

The menu contribution shows the command on:

- `treeitem_documentdbcluster`
- `treeitem_database`
- `treeitem_collection`

But the handler only accepts `DatabaseItem | CollectionItem` and unconditionally reads:

```ts
databaseName: node.databaseInfo.name,
```

A cluster node does not provide `databaseInfo`, so invoking the command from a cluster context can fail at runtime.

**Impact:** Users are offered a visible action path that does not match the command's implementation assumptions.

**Fix:** Either remove `documentdbcluster` from the menu condition or support cluster-node invocation by prompting for a database first.

PROMPT: remove.

---

### 11. The header comment no longer preserves enough recovery context — **Severity: LOW (UX / Recovery Gap)**

**File:** `src/commands/playground/newPlayground.ts`

The new template header now only includes the cluster name:

```ts
const headerComment = `// Query Playground: ${node.cluster.name}`;
```

It no longer includes the database name (or selected collection when launched from a collection node).

**Impact:** When a playground loses its in-memory binding, the document itself no longer tells the user which database it originally targeted. This makes manual recovery harder, especially given the missing reconnect flow.

**Fix:** Restore database/collection context in the header comment, or persist recoverable metadata in a hidden comment block.

PROMPT: no becasuse the database chan change, andso can dthe collection when the user uses vaiorus commands.

---

### 12. Collection-name cache warming is still single-editor, not multi-playground aware — **Severity: MEDIUM (Architecture Gap)**

**File:** `src/documentdb/query-language/playground-completions/CollectionNameCache.ts`

On `PlaygroundService.onDidChangeState()`, the cache warmer only inspects `vscode.window.activeTextEditor` and warms that editor's connection.

**Impact:** The multi-playground architecture still pre-warms collection metadata for only one document at a time. Non-active playgrounds can therefore feel colder or more stale than the design implies until they are focused individually.

**Fix:** Iterate all open playground bindings from `PlaygroundService` (or expose an iterator) and warm each distinct `{ clusterId, databaseName }` pair.
PROMPT: ignore ofr now

---

## Additional Summary Table

| #   | Issue                                                            | Severity   | Action                |
| --- | ---------------------------------------------------------------- | ---------- | --------------------- |
| 9   | Saving an untitled playground drops its connection on first save | **HIGH**   | Fix before merge      |
| 10  | Menu exposes cluster-node path that the command does not support | **HIGH**   | Fix before merge      |
| 11  | Header comment lost database/collection recovery context         | **LOW**    | Follow-up acceptable  |
| 12  | Cache warming still follows only the active editor               | **MEDIUM** | Follow-up recommended |

---

## Resolution Log

All actionable issues have been addressed. Summary of resolutions:

| #    | Source  | Issue                                        | Resolution                                                     | Commit       |
| ---- | ------- | -------------------------------------------- | -------------------------------------------------------------- | ------------ |
| 1    | Review  | Orphan cleanup kills running worker          | Fixed: skip evaluators in `executing` state                    | `3dea3dc2`   |
| 2    | Review  | Global `isExecuting` blocks all clusters     | No change — intentional v1 tradeoff                            | —            |
| 3    | Review  | Timeout: no settings hint in result panel    | Fixed: surface `SettingsHintError` in `formatError`            | `9f2da650`   |
| 4    | Review  | Saved files lose connection on reopen        | Created enhancement issue #585                                 | —            |
| 5    | Review  | Worker `error` event doesn't reject pending  | Fixed: reject all pending on error event                       | `7078806e`   |
| 6    | Review  | Uncaught exceptions not surfaced             | Fixed: send `evalError` before crash                           | `f660ec07`   |
| 7    | Review  | No health check between runs                 | Ignored per review guidance                                    | —            |
| 8    | Review  | Duplicate evaluator race (theoretical)       | Ignored per review guidance                                    | —            |
| 9    | Review  | Saving untitled playground drops connection  | Fixed: untitled→file URI migration                             | `6fad3d08`   |
| 10   | Review  | Menu exposes unsupported cluster node        | Fixed: removed `documentdbcluster` from menu                   | `e78aff7f`   |
| 11   | Review  | Header comment lost recovery context         | No change — database/collection can change during use          | —            |
| 12   | Review  | Cache warming single-editor only             | Ignored per review guidance                                    | —            |
| CR-1 | Copilot | `activeTextEditor` result routing bug        | Fixed: use `documentUri` parameter                             | `69c36bb4`   |
| CR-2 | Copilot | Cache warming comment mismatch               | Fixed: comment updated to match implementation                 | `da4d60ff`   |
| CR-3 | Copilot | `ShellTerminalInfo` string types             | Fixed: string-literal union types                              | `5cc0f6fd`   |
| CR-4 | Copilot | Missing test for document close cleanup      | Fixed: added tests for close and URI migration                 | `b15b35e3`   |
