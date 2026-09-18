---
feature: interactive-shell
kind: exploration
status: active
prs: []
created: 2026-09-18
updated: 2026-09-18
---

# Interactive Shell — liveness audit and idea backlog

## Briefing for the implementing agent

You are picking this up with fresh context. Read this section first; it is the whole handover.

### What this document is

An audit of the DocumentDB Interactive Shell's input line, completion and ghost text, written after
two user-visible bugs (Steps 13 and 14) turned out to be reachable within the first three
keystrokes. Every finding was read out of the source, not inferred. Every item has been triaged by
the operator into **Fix**, **Deferred**, or **Won't fix**, and each carries an explicit
`**Operator: ...**` line recording that decision.

### Your scope

**Implement the items under `# Fix`. Nothing else.**

`# Deferred` and `# Won't fix` are decisions, not backlog you may quietly promote. Each rejected
item records _why_, and several of the reasons are load-bearing — I1b was rejected because it breaks
the invariant that makes ghost text safe, and I8 because it puts a network call on the connect path.
If you find evidence that a decision was wrong, **say so and stop**; do not act on it.

Work one item per change. Several are XS or S and it will be tempting to batch them — don't. F1–F5
touch the same three files and a batched diff makes it impossible to tell which change caused a
rendering regression.

### Verify before you trust

Findings were verified against the tree at commit `35d644a2` on
`dev/tnaum/integrated-shell-improvements`. Line numbers and quoted snippets may have moved.
**Re-read the code before editing it.** Where this document and the code disagree about behaviour,
the code wins — and the mismatch is itself worth reporting.

### Invariants you must not break

These are hard-won. Two of them were learned by shipping the bug.

1. **CUB (`\x1b[nD`) cannot cross rows.** It clamps at column 1 of the current row. Anything written
   to the right of the cursor and then undone with CUB must be clipped to the current row first, or
   the cursor is stranded and the renderer silently loses track of which row it is on. This was
   Step 13.
2. **Never use `String.length` for terminal columns.** Use `terminalDisplayWidth()` and
   `clipToDisplayWidth()` from
   [terminalDisplayWidth.ts](../../../../src/documentdb/shell/terminalDisplayWidth.ts). They are
   grapheme-safe via `Intl.Segmenter`. F3 and F4 are both instances of this rule being broken.
3. **Deferred wrap is real.** Row math is `absCol > 0 ? Math.floor((absCol - 1) / cols) : 0`, and
   the last column is deliberately left unwritten. Content that exactly fills a row leaves the
   cursor _on_ that row until one more character arrives.
4. **Ghost text only ever appends after the cursor.** It never covers real characters — that is
   precisely what allows `clear()` to be a bare `\x1b[K`. F2 makes this explicit; I1b was rejected
   for violating it.
5. **Nothing lives below the input line.** `reRenderLine()` ends with `\x1b[J`, which erases
   everything after the cursor on every keystroke. This is why I7 needs I10 first.
6. **A completion is `(deleteCount, insertText)`, not just `insertText`.** See Step 14.

### The testing rule that matters here

Both Step 13 and Step 14 survived a full review round because the tests asserted on _intermediate
values_ — `insertText` in isolation, a width helper's return — and never on what the terminal
actually received or what the buffer actually became.

**Assert on the emitted ANSI string, or on the resulting buffer.** If your test would still pass
with the cursor on the wrong row, it is not testing the thing that broke.

Test suites named `TDD:` are behaviour contracts. If one fails after your change, **stop and ask**;
do not update it.

### Code map

| File                                                                                      | Role                                                             |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [DocumentDBShellPty.ts](../../../../src/documentdb/shell/DocumentDBShellPty.ts)           | Host adapter. Ghost text orchestration, Tab handling, dimensions |
| [ShellInputHandler.ts](../../../../src/documentdb/shell/ShellInputHandler.ts)             | Buffer, cursor, `reRenderLine()`, history                        |
| [ShellGhostText.ts](../../../../src/documentdb/shell/ShellGhostText.ts)                   | Dim inline suggestion rendering and clipping                     |
| [ShellCompletionProvider.ts](../../../../src/documentdb/shell/ShellCompletionProvider.ts) | Context detection and candidate generation                       |
| [ShellCompletionRenderer.ts](../../../../src/documentdb/shell/ShellCompletionRenderer.ts) | Multi-column list, `findCommonPrefix()`                          |
| [terminalDisplayWidth.ts](../../../../src/documentdb/shell/terminalDisplayWidth.ts)       | Width measurement and grapheme-safe clipping                     |
| [HelpProvider.ts](../../../../packages/documentdb-js-shell-runtime/src/HelpProvider.ts)   | `help` text (separate package, imports no `vscode`)              |

Read [iterations/13-ghost-text-wrap-clipping.md](./iterations/13-ghost-text-wrap-clipping.md) and
[iterations/14-bracket-notation-dot-removal.md](./iterations/14-bracket-notation-dot-removal.md)
before touching ghost text or completion acceptance. They explain why the current code looks the way
it does.

### Repository conventions

- **Build with `npm run build`.** Never `npm run compile`.
- Tests: `npx jest --no-coverage src/documentdb/shell/`. Baseline before your change: **13 suites,
  471 tests, all passing.**
- TypeScript is strict. No `any` — use `unknown` with type guards. Explicit return types. Null
  safety via `nonNullProp()` / `nonNullValue()` from `src/utils/nonNull.ts`.
- All user-facing strings go through `vscode.l10n.t()`. If you add, change or remove one, run
  `npm run l10n`.
- **Terminology:** this is a **DocumentDB** extension using the **MongoDB-compatible wire protocol**.
  Never use "MongoDB" alone as a product name — not in code, comments, tests or strings.
- See `.github/copilot-instructions.md` and `.github/instructions/typescript.instructions.md` for
  the full set.

### Recording your work

Add an iteration document at `iterations/15-<short-name>.md` (13 and 14 are taken) following the
shape of the two existing ones: symptom, root cause with evidence, fix, tests, and what you
deliberately did not do. Add a row to the timeline table in
[README.md](./README.md). Update the relevant item in this document to say it shipped.

Do not commit or push unless asked. Never `git add -f` — `docs/plan/` and `docs/analysis/` are
gitignored deliberately.

---

A deep dive into the first minutes of shell use, prompted by two observations:

