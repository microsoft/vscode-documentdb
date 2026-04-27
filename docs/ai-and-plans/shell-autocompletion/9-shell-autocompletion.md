# Step 9: Shell Tab Completion & Ghost Text

> **PR:** [#576 — Add context-aware shell completion and inline suggestions](https://github.com/microsoft/vscode-documentdb/pull/576)
> **Prerequisite:** Step 8 (Interactive Shell) complete (PR #508)
> **Status:** Implemented

---

## Overview

Tab completion and inline ghost text for the Interactive Shell's Pseudoterminal. Since the VS Code `TerminalCompletionProvider` API remains proposed (tracked in [microsoft/vscode#224505](https://github.com/microsoft/vscode/issues/224505)), this implements a self-contained fallback directly in the Pseudoterminal's keystroke handling.

---

## Architecture

### Components

| File                         | Purpose                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `ShellCompletionProvider.ts` | Context detection + candidate generation (platform-neutral, no VS Code API)                    |
| `ShellCompletionRenderer.ts` | Multi-column ANSI rendering of completion picker (bash/zsh style)                              |
| `ShellGhostText.ts`          | Inline dim suggestion lifecycle (show / clear / accept / reset), Unicode-aware cursor movement |
| `ShellInputHandler.ts`       | Tab key handling, `getCursor()` getter, `insertText()`, `replaceText()`, new callbacks         |
| `ShellOutputFormatter.ts`    | Error code extraction (`extractErrorCode`) for cleaner error messages in shell output          |
| `DocumentDBShellPty.ts`      | Wiring: connects completion provider + ghost text to terminal I/O                              |

### Data Flow

```
User presses Tab
  → ShellInputHandler fires onTab(buffer, cursor)
    → DocumentDBShellPty.handleTab()
      → ShellCompletionProvider.getCompletions(buffer, cursor, context)
        → detectContext() → determines shell context type
        → candidate generation from data sources
        → prefix filtering
      → Single match: insert remaining text inline
      → Multiple matches: insert common prefix + render picker via ShellCompletionRenderer

User types a character
  → ShellInputHandler fires onBufferChange(buffer, cursor)
    → DocumentDBShellPty.handleBufferChange() (50ms debounce)
      → evaluateGhostText()
        → ShellCompletionProvider.getCompletions()
        → Single match with prefix: show ghost via ShellGhostText
        → Otherwise: clear ghost

User presses Right Arrow at end of buffer
  → ShellInputHandler fires onAcceptGhostText()
    → DocumentDBShellPty inserts ghost text into buffer
```

### Context Detection

The `ShellCompletionProvider` detects 8 context types:

| Priority | Context           | Buffer Pattern                                  | Candidates                                                        |
| -------- | ----------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| 1        | Top-level         | Empty or partial command                        | `show`, `use`, `exit`, `quit`, `cls`, `clear`, `help`, `it`, `db` |
| 2        | Show subcommand   | `show <partial>`                                | `dbs`, `databases`, `collections`                                 |
| 3        | Use database      | `use <partial>`                                 | Database names from cache                                         |
| 4        | db-bracket        | `db[`, `db['`, `db["`                           | Collection names (with quote + `]` suffix)                        |
| 5        | db-dot            | `db.<partial>`                                  | Collection names + database methods                               |
| 6        | Collection method | `db.<coll>.<partial>` or `db['coll'].<partial>` | Collection methods (`find`, `insertOne`, etc.)                    |
| 7        | Method argument   | `db.<coll>.find({...` or `db['coll'].find({...` | Field names + query operators                                     |
| 8        | Cursor chain      | `db.<coll>.find({}).`                           | Cursor methods (`limit`, `skip`, `sort`, etc.)                    |

Both dot notation (`db.collection`) and bracket notation (`db['collection']`) are fully supported for contexts 4–8. Bracket notation is required for collections with special characters (hyphens, spaces, dots) in their names.

### Data Sources

| Source                       | Provides                                                     | Access                                            |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------------- |
| Static lists                 | Top-level commands, show subcommands                         | Hardcoded                                         |
| `ClustersClient`             | Database names, collection names                             | Synchronous cache read; background fetch if empty |
| `SchemaStore`                | Collection names (from queries), field names + types         | Synchronous singleton                             |
| `operator-registry`       | Query operators, BSON constructors, update operators, stages | `getFilteredCompletions()`                        |
| `shell-api-types` | Shell API methods by target (database, collection, cursor)   | `getMethodsByTarget()`                            |

All reads are **synchronous from caches** — Tab never blocks on network I/O. If a cache is empty, a background fetch is triggered so subsequent Tab presses have data.

---

## Design Decisions

### 1. Tab Completion Fallback (not `TerminalCompletionProvider`)

**Decision:** Implement our own tab completion in the Pseudoterminal.

**Reason:** The VS Code `TerminalCompletionProvider` API was proposed, briefly finalized, then reverted due to API shape feedback. As of April 2026 it remains proposed. Rather than wait indefinitely, we implement a self-contained fallback. When the API stabilizes, the completion data sources stay the same — only the presentation layer changes (from our ANSI picker to VS Code's native IntelliSense popup).

### 2. Bash/Zsh-Style Column Picker (not vertical menu)

**Decision:** Render completion candidates as a multi-column layout below the prompt, similar to bash/zsh tab completion.

**Reason:** This is the standard terminal completion UX that shell users expect. A vertical IntelliSense-style menu would require managing a stateful selection cursor and overlay rendering in the terminal — significantly more complexity for a fallback mechanism that will be replaced when the VS Code API stabilizes.

### 3. Color-Coded Candidates with `()` Suffix for Methods

**Decision:** Use ANSI colors to differentiate candidate kinds (cyan for collections, yellow for methods, green for fields, magenta for operators) and append `()` to method labels.

**Reason:** When `db.` shows both collection names and database methods, users need to instantly distinguish them. Colors provide a visual channel without inflating column width. The `()` suffix is a secondary signal that works even on color-limited displays.

**Alternatives considered:**

- Unicode prefix icons (`📦` collection, `ƒ` method) — variable-width chars break column alignment
- Suffix tags (`[collection]`, `[method]`) — doubles column width, wastes horizontal space
- Grouping with separator lines — loses alphabetical sorting users expect

### 4. Ghost Text Only for Single Prefix Matches

**Decision:** Ghost text only appears when there is exactly one completion candidate matching the typed prefix (e.g., `db.rest` → dim `aurants` when `restaurants` is the only match).

**Reason:** We initially implemented "smart" pattern-based ghost text (e.g., `find()` suggested after `db.collection.`) but removed it because:

- It created a confusing UX inconsistency: Tab accepted prefix ghost text but dismissed smart ghost text
- Users expected Tab to always accept visible ghost text, leading to frustration
- The Tab picker already provides method discoverability at `db.<coll>.`
- Keeping ghost text limited to unambiguous single-match cases makes the behavior predictable: if you see ghost text, Tab accepts it. Always.

**Exception — Schema hint ghost text:** When the user presses Tab inside a method argument (e.g., `db.users.find({`) and no field names are available (SchemaStore has no data for that collection), a non-insertable hint is displayed:

```
ⓘ Run db.users.find() first for field suggestions
```

This hint cannot be accepted via Tab or Right Arrow — it is purely informational. The hint only appears when SchemaStore truly has no fields for the collection; typing a non-matching prefix (e.g., a typo) on a collection with known schema will not trigger the hint.

### 5. Synchronous Cache Reads (No Async Blocking)

**Decision:** Tab completion never triggers an await or blocks on I/O. All data reads are from in-memory caches.

**Reason:** Tab completion must feel instant. If a cache is empty (e.g., user hasn't expanded the database tree yet), the first Tab press returns no results while a background fetch populates the cache. The next Tab press has data. This matches the `CollectionNameCache` pattern used by the playground completion provider.

### 6. Right Arrow Accepts Ghost Text

**Decision:** Right Arrow at end of buffer accepts ghost text, consistent with VS Code's own inline suggestions and GitHub Copilot ghost text.

**Reason:** This is the established convention for inline suggestion acceptance in VS Code. Tab also accepts ghost text (since ghost only appears for unambiguous single matches).

### 7. Auto-Quote Dotted Field Paths

**Decision:** Dotted nested field paths (e.g., `address.city`) are automatically wrapped in quotes when inserted via Tab completion.

**Reason:** Dotted paths are not valid as unquoted JavaScript object keys. Without quoting, `db.users.find({address.city: 'x'})` is a SyntaxError. Tab completion now produces `db.users.find({"address.city": 'x'})`. Ghost text is skipped for these candidates because the visual would be misleading (the insertion replaces the typed prefix rather than appending).

**Implementation:** Added `replaceText(deleteCount, text)` to `ShellInputHandler` as a replace-mode alternative to `insertText()`. When a candidate's `insertText` doesn't start with the typed prefix, `applySingleCompletion` uses `replaceText` to delete the prefix and insert the full quoted text.

### 8. Bracket Notation for Special-Character Collections

**Decision:** Collections with names containing special characters (hyphens, spaces, parentheses, etc.) automatically use bracket notation in completions.

**Reason:** `db.stores (10)` is a SyntaxError. When the user types `db.sto` and the only matching collection is `stores (10)`, Tab completion produces `db['stores (10)']` instead. The `needsBracketNotation()` helper detects names that are not valid JavaScript identifiers and switches to bracket syntax.

**Bracket notation contexts supported:**

- `db[` — shows all collection names with quote+bracket wrapping
- `db['partial` / `db["partial` — prefix-filters collection names
- `db['name'].` — collection method completions
- `db['name'].find({` — method argument completions (fields, operators)
- `db['name'].find({}).` — cursor chain completions

### 9. Unicode-Aware Ghost Text Cursor Movement

**Decision:** Ghost text cursor repositioning uses `Intl.Segmenter`-based display width calculation instead of `String.length`.

**Reason:** JavaScript's `String.length` counts UTF-16 code units, but ANSI cursor movement operates on display columns. Surrogate pairs (emoji), CJK characters (2-column width), and combining marks would cause the cursor to be positioned incorrectly after rendering ghost text. The `terminalDisplayWidth()` function iterates grapheme clusters and applies full-width character detection for CJK ranges.

### 10. Error Code Extraction for Cleaner Error Messages

**Decision:** Technical error code prefixes (e.g., `[PREFIX-12345]`) are stripped from error messages displayed in the shell.

**Reason:** Internal error codes like `[COMMON-10001]` are useful for diagnostics but clutter user-facing output. The `extractErrorCode()` function in `ShellOutputFormatter` separates the code from the message, keeping the display clean while preserving the code for telemetry.

---

## Reused Infrastructure

The terminal completions reuse significant infrastructure from the Collection View and Query Playground completion systems:

- **`cursorContext.ts`** — Shared cursor position detection (key / value / operator positions within query objects)
- **`completionKnowledge.ts`** — `KEY_POSITION_OPERATORS` set for context-aware filtering
- **`SchemaStore`** — Same singleton schema cache shared across Collection View, Playground, and Terminal
- **`operator-registry`** — Same operator metadata package
- **`shell-api-types`** — `getMethodsByTarget()` for method name lookups

The `ShellCompletionProvider` is modeled after `PlaygroundCompletionItemProvider` (Layer 2) but simplified: it doesn't need Monaco/VS Code CompletionItem mapping, and the terminal's single-expression context is simpler than a full playground file.

---

## Test Coverage

| Test File                               | Tests | Coverage                                                                                                                                |
| --------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ShellCompletionProvider.test.ts`       | 63+   | All 8 context types, prefix filtering, candidate kinds, cursor chains, bracket notation, dotted field quoting, special-char collections |
| `ShellCompletionRenderer.test.ts`       | 17    | Column layout, colors, method suffix, truncation, common prefix                                                                         |
| `ShellGhostText.test.ts`                | 25+   | Show / clear / accept / reset lifecycle, ANSI output, Unicode width                                                                     |
| `ShellInputHandler.test.ts` (additions) | 18+   | Tab callback, getCursor, insertText, replaceText, onBufferChange, ghost acceptance                                                      |
| `ShellOutputFormatter.test.ts`          | 54+   | Error code extraction, result formatting                                                                                                |
| `feedResultToSchemaStore.test.ts`       | 26    | Result type filtering, namespace validation, document cap, EJSON deserialization                                                        |

---

## Future: `TerminalCompletionProvider` Migration

When the VS Code `TerminalCompletionProvider` API finalizes:

1. The `ShellCompletionProvider` data sources and context detection can be reused directly
2. The `ShellCompletionRenderer` (ANSI picker) is replaced by VS Code's native IntelliSense popup
3. The `ShellGhostText` module can be removed (VS Code handles inline suggestions natively)
4. The Tab key handling in `ShellInputHandler` reverts to default terminal behavior
5. Registration: `vscode.window.registerTerminalCompletionProvider(provider, { triggerCharacters: ['.', ' '] })`
6. Filter to DocumentDB shell terminals only via terminal name or profile matching

Tracked in a separate GitHub issue.
