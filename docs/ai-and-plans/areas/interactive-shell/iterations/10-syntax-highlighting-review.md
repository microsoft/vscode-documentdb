# PR #580 Review — Interactive Shell with Syntax Highlighting

**PR:** https://github.com/microsoft/vscode-documentdb/pull/580
**Reviewer:** Agent (automated review against implementation plan)
**Date:** 2026-04-15
**Copilot Reviewer Comments:** 4 comments submitted (merged below)

---

## Overall Assessment

The implementation faithfully follows the plan from `0-plan.md`. All 4 work items are completed, all 80 tests pass, and the architecture matches the plan's design. The deviations (named rule properties instead of tuples, inlined regex patterns, `colorizeShellInput.ts` convenience wrapper) are all improvements over the original plan and are documented in the plan itself.

**File structure matches plan:** ✅ (with one minor location difference — see I-06)
**All plan work items implemented:** ✅ (WI-1 through WI-4)
**Tests cover plan requirements:** ✅ (all categories from plan tables)
**Color mapping matches plan spec:** ✅ (all ANSI codes correct)
**Setting gate (`colorOutput`) wired:** ✅
**No new dependencies:** ✅
**Copyright headers present:** ✅
**Monaco license attribution:** ✅

---

## Issues

### I-01: `regexpesc` regex contains spurious space — **Severity: HIGH (Bug)**

**File:** `src/documentdb/shell/highlighting/monarchRules.ts` line 183

The `regexpesc` pattern contains a space between the character class and the `|` alternation:

```
/\\(?:[bBdDfnrstvwWn0\\\/]|[(){}\[\]\$\^|\-*+?\.] |c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/
                                                  ^-- spurious space
```

This means the second alternative matches "a special regex control character **followed by a literal space**" rather than just "a special regex control character". The correct pattern (matching the Monaco source where `@regexpctl` is inlined) should be:

```
/\\(?:[bBdDfnrstvwWn0\\\/]|[(){}\[\]\$\^|\-*+?\.]|c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/
```

**Impact:** Regex escape sequences like `\(` or `\[` inside regex literals will only be recognized if followed by a space. Without a trailing space, these will fall through to the `regexp.invalid` rule (`/\\./`), producing incorrect token types. This affects regex highlighting accuracy.

**Fix:** Remove the space before `|c[A-Z]` on line 183.

---

### I-02: Misleading comment about `@name` resolution — **Severity: LOW (Cosmetic)**

**File:** `src/documentdb/shell/highlighting/monarchRules.ts` lines 190–191

The comment says:
```
// Inline regex references like `@digits` are resolved in the executor
// by replacing `@name` with the source of the corresponding pattern.
```

This contradicts the implementation — the DEVIATION note in the plan explicitly states that patterns were **inlined directly** and the executor does NOT perform `@name` resolution. This comment is leftover text that was not updated after the deviation was adopted.

**Fix:** Update the comment to reflect reality, e.g.:
```
// All @name references have been inlined directly in the regex patterns below.
// The executor does not need to resolve @name references.
```

---

### I-03: Module-level mutable cache in `monarchRunner.ts` — **Severity: MEDIUM (Design)**

**File:** `src/documentdb/shell/highlighting/monarchRunner.ts` lines 29–30

```typescript
let cachedInput: string | undefined;
let cachedResult: TokenSpan[] | undefined;
```

The tokenizer cache is module-level global state. This creates:
1. **Test interference risk** — Tests sharing the same module instance may get cached results from previous test runs. The caching tests verify this intentionally, but it means test execution order matters. A test calling `tokenize('const x = 1', rules)` early would affect later tests calling the same input.
2. **Multi-shell scenario** — If two shell terminals are open, they share the same cache. Since only one character is cached, this causes unnecessary re-tokenization when switching between shells (cache thrashing). This is not a correctness issue, just a performance miss.

The plan explicitly specifies this caching approach, so it's by design. However, encapsulating the cache in a class or closure would be more robust.

**Recommendation:** Consider moving the cache into the `ShellInputHandler` or creating a `Tokenizer` class instance per shell. Not blocking for this PR.

---