> "things can't just break like that" (Step 13 / Step 14 were both in the first three keystrokes)
> "I had only one collection called `restaurants-something` and when I typed `db.`, the ghost text
> didn't show. I know because it's not 'compliant' with the syntax, but still, that's a pity."

Grouped by decision: **Fix**, **Deferred**, **Won't fix**.

Every item has now been ruled on by the operator. "Record for the future" is not the same as "won't
fix", so deferred items get their own section rather than being buried next to the two things that
were actually rejected.

**Implementation progress is tracked in the Status column of the table below**, and each shipped item
carries a `### Shipped — commit <sha>` subsection recording what was done and why.

## Note: the future standalone shell

> "shell will be the shell for documentdb (like mongosh is for mongodb) and will also be extracted
> to a standalone executable in the future."

**This document is not about that.** Everything below targets the VS Code host as it stands today
and should be built for it. Two things are written down only because they are free:

- **Step 13's "rendering bugs are never platform-dependent" conclusion holds only while the host is
  VS Code.** It was true because `vscode.Pseudoterminal` writes into xterm.js — one emulator, one
  wcwidth table, everywhere. A standalone binary inherits conhost, Windows Terminal, iTerm2, tmux,
  each with its own width tables and ANSI quirks. Worth a qualifier on the claim. Not worth
  designing around yet.
- **The line-editing core is already VS Code-free, by accident.** Only `DocumentDBShellPty`,
  `ShellOutputFormatter` (one config read), `ShellSessionManager` and `ShellTerminalLinkProvider`
  import `vscode`. Staying that way costs nothing, so prefer the host-free module when there is a
  real choice — F5 is the only item below where that changes the answer. Don't invent interfaces
  for it.

Where an item will obviously need rework after extraction, it says so in one line. That is the
whole extent of the preparation.

## Rating scale

| Axis           | Meaning                                                                            |
| -------------- | ---------------------------------------------------------------------------------- |
| **Complexity** | XS = under an hour · S = contained · M = touches several files · L = new subsystem |
| **Usefulness** | 1 = nobody notices · 5 = users hit this in the first five minutes                  |
| **Luxury**     | 1 = invisible plumbing · 5 = the thing people screenshot and tweet                 |

Usefulness and luxury are deliberately separate. A bug fix is usefulness 5 / luxury 1. Tab-cycling
is luxury 5 / usefulness 3. Both are worth doing; they are not worth doing _in the same week_.

## Decisions at a glance

| #   | Item                                           | Complexity | Use | Lux | Decision  | Status             |
| --- | ---------------------------------------------- | ---------- | --- | --- | --------- | ------------------ |
| F1  | Resize can strand the cursor                   | S          | 5   | 1   | Fix       | Shipped `4c40d050` |
| F2  | Ghost text paints over real text mid-buffer    | XS         | 4   | 1   | Fix       | Shipped `88ef37c5` |
| F3  | Completion list measured with `String.length`  | S          | 3   | 1   | Fix       | Shipped `eb988c4b` |
| F4  | Prompt width measured with `String.length`     | XS         | 2   | 1   | Fix       | Shipped `412722bf` |
| F5  | Shell `help` hard-coded to ~62 columns         | S          | 3   | 2   | Fix       | Shipped `d4a2c765` |
| F6  | Banner and logo drawn at an assumed 80 columns | S          | 1   | 1   | Won't fix | —                  |
| I1a | Bracket-notation preview hint                  | S          | 4   | 3   | Fix       | Shipped `a0774f47` |
| I1b | Replacement-aware ghost text                   | M          | 4   | 5   | Won't fix | —                  |
| I1c | Ghost text at an empty prefix                  | S          | 3   | 3   | Fix       | Shipped `a22358b0` |
| I2  | History-based autosuggestion (capped)          | M          | 4   | 5   | Fix       | Shipped `50e6ba53` |
| I3  | Ctrl+R reverse history search                  | M          | 3   | 4   | Deferred  | —                  |
| I4  | Persist history across sessions                | M          | 4   | 2   | Deferred  | —                  |
| I5  | Inline `detail` hint for the single match      | S          | 4   | 4   | Fix       | Shipped `3b93b204` |
| I6  | `detail` in the multi-column list              | M          | 3   | 3   | Deferred  | —                  |
| I7  | Tab-cycling — as menu-select, with the list    | L (+ I10)  | 3   | 5   | Deferred  | —                  |
| I8  | First-run nudge naming a real collection       | S          | 5   | 3   | Won't fix | —                  |
| I9  | Clickable collection names                     | M          | 3   | 4   | Deferred  | —                  |
| I10 | Make `reRenderLine()` ghost-aware              | M          | 3   | 1   | Deferred  | —                  |

Two entries changed shape during triage. **I7** moved to Deferred once it became clear that the
version worth having (list stays visible, Tab moves a highlight through it) needs I10 as a
prerequisite — see I7 for the reasoning. **I10** moved the other way: dropping I1b removed its main
driver, then I7 gave it a new one, so it is deferred rather than closed.

F7 and F8 from the first draft were not defects; they are folded into I5 and I4 as supporting
evidence.

---

# Fix

## F1. A terminal resize can strand the cursor again (same family as Step 13)

**Operator: accepted.**

**Verified.** `DocumentDBShellPty.setDimensions()` updates `_columns` and calls
`ShellInputHandler.setColumns()`. That setter does one thing beyond storing the width:

```ts
// Reset tracked cursor row — after a resize xterm.js reflows content,
// making the previous _lastCursorRow stale.
this._lastCursorRow = 0;
```

Resetting to `0` is a **guess**, and it is wrong whenever the input line wraps after the resize.
xterm.js reflows the wrapped line and keeps the cursor on the same character, so the cursor can
easily end up on physical row 1 or 2. The next `reRenderLine()` reads `_lastCursorRow === 0`, emits
no `\x1b[nA`, and then `\r` + `\x1b[<promptWidth>C` + buffer paints on the wrong row — orphaning
everything above it. This is precisely the Step 13 failure, reached by a different route.

Nothing re-renders on resize either, so the line is also stale until the next keystroke.

**Repro (untested, derived from the code):** type a command long enough to wrap at ~60 columns,
then drag the panel narrower, then press one more key.

