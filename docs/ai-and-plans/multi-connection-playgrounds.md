# Multi-Connection Playgrounds

> **Status: ✅ Complete** — Implemented in PR [#583](https://github.com/microsoft/vscode-documentdb/pull/583).

## Goal

Each Query Playground document is permanently bound to the cluster/database it was created for. Multiple playgrounds can be open simultaneously, each connected to different servers, each with its own worker thread and result panel.

## Current State

- All `.documentdb.js` files share a single global `PlaygroundConnection` in `PlaygroundService`.
- A single `PlaygroundEvaluator` (with one worker thread) serves all playground files.
- One `PlaygroundResultProvider` maps each source URI to a deterministic result URI.
- CodeLens on line 0 shows connection status and clicking it opens instructions to right-click a tree node.
- Context menu has a submenu with "New Query Playground" and "Connect Query Playground to this database".

## Target State

- Each playground document has its own `PlaygroundConnection` stored in a `Map<string, PlaygroundConnection>` keyed by document URI.
- Each **cluster** gets its own `PlaygroundEvaluator` (worker thread), shared across playgrounds on the same cluster (same pattern as the interactive shell's `WorkerSessionManager`).
- The `PlaygroundResultProvider` already maps per source URI — no changes needed.
- CodeLens on line 0 shows the connection info; clicking it shows an info notification with details (no "change connection" workflow).
- The `connect` command and its submenu entry are removed.
- The submenu is removed entirely; the tree context menu directly shows "New Query Playground" (already has an inline button, keep the non-inline entry in a group too).
- The debug "Show Worker Stats" command reports all active playground workers (not just one).
- Opening a playground always creates a new file for that connection (no reuse/redirect).

## Architecture Changes

### 1. PlaygroundService — Per-Document Connection Map ✅

**Before:** Singleton with `_connection: PlaygroundConnection | undefined`
**After:** Singleton with `_connections: Map<string, PlaygroundConnection>` keyed by `uri.toString()`

New methods:

- `setConnection(uri, connection)` — bind a document to a connection
- `getConnection(uri)` — get connection for a specific document
- `removeConnection(uri)` — clean up when document closes
- `isConnected(uri)` — check if a specific document has a connection
- `getActiveClusterIds()` — returns all unique cluster IDs with open playgrounds _(added during implementation for orphan cleanup)_
- `hasPlaygroundsForCluster(clusterId)` — checks if any playground uses a given cluster _(added during implementation)_

Removed:

- `clearConnection()` (global)
- `isConnected()` (global, parameterless)
- `getConnection()` (global, parameterless)
- `getDisplayName()` (global, parameterless) → becomes `getDisplayName(uri)`

The StatusBar updates based on the active editor's URI, not a global state.

**Implementation note:** Document close cleanup (`onDidCloseTextDocument`) was added directly in the `PlaygroundService` constructor rather than as a separate external listener, keeping the cleanup logic co-located with the connection map.

### 2. PlaygroundEvaluator — Per-Cluster Worker Pool ✅

**Before:** Single `PlaygroundEvaluator` instance in `executePlaygroundCode.ts` module scope.
**After:** `Map<string, PlaygroundEvaluator>` keyed by `clusterId`.

- When executing code, look up (or create) the evaluator for `connection.clusterId`.
- Each evaluator owns one `WorkerSessionManager` → one worker thread.
- On document close, if no remaining playgrounds use that cluster's evaluator, shut it down.
- `getPlaygroundEvaluator()` → `getPlaygroundEvaluators()` returning the full map for debug stats.
- Added `shutdownOrphanedEvaluators()` — iterates the map and shuts down evaluators whose cluster has no remaining open playgrounds. Called from both `onDidChangeState` and `onDidChangeTabs` handlers in `ClustersExtension.ts`.

### 3. CodeLens — Display Only, No Connect Action ✅

**Before:** Connection lens uses `PlaygroundCommandIds.connect` command.
**After:** Connection lens uses `PlaygroundCommandIds.showConnectionInfo` command.

- Line 0: Show `$(plug) ClusterName / DatabaseName` — clicking shows `vscode.window.showInformationMessage` with connection details.
- Line 0: If not connected, show `$(warning) Not connected` with info about creating a new playground from the tree.
- The old `connect` command ID was replaced with `showConnectionInfo` (not removed entirely — the command still exists but now only shows info).

### 4. Context Menu — Remove Submenu, Keep Direct Command ✅

**Before:**

```
[inline] New Query Playground
[submenu] Query Playground >
  ├── New Query Playground
  └── Connect Query Playground to this database
```

**After:**

```
[inline] New Query Playground
[group]  New Query Playground    (non-inline, in a context menu group)
```

Removed:

- `documentDB.submenus.playground` submenu definition
- `vscode-documentdb.command.playground.connect` command definition
- The submenu reference in `view/item/context`
- The `documentDB.submenus.playground` menu entries

Replaced with:

- Direct `vscode-documentdb.command.playground.new` entry in the `5@2` group

### 5. newPlayground — Always Create New, Bind Connection ✅

The command already creates a new untitled document each time. Changes:

- Store the connection in `PlaygroundService` keyed by the new document's URI.
- Document close cleanup is handled by `PlaygroundService` internally (not a separate listener per document).

**Deviation from plan:** The command now **requires** a tree node. When invoked without one (e.g., from the command palette), it shows an informational message directing the user to right-click a database/collection in the panel. The template header comment is always cluster-specific (the generic "Write and run DocumentDB API queries" fallback was removed).

### 6. executePlaygroundCode — Per-URI Connection, Per-Cluster Evaluator ✅

- `executePlaygroundCode` now takes a `documentUri` parameter.
- Gets connection from `PlaygroundService.getConnection(documentUri)`.
- Looks up or creates evaluator from the per-cluster `Map<string, PlaygroundEvaluator>`.
- **Decision: kept global `isExecuting`** — simpler, prevents resource exhaustion.

### 7. Show Worker Stats — Report All Playground Workers ✅

Updated `showWorkerStats` to iterate the evaluator map and report each cluster's worker state (session ID, eval count, auth method, init duration).

**Additional scope:** Also enriched the Interactive Shell worker stats with details that were previously missing: `clusterDisplayName`, `activeDatabase`, `isInitialized`, `isEvaluating`, `workerState`, `authMethod`, and `username`. This required extending `ShellTerminalInfo`, adding getters to `ShellSessionManager`, and updating `DocumentDBShellPty.getTerminalInfo()`.

### 8. Lifecycle — Clean Up on Document Close ✅

- `PlaygroundService` listens for `onDidCloseTextDocument` internally and removes the connection.
- `ClustersExtension.ts` calls `shutdownOrphanedEvaluators()` on `onDidChangeState` and `onDidChangeTabs` to shut down workers whose cluster has no remaining playgrounds.
- Already existing: `PlaygroundResultProvider` cleans up result content on close (unchanged).

**Deviation from plan:** The tab close handler in `ClustersExtension.ts` was simplified — instead of checking whether _any_ playgrounds remain open (old global logic), it now delegates to `shutdownOrphanedEvaluators()` which checks per-cluster.

## Files to Modify

| File                            | Change                                                   |
| ------------------------------- | -------------------------------------------------------- |
| `PlaygroundService.ts`          | Per-document connection map, URI-based API               |
| `PlaygroundEvaluator.ts`        | No changes (one instance per cluster)                    |
| `executePlaygroundCode.ts`      | Per-cluster evaluator map, URI-based connection lookup   |
| `PlaygroundCodeLensProvider.ts` | URI-based connection display, info notification on click |
| `connectDatabase.ts`            | Remove entirely                                          |
| `newPlayground.ts`              | Bind connection to document URI, clean up listener       |
| `runAll.ts`                     | Pass document URI for connection lookup                  |
| `runSelected.ts`                | Pass document URI for connection lookup                  |
| `showWorkerStats.ts`            | Iterate all playground evaluators                        |
| `constants.ts`                  | Remove `connect` command ID, add `showConnectionInfo`    |
| `package.json`                  | Remove connect command, remove submenu, simplify menus   |
| `ClustersExtension.ts`          | Remove connect command registration                      |

## Execution Order

1. Update `PlaygroundService` (per-document map)
2. Update `constants.ts` (command IDs)
3. Update `executePlaygroundCode.ts` (per-cluster evaluator pool)
4. Update `newPlayground.ts` (bind connection to URI)
5. Update `PlaygroundCodeLensProvider.ts` (URI-based display, info notification)
6. Update `runAll.ts` and `runSelected.ts` (pass URI)
7. Remove `connectDatabase.ts` and its registration
8. Update `showWorkerStats.ts` (multi-evaluator reporting)
9. Update `package.json` (remove connect command, submenu → direct command)
10. Update `ClustersExtension.ts` (remove connect registration)
