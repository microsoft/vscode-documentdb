# PR #576 — Shell Autocompletion: Critical Review

> **PR:** [#576 — Add context-aware shell completion and inline suggestions](https://github.com/microsoft/vscode-documentdb/pull/576)
> **Reviewed:** 2026-04-14
> **Plan doc:** [9-shell-autocompletion.md](./9-shell-autocompletion.md)
> **Sources:** Manual code review + [Copilot automated review](https://github.com/microsoft/vscode-documentdb/pull/576)
> **Update:** Second-pass manual review added 8 more issues beyond the first draft, focused on mid-line editing, nested fields, multi-argument methods, and long-query terminal behavior.

---

## Severity Levels

| Level             | Meaning                                                   |
| ----------------- | --------------------------------------------------------- |
| **S1 — Critical** | Data loss, crash, or security vulnerability               |
| **S2 — High**     | Visible bug that affects common workflows                 |
| **S3 — Medium**   | Bug that affects less-common workflows or edge cases      |
| **S4 — Low**      | Minor inconsistency, polish issue, or maintenance concern |
| **S5 — Nit**      | Code style, docs, or negligible edge case                 |

---

## Issues

### #1 — ~~`onBufferChange` not fired for Ctrl+W, Ctrl+U, Ctrl+K~~ ✅ RESOLVED

**Severity: S2 — High**
**File:** `src/documentdb/shell/ShellInputHandler.ts`
**Origin:** [Copilot review comment on ShellInputHandler.ts](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764823)
**Resolved:** [`3104151`](https://github.com/microsoft/vscode-documentdb/commit/3104151) — Added `onBufferChange` callbacks after all three methods.

`onBufferChange` is called after `insertCharacter` (line 266), `handleBackspace` (line 327), and `handleDelete` (line 493). However, three buffer-mutating operations do NOT fire the callback:

- `deleteWordBeforeCursor()` (Ctrl+W) — mutates `_buffer` and `_cursor` at lines ~520–540
- `clearBeforeCursor()` (Ctrl+U) — clears all text before cursor
- `clearAfterCursor()` (Ctrl+K) — clears all text after cursor

**Impact:** Ghost text will remain visible after these edits, showing stale suggestions for a buffer that no longer matches. Users who habitually use Ctrl+W to correct mistakes will see confusing ghost text.

**Fix:** Add `this._callbacks.onBufferChange?.(this._buffer, this._cursor);` after each of these methods mutates the buffer.

---

### #2 — ~~`db[` bracket notation routes to `detectDbContext` but parsing assumes `db.`~~ ✅ RESOLVED

**Severity: S3 — Medium**
**File:** `src/documentdb/shell/ShellCompletionProvider.ts`
**Origin:** [Copilot review comment on ShellCompletionProvider.ts](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764830)
**Resolved:** [`5fd6bd7`](https://github.com/microsoft/vscode-documentdb/commit/5fd6bd7) — Removed the `db[` branch (option 1: don't advertise unsupported syntax).

The context detection entry point checks:

```typescript
if (trimmed.startsWith('db.') || trimmed.startsWith('db[')) {
  return this.detectDbContext(trimmed, text, cursor);
}
```

But `detectDbContext` immediately does `const afterDb = trimmed.slice(3);` which assumes `db.` format. For `db['my-collection'].find({...`, `afterDb` would be `'my-collection'].find({...` — the bracket and quote are included, leading to garbled prefix matching and no useful completions.

**Impact:** Any user who accesses collections via bracket notation (`db["my-collection"]`) will get no completions or nonsensical results. This is the **only** way to access collections with hyphens, spaces, or dots in their names.

**Fix:** Either:

1. Remove the `trimmed.startsWith('db[')` branch entirely (don't advertise unsupported syntax), or
2. Add bracket-notation parsing in `detectDbContext` that extracts the collection name from `db['name']` or `db["name"]`.

---

### #3 — ~~Stale ghost text timer fires after prompt reset~~ ✅ RESOLVED

**Severity: S3 — Medium**
**File:** `src/documentdb/shell/DocumentDBShellPty.ts`
**Origin:** [Copilot review comment on DocumentDBShellPty.ts](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764840)
**Resolved:** [`00fe5be`](https://github.com/microsoft/vscode-documentdb/commit/00fe5be) — `showPrompt()` now clears `_ghostTextTimer` before writing the prompt.

`showPrompt()` calls `_ghostText.reset()` and `_completionListVisible = false`, but does **not** clear `_ghostTextTimer`. The pending timer closure captures the old `buffer` and `cursor` values. When it fires 50ms later, `evaluateGhostText` is called with stale data and may render ghost text on a fresh, empty prompt.

Affected code paths where `showPrompt()` is called:

- After command evaluation completes (`handleLineInput`)
- After Ctrl+C interrupt (`handleInterrupt`)
- After empty Enter (`handleLineInput` early return)

**Impact:** Ghost text from a previous command appearing momentarily on a fresh prompt. Visually jarring, though not harmful.

**Fix:** In `showPrompt()`, add:

```typescript
if (this._ghostTextTimer) {
  clearTimeout(this._ghostTextTimer);
  this._ghostTextTimer = undefined;
}
```

---

### #4 — ~~`fieldLookup` closure re-fetches fields on every call~~ ✅ RESOLVED

**Severity: S4 — Low**
**File:** `src/documentdb/shell/ShellCompletionProvider.ts`, `getMethodArgumentCandidates`
**Origin:** [Copilot review comment on ShellCompletionProvider.ts](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764835)
**Resolved:** [`d56fb66`](https://github.com/microsoft/vscode-documentdb/commit/d56fb66) — Pre-computed `Map<path, type>` for O(1) lookups.

The `fieldLookup` closure inside `getMethodArgumentCandidates` calls `SchemaStore.getInstance().getKnownFields(...)` and then `fields.find(...)` (linear scan) on every invocation. `detectCursorContext` may invoke this lookup multiple times per completion request.

```typescript
const fieldLookup: FieldTypeLookup = (fieldName: string): string | undefined => {
    const fields = SchemaStore.getInstance().getKnownFields(...);  // called each time
    const field = fields.find((f) => f.path === fieldName);        // O(n) each time
    return field?.type;
};
```

**Impact:** Unnecessary CPU work on each Tab press inside method arguments. Not user-visible since the field list is in-memory, but wasteful.

**Fix:** Pre-compute a `Map<string, string | undefined>` from the fields array before creating the closure:

```typescript
const fields = SchemaStore.getInstance().getKnownFields(...);
const fieldTypeByPath = new Map(fields.map((f) => [f.path, f.type]));
const fieldLookup: FieldTypeLookup = (fieldName) => fieldTypeByPath.get(fieldName);
```

---

### #5 — ~~Typo in `terminal-enhancements.md` doc path~~ ✅ RESOLVED

**Severity: S5 — Nit**
**File:** `docs/ai-and-plans/future-work/terminal-enhancements.md`
**Origin:** [Copilot review comment on terminal-enhancements.md](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764845)
**Resolved:** [`408c514`](https://github.com/microsoft/vscode-documentdb/commit/408c514) — Fixed typo: `shell-autocomletion` → `shell-autocompletion`.

```
**Architecture docs:** `docs/ai-and-plans/shell-autocomletion/9-shell-autocompletion.md`
```

Should be `shell-autocompletion` (missing `p`).

---

### #6 — ~~`insertText()` doesn't fire `onBufferChange`~~ ✅ RESOLVED

**Severity: S4 — Low**
**File:** `src/documentdb/shell/ShellInputHandler.ts`, line 150
**Resolved:** [`1dd1e0e`](https://github.com/microsoft/vscode-documentdb/commit/1dd1e0e) — Documented the contract: `insertText` is a PTY-controlled mutation; the PTY handles follow-up evaluations.

`insertText()` is the public API used by DocumentDBShellPty to insert Tab completions and accepted ghost text. It modifies `_buffer` and `_cursor` but doesn't call `this._callbacks.onBufferChange?.(...)`.

**Impact:** After Tab completion inserts text (e.g., the common prefix of multiple matches), the ghost text evaluator is never triggered. Ghost text won't appear until the next manual keystroke.

This may be **intentional** — the PTY manages ghost text explicitly after Tab. But it creates an asymmetry: some buffer mutations notify, others don't. If future code relies on `onBufferChange` as a general buffer-mutation hook, this gap will cause subtle bugs.

**Recommendation:** Either add the callback call, or document the contract: "`insertText` is a PTY-controlled mutation; the PTY is responsible for any follow-up evaluations."

---

### #7 — ~~History navigation doesn't trigger ghost text~~ ✅ RESOLVED (won't fix)

**Severity: S4 — Low**
**File:** `src/documentdb/shell/ShellInputHandler.ts` (`historyPrevious`, `historyNext`)

When the user presses Up/Down arrows, the entire buffer is replaced by a history entry. These methods don't fire `onBufferChange`. Additionally, in `DocumentDBShellPty.handleInput`, the ghost text is cleared for all input except Right Arrow and Tab — including Up/Down arrows.

**Impact:** Ghost text never appears for recalled history entries. If the user recalls `db.us` from history and there's only one matching collection `users`, no ghost text is shown until they type another character.

**Recommendation:** Consider firing `onBufferChange` at the end of `historyPrevious` and `historyNext`, or accept this as intended behavior and document it.

==> actually, it's fine as it'd add too much noise.

---

### #8 — ~~No rate limiting on background cache fetch triggers~~ ✅ RESOLVED

**Severity: S4 — Low**
**File:** `src/documentdb/shell/ShellCompletionProvider.ts` (`getDatabaseCandidates`, `getDbDotCandidates`)
**Resolved:** [`e8cce7b`](https://github.com/microsoft/vscode-documentdb/commit/e8cce7b) — Added `_backgroundFetchTriggered` set to deduplicate concurrent fetches.

When the ClustersClient cache is empty, each Tab press fires `void client.listDatabases().catch(() => {})` or `void client.listCollections(...)`. Rapid Tab pressing causes multiple concurrent network requests.

```typescript
// Trigger background fetch
void client.listCollections(context.databaseName).catch(() => {
  // Non-critical
});
```

**Impact:** Unnecessary network traffic on empty caches. ClustersClient may or may not deduplicate concurrent requests internally.

**Recommendation:** Add a simple flag (`_fetchTriggered` per resource type) to avoid firing duplicate background fetches, or verify that ClustersClient deduplicates internally.

---

### #9 — ~~`DATABASE_METHODS` set is hardcoded, not derived from `documentdb-shell-api-types`~~ ✅ RESOLVED

**Severity: S4 — Low**
**File:** `src/documentdb/shell/ShellCompletionProvider.ts`, line ~130
**Resolved:** [`795f52f`](https://github.com/microsoft/vscode-documentdb/commit/795f52f) — Derived from `getMethodsByTarget('database')` at module load time.

`DATABASE_METHODS` is a hardcoded `Set` (14 entries) used to distinguish `db.<method>()` from `db.<collection>.`. Meanwhile, database method names are also available from `getMethodsByTarget('database')` in `documentdb-shell-api-types`.

**Impact:** If a new database method is added to the shell API types package, `DATABASE_METHODS` won't know about it. The completion provider would then treat `db.newMethod` as a collection named `newMethod`, offering collection method completions instead of nothing.

**Recommendation:** Derive `DATABASE_METHODS` from `getMethodsByTarget('database')` at module load time:

```typescript
const DATABASE_METHODS = new Set(getMethodsByTarget('database').map((m) => m.name));
```

---

### #10 — `findCommonPrefix` is case-insensitive but returns first candidate's casing

**Severity: S4 — Low**
**File:** `src/documentdb/shell/ShellCompletionRenderer.ts`, `findCommonPrefix`

The common prefix comparison is case-insensitive:

```typescript
common[j].toLowerCase() === text[j].toLowerCase();
```

But the returned prefix uses the first candidate's casing (`common = candidates[0].insertText`). If candidates are `["Users", "uploads"]`, the common prefix returned is `"U"` — which would insert an uppercase `U` even if the user typed lowercase `u`.

**Impact:** MongoDB collection/database names are case-sensitive. Inserting the wrong case would cause queries to target non-existent collections. However, this only manifests when candidates differ in casing of a common prefix, which is rare.

**Recommendation:** Use case-sensitive comparison instead, since MongoDB identifiers are case-sensitive. Change to:

```typescript
common[j] === text[j];
```

---

### #11 — Collection names conflicting with `DATABASE_METHODS` get no method completions

**Severity: S4 — Low**
**File:** `src/documentdb/shell/ShellCompletionProvider.ts`, `detectDbContext`

```typescript
if (!DATABASE_METHODS.has(collectionName)) {
  const prefix = afterDb.slice(dotIndex + 1);
  return { kind: 'collection-method', collectionName, prefix };
}
```

If a user has a collection named `aggregate`, `stats`, `version`, or any other name in `DATABASE_METHODS`, typing `db.aggregate.` would be treated as a database method call rather than a collection access. No method completions would be offered.

**Impact:** Users with unlucky collection names get no completions at `db.<name>.`. Rare in practice, but surprising.

**Recommendation:** Accept as a known limitation and document. The user can use bracket notation (`db["aggregate"].`), though that has its own issues (see #2).

---

### #12 — `handleInput` ghost text clearing compares raw `data` string against exact escape sequences

**Severity: S4 — Low**
**File:** `src/documentdb/shell/DocumentDBShellPty.ts`, `handleInput`

```typescript
if (data !== '\x1b[C' && data !== '\x09') {
  this._ghostText.clear((d) => this._writeEmitter.fire(d));
}
```

This comparison works correctly only if VS Code sends each key as a separate `handleInput` call. If the terminal sends multiple keystrokes in a single batch (e.g., rapid Right Arrow: `'\x1b[C\x1b[C'`), the check fails — `data` is a multi-char string that doesn't exactly match `'\x1b[C'`, so ghost text is incorrectly cleared.

**Impact:** In practice, VS Code typically sends individual key events to pseudoterminals, so this works. But it's a fragile assumption. Paste operations and certain terminal multiplexers can batch input.

**Recommendation:** Consider checking `data.startsWith('\x1b[C')` or `data === '\x09'` for single keys, or move the ghost clearing logic into the input handler where individual keys are already parsed.

---

### #13 — `detectMethodArgContext` regex doesn't handle nested method calls or `getCollection()`

**Severity: S4 — Low**
**File:** `src/documentdb/shell/ShellCompletionProvider.ts`, `detectMethodArgContext`

The regex for extracting collection and method names:

```typescript
const methodMatch = /db\.([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)$/.exec(beforeParen);
```

This doesn't handle `db.getCollection("name").find({...` because the `getCollection("name")` call interrupts the pattern. The regex expects `db.<identifier>.<identifier>` immediately before `(`.

**Impact:** Users who access collections via `db.getCollection("...")` instead of `db.<name>` get no field/operator completions inside method arguments. This is an uncommon but valid access pattern, especially for collections with special characters in names.

**Recommendation:** Accept as a known limitation for the fallback completion system. Document that method argument completions only work with the `db.<collection>.<method>()` syntax.

---

### #14 — Ghost text timer not cleared in `close()`'s sibling code paths

**Severity: S5 — Nit**
**File:** `src/documentdb/shell/DocumentDBShellPty.ts`

The `close()` method correctly clears `_ghostTextTimer`. However, `showPrompt()` and `handleInterrupt()` do not (covered in #3). This is listed separately because the ghost cleanup in `close()` proves the author was aware of the pattern but missed applying it consistently.

---

### #15 — Completion list rendering doesn't account for the prompt width

**Severity: S5 — Nit**
**File:** `src/documentdb/shell/ShellCompletionRenderer.ts`, `renderCompletionList`

The `terminalWidth` parameter is used to compute column layout, but the prompt prefix (e.g., `testdb> `) occupies some width. The completion list always starts at column 0 (via `\r\n`), so this isn't technically wrong. However, if the design ever changes to show inline completions (popup style), the prompt width would need to be considered.

**Impact:** None today. Future-proofing note only.

---

### #16 — `MAX_DISPLAY_ROWS` truncation logic can show empty columns

**Severity: S5 — Nit**
**File:** `src/documentdb/shell/ShellCompletionRenderer.ts`

The truncation calculation:

```typescript
const displayCount = displayRows * numCols;
const truncated = candidates.length > displayCount;
```

If there are 9 candidates in a 4-column layout, `totalRows = 3`, `displayRows = 3`, `displayCount = 12`. Since 9 < 12, it's not truncated. But the last row has only 1 candidate and 3 empty cells. This is fine visually but means the "…and N more" truncation only kicks in at 33+ candidates (8 rows × 4 cols + 1) in a typical 80-column terminal — well past the point where the list becomes overwhelming.

**Recommendation:** Consider lowering `MAX_DISPLAY_ROWS` or adding a max candidate count.

---

## Additional issues found in a second pass

### #17 — `replacementStart` is computed but never used, so Tab completion corrupts mid-token edits

**Severity: S3 — Medium**
**Files:** `src/documentdb/shell/ShellCompletionProvider.ts`, `src/documentdb/shell/DocumentDBShellPty.ts`

`CompletionResult` carries `replacementStart`, and `findReplacementStart()` is called for collection methods, cursor methods, and method-argument contexts. But the PTY never uses it. `applySingleCompletion()` and the common-prefix path only call `insertText(...)`, which inserts at the cursor without replacing any existing suffix.

**Repro:** Type `db.users.foo`, move the cursor between `f` and `oo`, then press Tab to complete `find`. The result becomes `db.users.findoo` instead of replacing the token cleanly.

**Impact:** Mid-line editing is a normal shell workflow after Left Arrow / Home / history recall. In those cases, completion can actively corrupt the buffer.

**Recommendation:** Use `replacementStart` to replace the token span around the cursor rather than append only the unmatched suffix.

---

### #18 — Case-insensitive matching can generate invalid mixed-case identifiers

**Severity: S3 — Medium**
**Files:** `src/documentdb/shell/ShellCompletionProvider.ts`, `src/documentdb/shell/DocumentDBShellPty.ts`

This is separate from Issue #10. Candidate filtering is case-insensitive, but completion insertion preserves whatever casing the user already typed and only appends the remaining suffix. For a real collection `users`, typing `db.US` and accepting the single match produces `db.USers`, not `db.users`.

**Impact:** DocumentDB and JavaScript identifiers are case-sensitive. The user ends up with a non-existent collection or method name even though completion appeared to “work”.

**Recommendation:** Either match case-sensitively for shell identifiers, or replace the whole token with `candidate.insertText`.

---

### #19 — Nested field completions are not quote-aware and break for dotted paths

**Severity: S2 — High**
**File:** `src/documentdb/shell/ShellCompletionProvider.ts`

Field candidates come from `SchemaStore.getKnownFields()` and commonly include dotted paths like `address.city`. But both `extractArgumentPrefix()` and `findReplacementStart()` stop at `.`. That means:

- typing inside `'address.c'` only uses prefix `c`, so `address.city` no longer matches
- when accepted from an empty key position, the provider inserts `address.city` as raw text even though object-literal keys with dots must be quoted (`"address.city"`)

**Repro:** `db.users.find({ "address.c|": "Seattle" })` or `db.users.find({ | })` and accept `address.city`.

**Impact:** Nested document queries — a very common pattern in DocumentDB — either get no completion or produce invalid shell syntax.

**Recommendation:** Treat dotted field paths as a single completion prefix in query-object contexts and emit quote-aware insertion text when a field name is not a valid bare JS identifier.

---

### #20 — Update / replace / distinct completions are mapped to the wrong argument

**Severity: S2 — High**
**File:** `src/documentdb/shell/ShellCompletionProvider.ts`

`getMethodArgumentCandidates()` chooses filter vs update vs pipeline metadata solely from `ctx.methodName`. It never parses which argument the cursor is currently in. That breaks common signatures such as:

- `updateOne(filter, update)`
- `updateMany(filter, update)`
- `findOneAndUpdate(filter, update)`
- `replaceOne(filter, replacement)`
- `distinct(fieldName, query?)`

**Repro:** In `db.users.updateOne({ na| }, { $set: { age: 1 } })`, the first argument should prefer filter operators, but the provider uses `UPDATE_COMPLETION_META` because the method name is `updateOne`.

**Impact:** The shell suggests the wrong language for the position the user is editing, especially on common write operations.

**Recommendation:** Parse commas and bracket depth to determine the current argument index, then choose completion sets per parameter rather than per method name only.

---

### #21 — Method-argument detection is not quote/regex aware, so parentheses inside strings disable completions

**Severity: S3 — Medium**
**File:** `src/documentdb/shell/ShellCompletionProvider.ts`

`detectMethodArgContext()` walks backward and counts raw `(` / `)` characters. It does not ignore strings, regex literals, or comments. A literal `)` inside `"text)"` or `/foo(bar)/` changes the depth calculation and can make the provider miss the actual method-call boundary.

**Repro:** `db.users.find({ note: ")", na| })` or `db.users.find({ name: /foo(bar)/, ag| })`.

**Impact:** Completion disappears in real-world filters precisely when the user is composing more complex queries.

**Recommendation:** Add a lightweight tokenizer or quote-aware scan before matching parentheses.

---

### #22 — `db.` method discoverability collapses on databases with many collections

**Severity: S4 — Low**
**Files:** `src/documentdb/shell/ShellCompletionProvider.ts`, `src/documentdb/shell/ShellCompletionRenderer.ts`

`getDbDotCandidates()` sorts all collections before database methods. `renderCompletionList()` then truncates to 8 rows. On a database with many collections, the visible list becomes “all collections, zero methods”, so `stats()`, `aggregate()`, `runCommand()`, etc. never appear in the picker.

**Impact:** Discoverability gets worse on the large, real-world databases where users most need help.

**Recommendation:** Reserve at least one row for database methods, group by kind, or cap collection rows before truncation.

---

### #23 — Wrapped-line editing is fundamentally unsupported, and completions make that more visible

**Severity: S3 — Medium**
**Files:** `src/documentdb/shell/ShellInputHandler.ts`, `src/documentdb/shell/DocumentDBShellPty.ts`

`setPromptWidth()` is currently a no-op with the comment “Reserved for future multi-line wrapping support”. The rest of the editor logic assumes the input is on a single terminal row and uses only horizontal cursor moves (`\b`, `\x1b[D`, `\x1b[C`). Once a query wraps past the terminal width, prompt rewrites, ghost text, and mid-line completion edits can land on the wrong visual row.

**Repro:** Type a long `find()` or `aggregate()` expression that wraps, then use Left Arrow + Tab or accept ghost text.

**Impact:** This is not hypothetical — real queries often exceed 80 columns. The fallback shell UI can visibly desync from the buffer during normal usage.

**Recommendation:** Either constrain the feature to single-line-safe cases for now or add real wrapped-line cursor accounting before relying on terminal-style inline UX.

---

### #24 — Cursor math and column layout are not safe for wide Unicode characters

**Severity: S4 — Low**
**Files:** `src/documentdb/shell/ShellInputHandler.ts`, `src/documentdb/shell/ShellGhostText.ts`, `src/documentdb/shell/ShellCompletionRenderer.ts`

The implementation uses `text.length`, `padEnd()`, and ANSI cursor moves based on JavaScript code units, not terminal display cells or grapheme clusters. Names like `日本語`, `emoji🚀`, or combining characters will leave the cursor in the wrong place and misalign the completion grid / ghost text.

**Impact:** International collection names and field values can visibly corrupt the terminal UI.

**Recommendation:** Use a display-width utility for cursor movement and column sizing instead of raw string length.

---

## Summary Table

| #   | Severity | Title                                                                | Origin           |
| --- | -------- | -------------------------------------------------------------------- | ---------------- |
| 1   | **S2**   | `onBufferChange` not fired for Ctrl+W/U/K                            | Copilot + Review |
| 2   | **S3**   | `db[` bracket notation parsing broken                                | Copilot          |
| 3   | **S3**   | Stale ghost text timer fires after prompt reset                      | Copilot + Review |
| 4   | **S4**   | `fieldLookup` closure re-fetches on every call                       | Copilot          |
| 5   | **S5**   | Typo in doc path (`autocomletion`)                                   | Copilot          |
| 6   | **S4**   | `insertText()` doesn't fire `onBufferChange`                         | Review           |
| 7   | **S4**   | History navigation doesn't trigger ghost text                        | Review           |
| 8   | **S4**   | No rate limiting on background fetch triggers                        | Review           |
| 9   | **S4**   | `DATABASE_METHODS` hardcoded, not derived from types                 | Review           |
| 10  | **S4**   | Case-insensitive `findCommonPrefix` returns wrong casing             | Review           |
| 11  | **S4**   | Collection names colliding with database methods                     | Review           |
| 12  | **S4**   | Ghost text clearing compares raw multi-char `data` string            | Review           |
| 13  | **S4**   | `detectMethodArgContext` regex doesn't handle `getCollection()`      | Review           |
| 14  | **S5**   | Ghost timer not cleared consistently across code paths               | Review           |
| 15  | **S5**   | Completion list doesn't account for prompt width                     | Review           |
| 16  | **S5**   | Truncation can show overwhelming completion lists                    | Review           |
| 17  | **S3**   | `replacementStart` is unused, so mid-token completion corrupts input | Review           |
| 18  | **S3**   | Case-insensitive single-match completion preserves wrong casing      | Review           |
| 19  | **S2**   | Nested field completions break for dotted / quoted keys              | Review           |
| 20  | **S2**   | Multi-argument methods use the wrong completion set                  | Review           |
| 21  | **S3**   | Parentheses inside strings / regex can disable completions           | Review           |
| 22  | **S4**   | Large databases hide `db.` methods behind collection truncation      | Review           |
| 23  | **S3**   | Wrapped-line queries are not safe for inline completion UX           | Review           |
| 24  | **S4**   | Unicode width handling can misalign cursor and picker                | Review           |

**Breakdown:** 0 S1, 3 S2, 6 S3, 11 S4, 4 S5 — **24 issues total**

---

## Copilot Review Comment Links (for follow-up)

All 5 Copilot review comments are **unresolved** and require responses:

1. **ShellInputHandler.ts** — `onBufferChange` missing for buffer-mutating operations
   → [Comment link](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764823) — Mapped to Issue #1

2. **ShellCompletionProvider.ts** — `db[` bracket notation routing broken
   → [Comment link](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764830) — Mapped to Issue #2

3. **ShellCompletionProvider.ts** — `fieldLookup` performance
   → [Comment link](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764835) — Mapped to Issue #4

4. **DocumentDBShellPty.ts** — Stale ghost text timer after prompt reset
   → [Comment link](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764840) — Mapped to Issue #3

5. **terminal-enhancements.md** — Doc path typo
   → [Comment link](https://github.com/microsoft/vscode-documentdb/pull/576#discussion_r2043764845) — Mapped to Issue #5

> **Note:** The above comment links use placeholder anchors derived from the Copilot review. Actual GitHub discussion thread IDs should be verified on the PR page before replying.

---

## Design-Level Observations

These are not bugs, but potential blind spots in the architecture documented in `9-shell-autocompletion.md`:

### Ghost text contract is implicit

The `onBufferChange` callback is documented as "Called after any buffer/cursor change" but actually only fires for a subset of mutations (printable chars, backspace, delete). The contract between `ShellInputHandler` and the PTY is unclear about which mutations trigger the callback. This creates a maintenance trap — future contributors may add new buffer-mutating operations and forget to fire the callback.

**Recommendation:** Either:

- Make `onBufferChange` truly fire after ALL buffer mutations (including `insertText`, history, clear operations), or
- Rename to `onPrintableInputChange` to make the limited scope explicit

### Synchronous-only data model limits completions on first use

The synchronous cache design (Tab never blocks) means the first Tab press in a fresh session returns no database/collection completions. The background fetch populates the cache for the next Tab press. This two-press pattern is undiscoverable — users may conclude completions don't work.

The plan doc acknowledges this but doesn't discuss mitigations like:

- Pre-populating caches during `initializeSession()` (the data is needed anyway for tree view)
- Showing a "(loading…)" indicator on first empty Tab press
- Pre-fetching collection names for the connected database during shell startup

### No integration test coverage

The test coverage is unit-only (mocked ClustersClient, SchemaStore). There's no integration test verifying the end-to-end flow:

1. PTY receives Tab → input handler fires callback → completion provider returns results → renderer formats → PTY writes to terminal
2. PTY receives keystrokes → debounced ghost text → provider returns → ghost text rendered → right arrow accepts

Unit tests verify each component in isolation but not the wiring in `DocumentDBShellPty`. A wiring bug (e.g., callback not connected, wrong parameter order) would pass all unit tests.