**Fix:** `_lastCursorRow` is derivable — it is `targetRow` from `reRenderLine()` Step 5 evaluated
against the _new_ column count. Recompute it in `setColumns()` instead of zeroing it, and have
`setDimensions()` call `renderCurrentLine()` so the line repaints at the new width.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| S          | 5          | 1      |

### Shipped — commit `4c40d050`

**The finding reproduced exactly as described**, and both halves of the prescribed fix were needed.

`ShellInputHandler.setColumns()` now recomputes the row through a small private
`cursorRowForColumns()` helper using the same deferred-wrap formula as `reRenderLine()`
(`absCol > 0 ? Math.floor((absCol - 1) / cols) : 0`, over `cursorColumn`). `DocumentDBShellPty.setDimensions()`
now calls `renderCurrentLine()`.

**Two implementation details worth recording**, neither of which changes the shape of the item:

- **The repaint is gated.** `setDimensions()` can fire at any moment, including mid-evaluation while
  command output is streaming and during connect while input is disabled. Repainting the input line
  then would inject the prompt and buffer into somebody else's output. The repaint is skipped unless
  `!_closed && !_evaluating && _inputHandler.isEnabled`.
- **Ghost state is cleared before the repaint.** `reRenderLine()` ends with `\x1b[J`, which erases the
  ghost from the screen while `ShellGhostText._visible` would stay `true` — Tab would then accept a
  suggestion the user can no longer see. `clearGhostState()` first. (This is the same hazard checked
  and dismissed under F2 for cursor movement, where `handleInput()` already clears it; `setDimensions()`
  does not go through `handleInput()`.)

Four tests, two of which fail against the unfixed source:

| Test                                                            | File                     | Fails before? |
| --------------------------------------------------------------- | ------------------------ | ------------- |
| tracks the cursor row across a **narrowing** resize (asserts CUU count) | `ShellInputHandler.test.ts` | yes           |
| tracks the cursor row across a **widening** resize                | `ShellInputHandler.test.ts` | no (control)  |
| `setDimensions` repaints the input line at the new width          | `DocumentDBShellPty.test.ts` | yes           |
| `setDimensions` does not touch the terminal while evaluating      | `DocumentDBShellPty.test.ts` | no (guard)    |

All four assert on emitted ANSI.

**F6 note.** The audit predicted that "if F1 gives the initial width a sensible value on the way past,
[F6] stops being a separate problem." It does not: F1 touches the resize path only, and `open()`'s
80-column default is untouched. F6 remains exactly as recorded — won't fix, for the reason already
given.

## F2. Ghost text paints over real text when the cursor is mid-buffer

**Operator: accepted.**

**Verified.** `evaluateGhostText()` has no "cursor is at the end of the buffer" guard. It calls
`getCompletionResult(buffer, cursor)`, which slices at the cursor, and then writes the suggestion
**at the cursor** — on top of whatever the buffer holds after it.

Two paths reach this with a non-empty tail. Both fire `onBufferChange` from a mid-buffer position:

- `handleDelete()` — the Delete key
- `clearBeforeCursor()` — Ctrl+U

`clear()`'s `\x1b[K` then erases the real tail along with the ghost, and the next `reRenderLine()`
repaints it. So the **buffer is never corrupted** — but the screen lies about its contents for as
long as the ghost is up, and `availableGhostColumns()` computes its clipping budget as if the rest
of the row were free, which it is not.

**Fix:** return early from `evaluateGhostText()` unless `cursor === buffer.length`. This is what
every other shell with autosuggestions does (fish, zsh-autosuggestions) and it makes the
"ghost only ever appends after the cursor" invariant explicit rather than accidental.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| XS         | 4          | 1      |

### Shipped — commit `88ef37c5`

**The finding did not reproduce.** The guard already exists — one level up, in the _caller_:

```ts
// DocumentDBShellPty.handleBufferChange()
if (cursor < buffer.length) {
    this.clearGhostState();
    return;
}
```

`git log -S` puts it in `ec1f36d4` ("wire tab completion and ghost text into terminal"), i.e. it has
been there since the feature landed. `evaluateGhostText()` has exactly one caller — the debounced
timer inside `handleBufferChange()` — so neither the Delete nor the Ctrl+U path can reach it with a
non-empty tail. Verified by reverting the source change and re-running the new regression test: it
passes either way.

**Done anyway, deliberately.** The guard was added in `evaluateGhostText()` as specified. It costs
four lines, it puts the invariant at the point where it actually matters (the write site, next to
`availableGhostColumns()`), and it means a future second caller cannot reintroduce the bug. The
regression test is the real deliverable: it asserts on the **emitted ANSI** (absence of
`\x1b[2m\x1b[90m`) rather than on an intermediate value, which is exactly the gap this audit calls
out.

**One adjacent hypothesis, checked and rejected.** Cursor movement does not fire `onBufferChange`, so
I expected `_ghostText._visible` to survive a Left Arrow while `reRenderLine()`'s `\x1b[J` erased the
ghost from the screen — leaving Tab able to accept an invisible suggestion. It cannot:
`DocumentDBShellPty.handleInput()` calls `clearGhostState()` on every input except `\x1b[C` and
`\x09`. Confirmed empirically (the buffer after `hel` → Left → Tab is `helpl`, which is plain
mid-buffer Tab completion, not a stale ghost). No defect; recorded so the next reader does not spend
the same half hour.

Tests added to [DocumentDBShellPty.test.ts](../../../../src/documentdb/shell/DocumentDBShellPty.test.ts)
under `ghost text — append-only invariant`: one positive control (ghost renders at end of buffer),
one guard assertion (no ghost styling emitted when the cursor is mid-buffer).

## F3. `renderCompletionList()` measures labels with `String.length`

**Operator: accepted.**

**Verified.** [ShellCompletionRenderer.ts](../../../../src/documentdb/shell/ShellCompletionRenderer.ts):

```ts
const maxLabelLen = Math.max(...displayLabels.map((l) => l.length));
const colWidth = Math.max(maxLabelLen + COLUMN_PADDING, MIN_COLUMN_WIDTH);
```

This is finding I-11 from the Step 10 review, in the one module that never received the fix. A
collection named with CJK characters or an emoji misaligns every column in the grid.

There is also no per-label clipping. A label wider than the terminal makes `colWidth > terminalWidth`,
so `numCols` collapses to `1` and every entry soft-wraps — at which point the `MAX_DISPLAY_ROWS = 8`
cap no longer bounds the number of _physical_ rows, and the list can push the prompt off-screen.

