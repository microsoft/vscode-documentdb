# Step 8 — Interactive Shell

**PR:** [#561](https://github.com/microsoft/vscode-documentdb/pull/561)

## Summary

Implemented the Interactive Shell — a REPL experience within a VS Code terminal, integrated with the extension's connection management and the `shell-runtime` evaluation engine. Users can type commands one at a time, use shell helpers (`show dbs`, `use db`, `it`, `help`, `exit`), maintain persistent variables across commands, and navigate command history with arrow keys.

## What the Interactive Shell Is

A **REPL (Read-Eval-Print Loop)** in a VS Code terminal tab:

- Type commands and see results immediately
- Shell commands: `show dbs`, `show collections`, `use <db>`, `help`, `exit`/`quit`, `cls`/`clear`
- Cursor iteration with `it`
- Persistent variables across commands within a session
- Command history via Up/Down arrow keys
- Database-aware prompt (e.g., `myDatabase>`)

### What It Is NOT

- Not a full terminal emulator — no shell escapes, no filesystem access
- Not a replacement for the Query Playground — the playground is for multi-statement scripts; the shell is for ad-hoc one-liners
- Not a standalone process — runs within the extension worker thread

## Key Decisions

### UI Surface: Pseudoterminal

**Selected:** `vscode.Pseudoterminal` via `createTerminal({ pty })`.

Other approaches were evaluated and rejected:

- **Webview (S2):** Webview-based shells (using CodeMirror or similar) suffer from scrolling issues, non-standard copy/paste, and keyboard handling that "feels off"
- **Virtual Document (S3):** Document metaphor is a poor fit for REPL — read-only range management is fragile
- **Hybrid (S4):** Split attention between terminal input and webview output is jarring

The Pseudoterminal provides a real terminal experience. VS Code's xterm.js handles scrollback, selection, and copy/paste. When the `TerminalCompletionProvider` API finalizes, we get native IntelliSense popups.

### Eval Backend: Dedicated Worker per Session

Each shell session gets its own worker thread with its own database client. The worker infrastructure is shared with the Query Playground via `WorkerSessionManager`, differentiated by a `persistent` flag:

| Aspect                | Playground (`persistent: false`) | Shell (`persistent: true`)   |
| --------------------- | -------------------------------- | ---------------------------- |
| Context per eval      | Fresh each time                  | Reused across commands       |
| Variables             | Reset per run                    | Persist within session       |
| `it` cursor iteration | Not supported                    | Supported (cursor preserved) |
| Lifecycle             | One shared worker                | One worker per shell tab     |

### Shell Commands: Let `@mongosh` Handle Most Things

Only commands needing VS Code-specific behavior are intercepted by `CommandInterceptor`:

| Intercepted       | Behavior                           |
| ----------------- | ---------------------------------- |
| `help` / `help()` | Show DocumentDB-specific help text |
| `exit` / `quit`   | Signal shell close                 |
| `cls` / `clear`   | Clear terminal screen              |

Everything else (`show dbs`, `show collections`, `use <db>`, `it`) is handled natively by `@mongosh`'s `ShellEvaluator` and `ShellInstanceState`.

### Discussion: Why Not Intercept Everything?

The `CommandInterceptor` architecture supports incremental migration from delegation (let `@mongosh` handle it) to custom handling (we handle it directly). Starting with delegation keeps the implementation simple and ensures correctness — `@mongosh` has extensive test coverage for these commands. Future work can selectively intercept commands for custom formatting or validation.

## Work Items

### WI-0: Legacy Shell Removal & Settings Migration

Removed the legacy `launchShell` command (which spawned an external `mongosh` process) and migrated settings:

- Removed: `documentDB.mongoShell.path`, `documentDB.mongoShell.args`, `documentDB.mongoShell.timeout`
- Added: `documentDB.shell.display.colorOutput`, `documentDB.shell.display.autocompletion`, `documentDB.shell.timeout`

### WI-1: Worker Infrastructure Refactoring

Extracted `WorkerSessionManager` from `PlaygroundEvaluator` — a reusable class handling worker spawning, IPC protocol, timeout management, and Entra ID OIDC token relay. Both `PlaygroundEvaluator` and `ShellSessionManager` wrap this shared infrastructure.

### WI-2: Shell UI — Terminal Pseudoterminal

- `DocumentDBShellPty` — implements `vscode.Pseudoterminal` with `onDidWrite` (output) and `handleInput` (keystrokes)
- `ShellInputHandler` — line editing with cursor movement (left/right/home/end), insert/delete, word navigation (Ctrl+Left/Right)
- `ShellOutputFormatter` — EJSON formatted output with optional ANSI color coding
- Dynamic prompt showing current database name
- Connection banner with host, auth method, username, emulator status
- Dynamic terminal tab name: `DocumentDB: user@cluster/db`

### WI-3: CommandInterceptor Expansion

Added `exit`/`quit` and `cls`/`clear` to the `CommandInterceptor`. Surface-aware help text (separate content for shell vs. playground).

### WI-4: Connection & Launch

Launch points from the tree view:

- Right-click cluster → Open Interactive Shell (defaults to `test` database)
- Right-click database → Open Interactive Shell (uses that database)
- Right-click collection → Open Interactive Shell (uses that collection's database)

### WI-4.5: Shell UX Polish

- `Ctrl+C` cancellation during execution (kills worker, respawns fresh)
- `use <db>` updates the prompt and terminal tab name dynamically
- Multi-line input detection (bracket counting for incomplete expressions)
- ANSI-colored JSON output with configurable setting

### WI-5: Terminal Links

After query results with a known namespace, the shell appends a clickable action line:

```
📊 Open collection [db.collection] in Collection View
```

`ShellTerminalLinkProvider` matches the pattern and opens the Collection View on click.

## Testing

- **ShellInputHandler:** 37 tests (line editing, cursor movement, history, word navigation)
- **ShellOutputFormatter:** 17 tests (EJSON formatting, ANSI coloring, cursor hints)
- **DocumentDBShellPty:** 22 tests (lifecycle, eval, special results, `use <db>`, action line)
- **ShellTerminalLinkProvider:** 10 tests (pattern matching, special characters, registry)
- **CommandInterceptor:** Tests for `exit`, `quit`, `cls`, `clear` patterns
- **openInteractiveShell:** 9 tests (node extraction, credential checks)