### I-04: `input_indexOf` uses snake_case naming — **Severity: LOW (Convention)**

**File:** `src/documentdb/shell/highlighting/monarchRunner.ts` line 237

```typescript
function input_indexOf(haystack: string, needle: string, fromIndex: number): number {
```

TypeScript convention (and the project's ESLint config) uses camelCase for function names. This should be `inputIndexOf`.

**Fix:** Rename to `inputIndexOf`.

---

### I-05: Linear scan for keyword/operator lookup — **Severity: LOW (Performance)**

**File:** `src/documentdb/shell/highlighting/monarchRunner.ts` line 195

```typescript
if (Array.isArray(array) && (array as string[]).includes(matchedText)) {
```

The `resolveCases` function performs `Array.includes()` which is O(n) on every identifier match. With 47 keywords, 10 BSON constructors, and 8 shell commands, this is fine for typical shell input (< 200 chars), well within the 0.5ms target. However, converting these arrays to `Set` objects (lazily, on first use) would be more idiomatic and future-proof.

**Recommendation:** Consider converting to `Set` in a follow-up. Not blocking.

---

### I-06: `shellHighlighter.test.ts` location differs from plan — **Severity: LOW (Convention)**

**File:** `src/documentdb/shell/shellHighlighter.test.ts`

The plan's file structure specifies:
```
src/documentdb/shell/highlighting/
└── shellHighlighter.test.ts  # WI-4 integrated tests
```

But the file is actually at `src/documentdb/shell/shellHighlighter.test.ts` (one directory up, alongside `ShellInputHandler.ts`). This placement is arguably better since the integration tests exercise `ShellInputHandler` + highlighting together, but it's a deviation from the plan.

**Recommendation:** Acceptable as-is. The test location makes sense given it tests integration between `ShellInputHandler` and the highlighting pipeline.

---

### I-07: `colorizeShellInput.ts` not in original plan — **Severity: INFO (Deviation)**

**File:** `src/documentdb/shell/highlighting/colorizeShellInput.ts`

The plan specifies importing `tokenize`, `colorizeInput`, and `shellLanguageRules` directly in `DocumentDBShellPty` (WI-4d). The implementation instead creates a convenience wrapper (`colorizeShellInput`) and imports just that. This is a cleaner separation of concerns — the PTY doesn't need to know about the tokenizer/colorizer internals.

**Assessment:** Positive deviation. No action needed.

---

### I-08: `resolveCases` relies on `Object.entries` iteration order — **Severity: LOW (Correctness)**

**File:** `src/documentdb/shell/highlighting/monarchRunner.ts` lines 186–206

The `resolveCases` function iterates over `Object.entries(cases)` and returns the first matching array. This means the order of keys in the `actionCases` object determines priority (e.g., `@shellCommands` before `@keywords`). In JavaScript, `Object.entries` preserves insertion order for string keys, so this works correctly. However, it's an implicit contract — reordering keys in `monarchRules.ts` would change behavior silently.

The plan specifies this ordering requirement: "Add a `cases` branch in the lowercase identifier rule so `@shellCommands -> 'shell.command'` is checked **before** `@keywords`." The implementation correctly places `@shellCommands` first.

**Recommendation:** Add a brief comment in the `actionCases` objects noting that key order matters. Not blocking.

---

### I-09: No `l10n` strings added — **Severity: INFO (Verification)**

No user-facing strings were added in this PR. All new code is internal (tokenizer, colorizer, ANSI sequences). The `colorize` callback and `reRenderLine()` produce terminal escape sequences, not localized messages. The `l10n` step from the PR checklist is satisfied (no new strings to localize).

---

### I-10: Wrapped input lines are not actually supported by `reRenderLine()` — **Severity: HIGH (Bug)**

**Files:** `src/documentdb/shell/ShellInputHandler.ts` (`reRenderLine()`), `src/documentdb/shell/DocumentDBShellPty.ts`

The full-line re-render strategy assumes the editable input always fits on a single terminal row. `reRenderLine()` resets with `\r` and moves right by `_promptWidth`, but it never accounts for the terminal's column count or the number of wrapped rows already occupied by `prompt + buffer`. Once the user types past the terminal width, the next re-render starts at the beginning of the **current wrapped row** rather than the original prompt line.

**Impact:** Visual corruption and cursor drift on long queries. This directly undermines manual test **T-17** in the plan (`No wrapping artifacts; cursor tracks correctly at end`) and will be visible on longer `find()` / `aggregate()` expressions.

**Fix:** Make the renderer wrap-aware (track terminal columns and move up before rewriting), or explicitly scope the feature to single-row input until that support exists.

---

### I-11: Cursor math uses `String.length` instead of terminal display width — **Severity: HIGH (Correctness)**

**Files:** `src/documentdb/shell/ShellInputHandler.ts`, `src/documentdb/shell/DocumentDBShellPty.ts`

Both prompt-width and cursor-offset calculations use JavaScript string length (`prompt.length`, `_buffer.length - _cursor`, etc.). That is not the same as **terminal display width** for emoji, CJK, and combining characters. The codebase already recognizes this in `ShellGhostText.ts`, which implements `terminalDisplayWidth()` for exactly this reason, but the new highlighting path does not reuse that logic.

**Impact:** Prompts like `数据库> ` or inputs containing emoji / non-ASCII text will misplace the cursor, erase the wrong columns, or overwrite part of the prompt. This is a correctness bug, not just a cosmetic issue.

**Fix:** Reuse the same display-width calculation used by `ShellGhostText` anywhere the renderer computes cursor movement or prompt width.

---

### I-12: Completion-initiated edits bypass the highlighting path — **Severity: MEDIUM (UX / Requirement Gap)**

**Files:** `src/documentdb/shell/ShellInputHandler.ts` (`insertText()`, `replaceText()`), `src/documentdb/shell/DocumentDBShellPty.ts` (`rewriteCurrentLine()`)

The new highlighting architecture correctly re-renders after typed edits (`insertCharacter`, `handleBackspace`, `handleDelete`, etc.), but PTY-controlled buffer mutations still write raw text directly to the terminal. This affects:
- accepting ghost text,
- single-candidate Tab completion,
- replacement completions (quoted field paths / bracket notation),
- prompt rewrite after showing the completion list.

Because these flows bypass `reRenderLine()` / `colorize`, the line can temporarily lose highlighting or show newly inserted text uncolored until the user types again.

**Impact:** This conflicts with WI-4's stated goal that highlighting should apply on **every buffer mutation**.

**Fix:** Route these PTY-controlled mutations through the same re-render/colorize path, or at minimum add dedicated tests and document the intended exception.

---

### I-13: Key plan scenarios are still untested — **Severity: MEDIUM (Coverage Gap)**

**Files:** `src/documentdb/shell/shellHighlighter.test.ts`, `src/documentdb/shell/ShellInputHandler.test.ts`, `src/documentdb/shell/DocumentDBShellPty.test.ts`

The automated tests cover the happy path well, but several of the plan's most failure-prone scenarios are still missing from test coverage:
- long wrapped lines from **T-17**,
- Unicode / wide-character prompts or input,
- Tab completion and ghost-text acceptance with highlighting still intact,
- completion-list redraw preserving colorized input.

**Impact:** The existing suite can pass cleanly while these user-visible regressions remain undetected.

**Recommendation:** Add contract-style tests for wrapped lines and completion redraw before calling the feature fully production-ready.

---

## Copilot Reviewer Comments

Copilot submitted a review with **4 comments** (generated 2026-04-15). Below each is mapped to the corresponding agent finding (or listed as new).

### C-01: Cache ignores `rules` parameter (×2 duplicate threads)

**Thread IDs:** `PRRT_kwDOODtcO857GrPs`, `PRRT_kwDOODtcO857GrQL`
**File:** `src/documentdb/shell/highlighting/monarchRunner.ts`
**Links:** [Thread 1](https://github.com/microsoft/vscode-documentdb/pull/580#discussion_r2494398444), [Thread 2](https://github.com/microsoft/vscode-documentdb/pull/580#discussion_r2494398476)

> "The memoization key ignores the `rules` parameter, so calling `tokenize()` with the same input but different `rules` will incorrectly return a cached result from the previous ruleset. Fix by including rules identity in the cache (e.g., store `cachedRules` and require `rules === cachedRules` for a cache hit, or use a `WeakMap<MonarchLanguageRules, { input, result }>`)."

**Mapping:** Related to **I-03** (module-level mutable cache). The agent review noted the global cache design as a concern. Copilot specifically flags the missing `rules` identity check.

**Assessment:** In practice, `tokenize()` is only ever called with `shellLanguageRules` (the single exported instance from `monarchRules.ts`). The `colorizeShellInput.ts` wrapper hard-codes it, and no other callers exist. However, the function signature accepts `rules` as a parameter, creating an API contract that the cache violates. **Severity: LOW in practice, MEDIUM as an API correctness concern.** A simple `cachedRules` reference check (`rules === cachedRules`) is a one-line fix with no performance cost.

---

### C-02: `regexpesc` spurious space

**Thread ID:** `PRRT_kwDOODtcO857GrQk`
**File:** `src/documentdb/shell/highlighting/monarchRules.ts`
**Link:** [Thread](https://github.com/microsoft/vscode-documentdb/pull/580#discussion_r2494398500)

> "The `regexpesc` pattern contains an extra literal space after the character class (`[...\\.] |c[A-Z]...`). As written, it requires a space after that escaped character, which will cause valid regex escapes to be mis-tokenized. Remove the stray space so the alternation is `[...]|c[A-Z]|...`."

Copilot provides a suggested fix:
```typescript
const regexpesc = /\\(?:[bBdDfnrstvwWn0\\\/]|[(){}\[\]\$\^|\-*+?\.]|c[A-Z]|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/;
```

**Mapping:** Identical to **I-01** in the agent review. Both reviews independently flagged the same bug.

---

### C-03: `setPromptWidth` must be called for every prompt

**Thread ID:** `PRRT_kwDOODtcO857GrQ6`
**File:** `src/documentdb/shell/DocumentDBShellPty.ts`
**Link:** [Thread](https://github.com/microsoft/vscode-documentdb/pull/580#discussion_r2494398522)

> "With `ShellInputHandler` now using `\r` + `promptWidth` for every `reRenderLine()`, the PTY must ensure `setPromptWidth()` is called whenever the prompt (and continuation prompt) is written, otherwise re-renders will return to column 0 and risk overwriting the prompt area. If the prompt includes any ANSI styling, compute `promptWidth` using the visible (non-ANSI) width."

**Mapping:** This was not explicitly flagged as an issue in the agent review, but it was **verified as correctly implemented** — `showPrompt()` calls `setPromptWidth(prompt.length)` at line 503 and `showContinuationPrompt()` calls it at line 525. Both prompts are plain text without ANSI codes, so `.length` equals the visible width. No action needed — the implementation already satisfies this concern.

**Assessment:** Non-issue (already handled correctly). Copilot's concern is valid as a general principle but the code already does the right thing.

---

## Summary Table

| ID | Severity | File | Issue | Action |
|----|----------|------|-------|--------|
| I-01 / C-02 | **HIGH** | `monarchRules.ts:183` | Spurious space in `regexpesc` regex breaks regex escape matching | ✅ Fixed (`eba9286`) |
| I-02 | LOW | `monarchRules.ts:190-191` | Misleading comment about `@name` resolution (contradicts deviation) | ✅ Fixed (`cad3ae1`) |
| I-03 / C-01 | MEDIUM | `monarchRunner.ts:29-30` | Module-level cache ignores `rules` param; global state concerns | ✅ Fixed (`af0a427`) |
| I-04 | LOW | `monarchRunner.ts:237` | `input_indexOf` uses snake_case (should be camelCase) | ✅ Fixed (`6c35419`) |
| I-05 | LOW | `monarchRunner.ts:195` | Linear array scan for keyword lookup (O(n) per match) | Deferred (not blocking) |
| I-06 | LOW | `shellHighlighter.test.ts` | Test file location differs from plan (one dir up) | Accept as-is |
| I-07 | INFO | `colorizeShellInput.ts` | Extra convenience wrapper not in plan | Accept (positive deviation) |
| I-08 | LOW | `monarchRunner.ts:186-206` | `resolveCases` relies on implicit key insertion order | ✅ Fixed (`50c0173`) |
| I-09 | INFO | — | No l10n strings needed | Verified |
| I-10 | **HIGH** | `ShellInputHandler.ts` / `DocumentDBShellPty.ts` | Full-line re-render assumes a single terminal row; wrapped input is not handled | ✅ Fixed (`6c2e7e4`) |
| I-11 | **HIGH** | `ShellInputHandler.ts` / `DocumentDBShellPty.ts` | Cursor math uses `String.length` instead of terminal display width | ✅ Fixed (`6c2e7e4`) |
| I-12 | MEDIUM | `ShellInputHandler.ts` / `DocumentDBShellPty.ts` | Completion and ghost-text insertions bypass the colorized re-render path | ✅ Fixed (`63c8f4f`) |
| I-13 | MEDIUM | shell highlighting tests | Missing coverage for wrapped lines, Unicode width, and completion redraw | Deferred (separate PR) |
| C-03 | INFO | `DocumentDBShellPty.ts` | `setPromptWidth` must be called for every prompt | Already handled correctly |

---

## Recommendation

**Address before merge:**
1. **I-01 / C-02** — ✅ Fixed in `eba9286` — Removed the spurious space in `regexpesc`
2. **I-03 / C-01** — ✅ Fixed in `af0a427` — Added `cachedRules` identity check to tokenizer cache
3. **I-10** — ✅ Fixed in `6c2e7e4` — `reRenderLine()` is now wrap-aware (moves cursor up to prompt row, uses `\x1b[J`, computes row/column offsets)
4. **I-11** — ✅ Fixed in `6c2e7e4` — Cursor math uses `terminalDisplayWidth()` (extracted to shared module) instead of `String.length`

**Strongly consider before merge:**
5. **I-12** — ✅ Fixed in `63c8f4f` — `insertText()`, `replaceText()`, and `rewriteCurrentLine()` now route through `reRenderLine()` / `renderCurrentLine()` so highlighting applies on every buffer mutation
6. **I-13** — Deferred to a separate PR. Additional regression tests for wrapped lines, Unicode width, and completion redraw.

---

## Fix Log

All fixes applied 2026-04-15. 398 shell tests pass (12 suites). Prettier and lint clean.

| Commit | Issue(s) | Summary |
|--------|----------|---------|
| `eba9286` | I-01, C-02 | Removed spurious space in `regexpesc` regex pattern. The second alternative `[...] |c[A-Z]` required a trailing space after escaped regex control characters, causing valid escapes like `\(` or `\[` to mis-tokenize. |
| `cad3ae1` | I-02 | Updated misleading comment that stated `@name` references are resolved by the executor. All references were inlined directly per the documented deviation. |
| `af0a427` | I-03, C-01 | Added `cachedRules` reference check to the tokenizer cache. The cache now requires both `input === cachedInput` and `rules === cachedRules` for a hit, honoring the API contract. |
| `6c35419` | I-04 | Renamed `input_indexOf` → `inputIndexOf` (camelCase per TypeScript convention). |
| `50c0173` | I-08 | Added comment documenting that key order in `actionCases` objects determines match priority (Object.entries insertion order). |
| `6c2e7e4` | I-10, I-11 | Made `reRenderLine()` wrap-aware: cursor moves up to prompt row before `\r`, uses `\x1b[J` instead of `\x1b[K`, computes row/column cursor repositioning. Extracted `terminalDisplayWidth()` from `ShellGhostText.ts` to shared `terminalDisplayWidth.ts` module. All cursor math now uses display width instead of `String.length`. Added `setColumns()` to `ShellInputHandler`, wired from `DocumentDBShellPty`. |
| `63c8f4f` | I-12 | `insertText()` and `replaceText()` now call `reRenderLine()` instead of manual ANSI echo. `rewriteCurrentLine()` delegates to `renderCurrentLine()` using the colorize callback. Syntax highlighting now applies on every buffer mutation including completions and ghost text. |