**Fix:** `terminalDisplayWidth()` for measurement, `clipToDisplayWidth()` for labels wider than
`terminalWidth - COLUMN_PADDING`. Both helpers already exist and are already tested.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| S          | 3          | 1      |

### Shipped — commit `eb988c4b`

**The finding reproduced, and it had a third instance the audit did not name.** Measurement
(`maxLabelLen`) and the missing clip were both as described. The third was `label.padEnd(colWidth)`
in the row loop — also `String.length`, and actually the one that produces the visible misalignment:
measuring wrong sizes the column, but padding wrong is what pushes the next column sideways. Fixed
via a local `padToDisplayWidth()` helper.

The clip is `Math.max(MIN_COLUMN_WIDTH, terminalWidth - COLUMN_PADDING)` with an `…` marker, which
also guarantees `colWidth <= terminalWidth`, so `numCols >= 1` and a rendered row can never soft-wrap.
That is what restores `MAX_DISPLAY_ROWS` as a bound on _physical_ rows.

Two tests, both failing against the unfixed module:

| Test                                                                 | Asserts on            |
| ---------------------------------------------------------------------- | --------------------- |
| `寿司` (2 code units, 4 columns) is followed by exactly 4 pad spaces   | the emitted row string |
| a 60-char label in a 20-column terminal clips, and no row exceeds 20 visible columns | every emitted row, escapes stripped |

**Unblocks I6 and I7** — both were gated on width-correct measurement here. They remain deferred.

## F4. `setPromptWidth(prompt.length)` — same `String.length` problem, three call sites

**Operator: accepted.**

**Verified.** `showPrompt()`, `showContinuationPrompt()`, and `rewriteCurrentLine()` all do:

```ts
const prompt = `${this._currentDatabase}> `;
this._inputHandler.setPromptWidth(prompt.length);
```

Database names are not restricted to ASCII. A non-BMP or double-width character in the database name
makes `_promptWidth` too small, and **every** subsequent `reRenderLine()` positions the cursor
wrongly — the prompt is the base of all the cursor math.

`showContinuationPrompt()` is the live one today: `'┆ > '` is 4 UTF-16 units and 4 columns, so it
happens to be correct. It is correct by luck, not by construction.

**Fix:** `terminalDisplayWidth(prompt)` at all three sites.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| XS         | 2          | 1      |

### Shipped — commit `412722bf`

**The finding reproduced exactly as described.** All three sites were still passing `prompt.length`.
Changed to `terminalDisplayWidth(prompt)`; no other change.

The regression test constructs a PTY on a database named `日本語` — 5 UTF-16 code units, 8 terminal
columns — and asserts on the **emitted ANSI**: the re-render after one keystroke must contain
`\r\x1b[8C` and must not contain `\r\x1b[5C`. Verified failing against the unfixed source
(`Received: …\r\x1b[5Cx`) and passing after.

The continuation prompt is unchanged in value — `┆ > ` is 4 units and 4 columns either way — but it
is now correct by construction rather than by luck, which was the point of the item.

## F5. Shell `help` is hard-coded to ~62 columns

**Operator: accepted.**

**Verified.** `HelpProvider.buildShellHelp()` builds entries with `command.padEnd(40)` plus a
two-space indent. The widest line (`db.<coll>.updateOne({}, {$set:{}})` + description) lands around
62 columns. Below that, every entry soft-wraps with no hanging indent and the two-column layout
collapses into noise — on exactly the narrow panels where Step 13 was reported.

`HelpProvider` receives no width, and `ShellOutputFormatter` has no notion of width either (grepped:
zero matches for `columns|width|padEnd|truncate`). Width is known only in `DocumentDBShellPty`.

**Fix:** give `HelpProvider` a column count and let it emit entries that fit; the formatter keeps
doing colour only. `ShellOutputFormatter.colorizeHelpText()` is the other candidate — it already
parses the `  <command><2+ spaces><description>` shape — but `HelpProvider` is the better home at
the same cost, since it owns the layout and imports no `vscode`.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| S          | 3          | 2      |

### Shipped — commit `d4a2c765`

**Built in `HelpProvider`, as directed.** But the phrase "at the same cost" is not right, and the
reason is worth recording because it would have changed the estimate: **`HelpProvider` runs in the
worker thread.** `DocumentDBShellRuntime` constructs it, and that whole runtime lives behind
`WorkerSessionManager`. The terminal width lives in `DocumentDBShellPty`, in the extension host.
So "give `HelpProvider` a column count" is a cross-thread change, which `colorizeHelpText()` would
not have been.

**It is still cheap, because the width did not need a resize protocol.** There is already a per-eval
message carrying `displayBatchSize` from the host to the worker. The width rides along on it:

```
DocumentDBShellPty._columns
  → ShellSessionManager.evaluate(code, terminalColumns)
  → MainToWorkerMessage 'eval'.terminalColumns
  → playgroundWorker → ShellEvalOptions.terminalColumns
  → DocumentDBShellRuntime.evaluate
  → CommandInterceptor.tryIntercept(code, columns)
  → HelpProvider.getHelpResult(columns)
```

Seven files, every one of them a one-liner except `HelpProvider` itself. The width is sampled at the
moment `help` is evaluated, which is the only moment it matters — no resize listener, no stale value.
The field is optional, so the playground path is untouched.

**Layout.** `buildShellHelp()` now builds a `ShellHelpLine[]` (header / blank / entry / tip) and
`layoutShellHelp()` renders it for a width:

- the command column is sized to the **widest command** (34) rather than a fixed 40, which returns
  6 columns to every line before anything else happens;
- descriptions wrap with a hanging indent aligned to the description column;
- below `MIN_DESCRIPTION_WIDTH = 12` usable columns for the description (≈ 50 terminal columns) the
  two-column layout is abandoned and entries **stack** — command, then description indented beneath.
  A description that wraps every two words is worse than one on its own line;
- the tip line wraps too, rather than relying on the terminal to soft-wrap it.

`ShellOutputFormatter` is unchanged: it still only applies colour. Its entry regex
(`^( {2})(\S.*\S)( {2,})(\S.+)$`) continues to match two-column entries, and wrapped continuation
lines fall through to the gray "tip" branch, which is the colour they want anyway.

