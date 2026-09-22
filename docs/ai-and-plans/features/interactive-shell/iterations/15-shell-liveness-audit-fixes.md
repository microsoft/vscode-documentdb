---
feature: interactive-shell
kind: iteration
status: active
prs: []
created: 2026-09-18
code:
    - src/documentdb/shell/DocumentDBShellPty.ts
    - src/documentdb/shell/ShellInputHandler.ts
    - src/documentdb/shell/ShellCompletionRenderer.ts
    - src/documentdb/shell/ShellSessionManager.ts
    - packages/documentdb-js-shell-runtime/src/HelpProvider.ts
---

# Step 15 — Working the shell liveness audit

**Branch:** `dev/tnaum/integrated-shell-improvements`
**Source:** [shell-liveness-audit.md](../shell-liveness-audit.md)

This step implements the nine items the operator marked **Fix** in the liveness audit. It is not a
bug report; it is the execution record for a document that already did the diagnosis.

Per-item detail — what was found, what was decided and why — lives **inline in the audit itself**,
under a `### Shipped — commit <sha>` subsection beneath each item. The audit is the primary record.
This document is the summary and the cross-cutting lessons.

## What shipped

Nine items, nine commits, in the order the audit recommended.

| Item | Commit     | What changed                                                                |
| ---- | ---------- | --------------------------------------------------------------------------- |
| F2   | `88ef37c5` | Ghost text guarded against a mid-buffer cursor                              |
| F4   | `412722bf` | Prompt measured in display columns at all three call sites                  |
| F1   | `4c40d050` | Tracked cursor row recomputed on resize; the line repaints at the new width |
| I5   | `3b93b204` | A fully-typed candidate's own `detail` rendered as an inline hint           |
| F3   | `eb988c4b` | Completion list measured, clipped and padded in display columns             |
| F5   | `d4a2c765` | Shell `help` laid out to the terminal width                                 |
| I1a  | `a0774f47` | Bracket-notation completions advertised instead of silently skipped         |
| I1c  | `a22358b0` | `db.` suggests when exactly one collection could be meant                   |
| I2   | `50e6ba53` | Fish-style history autosuggestion, with both caps                           |

Each is followed by a small `Record <item> in the shell liveness audit` commit carrying the
write-up, because a commit cannot reference its own hash.

Deferred and won't-fix items were not touched. F6 was re-checked against F1 and still holds.

## Follow-ups found in the shipped build

