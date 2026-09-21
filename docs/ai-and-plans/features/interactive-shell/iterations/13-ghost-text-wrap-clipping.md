---
feature: interactive-shell
kind: iteration
status: active
prs: []
created: 2026-09-18
code:
    - src/documentdb/shell/ShellGhostText.ts
    - src/documentdb/shell/DocumentDBShellPty.ts
    - src/documentdb/shell/terminalDisplayWidth.ts
    - src/documentdb/shell/ShellInputHandler.ts
---

# Step 13 — Ghost text wrapping corrupts the input line

**Branch:** `dev/tnaum/integrated-shell-improvements`
**Reported by:** external user (screenshot), reproduced locally after narrowing the terminal

> Every keystroke repainted the input line on a **new** row, stacking one line per character.
> The cause was ghost text overflowing the terminal width — not the input buffer, and not the
> user's operating system.

## Symptom

Typing `db.<collection>.validate(` and continuing to type produced a stack of lines, each one
character longer than the last:

```
newDb2> db.newColl2.validatE(   🛈 Run db.newColl2.find() first
        db.newColl2.validate(   🛈 Run db.newColl2.find() first
        db.newColl2.validate({  🛈 Run db.newColl2.find() fir
        db.newColl2.validate({re  🛈 Run db.newColl2.find() f
```

The command still executed correctly on Enter — the buffer was never corrupted, only the
rendering.

Two details in the report identified the mechanism before any code was read:

- The stacked lines carry **no prompt**, just an indent equal to the prompt width. That is the
  signature of `reRenderLine()`'s Step 2 (`\r` followed by `\x1b[<promptWidth>C`) executing on a
  row that is not the prompt row.
- The hint appears progressively "truncated". It was never truncated — that is simply the part
  that fit before the right edge, and the buffer grew one column per repaint.

## Root cause

`ShellGhostText.show()` wrote the suggestion and then walked the cursor back to the editing
position:

```ts
write(GHOST_STYLE + text + ANSI_RESET);
const displayWidth = terminalDisplayWidth(text);
if (displayWidth > 0) {
    write(`\x1b[${String(displayWidth)}D`);
}
```

`ShellGhostText` was never given the terminal column count. When
`promptWidth + bufferWidth + ghostWidth` exceeded the terminal width, the sequence unravelled:

1. The ghost text ran past the right edge and xterm.js wrapped it onto the next row.
2. **CUB (`\x1b[nD`) does not move between rows** — it clamps at column 1 of the current row. The
   cursor was left stranded on the wrapped row.
3. The next keystroke called `clearGhostState()`, whose `\x1b[K` erased the *wrapped* row and left
   the ghost fragment sitting on the real input row.
4. `reRenderLine()` Step 1 consults `_lastCursorRow`, which is derived only from
   `_promptWidth + bufferWidth`. Ghost text is invisible to that calculation, so with prompt and
   buffer still fitting on one row it computed `0` and emitted no `\x1b[nA`.
5. `\r` + `\x1b[<promptWidth>C` + buffer then painted the line on the stranded row.

Each keystroke repeated the cycle one row lower.

### Relationship to I-10 / I-11

[10-syntax-highlighting-review.md](./10-syntax-highlighting-review.md) raised I-10 ("Wrapped input
lines are not actually supported by `reRenderLine()`") and I-11 (cursor math using `String.length`).
Both were fixed in `6c2e7e4`, which made the renderer wrap-aware and extracted
`terminalDisplayWidth()` **out of `ShellGhostText.ts`** into a shared module.

That fix covered the *buffer* path only. Ghost text donated the width helper and was then left as
the one writer that still had no notion of terminal width. This bug is the unclosed half of I-10.

## Why it was not reproducible at first

It is **not platform-dependent**, despite the reporter being on native Windows and the maintainer on
Windows + WSL. VS Code's `Pseudoterminal` API writes directly into xterm.js in the renderer process:
there is no ConPTY, no winpty, and no OS terminal emulator in the path. The same xterm.js build
parses the escape sequences on every platform.

Two environmental variables actually gated the repro:

- **Terminal width.** Measuring the reporter's screenshot: prompt `newDb2> ` = 8 columns, buffer
  `db.newColl2.validate(` = 21, visible hint tail ≈ 32 → their panel was roughly **61 columns**. The
  full hint is 54 columns, so the line needed 83 columns to fit. A maintainer with a panel wider
  than 83 columns sees nothing wrong.
- **Typing speed.** `handleBufferChange()` debounces ghost evaluation by 50 ms and cancels the
  pending timer on each keystroke. Typing quickly renders the ghost only once, at the end; typing
  slower than ~50 ms per character renders — and re-wraps — on every character.

The trigger condition is:

$$\text{promptWidth} + \text{bufferWidth} + \text{ghostWidth} > \text{cols}$$

Note that the schema hint embeds the collection name, so long collection names lower the width
threshold for everyone. The confirming screenshot used `vector_index_debug_cases`.

## Reproduction

1. Open the shell, connect, and `use` a database.
2. Pick a collection you have **not** run `find()` on in this session — `evaluateGhostText()` only
   shows the schema hint when `SchemaStore.getKnownFields()` returns empty and the context is
   `method-argument`.
3. Narrow the terminal panel to roughly 60 columns.
4. Type `db.<collection>.validate(` and keep typing **slowly**.

To confirm the mechanism without adjusting the panel, temporarily call
`this._inputHandler.setColumns(40)` in `open()`; the bug then reproduces at any typing speed.

## Fix — clip, do not wrap

The operator chose clipping over making `reRenderLine()` ghost-aware. Ghost text is a hint; losing
its tail is acceptable, whereas a wrapped hint corrupts the line.

| File                     | Change                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `terminalDisplayWidth.ts` | Added `clipToDisplayWidth()` — grapheme-safe truncation via `Intl.Segmenter`, so surrogate pairs are never split                       |
| `ShellInputHandler.ts`   | Added the `cursorColumn` getter (`_promptWidth` + display width up to the cursor)                                                      |
| `ShellGhostText.ts`      | `show()` takes optional `availableColumns` and clips to it, appending `…` when truncated                                               |
| `DocumentDBShellPty.ts`  | Added `availableGhostColumns()`, passed to all three `show()` call sites (completion, closing brackets, schema hint)                    |

Two details worth preserving:

- **`availableGhostColumns()` returns `cols - 1 - (cursorColumn % cols)`.** The `-1` keeps the final
  column free. Writing into the last column sets the terminal's deferred-wrap flag, which is the
  same trap in a different disguise.
- **The full suggestion is still stored in `_currentGhost`.** Only the rendered form is clipped, so
  Tab / Right Arrow still accepts the complete completion even when the display was cut short. The
  re-render dedupe now compares the rendered text as well, so a terminal resize repaints correctly.

## Tests

- `ShellGhostText.test.ts` — new `width clipping` block: never renders wider than the available
  columns, the cursor-back distance always equals what was written, no render at zero or negative
  width, full text retained for acceptance, re-render on width change, no surrogate-pair splitting.
- `ShellInputHandler.test.ts` — new `cursorColumn` block, including display-width counting for
  surrogate pairs.

13 suites / 468 tests pass under `src/documentdb/shell/`; `npm run build` is clean.

## Deliberately not done

- **`reRenderLine()` is still not ghost-aware.** `_lastCursorRow` continues to ignore ghost text.
  Clipping makes that safe today, but any future writer that emits past the cursor without clipping
  will resurrect this bug. This is the remaining structural weakness.
- **The `🛈` (U+1F6C8) glyph was kept.** `terminalDisplayWidth()` counts it as 1 column, matching
  xterm's wcwidth table, but the reporter's font substitutes a different glyph (it renders as `①`
  in their screenshot). If a substituted glyph is measured as double-width the cursor-back is off by
  one. Clipping bounds the damage to a single column instead of a wrap, so this was left alone
  rather than swapped for an ASCII marker.
- **`ShellGhostText.accept()` is dead code** — referenced only from its own tests, never from
  `DocumentDBShellPty`, which uses `currentText` + `clearGhostState()` + `insertText()` instead. Out
  of scope here; a candidate for removal.

## Lessons

- In this codebase a terminal rendering bug that "only happens for one user" should prompt a
  question about **terminal column count and typing speed** before any question about the operating
  system. The `Pseudoterminal` API removes the OS from the rendering path entirely.
- Anything written to the right of the cursor and then undone with CUB must be clipped to the
  current row. CUB cannot cross rows, so an unclipped writer silently desynchronises the renderer's
  idea of which row it is on.