**Known cosmetic consequence, accepted.** In stacked mode the command line has no trailing
description, so it no longer matches the entry regex and renders gray rather than yellow. Fixing it
means teaching the formatter a third line shape; not worth it for terminals under 50 columns, and
not this item.

Five tests in `HelpProvider.test.ts` (longest line fits at 40/50/60/80/120; exact command-column
position at 80; stacking at 40; tip wrapping at 40; the 80-column default) and one in
`DocumentDBShellPty.test.ts` asserting the resized width actually reaches `evaluate()`.

**Existing assertions updated, not weakened.** Seven `expect(mockEvaluate).toHaveBeenCalledWith(code)`
assertions in `DocumentDBShellPty.test.ts` now also assert the forwarded width — `(code, 80)`. That
is a strictly stronger assertion, and it is why the change shows up in tests it does not otherwise
touch.

## I1. The reported gap: ghost text for bracket-notation collections

**The complaint.** One collection, named `restaurants-something`. Typing `db.` shows nothing.
Typing `db.rest` shows nothing. Ghost text is, for this user, a feature that does not exist.

**Why, exactly.** Two independent gates, both verified:

1. `evaluateGhostText()` requires `result.candidates.length === 1 && result.prefix.length > 0`.
   `db.` has an empty prefix, so it never shows ghost text — and `db.` also returns every database
   method alongside the collections, so it is never a single candidate anyway.
2. Bracket-notation candidates are excluded outright (as of Step 14, explicitly via
   `replaceCharsBefore`). Ghost text can only _append_ after the cursor; bracket notation has to
   _rewrite_ the `.` before it. The two are structurally incompatible.

So a user whose collections all need bracket notation gets ghost text at no prefix length, ever.
That is a bad first impression and it is invisible — nothing tells them the feature exists.