Four issues surfaced while using the nine-item build. They are recorded in full under
[Found after Step 15](../shell-liveness-audit.md#found-after-step-15); all four shipped on this
branch.

| Item | Commit     | What changed                                                                 |
| ---- | ---------- | ---------------------------------------------------------------------------- |
| N1   | `829788c1` | Tab asks the completion provider before accepting an insertable ghost         |
| N2   | `5526f566` | Informational hints use `🛈`; `db.` reports the collection count               |
| N3   | `3dc5b368` | Autocompletion and informational hints are controlled by separate settings   |
| N4   | `77d39bbe` | Accepting a completion re-evaluates the next suggestion or informational hint |

N2 supersedes I1c's empty-prefix insertion. `db.` now reports how many collections are available;
typing enough of a collection name still reaches the normal completion or bracket-notation preview.
N3 then makes the visible affordance the setting boundary: unmarked, insertable text belongs to
`autocompletion`, while every `🛈` line belongs to `inlineHints`.

## The user complaint that opened the audit

> "I had only one collection called `restaurants-something` and when I typed `db.`, the ghost text
> didn't show."

Two independent gates caused that, and it initially took two items to close:

- **I1c** lets `db.` suggest at all, by ignoring database methods and asking whether exactly one
  _collection_ is on offer.
- **I1a** handles the fact that this particular collection needs bracket notation, which ghost text
  cannot render inline — so it is advertised instead: `db.` → `  → db['restaurants-something']  (Tab)`.

Neither would have answered the complaint alone. That is worth remembering when triage splits a
single report into separate items. N2 later replaced I1c's special one-collection insertion with a
collection-count hint because Tab could not honor that insertion consistently; I1a remains the
bracket-notation path once the user narrows the prefix.

## Findings that did not match the audit

The audit asked for these to be reported rather than improvised around.

**F2 did not reproduce.** The guard it asks for already existed one level up, in
`handleBufferChange()`, since the original feature commit `ec1f36d4`. `evaluateGhostText()` has
exactly one caller, so neither the Delete nor the Ctrl+U path could reach it mid-buffer. Verified by
reverting the change and re-running the new test. The guard was added anyway — four lines, at the
write site, where a second caller cannot reintroduce the bug — and the regression test is the real
deliverable.

**F3 had a third instance the audit did not name.** Measurement and the missing clip were as
described; `label.padEnd(colWidth)` in the row loop was not, and it is the one that actually pushes
columns out of alignment.

**F5's cost was misjudged, though the conclusion still holds.** The audit says `HelpProvider` is the
better home "at the same cost". It is the better home, but the cost is not the same:
`HelpProvider` runs in the **worker thread**, and the terminal width lives in the extension host.
That turned out cheap only because an existing per-eval message already crosses that boundary, so
the width rides along and is sampled exactly when `help` runs. Had that message not existed, F5
would have needed a resize protocol and should have been re-rated.

**One hypothesis checked and rejected.** Cursor movement does not fire `onBufferChange`, so stale
ghost state looked likely — ghost erased from the screen by `reRenderLine()`'s `\x1b[J` while
`isVisible` stayed `true`, letting Tab accept an invisible suggestion. It cannot happen:
`handleInput()` clears ghost state on every input except Right Arrow and Tab. Recorded so nobody
spends that half hour twice. (`setDimensions()` does _not_ go through `handleInput()`, which is why
F1 clears ghost state explicitly.)

## The decision the audit left open

I2 and I5 both want the single row after the cursor, and nothing said which wins. The rule adopted,
and now written into `evaluateGhostText()` as a comment and enforced by branch order, is
**insertable beats informational**:

1. completion ghost
2. bracket-notation preview
3. history autosuggestion
4. candidate description
5. schema hint
6. closing brackets

The visible consequence: after running `db['restaurants-something'].find()`, typing `db` offers the
whole previous line rather than `🛈 Current database`. A suggestion acceptable with one keypress
beats a description of a word already typed.

Before this step that ordering was implicit — whichever branch returned first. Three of the nine
items added a new writer to that row, so it could not stay implicit.

## Tests

All new tests assert on **emitted ANSI or the resulting buffer**, never on an intermediate value.
That was the audit's central testing instruction, and it is what would have caught both Step 13 and
Step 14.

Representative examples:

| Assertion                                             | Why it is the right level                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| `\r\x1b[8C` for a database named `日本語`             | the cursor column is the thing that breaks, not the width helper  |
| CUU count after a narrowing resize                    | would still pass if the row math were wrong, were it not asserted |
| `寿司` followed by exactly four pad spaces            | column alignment is only observable in the emitted row            |
| Tab after the I1a preview produces the previewed text | an advertisement that lies is the Step 14 failure again           |
| Right Arrow inserts exactly the remembered command    | a completion is `(deleteCount, insertText)` applied to a buffer   |

Shell suites went from **13 / 471** to **13 / 496**. Full suite: 255 suites, 3,948 tests, green.
`npm run build` clean after every commit.

No `TDD:` suite was modified. Seven existing `toHaveBeenCalledWith(code)` assertions in
`DocumentDBShellPty.test.ts` became `(code, 80)` under F5 — strictly stronger, not weakened.

## Things deliberately not done

- **`ShellGhostText.accept()`** is still dead code, referenced only by its own tests. The audit says
  removing it inside an unrelated fix is not defensible. It was not touched.
- **I10** — making `reRenderLine()` ghost-aware — was not started, despite three items writing to the
  row after the cursor. All three append or go through the hint path, so the convention still holds
  without enforcement. It remains the gate on I7.
- **Localization.** None of the new ghost hints add English prose: an arrow, an `🛈`, a preview, and
  `(Tab)` as a key name. No `npm run l10n` was needed, which is worth stating because it looks like
  it should have been. `showSchemaHint()`'s existing literal is likewise unlocalized; left alone.

## Lessons

- **A finding that no longer reproduces is still worth a commit, if the guard belongs somewhere
  else.** F2's bug was closed in the caller. Putting the guard at the write site costs four lines and
  removes the possibility of a future second caller reopening it. Deleting the item instead would
  have thrown away the regression test, which was the part with lasting value.
- **Cost estimates in an audit should record _where the code runs_, not just which module owns the
  concern.** F5 was rated S on the assumption that two candidate modules were equally reachable. One
  was across a thread boundary. The conclusion survived; the estimate would not have.
- **When several items add writers to the same scarce resource, decide the precedence explicitly
  before the second one lands.** The row after the cursor gained three new writers in this step. The
  ordering was implicit and would have become an emergent property of branch order.
- **Splitting a user report into separate backlog items hides whether the report is actually
  answered.** I1a and I1c were rated and reasoned about independently; only together do they fix the
  complaint that prompted the whole audit.
