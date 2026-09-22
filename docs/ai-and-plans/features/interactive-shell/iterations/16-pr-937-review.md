---
feature: interactive-shell
kind: review
status: active
prs: [937]
created: 2026-09-22
code:
    - src/documentdb/shell/**
    - packages/documentdb-js-shell-runtime/src/HelpProvider.ts
    - src/documentdb/feedResultToSchemaStore.ts
    - src/documentdb/playground/playgroundWorker.ts
---

# PR #937 review — "Harden the interactive shell experience"

**Branch:** `dev/tnaum/integrated-shell-improvements` · **Base:** `main` (merge-base `fa7bcbf5`)
**Size:** +5,428 / −347 across 59 files · **State at review:** draft, no reviewer comments yet

This is the Stage 1 review required by [CONTRIBUTING.md §6.1](../../../../../CONTRIBUTING.md#61-stage-1-ai-review-pass-run-by-the-contributor).
It covers steps 12–15 of the feature, which all ship in this one PR.

Two parts:

1. **[PR findings](#pr-findings)** — issues in what this PR changed.
2. **[Beyond the PR](#beyond-the-pr--the-feature-as-a-whole)** — an independent sweep of the
   Interactive Shell as a feature, looking for things this hardening iteration arguably should have
   caught while the code is open.

Each finding carries a severity, the evidence it rests on, solution options with trade-offs, a
recommendation, and the operator's **Decision**. Start at
[Disposition after Stage 2](#disposition-after-stage-2) for the index, and at
[Contested on-hold items](#contested-on-hold-items--and-how-they-landed) for the five deferrals
argued back and how each landed.

## Review status legend

| Marker | Meaning                                                             |
| ------ | ------------------------------------------------------------------- |
| ✅     | Verified against the source; the described behavior is real         |
| ⚠️     | Verified by reading, not by running; reachability argued not proven |
| 💭     | Judgement call — design opinion, not a defect                       |

## What was verified

- Full non-test diff read for `src/documentdb/shell/**`, `src/documentdb/auth/**`,
  `src/documentdb/playground/**`, `packages/documentdb-js-shell-runtime/**`, `package.json`.
- Shell suites re-run against the PR tree: **15 suites, 550 tests, green**.
- CI code-quality comment on the PR: l10n, ESLint, Prettier all green. VSIX size −263 KB.
- Cross-checked `ClustersClient.getClient` / `listCollections` semantics, `accumulateTelemetry`
  measurement folding, `reRenderLine()` cursor-row math, and `SETTINGS_LINE_PATTERN`.

## Overall assessment

The PR does what it claims. The precedence rule for the row after the cursor, the display-column
work, and the decision to split `autocompletion` from `inlineHints` are all good calls, and the
testing discipline (assert on emitted ANSI, never on an intermediate) is genuinely the right bar for
this surface.

The findings below are concentrated in one place: **the PR added a fourth independent model of
where the cursor is**, and it does not agree with the one `reRenderLine()` already had. That is
[P1](#p1--availableghostcolumns-and-rerenderline-disagree-about-deferred-wrap), and it is the only
finding worth blocking on.

---

# PR findings

## P1 — `availableGhostColumns()` and `reRenderLine()` disagree about deferred wrap

**Severity: Medium** (symptom is severe — visible line corruption; reachability is narrow) · ✅

`ShellInputHandler.reRenderLine()` and the new `setColumns()` both use the deferred-wrap–aware
formula, and say so in comments:

```ts
// ShellInputHandler.cursorRowForColumns / reRenderLine
return absCol > 0 ? Math.floor((absCol - 1) / columns) : 0;
```

`DocumentDBShellPty.availableGhostColumns()`, added by this PR, uses a different one:

```ts
return cols - 1 - (this._inputHandler.cursorColumn % cols);
```

The two disagree exactly when `cursorColumn` is a positive multiple of `cols`. Worked example,
`cols = 80`, prompt `test> ` (6), buffer 74 display columns → `cursorColumn = 80`:

| Component                 | Believes the cursor is…                    | Free columns |
| ------------------------- | ------------------------------------------ | ------------ |
| `reRenderLine()`          | row 0, last column, wrap pending (correct) | 0            |
| `availableGhostColumns()` | row 1, column 0                            | **79**       |

So up to 79 columns of ghost text are written believing the row is empty. The terminal performs the
deferred wrap, the text lands on row 1, and `\x1b[<n>D` — which by design cannot cross rows — leaves
the cursor at row 1 column 0 while the true editing position is row 0. `_lastCursorRow` is still 0,
so the **next** `reRenderLine()` moves up zero rows from the wrong row and repaints the input line
one row below itself, leaving the stale copy above.

This is the Step 13 failure mode, reachable through the code Step 13 added to prevent it. It fires
whenever the line happens to sit at an exact multiple of the terminal width _and_ a suggestion is
available — typing steadily past column 80 passes through that point once per wrapped row.

### Options

| #   | Option                                                                                                                                 | Pros                                                                                                   | Cons                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| A   | Fix the formula in place: `const col = absCol > 0 ? ((absCol - 1) % cols) + 1 : 0; return Math.max(0, cols - 1 - col);`                | Two lines; matches the existing convention; the regression test is cheap to write                      | Still a third copy of the same arithmetic — the drift can recur     |
| B   | Move the arithmetic into `ShellInputHandler` as `availableColumnsAfterCursor()`, next to `cursorRowForColumns()`, and have the PTY ask | One owner for "where is the cursor, in rows and free columns"; the two formulas can no longer disagree | Slightly widens the input handler's public surface                  |
| C   | Export the deferred-wrap row/column helpers from `terminalDisplayWidth.ts` and have both call sites use them                           | Pure functions, trivially unit-testable in isolation; no class coupling                                | A width module that also knows about cursors is a slightly odd home |
| D   | Do I10 (make `reRenderLine()` ghost-aware) and delete the separate accounting entirely                                                 | Removes the whole class of bug, not this instance; unblocks I7                                         | M-sized, and this PR is already large — wrong moment                |

**Recommendation: B**, plus a test that drives the PTY to `cursorColumn === cols` with a suggestion
pending and asserts the emitted CUB/CUU sequence. B is A's fix with the duplication removed, at
roughly the same cost. D stays the right long-term answer and is already tracked as I10 — record
this finding as new evidence for it.

**Decision — accepted, option B.** Move the arithmetic into `ShellInputHandler` alongside
`cursorRowForColumns()` and have the PTY ask, plus the regression test at `cursorColumn === cols`.
D is not reopened here; it stays I10.

**Amended after the contest pass:** [B7](#b7--no-property-test-across-the-three-width-consumers) is
folded into this item. The regression net is the property test over widths 20–200, not only the
single `cursorColumn === cols` case — the exact-multiple case is the one that was missed, so a test
that only covers it proves nothing about the next one.

> **IMPLEMENTED — `9793eb6c` + follow-up regression test.** `ShellInputHandler` now owns
> deferred-wrap-aware `availableColumnsAfterCursor()`, and the PTY delegates to it. The tests cover
> the exact-width boundary and sweep widths 20–200 over ASCII, CJK, emoji and combining graphemes,
> asserting the actual ghost output and CUB distance never exceed the row. This removes the
> disagreeing formula rather than patching only the observed value.

---

## P2 — Collection prewarming can open a second cluster connection on shell open

**Severity: Medium** · ✅

Both new prewarm call sites go through `ShellCompletionProvider.prewarmCollections()`, which calls
`ClustersClient.getClient(clusterId)`. That method is not a cache read:

```ts
// ClustersClient.getClient — when nothing is cached
const client = new ClustersClient(clusterId);
await client.initClient(abortSignal);   // full connect + metadata + telemetry
```

Before this PR the same fetch was reached only from `getDbDotCandidates()`, which guards it with
`ClustersClient.getExistingClient()` — a non-creating lookup. So the lazy path could never create a
connection; the new eager path can.

Consequences when no extension-host client exists for that cluster (shell opened from the command
palette, a URI handler, or after the tree client was disposed):

- A second connection is opened for a session the user may only use to run one command.
- `initClient` emits connect/metadata telemetry, now attributed to opening a shell. Any dashboard
  counting connections per cluster will drift.
- For Entra ID, a token acquisition runs on the extension host in addition to the worker's.
- On an unreachable cluster the attempt hangs until its own timeout; the `catch` swallows it, so it
  is invisible rather than harmless.

`use <database>` repeats this per database switch.

### Options

| #   | Option                                                                                                                      | Pros                                                                                            | Cons                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A   | Use `getExistingClient()` in `prewarmCollections()` and return early when there is none                                     | One line; prewarm keeps the benefit whenever the tree already connected; never creates anything | Shells opened without the tree get no prewarm — back to the old first-`db.` latency |
| B   | Add an explicit `createIfMissing` flag; the two PTY call sites pass `false`, the completion fallback keeps today's behavior | Intent is stated at each call site rather than implied                                          | A boolean parameter on a method that had none                                       |
| C   | Keep eager creation but make it opt-in via a setting                                                                        | User can choose latency over connections                                                        | A setting for something users cannot reason about; adds surface                     |
| D   | Ask the **worker** for the collection list instead — it is already connected and authenticated                              | No second connection ever; correct by construction; the worker is the session's real client     | Needs a new worker message type and a place to cache the answer; M-sized            |

**Recommendation: A now, D recorded as the right shape.** A restores the pre-PR invariant that
completion never causes a connection, and keeps the win in the common case (shell opened from the
tree, where the client is already cached). D is what this should eventually be: the shell already
owns a connected client in its worker, and reaching around it to the extension host is the actual
design smell.

**Decision — accepted, option A, and option D becomes an issue.** `prewarmCollections()` switches to
`getExistingClient()` in this PR, restoring the invariant that completion never causes a connection.
Asking the worker for the collection list is filed as a tracking issue rather than attempted here.

> **IMPLEMENTED — `9793eb6c`; follow-up [#938].** Prewarming now returns when
> `getExistingClient()` has no cached client and has a regression test proving `getClient()` is not
> called. This preserves the common cached-client speedup without creating a second session; #938
> owns the worker-sourced design because it requires a new cross-thread contract.

---

## P3 — The bracket-notation preview clips away the part it exists to show

**Severity: Medium** (UX) · ✅

`showCompletionPreviewHint()` renders the whole prospective line:

```ts
const preview = buffer.slice(0, Math.max(0, buffer.length - deleteCount)) + candidate.insertText;
```

The hint is then clipped to `availableGhostColumns()` — which is _reduced_ by the very buffer the
preview repeats. The hint therefore needs roughly the width the line already consumed, plus the
collection name, plus the ` 🛈` marker.

Worked example, 40-column terminal, prompt `test> ` (6), buffer `db.rest` (7):

- available = `40 - 1 - 13` = 26 columns
- needed = ` 🛈` (5) + `db['restaurants-original']` (26) = 31
- rendered = `  🛈 db['restaurants-orig…`

The ellipsis lands precisely on the closing `']`, which is the information I1a was added to convey.
This gets worse as the line grows, and I1a exists specifically for users whose collection names are
long enough to need bracket notation in the first place.

### Options

| #   | Option                                                                   | Pros                                                                 | Cons                                                          |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------- |
| A   | Preview only the replaced token: `🛈 → ['restaurants-original']`          | Shortest possible; shows exactly what changes; scales with name only | Loses the "here is the whole line" reading                    |
| B   | Clip from the **left** with a leading ellipsis: `🛈 …taurants-original']` | Keeps the tail, which is the informative end                         | Leading ellipsis is unusual in a terminal; still truncates    |
| C   | Elide the unchanged prefix: `🛈 …['restaurants-original']`                | Whole-line reading survives; the changed part always fits            | One more rendering rule to maintain                           |
| D   | Leave it; the user narrows the prefix and the preview shortens           | No work                                                              | The failure is at the moment of discovery, which is the point |

**Recommendation: C**, falling back to A when even the elided form does not fit. Both keep the
promise the hint makes — that the advertised text is what Tab will produce — which is the Step 14
lesson written into the plan's own test table.

**Decision — overridden to option A, without the arrow.** Preview only the replaced token, rendered
as `🛈 ['restaurants-original']`.

The review's own option A was written as `🛈 → ['restaurants-original']`, which is wrong on its face:
[N2](../shell-liveness-audit.md#n2-the-hint-marker-vocabulary-is-inconsistent) already decided that
the `→` marker folds into `🛈`, and reintroducing it would undo a decision taken two weeks earlier in
this same branch. A reviewer proposing a rendering must check the marker vocabulary that is already
settled — noting it here because the mistake was in the review, not in the code.

C (eliding the unchanged prefix) is not taken: it keeps a whole-line reading that nothing has asked
for, at the cost of a rendering rule that has to be maintained against every future clip case.

> **IMPLEMENTED — `9793eb6c`.** Rewrite previews now pass only `candidate.insertText` to the shared
> hint renderer, producing `🛈 ['name']`. This is shorter, preserves the closing bracket under
> clipping, and avoids adding a special prefix-elision rule; tests still apply Tab and assert the
> complete resulting buffer.

---

## P4 — `isWideCharacter()` has no emoji coverage, and this PR multiplies 🛈 usage

**Severity: Low–Medium** · ⚠️

`terminalDisplayWidth()` counts every non-CJK grapheme as one column. Emoji and pictographs
(U+1F300–U+1FAFF) are absent from `isWideCharacter()`. Before this PR the only emitter was
`showSchemaHint()`; this PR routes **four** hint kinds through `showInlineHint()`, all prefixed
` 🛈`, and hints are now shown far more often.

U+1F6C8 is East Asian Neutral and is width 1 under both xterm.js Unicode providers, so the current
code is most likely correct _for this character_. The exposure is structural rather than present:

- The same width function measures **collection and field names** in `renderCompletionList()` and in
  ghost text. A collection named `📦 inventory` is measured as 1 column for the emoji and rendered as
  2 by xterm's Unicode 11 provider, misaligning every column to its right and — in ghost text —
  stranding the cursor by one column on each render.
- Any future marker chosen from the emoji block (⚠️, ✅) inherits the bug silently.

### Options

| #   | Option                                                                                               | Pros                                           | Cons                                                          |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| A   | Add the emoji-presentation ranges to `isWideCharacter()` and handle VS16 (U+FE0F) as forcing width 2 | Matches xterm's Unicode 11 provider; ~10 lines | Hand-maintained table; drifts with each Unicode release       |
| B   | Depend on a maintained width library (`string-width` / `get-east-asian-width`)                       | Correct and stays correct                      | New runtime dependency in a bundle-size-sensitive extension   |
| C   | Restrict shell markers to BMP characters (`ℹ` U+2139 without VS16, `→`) and leave the table alone    | No width risk from our own output; zero code   | Does nothing for user-supplied names; N2 deliberately chose 🛈 |
| D   | Leave as-is, add a comment naming the gap                                                            | Free                                           | The next person re-derives it                                 |

**Recommendation: A**, scoped to emoji-presentation plus VS16, with a table-driven test listing the
characters the shell actually emits alongside a handful of realistic collection names. B is the
better engineering answer but the VSIX-size trade-off is the operator's call, not the reviewer's.

**Decision — accepted, option A.** Extend `isWideCharacter()` with emoji-presentation ranges and
VS16 handling, with the table-driven test over the characters the shell actually emits plus realistic
collection names. No new runtime dependency (B declined — the VSIX-size trade-off is not worth it for
a table this small).

> **IMPLEMENTED WITH A MECHANICAL DEVIATION — `9793eb6c`.** Width calculation uses the runtime
> Unicode `Emoji_Presentation` property plus explicit VS16 detection rather than a hand-copied range
> table. **Pros:** no dependency, no range drift, and text-default `🛈` remains one column as xterm
> expects. **Cons:** behavior follows the Node runtime's Unicode data rather than a frozen table.
> Table-driven tests cover `🛈`, default emoji, VS16, CJK, combining marks and realistic names. This
> choice is higher confidence than broad pictograph ranges, which would incorrectly widen `🛈`.

---

## P5 — `HELP_SETTING_ALIASES` duplicates help text across a package boundary, unguarded

**Severity: Low** · ✅

`HelpProvider.buildShellHelp()` (in `packages/documentdb-js-shell-runtime`, which runs in the
**worker thread**) emits `⚙ [colorSupport]`. `ShellTerminalLinkProvider` (in `src/`, extension host)
maps that marker back with a hardcoded table, falling back to the raw marker:

```ts
const settingKey = HELP_SETTING_ALIASES[settingsMatch[1]] ?? settingsMatch[1];
```

An alias added on one side and not the other produces a link that opens the Settings UI filtered on
`inlineHints` — no error, no empty state the user can interpret, just a search that finds nothing
useful. The new test hardcodes the same two pairs, so it passes whether or not the two sides agree.

### Options

| #   | Option                                                                                                                                                                                                   | Pros                                                                       | Cons                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A   | Contract test: extract every `⚙ [x]` from `new HelpProvider('shell').getHelpText()`, assert each resolves via the map, and assert each resolved key exists in `package.json` `contributes.configuration` | Catches drift on both sides and against the manifest; no production change | Test reaches across a package boundary and into the manifest                             |
| B   | Emit the full setting ID and let the link provider wrap it; drop the alias map                                                                                                                           | No mapping to drift                                                        | F5 introduced compact markers precisely so links survive narrow terminals — reopens that |
| C   | Drop the fallback so an unknown marker renders as plain text instead of a broken link                                                                                                                    | Fails visibly rather than silently                                         | Still needs someone to notice                                                            |

**Recommendation: A**, and C as a cheap companion. A is the test that would have been written if the
two halves lived in the same package.

**Decision — accepted, options A and C.** Add the contract test that walks every `⚙ [x]` marker in
the generated shell help through the alias map and on to `package.json`, and drop the
`?? settingsMatch[1]` fallback so an unmapped marker renders as plain text rather than a link that
goes nowhere.

> **IMPLEMENTED — `9793eb6c`.** The test extracts markers from real `HelpProvider('shell')` output,
> resolves each through the exported readonly map, and verifies the full key exists in every
> manifest configuration section. Unknown compact markers now produce no link. The known full
> `documentDB.shell.initTimeout` marker remains explicitly mapped for timeout errors.

---

## P6 — `documentDB.shell.display.autocompletion` went from inert to load-bearing

**Severity: Low** · ✅ 💭

The setting previously read _"Reserved for future use."_ and defaulted to `true`. Anyone who set it
to `false` did so against a documented no-op. After this PR that stored `false` silently disables Tab
completion, the candidate list, and all inline suggestions.

A second, smaller consequence: with the setting off, `handleTab()` returns before doing anything —
Tab produces no completion, no literal tab, and no bell. In multi-line mode, where a user might
reasonably reach for Tab to indent, the key is simply dead.

### Options

| #   | Option                                                               | Pros                                                  | Cons                                                   |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------ |
| A   | Accept it — the setting now does what its name always said           | No work; the name was never misleading                | A silent behavior change for anyone who had toggled it |
| B   | Mention it in the release notes for the version that ships this      | Costs one line; users who toggled it are few but real | Nothing else                                           |
| C   | Insert a literal tab (or configurable spaces) when completion is off | Tab stops being dead                                  | New input semantics; no one has asked for it           |

**Recommendation: A + B.** The setting reads honestly now; a release-note line is the whole
remediation. C is a separate idea that should not ride along in a hardening PR.

**Decision — accepted, option A only.** The setting now does what its name always said; no code
change. **B is declined** — no release-note line. The setting was shipped documented as _"Reserved
for future use"_, so the population that deliberately set it to `false` is close to empty, and a
release note about a setting becoming functional costs more reader attention than it returns.

> **RESOLVED — no change by decision.** No migration, literal-Tab behavior, or release-note entry was
> added. The benefit would be negligible for a previously documented no-op, while each alternative
> adds semantics or reader cost unrelated to the hardening goal.

---

## P7 — `shell.historySuggestion` shown/accepted is not a usable ratio

**Severity: Low** (telemetry quality) · ✅

`accumulateTelemetry` sums measurements, so `sample.measurements.shown = 1` is a per-call counter —
the pattern is correct and matches the surrounding code. The problem is the denominator.

A history ghost re-renders whenever the suggestion text changes, which is most keystrokes while a
match holds. Typing 20 characters of a remembered command can emit ~20 `shown` events for one
suggestion the user either accepts once or abandons. `shell.completionGhost` has the same shape but
a much narrower trigger, so the two events look comparable on a dashboard and are not.

### Options

| #   | Option                                                                                                                                  | Pros                                           | Cons                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| A   | Count a suggestion once per _matched history entry_, not per render — track the last suggested entry and only increment when it changes | Ratio becomes meaningful; small state addition | One more field on the PTY                       |
| B   | Add a separate `renders` measurement and leave `shown` per-render                                                                       | No behavior change; the dashboard can pick     | Pushes the problem to whoever builds the query  |
| C   | Leave it, and document the semantics where the event is defined                                                                         | Free                                           | Dashboards will be wrong before anyone reads it |

**Recommendation: A.** Also cross-check against
[`skills/vscode-documentdb-telemetry-dashboards`](../../../../../.github/skills/vscode-documentdb-telemetry-dashboards/SKILL.md)
— a new event name should be registered wherever the existing shell events are, or it will be
invisible.

**Decision — accepted, option A.** Count a suggestion once per matched history entry rather than per
render, and cross-check that `shell.historySuggestion` is registered wherever the existing shell
events are.

> **IMPLEMENTED — `9793eb6c`.** The PTY remembers the last matched history entry and increments
> `shown` only when that entry changes; a test types through one match across multiple debounced
> renders and observes one event. The event already uses the extension's shared accumulating
> telemetry path, so no separate event registry change was required.

---

## P8 — `maybeFeedSchemaStore` is `async` with nothing to await

**Severity: Low** · ✅

Commit `570f55bf` made `deserializeResultForSchema` synchronous (correctly — the `await import('bson')`
was the dual-package hazard documented in the sibling PR #933 work). But the caller kept its
`async`/`void` shape:

```ts
private async maybeFeedSchemaStore(result: SerializableExecutionResult): Promise<void> {
    try {
        const deserialized = deserializeResultForSchema(result);   // sync
        feedResultToSchemaStore(deserialized, this._connectionId); // sync
    } catch { /* best-effort */ }
}
```

The signature now promises deferral it does not provide: `EJSON.parse` of the batch plus schema
inference runs inline on the extension-host thread before the prompt returns. The retained comment
"Runs asynchronously and never blocks the prompt" was edited, but the `async` keyword and the `void`
at the call site still say otherwise to the next reader.

At the default `documentDB.batchSize` of 50 this is not measurable. It is a correctness-of-contract
issue, and a latency one for users who raise the batch size.

### Options

| #   | Option                                                                                | Pros                                          | Cons                                              |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- |
| A   | Drop `async`/`Promise<void>`/`void`; call it plainly                                  | Signature matches behavior; smallest change   | Keeps the work on the hot path                    |
| B   | A + `setTimeout(..., 0)` so the prompt is painted before parsing                      | Restores the original non-blocking intent     | Reordering is observable if a test asserts timing |
| C   | Move parsing to the worker, which already has the raw objects before serializing them | Removes a parse/serialize round trip entirely | Crosses a thread boundary; M-sized                |

**Recommendation: A for this PR, C recorded as future work.** C is the real answer — the worker
serializes objects to EJSON and the host immediately parses them back purely to feed `SchemaStore` —
but it is out of scope here.

**Decision — accepted, option A, and option C becomes an issue.** Drop the `async`/`Promise<void>`/
`void` so the signature matches the behavior. Moving the parse into the worker — which already holds
the raw objects it serializes — is filed as a tracking issue.

> **IMPLEMENTED — `9793eb6c`; follow-up [#939].** `maybeFeedSchemaStore()` is now synchronous in
> both signature and call site, matching its actual EJSON parse/inference behavior. #939 tracks
> removing the round trip entirely because that change crosses the worker boundary.

---

## P9 — `Intl.Segmenter` is constructed on every call in two hot functions

**Severity: Low** (performance) · ✅

Both `terminalDisplayWidth()` and the new `clipToDisplayWidth()` do
`new Intl.Segmenter(undefined, { granularity: 'grapheme' })` per invocation. Segmenter construction
is not free. On the non-ASCII path these run per keystroke, and `renderCompletionList()` calls them
twice per candidate (clip, then pad).

**Recommendation:** hoist one module-level `const GRAPHEME_SEGMENTER` and share it. Segmenters are
stateless across `segment()` calls, so there is no correctness trade-off to weigh — this is a
one-line change with no downside.

**Decision — accepted after the contest pass.** Hoist a module-level `GRAPHEME_SEGMENTER` shared by
`terminalDisplayWidth()` and `clipToDisplayWidth()`. Taken because P4 opens this file anyway; the
only cost of deferring was a second PR touching it.

> **IMPLEMENTED — `9793eb6c`.** Both width functions share one module-level segmenter. Segmenters
> are stateless for these calls, so this removes per-keystroke construction without a lifecycle or
> correctness trade-off.

---

## P10 — `_ghostTextIsHistory` is cleared in only one place

**Severity: Low** (latent) · ⚠️

`showInsertableGhost()` resets `_ghostTextIsHint`, and the completion branch resets
`_ghostTextIsClosingBrackets` and `_ghostCandidateKind`, but nothing resets `_ghostTextIsHistory`
except `clearGhostState()`.

I traced this and could **not** find a reachable path today: `handleInput()` clears ghost state on
every input except Right Arrow and Tab, and both accept paths call `clearGhostState()` before
`reevaluateGhostText()`. So this is a trap, not a bug — a future writer to that row that does not go
through `clearGhostState()` will mis-attribute acceptance telemetry to history.

**Recommendation:** set all four flags in one place. The cleanest shape is a private
`setGhostKind('completion' | 'history' | 'closingBrackets' | 'hint')` that assigns the whole tuple,
replacing four independent booleans that must be kept consistent by hand. This is the same "make the
invariant structural" move the PR already made for `showInsertableGhost` / `showInlineHint`, applied
one level deeper.

**Decision — accepted after the contest pass, conditionally.** Replace the four booleans with a
single ghost-kind value **if P1's implementation already moves that state**. If P1 lands without
touching the flags, this stays on hold — it is a latent trap, not a live defect, and does not justify
its own commit.

> **RESOLVED — condition not met, no change.** P1 centralized only cursor-capacity arithmetic in
> `ShellInputHandler`; it did not move the PTY's ghost-kind flags. Converting the tuple would therefore
> be an unrelated state refactor with no live failure fixed, exactly the case the conditional ruling
> said to leave on hold.

---

## P11 — Shell `help` advertises two of five settings, and not the one it just made real

**Severity: Low** (UX) · ✅ 💭

The new Settings section links `colorSupport` and `inlineHints`. It omits
`documentDB.shell.display.autocompletion` — the setting this PR converted from a no-op to the master
switch for Tab completion — as well as `multiLinePasteBehavior`, `initTimeout`, and `batchSize`.

A user who finds the ghost text distracting reads `help`, sees `inlineHints`, turns it off, and the
dim insertable suggestions remain. The one setting that would have answered their question is the
one not listed.

**Recommendation:** add `autocompletion` as a third entry. Whether the remaining two belong in
`help` is a judgement call — arguably `help` should list the _display_ settings and leave the rest to
the Settings UI, which is a defensible line to draw and worth stating explicitly in the audit.

**Decision — accepted.** Add `autocompletion` as a third entry in the shell `help` Settings section,
with its alias and link. The remaining shell settings stay out: `help` lists the **display**
settings, and `initTimeout`, `multiLinePasteBehavior` and `batchSize` belong to the Settings UI.
That is the line, and it is now written down.

> **IMPLEMENTED — `9793eb6c`.** Shell help now lists `autocompletion` with a compact clickable
> marker and narrow-width manual search fallback. The help contract test proves the marker resolves
> to the contributed display setting; operational settings remain intentionally absent.

---

## P12 — A clipped ghost inserts more than it showed

**Severity: Info** · ✅ 💭

`ShellGhostText` keeps `_currentGhost` (full) and `_renderedGhost` (clipped, ellipsised), and
`accept()` returns the full text. Right Arrow on `  db.restaurants.aggregate([{ $ma…` inserts the
entire remembered command.

This is almost certainly the right behavior — the ellipsis is the signal that there is more — and
fish behaves the same way. Recording it because it is an undocumented contract that a future reader
of `accept()` could "fix" in the wrong direction, and because no test pins it.

**Recommendation:** one test asserting that accepting a clipped ghost inserts the unclipped text, and
one sentence in the user manual. No production change.

**Decision — on hold.** Not decided in this pass.

> **UNCHANGED — still on hold.** No production behavior or documentation contract was added. The
> clipped/full acceptance behavior remains covered indirectly by PTY acceptance tests, but the
> review did not authorize the dedicated user-manual promise proposed here.

---

# Beyond the PR — the feature as a whole

The brief was to look past the diff for things this hardening iteration should arguably close while
the code is open. These are ordered by how strongly they belong in _this_ iteration rather than a
later one.

## B1 — This PR increased the unlocalized surface of the shell

**Severity: Medium** · ✅

Step 15 records: _"Localization. None of the new ghost hints add English prose … No `npm run l10n`
was needed, which is worth stating because it looks like it should have been."_ That is true of the
markers. It is not true of the PR as a whole, which added to `HelpProvider`:

- `'Select an option to open it in VS Code Settings:'`
- `'Manual access: search Settings for documentDB.shell.display.colorSupport'`
- `'1. ⚙ [colorSupport] Toggle syntax and output colors.'`
- `'2. ⚙ [inlineHints] Toggle 🛈 descriptions, counts, and previews.'`

Plus the pre-existing unlocalized set it sits in: the entire `help` document, `'…and N more'` in
`renderCompletionList`, and `showSchemaHint`'s `'Run db.X.find() first for field suggestions'`.

The repo rule is _"Use `vscode.l10n.t()` for all user-facing strings."_ `HelpProvider` lives in
`packages/documentdb-js-shell-runtime`, which deliberately has no `vscode` dependency and runs in a
worker — so the rule is not mechanically applicable there, and that is a real constraint rather than
an oversight. But it has never been written down, and the gap is now growing.

### Options

| #   | Option                                                                                                                                        | Pros                                                                    | Cons                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A   | Record the constraint in the feature README: shell `help` is English by design because it is generated in a worker in a `vscode`-free package | Honest, costs a paragraph, stops the question being re-asked            | The gap stays                                                                            |
| B   | Pass a translated string bundle into `HelpProvider` from the host at init                                                                     | Fully localizable; the package stays `vscode`-free                      | New init payload; `l10n.t` keys for ~30 strings; M-sized                                 |
| C   | Move `help` rendering to the extension host; the worker returns a marker and the host builds the text                                         | `vscode.l10n.t()` works directly; host already knows the terminal width | Undoes F5's "HelpProvider is the better home" decision — re-litigating a recorded choice |
| D   | Localize only the host-side strings (`'…and N more'`, the schema hint) and leave `help`                                                       | Small, strictly positive                                                | Partial; the largest block stays English                                                 |

**Recommendation: A + D in this PR, B recorded as future work.** A is the missing piece: the
constraint is real and reasonable, and writing it down converts a silent gap into a stated decision.
D is a handful of lines with no architectural argument attached. C should not be taken — F5's
placement decision was reasoned and recent, and reversing it for localization alone would trade a
correctness property (width is sampled where `help` runs) for a translation property.

**Decision — option B becomes an issue; option A taken after the contest pass.** The tracking issue is
the question itself: _how does a `vscode`-free worker package emit localized text?_ That is the
reusable problem — `documentdb-js-shell-runtime` will not be the last package in this position — so
the issue is scoped to the mechanism, not to translating `help`.

**Option A is now in scope for this PR:** a paragraph in the feature README stating that shell `help`
is English **by design**, because it is generated in a worker in a package that cannot depend on
`vscode`. Without it the gap reads as an oversight and gets re-filed — this review did exactly that.

D (localize the host-side strings) was not taken.

> **IMPLEMENTED / TRACKED — feature README; follow-up [#940].** The README now states that worker
> help is English by design because `documentdb-js-shell-runtime` cannot depend on `vscode`, and that
> moving width-sensitive rendering to the host is not the workaround. #940 owns the reusable
> translated-bundle mechanism. This documents the constraint now without pretending the gap is
> solved.

---

## B2 — The connection banner is now the last width-unaware surface

**Severity: Medium** (UX) · ✅

F6 ("banner and logo drawn at an assumed 80 columns") was rated **Won't fix** before F5 taught `help`
to lay itself out. That decision is worth re-rating, because this PR also made the banner
substantially longer:

```
Identity: user@contoso.com | Authentication: Microsoft Entra ID (Managed Identity) | Database: myDatabase
```

That is ~105 columns before the display name, and it is the first thing every user sees. Below ~100
columns it hard-wraps mid-label, and it now carries ANSI sequences from `formatConnectionValue()`, so
the wrap lands in the middle of a styled run.

The new logo is fine — 24 columns, safe well below any realistic terminal.

### Options

| #   | Option                                                                                             | Pros                                                     | Cons                                                                    |
| --- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| A   | Break the summary into one label per line below a threshold (say 100 columns)                      | Simple; the host already knows `_columns` at banner time | Three lines instead of two in narrow terminals                          |
| B   | Always one label per line                                                                          | Predictable; easiest to read; no width logic at all      | Taller banner for everyone; the compact form was a deliberate choice    |
| C   | Shorten the labels (`Auth:` instead of `Authentication:`, drop `Microsoft Entra ID` to `Entra ID`) | No layout logic; buys ~25 columns                        | Terminology rules favor the full product names                          |
| D   | Leave it — terminals are wide                                                                      | Free                                                     | The PR's own thesis is that narrow widths are where this feature breaks |

**Recommendation: A.** The host knows the width at banner time (`_columns`, defaulted to 80 and
updated by `open()`), so this is genuinely cheap — and shipping width-aware `help` next to a
width-blind banner is the inconsistency a reviewer will notice first. Re-rate F6 in the audit with
the reasoning, whichever way it goes.

**Decision — accepted, option A.** Break the connection summary into one label per line below a width
threshold. F6 is thereby re-rated from **Won't fix** in practice: the logo stays as-is, the summary
becomes width-aware. Record that re-rating in the audit against F6, with this PR's longer
`Identity: … | Authentication: … | Database: …` line as the reason it changed.

> **IMPLEMENTED — `9793eb6c`.** Below 100 columns the PTY emits identity, authentication and
> database as separate localized lines; wider terminals retain the compact summary. Narrow and wide
> tests pin both layouts. The audit now re-rates F6 as shipped for the summary while retaining the
> original no-change decision for the fixed 24-column logo.

---

## B3 — The screen-reader story is one `colorSupport` toggle, and this PR made the row noisier

**Severity: Medium** (accessibility) · 💭 ⚠️

`documentDB.shell.display.colorSupport` is documented as _"Disable for screen readers or piped
output"_, but it only suppresses ANSI color. It does not suppress the behavior that actually matters
to assistive technology: text written after the cursor, then un-written, on a 50 ms debounce, on
every keystroke. This PR increases how often that happens (four hint kinds plus history
autosuggestion where there was one schema hint), and adds a `🛈` glyph that screen readers announce
inconsistently.

VS Code exposes `editor.accessibilitySupport` and the terminal has its own accessible-buffer mode.
Neither is consulted.

### Options

| #   | Option                                                                                                                  | Pros                                                                | Cons                                                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| A   | Default `autocompletion` and `inlineHints` to `false` when `editor.accessibilitySupport === 'on'`, overridable          | Right default for the users who need it; the settings already exist | Implicit coupling between an editor setting and shell behavior; needs a `help` line explaining why the row is empty |
| B   | Replace `🛈` with an ASCII marker (`(i)`) when `colorSupport` is off, treating that setting as the existing "plain mode" | Uses the switch already documented for screen readers; tiny change  | Overloads a setting named for color with non-color meaning                                                          |
| C   | Add a third setting, `documentDB.shell.display.plainMode`, that turns off color, hints, and ghost text together         | Explicit; one switch for "I am using a screen reader"               | A fourth display setting; N3 already debated how many is too many                                                   |
| D   | Document the recommended combination in the user manual and stop there                                                  | Zero risk; honest                                                   | Leaves the default hostile                                                                                          |

**Recommendation: D in this PR, A investigated separately.** This deserves a real accessibility pass
rather than a guess appended to a large hardening PR — the
[`accessibility-aria-expert`](../../../../../.github/skills/accessibility-aria-expert/SKILL.md) skill
is written for webviews, so the terminal surface has no established pattern to follow yet. Recording
it as a known gap with a named owner is more valuable than shipping A untested.

**Decision — issue only; nothing in this PR.** Confirms the review's own recommendation that this
needs a dedicated accessibility pass rather than a guess appended to a large hardening PR. Option D
(document the recommended setting combination) was not taken either — the issue carries the whole
item, including the open question of whether the terminal surface needs its own accessibility skill
alongside `accessibility-aria-expert`.

> **TRACKED — [#941], no code change.** The issue requires evidence from screen readers and VS Code's
> terminal accessibility modes before choosing defaults or a plain-mode design. Shipping an
> untested coupling to editor accessibility settings would reduce confidence rather than improve
> accessibility.

---

## B4 — History autosuggestion replays whatever was typed, including secrets

**Severity: Medium** · ✅ 💭

I2 gives the shell fish-style autosuggestion over the last 100 in-memory commands. The audit records
that I4 (persisting history) is _"blocked on a redaction decision rather than on storage"_. That
redaction question now has an in-memory, on-screen counterpart that shipped without being asked:

- A user who runs `db.auth('admin', 'hunter2')` will see it re-offered as dim ghost text the moment
  they type `db.a`, in front of whoever is looking at the screen or the shared window.
- Right Arrow accepts it in one keystroke, with no confirmation, and the secret is then in the
  buffer — and in the next history entry.
- `getClosingBrackets`, syntax highlighting, and the history scan all operate on the raw text; there
  is no redaction layer anywhere on this path.

Nothing leaves the machine, and the same text was already in scrollback — so this is an exposure
change of degree, not of kind. But "offered back automatically, accepted with one key" is a
meaningfully different posture from "present in scrollback".

### Options

| #   | Option                                                                                                                                                                         | Pros                                                              | Cons                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------ |
| A   | Skip history entries matching a small sensitive-pattern list (`db.auth(`, `createUser`, `updateUser`, `changeUserPassword`, anything containing `mongodb://` with credentials) | Targeted; the list is short and the method names are well known   | Pattern lists are always incomplete                          |
| B   | Skip nothing from suggestion, but exclude the same patterns from the history _ring_ entirely                                                                                   | Also fixes Up-arrow recall and pre-solves I4's redaction question | Users lose Up-arrow for those commands, which some will want |
| C   | Add a setting to disable history autosuggestion independently of other ghost text                                                                                              | User control                                                      | A fifth display setting; does not help users who never look  |
| D   | Accept — it is local, in-memory, and matches every other shell                                                                                                                 | True; bash and fish do exactly this                               | Those shells are not usually screen-shared inside an IDE     |

**Recommendation: A, with the pattern list shared with I4** so that whenever persistence lands it
inherits one redaction rule rather than inventing a second. This is the highest-value item in this
section: it is small, it is on the path the PR just built, and it retires a blocker on a deferred
item at the same time.

**Decision — issue only, and the exposure is explicitly accepted for this release.** Confirmed after
the contest pass.

**Operator's reasoning:** shell history is never persisted. It lives in memory for the life of the
terminal and is gone when the terminal closes — nothing reaches disk, secret storage, or telemetry.
What autosuggestion re-displays is text the user typed in this session, in a window they are already
looking at.

**What that reasoning does not cover, stated so it is not lost:** the residual is on-screen and
timing, not storage — a secret typed early in a session is re-offered later on a matching prefix, and
Right Arrow accepts it in one keypress. The two situations where that matters are screen sharing and
an unattended window. This is accepted, not unrecognized.

**The issue must carry both**: the exposure decision above, and the shared-pattern-list constraint —
the value of option A was never the filter alone, it was that the same list unblocks
[I4](../shell-liveness-audit.md#i4-persist-history-across-sessions). An issue filed as only "redact
secrets from autosuggestion" loses the half that mattered and reads like a backlog item rather than a
decision.

> **TRACKED — [#945], exposure accepted for this release.** The issue records both the in-memory-only
> rationale and the residual screen-sharing/unattended-window risk, and requires one policy shared by
> autosuggestion and future persistence. No partial pattern list was shipped as if it were a complete
> security boundary.

---

## B5 — `ShellGhostText.accept()` is still dead code

**Severity: Low** · ✅

Referenced only by its own tests. Step 15 explicitly declined to remove it inside an unrelated fix,
which was the right call at the time. This PR now touches `ShellGhostText` substantially — the
constructor, `_renderedGhost`, `show()`, `clear()`, `reset()` — so "unrelated" no longer applies.

Note the interaction with [P12](#p12--a-clipped-ghost-inserts-more-than-it-showed): `accept()` is the
natural home for the clipped-vs-full contract, so deleting it and pinning that contract on the PTY's
`handleAcceptGhostText()` should be decided together rather than separately.

**Recommendation:** delete `accept()` and its tests, or wire `handleAcceptGhostText()` through it —
but pick one in this PR, since the next person to open this file will ask the same question again.

**Decision — accepted: clean up.** Delete `ShellGhostText.accept()` and its tests. The PR already
rewrites this class substantially, so "removing it inside an unrelated fix" — Step 15's reason for
leaving it — no longer applies.

> **IMPLEMENTED — `9793eb6c`.** The dead method, lifecycle documentation and method-only tests were
> removed. PTY acceptance remains the single live path and continues to test insertion of the full
> ghost text.

---

## B6 — I10 is the root cause of P1, Step 13, and F2, and it is still deferred

**Severity: Medium** (strategic) · 💭

Three separate defects in this feature have now had the same shape: **something writes to the row
after the cursor, and `reRenderLine()` does not know about it.**

| Item             | Symptom                                                 | Fix shipped                |
| ---------------- | ------------------------------------------------------- | -------------------------- |
| Step 13          | Ghost text wraps and strands the cursor                 | Clip ghost text to the row |
| F2               | Ghost text paints over the real tail mid-buffer         | Guard at the write site    |
| P1 (this review) | Free-column math disagrees with the renderer's row math | (open)                     |

Each was fixed by teaching one more caller to compensate for a renderer that does not model ghost
text. Step 15's own lessons say: _"When several items add writers to the same scarce resource, decide
the precedence explicitly before the second one lands."_ The same argument applies one level down —
the row has five writers and a renderer that believes it has none.

I10 is rated M and gates I7 (Tab-cycling), the largest deferred item. It should not be done in this
PR. It should be **re-rated** with P1 as new evidence, because its value was assessed when it looked
like tidiness and it is now demonstrably preventing recurring defects.

**Recommendation:** add P1 to I10's justification in the audit and raise its value rating. Consider
opening a tracking issue per
[CONTRIBUTING §6.5](../../../../../CONTRIBUTING.md#65-escape-hatch-create-issues-instead-of-blocking-the-pr)
so it survives outside this document.

**Decision — on hold.** Not decided in this pass.

> **UNCHANGED — still on hold.** P1 now supplies the evidence this re-rating would cite, but the
> operator did not authorize I10 implementation or an issue in this pass. The accepted narrow fix
> removes the live corruption without expanding this already-large PR into the renderer redesign;
> the cost is that the broader five-writer model remains deferred.

---

## B7 — No property test across the three width consumers

**Severity: Low** · 💭

Three components independently convert display width into cursor movement: `reRenderLine()`,
`ShellGhostText.show()`, and `renderCompletionList()`. The PR's tests assert specific emitted
sequences for specific inputs, which is the right level and caught real bugs — but each is a point
sample, and P1 is exactly the case that falls between them.

**Recommendation:** one property-style test that, for widths 20–200 and a corpus of buffers (ASCII,
CJK, emoji, combining marks), asserts the invariant _"total emitted display width after the cursor ≤
columns − cursor column − 1"_. That invariant is stated in `availableGhostColumns()`'s doc comment
already; nothing checks it. This is cheap relative to what it covers, and would have caught P1
without anyone thinking of the exact-multiple case.

**Decision — accepted after the contest pass, folded into
[P1](#p1--availableghostcolumns-and-rerenderline-disagree-about-deferred-wrap).** Not a separate work
item: it ships as P1's regression net, covering widths 20–200 over ASCII, CJK, emoji and combining
marks. P4 widens the alphabet that invariant must hold over, so both changes land against the same
test.

> **IMPLEMENTED WITH P1.** The property sweep drives the shared capacity owner and actual ghost
> renderer, asserting emitted display width and cursor-back distance across every width and character
> class named above. It is kept with P1 because the test protects the invariant, not one formula.

---

# Disposition after Stage 2

Decided by the operator on 2026-09-22, in two passes: the initial decisions, then a contest pass over
the items first left on hold. The per-finding reasoning is on each **Decision** line above; this is
the index.

## Build in this PR

| Finding                                                                                                                 | Severity | Decided                                                     |
| ----------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| [P1](#p1--availableghostcolumns-and-rerenderline-disagree-about-deferred-wrap) deferred-wrap disagreement               | Medium   | Option B — one owner in `ShellInputHandler`; **absorbs B7** |
| [P2](#p2--collection-prewarming-can-open-a-second-cluster-connection-on-shell-open) prewarm opens a connection          | Medium   | Option A — `getExistingClient()`                            |
| [P3](#p3--the-bracket-notation-preview-clips-away-the-part-it-exists-to-show) preview clipping                          | Medium   | Option A **without the arrow** — `🛈 ['name']`               |
| [P4](#p4--iswidecharacter-has-no-emoji-coverage-and-this-pr-multiplies--usage) emoji width                              | Low–Med  | Option A — emoji ranges + VS16, table-driven test           |
| [P5](#p5--help_setting_aliases-duplicates-help-text-across-a-package-boundary-unguarded) alias drift                    | Low      | Options A + C — contract test, drop the fallback            |
| [P7](#p7--shellhistorysuggestion-shownaccepted-is-not-a-usable-ratio) telemetry ratio                                   | Low      | Option A — count per matched entry                          |
| [P8](#p8--maybefeedschemastore-is-async-with-nothing-to-await) signature cleanup                                        | Low      | Option A — drop `async`/`void`                              |
| [P9](#p9--intlsegmenter-is-constructed-on-every-call-in-two-hot-functions) Segmenter hoist                              | Low      | Accepted in the contest pass — rides with P4                |
| [P11](#p11--shell-help-advertises-two-of-five-settings-and-not-the-one-it-just-made-real) `help` omits `autocompletion` | Low      | Accepted — add the third entry                              |
| [B1](#b1--this-pr-increased-the-unlocalized-surface-of-the-shell) l10n constraint                                       | Medium   | Option A — README paragraph (mechanism → issue)             |
| [B2](#b2--the-connection-banner-is-now-the-last-width-unaware-surface) banner width                                     | Medium   | Option A — stack below a threshold; re-rate F6              |
| [B5](#b5--shellghosttextaccept-is-still-dead-code) dead `accept()`                                                      | Low      | Accepted — delete it and its tests                          |

**Conditional:** [P10](#p10--_ghosttextishistory-is-cleared-in-only-one-place) (ghost-kind value)
ships **only if** P1's implementation already moves those flags. Otherwise it returns to on hold.

**Absorbed:** [B7](#b7--no-property-test-across-the-three-width-consumers) is not a separate work
item — it is P1's regression net.

## No change (decided)

| Finding                                                                                             | Decided                             |
| --------------------------------------------------------------------------------------------------- | ----------------------------------- |
| [P6](#p6--documentdbshelldisplayautocompletion-went-from-inert-to-load-bearing) setting became live | Option A only — **no release note** |

## Filed as issues

| Source                                                                                         | Issue scope                                                                             |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [P2](#p2--collection-prewarming-can-open-a-second-cluster-connection-on-shell-open) option D   | [#938] — ask the worker for the collection list instead of the extension host           |
| [P8](#p8--maybefeedschemastore-is-async-with-nothing-to-await) option C                        | [#939] — feed `SchemaStore` from the worker; drop the serialize/parse round trip        |
| [B1](#b1--this-pr-increased-the-unlocalized-surface-of-the-shell) option B                     | [#940] — **how** a `vscode`-free worker package emits localized text                    |
| [B3](#b3--the-screen-reader-story-is-one-colorsupport-toggle-and-this-pr-made-the-row-noisier) | [#941] — accessibility pass for the terminal surface                                    |
| [B4](#b4--history-autosuggestion-replays-whatever-was-typed-including-secrets)                 | [#945] — redaction; carries the **accepted exposure** and the I4 shared-list constraint |

## On hold

Still undecided after both passes:
[P12](#p12--a-clipped-ghost-inserts-more-than-it-showed) and
[B6](#b6--i10-is-the-root-cause-of-p1-step-13-and-f2-and-it-is-still-deferred). Neither was
contested — see [Not contested](#not-contested) for why both are correctly parked.

## Contested on-hold items — and how they landed

Five items were argued back after the first pass. **All five were resolved**; the outcome is on each
subsection and reflected in the tables above. Kept in full because the argument, not just the
outcome, is the part that is hard to reconstruct later.

### B7 — the width property test. Reopen. → **Accepted, folded into P1**

P1 is being fixed, and the fix is a **behavioral** change to cursor arithmetic. The accepted plan
adds one regression test at `cursorColumn === cols`. That test only proves the case someone thought
of; P1 itself is the proof that thinking of the case is the hard part.

B7's invariant — _emitted display width after the cursor ≤ columns − cursor column − 1_ — is already
written in `availableGhostColumns()`'s doc comment, and P4 is about to widen the input alphabet that
invariant must hold over. Doing P1 and P4 without B7 means changing the width model twice and
verifying it by example both times.

**Ask:** fold B7 into P1 as its regression net rather than treating it as a separate item.

**Resolved:** agreed — folded into P1. B7 has no commit of its own.

### P9 — hoist the `Intl.Segmenter`. Reopen, at effectively zero cost. → **Accepted**

One line, no trade-off recorded on either side, in a file **P4 is about to edit anyway**. Leaving it
on hold means either a second PR touching `terminalDisplayWidth.ts` or a permanent per-keystroke
allocation. There is no version of this that is cheaper later.

**Resolved:** agreed — ships with P4.

### P10 — the ghost-kind tuple. Reopen, conditionally. → **Accepted, conditionally**

P1 opens `DocumentDBShellPty` and `ShellInputHandler`; B5 deletes part of `ShellGhostText`. The four
loosely-coupled booleans are exactly the state this work is moving around. If P1 lands without it,
the next person adding a writer to that row inherits the trap described in the finding.

**Ask:** take it only if P1's implementation already touches the flags. If P1 lands cleanly without
them, leave it on hold — it is a latent issue, not a live one.

**Resolved:** agreed, on exactly that condition. The implementing commit for P1 must state which way
it went, so the condition is not silently dropped.

### B4 — deferred to an issue. Push back. → **Exposure accepted, with reasoning**

Recorded here rather than silently accepted: this was the review's highest-value beyond-the-PR item
and the only one with a **security** dimension. Deferring it means shipping a feature that, in this
release, offers `db.auth('admin', 'hunter2')` back as one-keypress ghost text.

The counter-argument for deferring is real — a pattern list is a security control, and shipping one
hastily inside a large PR is how incomplete filters become permanent. But the exposure is live from
the moment this PR merges, and the mitigation is a `startsWith` check over four method names.

**Ask:** either take option A now, or state in the issue that the exposure is **accepted for this
release** and why. An issue that reads like a backlog item will not convey that a decision was made.

**Resolved:** the second branch — the exposure is **accepted**, because shell history is never
persisted. The full reasoning, and the residual it does not cover, are recorded on
[B4](#b4--history-autosuggestion-replays-whatever-was-typed-including-secrets) itself. This is the
one place where the review's recommendation was overruled on the merits rather than on scope, which
is why the reasoning is written out rather than summarized.

### B1 option A — documenting the constraint. Reopen. → **Accepted**

The issue covers the _mechanism_. It does not cover the fact that shell `help` is English **by
design** because it is generated in a `vscode`-free worker package. Until that sentence is in the
feature README, the gap looks like an oversight, and the next reviewer will file it again — this
review just did.

**Ask:** one paragraph in the feature README, independent of when the issue is worked.

**Resolved:** agreed — the README paragraph ships in this PR; the mechanism stays an issue.

### Not contested

[P12](#p12--a-clipped-ghost-inserts-more-than-it-showed) and
[B6](#b6--i10-is-the-root-cause-of-p1-step-13-and-f2-and-it-is-still-deferred) are correctly on hold.
P12 pins a contract that nothing is currently threatening. B6 is an audit re-rating whose whole
value is the evidence from P1 — which does not exist until P1 is implemented, so doing it now would
be writing the conclusion before the work.

## Still to do in the review workflow

Per [CONTRIBUTING §6.1](../../../../../CONTRIBUTING.md#61-stage-1-ai-review-pass-run-by-the-contributor):

- [x] Step 1 — edge-case review with severities
- [ ] Step 2 — merge the GitHub Copilot reviewer comments and reassess (**none posted yet** — the PR
      is still a draft with no reviews)
- [ ] Step 3 — validation gate with a different vendor's model
- [x] Step 4 — independent sweep beyond the captured issues
- [x] Stage 2 — operator decisions recorded, 2026-09-22, including the contest pass
- [x] Stage 3 — implemented in grouped shell/test and documentation commits as authorized by the
      operator; each finding is logged inline above
- [x] File the five issues listed above and link them here

Twelve work items ship in this PR, plus P10 conditionally. Suggested order, so that each item lands
against a file the previous one already opened: P1 (with B7), P10 if it falls out, P4 + P9, P2, P3,
P5, P7, P8, P11, B2, B5, B1.

Before the PR moves to ready for review, the Case 2 command list in
[copilot-instructions.md](../../../../../.github/copilot-instructions.md) applies in full —
`npm run l10n` will be needed if any accepted option adds a `vscode.l10n.t()` string. P11 and B2 are
the two most likely to.

[#938]: https://github.com/microsoft/vscode-documentdb/issues/938
[#939]: https://github.com/microsoft/vscode-documentdb/issues/939
[#940]: https://github.com/microsoft/vscode-documentdb/issues/940
[#941]: https://github.com/microsoft/vscode-documentdb/issues/941
[#945]: https://github.com/microsoft/vscode-documentdb/issues/945