The operator chose I1a and rejected I1b ("I think I1a is easier to grasp for the user. I'm worried
I1b will break."). I1c is complementary and was accepted alongside it.

### I1a. Advertise instead of insert — a non-insertable preview hint

Reuse the schema-hint machinery (`_ghostTextIsHint = true`, which already makes ghost text
non-insertable). When the single candidate needs bracket notation, render:

```
newDb2> db.rest   → db['restaurants-something']   (Tab)
```

Tab already does the right thing after Step 14, so the hint only has to _tell the user that_. No new
rendering model, no change to `clear()`, and the existing width clipping applies unchanged.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| S          | 4          | 3      |

### Shipped — commit `a0774f47`

**Built as specified.** The branch in `evaluateGhostText()` that used to call `clearGhostState()` for
these candidates now calls `showCompletionPreviewHint()` instead. That is the whole behavioural
change; the hint machinery already existed.

**It covers more than bracket notation, and that is deliberate.** The guard being replaced fires for
any candidate where `insertText` does not start with the typed prefix _or_ `replaceCharsBefore > 0`
— bracket-notation collections, quoted field paths (`address.ci` → `"address.city"`), special-char
collections. All three were invisible for the same reason and all three are now advertised the same
way. Narrowing the hint to bracket notation alone would have meant adding a condition to exclude
cases that have the identical problem.

**Rendering.** `  → <preview>  (Tab)`, where `preview` is the buffer with the replaced region already
substituted — computed as `buffer.slice(0, len - (prefix.length + replaceCharsBefore)) + insertText`,
the same arithmetic `applySingleCompletion()` uses. So the preview is the real result, not a
reconstruction that can drift from it.

**No `l10n` run.** The hint adds no English prose — an arrow, the preview, and `(Tab)` as a key name.
Consistent with the sibling `showSchemaHint()`.

Two tests, driving a mocked bracket-notation candidate through
`ShellCompletionProvider.prototype.getCompletions`:

| Test                                                      | Fails before? |
| ----------------------------------------------------------- | ------------- |
| `db.rest` emits `  → db['restaurants-something']  (Tab)`    | yes           |
| Tab then actually produces `db['restaurants-something']`     | no — it pins the preview to reality |

The second test is the one that matters long-term: an advertisement that lies about what Tab does
is worse than no advertisement, and that is exactly the class of bug Step 14 was.

### I1b. Replacement-aware ghost text — rejected

Moved to the **Won't fix** section below, with the reasoning.

### I1c. Ghost text at an empty prefix

Relax `prefix.length > 0` so that `db.` alone can suggest — but only when there is exactly one
_collection_ candidate, ignoring database methods (which are never what a user means by `db.<Tab>`
on a fresh database). Pairs naturally with I1a/I1b; on its own it fixes the `db.` case for
ordinary collection names.

Worth checking against the Step 13 width work: at `db.` the cursor column is small, so a long
collection name is the most likely thing to need clipping. It will — that path is now covered.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| S          | 3          | 3      |

### Shipped — commit `a22358b0`

**Built as specified**, including the "ignore database methods" rule, which is the part that makes it
work at all.

Rather than relaxing the `prefix.length > 0` condition in place, candidate selection moved into a
`ghostCandidate()` helper, because the two cases genuinely answer different questions:

| Prefix      | Rule                                                                        |
| ----------- | --------------------------------------------------------------------------- |
| non-empty   | the sole match, as before                                                   |
| empty       | `db-dot` context only, and only when exactly one candidate is a `collection` |

Putting that behind one named function keeps `evaluateGhostText()`'s precedence chain readable and
means the rest of the branch — preview hint, ghost, description — is shared between the two cases
rather than duplicated.

**I1a and I1c compose, which is the nicest outcome here.** A sole collection that needs bracket
notation, at `db.` with nothing typed, now produces `db.` → `  → db['restaurants-something']  (Tab)`.
That is precisely the user complaint that opened this audit — one collection named
`restaurants-something`, typing `db.`, nothing shown — and it is answered by the two items together,
neither of which would have answered it alone.

Two tests: sole collection among database methods at `db.` emits the ghost; two collections emit
nothing.

## I2. History-based autosuggestion (fish-style)

When the buffer is a prefix of a previous command, ghost the rest of it. This is the single most
recognised "modern shell" affordance, and it is a **pure append** — it needs no change to the ghost
text contract, no completion provider work, and it inherits Step 13's clipping for free.

It also degrades gracefully in exactly the case that triggered this audit: after the user has run
`db['restaurants-something'].find()` once, typing `db` suggests the whole line, bracket notation and
all, with no syntax awareness required at all.

Worth building even with I4 deferred — within a single session the history array already exists and
is already populated, so this needs no storage work at all. I4 only makes it survive a restart.

**Operator requirement: cap the count.** `_maxHistory` is currently **500**, and the naive
implementation scans it on every keystroke, inside the 50 ms ghost-text debounce. Two separate caps
are wanted and they should not be conflated:

| Cap                    | Why                                                                                                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entries searched**   | Scan only the most recent N (N ≈ 50–100), newest first, and stop at the first match. A hit on the 400th-oldest command is not what the user meant, and the scan is on the typing path. |
| **Matches considered** | Stop at the first match rather than collecting all of them. Ghost text shows exactly one suggestion, so there is nothing to do with the rest.                                          |

The entry cap belongs next to `_maxHistory` as its own named constant, not derived from it — they
answer different questions (how much to remember vs. how far back to suggest from), and tying them
together means raising one silently raises the cost of the other.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| M          | 4          | 5      |

### Shipped — commit `50e6ba53`

**Both caps are in from the first commit**, as required. `ShellInputHandler.findHistorySuggestion()`
scans newest-first over at most `_maxHistorySearch = 100` entries and returns on the first hit.
The constant sits beside `_maxHistory` and is written as an independent value with the reasoning in
its doc comment, so a later change to `_maxHistory` cannot silently move it.

**One decision the audit left open: precedence against the completion ghost.** I2 and I5 both want
the row after the cursor, and the audit set the order for neither. The rule adopted — and now
written into `evaluateGhostText()` — is **insertable beats informational**:

1. completion ghost (insertable)
2. bracket-notation preview (informational, but it is the _only_ thing that can be said about that
   candidate)
3. **history autosuggestion** (insertable)
4. candidate description — I5 (informational)
5. schema hint (informational)
6. closing brackets (insertable, but only reachable when nothing above matched)

The visible consequence, and the reason the rule is worth stating: typing `db` after running
`db['restaurants-something'].find()` now offers the whole previous line rather than I5's
`🛈 Current database`. A suggestion the user can accept with one keypress is worth more than a
description of a word they have already typed.

**One thing deliberately excluded: multi-line history entries.** `_history` stores multi-line
expressions with embedded `\n`, and `replaceLineWith()` flattens them to spaces for Up-arrow recall.
Ghost text has no such step — `insertText()` would put a raw newline into a single-line buffer.
Entries containing `\n` are skipped. Flattening them instead would suggest a command that differs
from what was actually run, which is the I1a "advertisement that lies" failure again.

**Telemetry** follows the closing-brackets pair exactly: `shell.historySuggestion` with `shown` and
`accepted` measurements, and a `_ghostTextIsHistory` flag so the accept path can attribute
correctly. Without it, accepted history suggestions would have been counted as nothing at all.

Seven tests, five on the cap and match semantics (`ShellInputHandler.test.ts`) and three on the
rendered result (`DocumentDBShellPty.test.ts`: it suggests, it yields to a completion candidate, and
Right Arrow inserts exactly the remembered command).

**I4 remains deferred and this does not change that.** Session-scoped history was always enough for
I2 — the array already exists and is already populated. I4 only makes it survive a restart, and its
blocker is redaction, not storage.

## I5. Show `detail` for the single-candidate case

**Supporting evidence.** `getDbDotCandidates()` populates `detail` from the shell-api-types registry
(`method.description`), and the operator and BSON candidates carry descriptions too. Grepping
`src/documentdb/shell/` for `.detail` returns **zero** reads. The shell already holds, in memory, a
one-line description of every method it offers, and renders none of it.

The operator's direction is to present it **inline, in the same visual language as the existing
ghost hints** — not as a separate line below the prompt. That reuses `_ghostTextIsHint`, which
already marks ghost text as non-insertable, and inherits Step 13's width clipping unchanged:

```
newDb2> db.coll.countDocuments   🛈 Count of documents matching the filter
```

This is the highest ratio of user-visible improvement to code written in this document, because the
data is already fetched and thrown away. It is also the direct answer to "can we improve anything on
the ghost texts for commands": the good content already exists and is simply not rendered.

One caution: the hint competes for the same row as the completion ghost. When a completion ghost is
showing, the description must yield — `evaluateGhostText()` needs a single, explicit precedence
order rather than whichever branch happens to return first.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| S          | 4          | 4      |

### Shipped — commit `3b93b204`

**The finding held.** `.detail` still had zero readers in `src/documentdb/shell/`.

**The one decision this item required: _when_ does the description get the row?** The audit specifies
the visual but not the trigger. The answer that falls out of the caution above is **when the single
candidate is fully typed** — `remaining.length === 0`, so there is nothing to insert and the row is
genuinely free. Any earlier and it would be fighting the completion ghost for the same columns; the
completion ghost is worth more, because it can be accepted.

So the precedence is now written out in `evaluateGhostText()` as a comment and enforced by the
branch order:

1. insertable completion (`remaining.length > 0`)
2. the candidate's `detail`
3. schema hint
4. closing brackets

This also lands the audit's own example verbatim: `db.coll.countDocuments` → `  🛈 Count of
documents matching the filter`.

**Implementation notes.**

- `showDetailHint()` sits next to `showSchemaHint()` and reuses `_ghostTextIsHint = true`, so it is
  non-insertable by construction and clipped by `availableGhostColumns()` with no new code.
- **No `l10n` run needed.** The hint contributes no English of its own — the glyph and two spaces
  only. The description text comes from the registry. (Noted because it is the kind of thing that
  looks like it needs `npm run l10n` and does not. `showSchemaHint()`'s literal is likewise not
  localized today; left alone, it is not this item.)

Three tests, asserting on emitted ANSI:

| Test                                                    | Fails before? |
| --------------------------------------------------------- | ------------- |
| `help` (exact) emits `\x1b[2m\x1b[90m  🛈 Show help`        | yes           |
| `hel` (incomplete) emits the completion ghost and no `🛈` | no (precedence guard) |
| Tab on a showing description inserts nothing               | no (non-insertability guard) |

## I8. A first-run nudge that names a real collection — rejected

Moved to the **Won't fix** section below.

---

# Deferred

Recorded, not scheduled. Each one states what would make it move.

## I7. Tab-cycling through candidates

**Operator: "can we combine, and show the list as well? sometimes it's a lot of options. If not,
I'd leave it as is and push it back to future iterations."**

**Yes, it can be combined — and that is the right design. But it is not the job that was rated L.**

What you are describing is zsh's `menu-select`: the candidate list stays on screen, the current
selection is highlighted in it, and Tab moves the highlight while the inline text updates to match.
It is strictly better than cycling blind, because with a lot of options cycling without a visible
list is worse than the current behaviour, not better.

The cost is where it gets interesting. Today the list is **fire-and-forget**:

```
renderCompletionList()  →  writes '\r\n' + rows below the prompt
'\r\n'                  →  then the prompt is rewritten *below* the list
rewriteCurrentLine()
```

The list is emitted once and then abandoned; the input line moves down past it and never looks up
again. For menu-select, that list becomes a **live region the shell owns** and must redraw on every
Tab. That means moving the cursor back up over it (`\x1b[nA`), which means knowing exactly how many
physical rows it occupies — which depends on the terminal width and on label wrapping, i.e. on F3
being correct first.

And it puts rows **below** the input line under the renderer's control. `reRenderLine()`'s entire
model is `_lastCursorRow`, a single number describing where the cursor sits relative to the prompt
row, with `\x1b[J` erasing everything after it. A live list below the input line breaks that: `\x1b[J`
would wipe it on every keystroke.

So the honest accounting:

- `MAX_DISPLAY_ROWS = 8` already exists and already bounds the region, which is the one thing that
  makes this tractable at all — an unbounded list that scrolls the viewport would put the row math
  permanently out of sync.
- **I10 stops being optional and becomes a prerequisite.** `reRenderLine()` has to learn about rows
  it does not own. That is the same structural change I10 describes, arrived at from a third
  direction.
- The rating moves from L to L-plus-I10. It is no longer "persistent completion state"; it is "the
  shell owns a multi-row region of the terminal".

**Recommendation: take the second half of your own sentence.** Leave Tab as it is — list plus common
prefix is competent, and it already handles "a lot of options" without pretending to. Push I7 to a
future iteration, and do it as menu-select rather than blind cycling when it comes back.

**Moves when:** F3 and I10 have landed. Then it is a contained feature rather than a renderer
rewrite.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| L (+ I10)  | 3          | 5      |

## I3. Ctrl+R reverse history search

**Operator: "record for the future."**

`historyPrevious()` / `historyNext()` already exist; this is a search UI over the same array, plus a
modal input state in `ShellInputHandler`. The modal state is the real cost — it needs its own prompt
rendering and its own interaction with `reRenderLine()`.

**Moves when:** I4 lands. Ctrl+R over a single session's history is a much smaller prize, and the
modal input state is the same cost either way.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| M          | 3          | 4      |

## I4. Persist history across sessions

**Operator: "future."**

**Supporting evidence.** `ShellInputHandler._history` is a plain in-memory array on the instance,
capped by `_maxHistory`. There is no `globalState` or `workspaceState` read or write anywhere in
`src/documentdb/shell/`. Closing the terminal loses every command.

**The blocker is not storage, it is redaction.** Shell history holds `db.auth(...)`, hand-typed
connection strings, and documents containing tokens. `credentialSecrets()` already exists in
`DocumentDBShellPty` for telemetry redaction and is the obvious reuse, but deciding _what_ counts as
a secret in free-form shell input is the actual work. Persisting raw history would be a regression
against "never log passwords, tokens, or connection strings".

`workspaceState` keyed by cluster is the right storage today. (Post-extraction it becomes a dotfile,
and the redaction question gets sharper because the file is readable outside VS Code — a one-line
note for whoever does that work, not a reason to build an abstraction now.)

**Moves when:** the redaction rule is decided, or when I2/I3 make session-scoped history visibly
insufficient. A defensible alternative outcome is "no persistence, documented as deliberate" — see
the open questions.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| M          | 4          | 2      |

## I6. Add `detail` to the multi-column completion list

**Operator: "future."**

The natural sequel to I5: when the list fits, render `label  —  detail` in two columns instead of a
dense grid of bare labels.

**Moves when:** F3 lands (it needs width-correct measurement) and I5 has settled how much
description is useful at a glance. Also needs a rule for switching between grid mode (many short
labels) and detail mode (few labels) — a design question, not a coding one.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| M          | 3          | 3      |

## I9. Clickable collection names in `show collections`

**Operator: accepted as deferred.**

`ShellTerminalLinkProvider` already exists for post-result action sentinels, and Step 11 already
solved making terminal links visible at rest. Extending it so collection names in `show collections`
open the Collection View would connect the shell to the rest of the extension.

The reason to hold it: the link provider matches sentinels in _output_, and collection names are
arbitrary strings. This needs a sentinel-style marker rather than a name match, or the
false-positive rate will be embarrassing. That is most of the work, and it buys a convenience rather
than fixing anything.

(One-line note for later: this is the one item here that cannot exist outside VS Code — no
`TerminalLinkProvider`, no Collection View.)

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| M          | 3          | 4      |

## I10. Close the Step 13 structural gap — make `reRenderLine()` ghost-aware

**Operator: accepted as deferred.**

Carried forward from [13-ghost-text-wrap-clipping.md](./iterations/13-ghost-text-wrap-clipping.md).
`_lastCursorRow` still ignores ghost text. Clipping makes that safe today, but the invariant is "no
writer may emit past the cursor without clipping" and it is enforced by convention alone.

This item moved twice during triage. Rejecting I1b removed its original driver — every accepted item
either appends or goes through `reRenderLine()` itself, so the convention holds without enforcement,
and F2 makes it explicit at almost no cost. Then I7-as-menu-select gave it a new and stronger one:
a live candidate list below the input line needs the renderer to know about rows it does not own,
and `\x1b[J` currently erases everything after the cursor on every keystroke.

So it is no longer "nice to have eventually". It is the gate on the one feature the operator most
wants back.

**Moves when:** I7 comes back (it is the gate), I1b is revived, or any other writer needs to emit
past the cursor. (Also worth revisiting after extraction, when the emulator can no longer be assumed
to behave like xterm.js.)

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| M          | 3          | 1      |

---

# Won't fix

## I8. A first-run nudge that names a real collection

**Operator: "no." Rejected.**

The proposal was to end the connect banner with a concrete example built from the user's own data:

```
Try: db['restaurants-something'].find()      Press Tab to complete names.
```

**Why the rejection holds up, independent of taste.** The banner is already four lines before the
first prompt, and this would have made it five — permanently, for every session, to solve a
first-session problem. It also puts a collection listing on the connect path: today
`listCollections()` is triggered lazily in the background by the completion provider, and making the
banner depend on it turns a best-effort cache warm into something the user waits for. Paying that on
every connect to print a suggestion most users need once is a bad trade.

The underlying need — _users do not know Tab completion exists_ — is real and stays unaddressed.
I1a and I5 both put that information where the user already is (on the input line, at the moment
they are typing) instead of in a banner they have scrolled past. That is the better place for it
anyway.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| S          | 5          | 3      |

## I1b. Replacement-aware ghost text

**Operator: "I'm worried I1b will break." Rejected.**

The idea was to teach `ShellGhostText.show()` a `replaceBefore: number` — move left N columns, draw
the full `db['restaurants-something']` in dim gray, move back — so the user watches the finished
expression form in place.

**Why the concern is correct, not merely cautious.** Ghost text is safe today because of one
invariant: it never covers real characters. That is precisely what makes `clear()` a single
`\x1b[K`. `replaceBefore > 0` breaks the invariant by design. Clearing would have to hand off to
`reRenderLine()` to restore the overwritten `.`, which drags in I10, and it would add a second
writer to the one part of this codebase that has produced two user-visible bugs in two consecutive
iterations (Steps 13 and 14). The payoff — a prettier preview of something Tab already does
correctly — does not justify reopening that surface.

I1a delivers the actual user value (they learn the completion exists, and Tab works) at a fraction
of the risk. **Revisit only if** I1a ships and users still report not understanding what Tab will do.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| M          | 4          | 5      |

## F6. Banner and logo drawn at an assumed 80 columns

**Operator: accepted as won't fix.**

`open(initialDimensions)` applies dimensions only when VS Code supplies them; otherwise `_columns`
stays at its `80` default until the first `setDimensions()` call. `showLogo()` draws a fixed
24-column box.

Cosmetic and momentary — VS Code calls `setDimensions` promptly. If F1 gives the initial width a
sensible value on the way past, this stops being a separate problem anyway. Recorded so the next
person to notice the logo wrapping at 20 columns knows it was seen and judged not worth its own
change.

| Complexity | Usefulness | Luxury |
| ---------- | ---------- | ------ |
| S          | 1          | 1      |

---

# Suggested order

Not a plan — a recommendation, expected to be rearranged.

1. **F2** (XS) and **F4** (XS) — two guards, trivially testable, each closing a class rather than an
   instance.
2. **F1** (S) — a live Step-13-shaped bug reachable by dragging the panel.
3. **I5** (S) — the cheapest thing a user notices, because the data is already fetched and then
   discarded. With I8 rejected, I5 and I1a are now the only two places where Tab completion
   advertises itself at all, which raises their importance rather than lowering it.
4. **F3** (S) and **F5** (S) — width correctness in the last two modules that lack it. F3 is also a
   prerequisite for I6 and I7 whenever those come back.
5. **I1a** (S) with **I1c** (S) — advertise bracket-notation completion, and let `db.` suggest at
   all.
6. **I2** (M) — history autosuggestion, with both caps in place from the first commit rather than
   bolted on afterwards.

Items 1–5 are all S or XS and together they cover every finding a user can hit in their first five
minutes.

# Open questions for the operator

- **Is "append only" the permanent ghost text contract?** Rejecting I1b answers it for now, and F2
  would write it down. But I7-as-menu-select needs the renderer to own rows it does not write today,
  which is the same question approached from the other side. Worth one decision covering both rather
  than two decisions that can disagree.
- **Should history persist at all, given the redaction obligation?** "No, and document why" is
  defensible and cheaper than getting redaction right.
- **Which of F1–F5 are worth a regression test each?** Every one of them is a width or cursor bug
  that survived a review round because nothing asserted on the rendered output. That is the same gap
  Step 14 exposed in the completion tests.

---

# Closing note for the implementing agent

## Definition of done, per item

1. The change is scoped to one item from `# Fix`.
2. A test exists that fails before the change and passes after it, and it asserts on **emitted ANSI
   or the resulting buffer** — not on an intermediate value.
3. `npx jest --no-coverage src/documentdb/shell/` passes. No `TDD:` suite was modified.
4. `npm run build` is clean.
5. The item in this document is marked as shipped, with the commit reference.

Full verification (`npm run prettier-fix`, `npm run lint`, the whole Jest suite, `npm run package`,
and `npm run l10n` if strings changed) belongs at ready-for-review, not per commit. See
`.github/copilot-instructions.md` for the two-case rule.

## Things that will tempt you, and shouldn't

- **Batching F1–F5.** They share three files. A batched diff makes a rendering regression
  untraceable, and these bugs are only visible at specific terminal widths.
- **Fixing `ShellGhostText.accept()`.** It is dead code — referenced only by its own tests, never by
  `DocumentDBShellPty`, which uses `currentText` + `clearGhostState()` + `insertText()` instead.
  Removing it is defensible; doing so inside an unrelated fix is not.
- **Making `reRenderLine()` ghost-aware while you are in there.** That is I10, it is deferred, and it
  is the gate on I7. Do it as its own change with its own reasoning, or not at all.
- **Swapping the `🛈` glyph for ASCII.** Considered and rejected in Step 13. `terminalDisplayWidth()`
  counts U+1F6C8 as one column, matching xterm's table; clipping bounds any font-substitution error
  to a single column. Leave it.
- **Widening the fix "while you understand the area".** Several findings are one-line guards on
  purpose. A guard that closes a class of bug is worth more than a refactor that closes one instance
  and opens a review.

## If something doesn't match

Report, don't improvise:

- A finding that no longer reproduces → the code moved; say which finding and what you found instead.
- A `Fix` item that turns out to need a `Deferred` item first → stop and say so. I7 already turned
  out this way during triage, and catching it before implementation was the point.
- A rejected item that looks necessary after all → the reasoning is recorded next to each rejection.
  Argue against the recorded reason specifically, not against the decision.

## Suggested first move

**F2.** It is a one-line guard, it has an obvious test, and it makes invariant 4 explicit — which is
what several other decisions in this document are resting on.
