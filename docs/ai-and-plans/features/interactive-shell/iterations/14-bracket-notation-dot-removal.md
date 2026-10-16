---
feature: interactive-shell
kind: iteration
status: active
prs: [937]
created: 2026-09-18
code:
    - src/documentdb/shell/ShellCompletionProvider.ts
    - src/documentdb/shell/DocumentDBShellPty.ts
---

# Step 14 — Bracket-notation completion left the `db.` dot behind

**Branch:** `dev/tnaum/integrated-shell-improvements`
**Reported by:** maintainer (screenshot of a live shell session)

> Accepting a special-character collection name after `db.` produced `db.['my-coll']` —
> a SyntaxError. The bracket switch worked; the dot removal was never implemented.

## Symptom

```
newDb2> db.
newDb2> db.['my-collection']      ← Tab accepted here
```

The candidate correctly switched to bracket notation, but the `.` that triggered the
completion survived in front of it.

## Root cause

The replacement span never included the dot.

`makeCollectionCandidate()` has always returned `insertText: "['stores (10)']"` for names that
fail `needsBracketNotation()`. Acceptance, however, lived in
`DocumentDBShellPty.applySingleCompletion()` and deleted exactly `result.prefix.length`
characters backwards from the cursor. In the `db-dot` context `replacementStart` is
`'db.'.length`, so the prefix begins **after** the dot:

| Typed    | prefix | deleted | inserted          | result               |
| -------- | ------ | ------- | ----------------- | -------------------- |
| `db.sto` | `sto`  | `sto`   | `['stores (10)']` | `db.['stores (10)']` |
| `db.`    | `''`   | —       | `['stores (10)']` | `db.['stores (10)']` |

The empty-prefix case took the other branch (`insertText.slice(0)` → plain `insertText()`), so
both paths were broken for the same underlying reason.

The candidate knew it needed bracket notation. It had no way to say _"and delete the character
in front of me."_ `CompletionResult.replacementStart` is per-context, and the same `db-dot`
context legitimately serves both dot- and bracket-notation candidates, so widening it for the
whole context would have corrupted the normal collection names.

### Doc drift

[09-shell-autocompletion.md](./09-shell-autocompletion.md) decision 8 states that typing `db.sto`
and pressing Tab "produces `db['stores (10)']`". That was the intent, never the behavior. The
`needsBracketNotation()` half shipped in `b6da576`; the dot-removal half did not, and the tests
asserted only on `insertText` in isolation — never on the resulting buffer. That is why it
survived a full review round.

## Fix — let the candidate own its replacement span

Added an optional `replaceCharsBefore` to `CompletionCandidate`: extra characters to delete
_before_ the typed prefix. Bracket-notation collection candidates set it to `1`.

| File                         | Change                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ShellCompletionProvider.ts` | `replaceCharsBefore?: number` on `CompletionCandidate`; set to `1` in `makeCollectionCandidate()` for the bracket branch   |
| `DocumentDBShellPty.ts`      | `applySingleCompletion()` deletes `prefix.length + replaceCharsBefore`; `evaluateGhostText()` skips candidates that set it |

Two supporting checks needed no change, and it is worth recording why:

- **`findCommonPrefix()`** already refuses to slice when the common prefix does not start with
  the typed text (case-insensitive), so a bracket candidate among several matches cannot leak
  `['` into the buffer.
- **`replaceText()`** clamps `deleteCount` to the cursor position, so the extra character can
  never delete past the start of the buffer.

The ghost-text guard previously relied on `!insertText.startsWith(prefix)` to exclude these
candidates. That happened to be true for bracket notation, but it is an accident: any future
candidate that rewrites text _before_ the cursor while still starting with the prefix would have
rendered a ghost that lies about what acceptance will do. The guard now checks
`replaceCharsBefore` explicitly.

## Tests

`ShellCompletionProvider.test.ts` — three additions to the existing
`special-char collection auto-switch to bracket notation` block: `replaceCharsBefore` is `1` for
bracket candidates, `undefined` for dot candidates, and — the one that would have caught this —
a test that **applies** the replacement to the buffer and asserts the result is
`db['stores (10)']`.

13 suites / 471 tests pass under `src/documentdb/shell/`; `npm run build` is clean.

## Lessons

- Asserting on `insertText` alone is not enough. A completion is `(deleteCount, insertText)`
  applied to a buffer; tests that check only the second half will miss an entire class of bug.
  Prefer at least one test per candidate shape that applies the edit and compares the buffer.
- When a candidate's insertion is not a pure suffix of what the user typed, the _candidate_ has
  to carry the replacement span. A per-context `replacementStart` cannot describe a context whose
  candidates replace different amounts of text.
