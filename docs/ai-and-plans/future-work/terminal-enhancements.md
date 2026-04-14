# Future Work: Terminal Enhancements

> Items specific to the Interactive Shell's terminal UI surface (Pseudoterminal). These are tracked so work can be picked up independently.
>
> **Prerequisites:** Step 8 (Interactive Shell) is complete.

---

## 1. Autocompletion via `TerminalCompletionProvider`

**Priority:** High — implement as soon as the API is finalized
**Tracking:** [microsoft/vscode#224505](https://github.com/microsoft/vscode/issues/224505), [#577](https://github.com/microsoft/vscode-documentdb/issues/577)
**Blocked by:** API finalization (proposed as of April 2026)

### Background

VS Code's Terminal Suggest feature (IntelliSense popup in terminals) is stable since VS Code 1.96. The extension API to contribute custom completions (`TerminalCompletionProvider`) is proposed — it was briefly finalized then reverted due to API shape feedback.

### What to Implement

| Trigger                   | Suggestions                                              | Data Source                       |
| ------------------------- | -------------------------------------------------------- | --------------------------------- |
| Empty line                | `show`, `use`, `exit`, `quit`, `cls`, `help`, `it`, `db` | Static list                       |
| `show `                   | `dbs`, `databases`, `collections`, `tables`              | Static list                       |
| `use `                    | Known database names                                     | `SchemaStore` or `ClustersClient` |
| `db.`                     | Known collection names                                   | `SchemaStore`                     |
| `db.<collection>.`        | Method names (`find`, `insertOne`, etc.)                 | Shell API type definitions        |
| `db.<collection>.find({ ` | Field names from schema                                  | `SchemaStore`                     |
| Inside `{ $`              | DocumentDB API query operators                           | `documentdb-constants`            |

### Action When API Finalizes

1. Check the final API shape
2. Add to `enabledApiProposals` if needed
3. Implement provider using existing `documentdb-constants` and `SchemaStore` data
4. Register with trigger characters `.` and ` ` (space)
5. Filter to DocumentDB shell terminals only

---

## ~~2. Tab Completion Fallback~~ ✅

**Completed in:** [PR #576](https://github.com/microsoft/vscode-documentdb/pull/576)
**Architecture docs:** `docs/ai-and-plans/interactive-shell/9-shell-autocompletion.md`

Implemented as a self-contained tab completion system in the Pseudoterminal with context-aware completions (7 context types), color-coded bash/zsh-style multi-column picker, and inline ghost text for single prefix matches. See the architecture docs for full details and design decisions.

---

## 3. Terminal Links — Extended Patterns

**Priority:** Medium | **API Status:** `TerminalLinkProvider` is stable

Beyond the current "Open in Collection View" action line:

| Pattern                             | Action                                  |
| ----------------------------------- | --------------------------------------- |
| Error codes (e.g., `E11000`)        | Open DocumentDB error documentation     |
| Namespace strings (`db.collection`) | Open that collection in Collection View |
| Connection strings in output        | Copy to clipboard                       |

### "Open in Collection View" with Query Pre-Fill

Pre-fill the Collection View with the same filter/sort/projection the user ran in the shell. Requires parsing `find()` calls to extract parameters.

---

## 4. ANSI Output Formatting — Advanced

**Priority:** Low

- Nested document indentation with alternating depth colors
- Array element numbering in the left margin
- Truncation with "... N more fields" for wide documents
- Execution time displayed after each result

---

## 5. Smart Prompt Features

**Priority:** Low

- ~~Auto-suggest from history (ghost text)~~ — Inline ghost text for single prefix matches implemented in [PR #576](https://github.com/microsoft/vscode-documentdb/pull/576). History-based ghost text not implemented (deferred).
- Prompt coloring (green when connected, red when disconnected)
- Execution status indicator (spinner while running)

---

## 6. Session History Persistence

**Priority:** Low

Command history that survives VS Code restarts via `globalState`. Currently, history is per-session only.
