# Step 6 — Query Playground

**PR:** [#536](https://github.com/microsoft/vscode-documentdb/pull/536)

## Summary

Implemented the Query Playground — a `.documentdb` file where users write and run DocumentDB API queries with JavaScript syntax. Delivered as three sequential work items: Foundation, Interaction Layer, and Execution + Output.

## What the Query Playground Is

A JavaScript file with a custom extension (`.documentdb`) that users can:

1. **Write** DocumentDB API queries and scripts using JavaScript syntax
2. **Get autocompletion** (initially built-in JS IntelliSense; enhanced in Step 7)
3. **Run** the entire file, a selection, or the current statement via CodeLens / keyboard shortcuts
4. **See results** in a formatted read-only side panel

It is **not** an interactive shell — there is no prompt, no `show dbs`, no cursor iteration with `it`. It is a code file, analogous to a Jupyter notebook for DocumentDB.

## Key Decisions

### D1: Connection Scope — Global

All Query Playground files share a single global connection. This matches the legacy scrapbook behavior and keeps implementation simple. Per-file connections were considered but deferred as future work.

### D2: Execution Architecture — In-Process with MongoClient Reuse

The extension reuses the existing authenticated `MongoClient` from `ClustersClient` rather than creating a new connection. The `@mongosh` `NodeDriverServiceProvider` accepts an existing client directly — it wraps it without creating a new connection.

**Why this matters:** The user has already authenticated (SCRAM or Entra ID). Re-creating the client would require caching credentials or re-triggering auth flows. In-process evaluation avoids both.

**Upgrade path:** The accepted risk is that infinite loops (`while(true){}`) freeze the extension host because `Promise.race()` can't preempt a blocked event loop. Step 6.2 upgrades to a persistent worker thread (Option F) for full isolation.

### D3: Code Selection — Blank-Line Blocks

Three execution modes in priority order:

1. **Run Selection** — if text is selected, run that selection (expanded to full lines)
2. **Run Current Block** — scan for blank-line-delimited blocks around the cursor
3. **Run All** — execute entire file

Variables persist within a single `eval()` call but not between separate runs. Users who need variables to carry over should keep related code in the same block or use "Run All."

### D4: Output Display — Virtual Read-Only Document

JSON-formatted results displayed in a `.jsonc` read-only side panel. Results include cluster/database info, timestamp, code echo, execution timing, and document count.

### D5: File Extension — `.documentdb` + `.documentdb.js`

Dual extensions for the same language ID. `.documentdb` is clean and branded; `.documentdb.js` is recognized as JavaScript by external tools and GitHub.

## Implementation Details

### WI-1: Foundation

- Registered `documentdb-scratchpad` language ID with JS grammar delegation
- `ScratchpadService` singleton managing global connection state
- `StatusBarItem` showing active connection

### WI-2: Interaction Layer

- **CodeLens:** Connection status (line 0), Run All (line 0), per-block Run (at each block's start line)
- **Block detection:** Blank-line separation with gutter indicators
- **Commands:** New Playground, Connect, Run All, Run Selected
- **Keybindings:** Ctrl+Enter (run block), Ctrl+Shift+Enter (run all)
- **Tree view submenu** on database/collection nodes

### WI-3: Execution + Output

- In-process evaluation using `@mongosh` packages (`ShellEvaluator`, `ShellInstanceState`, `NodeDriverServiceProvider`)
- `vm.runInContext()` with full shell context (`db`, BSON constructors)
- EJSON-formatted results with headers (cluster/database, timestamp, code echo, timing)
- Custom `help` handler with DocumentDB-specific reference

## Discussion: Eval Package Architecture

The extension uses the same `@mongosh` packages as other tools (shell evaluator, async rewriter, service provider) but with a fundamentally different connection strategy: reusing an existing authenticated `MongoClient` in-process rather than creating a new connection per execution in a worker thread. This eliminates authentication overhead and provides instant execution.

## Dependencies Added

- `@mongosh/shell-evaluator`, `@mongosh/shell-api`, `@mongosh/service-provider-node-driver`, `@mongosh/service-provider-core`, `@mongosh/errors`
- 7 webpack externals for optional transitive dependencies (`electron`, `ssh2`, `@babel/preset-typescript`, etc.)

## Testing

30 unit tests covering `ScratchpadService`, statement detection, and `ScratchpadCodeLensProvider`.
