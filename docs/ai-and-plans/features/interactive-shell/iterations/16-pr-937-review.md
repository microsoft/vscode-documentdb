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
recommendation, and an empty **Decision** line for Stage 2.

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

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

**Decision:**

---

# Recommended disposition

| Finding                                                                                                                 | Severity | Suggested for this PR                                |
| ----------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| [P1](#p1--availableghostcolumns-and-rerenderline-disagree-about-deferred-wrap) deferred-wrap disagreement               | Medium   | **Yes — fix before ready for review**                |
| [P2](#p2--collection-prewarming-can-open-a-second-cluster-connection-on-shell-open) prewarm opens a connection          | Medium   | **Yes — one-line option A**                          |
| [P3](#p3--the-bracket-notation-preview-clips-away-the-part-it-exists-to-show) preview clipping                          | Medium   | Yes — it undercuts I1a, which is a headline item     |
| [B4](#b4--history-autosuggestion-replays-whatever-was-typed-including-secrets) history + secrets                        | Medium   | Yes — small, and retires an I4 blocker               |
| [P5](#p5--help_setting_aliases-duplicates-help-text-across-a-package-boundary-unguarded) alias contract test            | Low      | Yes — test only                                      |
| [P9](#p9--intlsegmenter-is-constructed-on-every-call-in-two-hot-functions) Segmenter hoist                              | Low      | Yes — one line, no trade-off                         |
| [P8](#p8--maybefeedschemastore-is-async-with-nothing-to-await) signature cleanup                                        | Low      | Yes — one line                                       |
| [P11](#p11--shell-help-advertises-two-of-five-settings-and-not-the-one-it-just-made-real) `help` omits `autocompletion` | Low      | Yes — one entry                                      |
| [P4](#p4--iswidecharacter-has-no-emoji-coverage-and-this-pr-multiplies--usage) emoji width                              | Low–Med  | Operator's call — depends on the dependency question |
| [P10](#p10--_ghosttextishistory-is-cleared-in-only-one-place) ghost-kind tuple                                          | Low      | Optional — worth it if P1 opens the file anyway      |
| [P6](#p6--documentdbshelldisplayautocompletion-went-from-inert-to-load-bearing) setting became live                     | Low      | Release note only                                    |
| [P7](#p7--shellhistorysuggestion-shownaccepted-is-not-a-usable-ratio) telemetry ratio                                   | Low      | Either way — cheap                                   |
| [P12](#p12--a-clipped-ghost-inserts-more-than-it-showed) clipped accept                                                 | Info     | Test + one doc sentence                              |
| [B1](#b1--this-pr-increased-the-unlocalized-surface-of-the-shell) l10n constraint                                       | Medium   | Document the constraint; defer the mechanism         |
| [B2](#b2--the-connection-banner-is-now-the-last-width-unaware-surface) banner width                                     | Medium   | Yes if cheap — else re-rate F6 explicitly            |
| [B3](#b3--the-screen-reader-story-is-one-colorsupport-toggle-and-this-pr-made-the-row-noisier) accessibility            | Medium   | **No** — needs its own pass                          |
| [B5](#b5--shellghosttextaccept-is-still-dead-code) dead `accept()`                                                      | Low      | Decide it, either way                                |
| [B6](#b6--i10-is-the-root-cause-of-p1-step-13-and-f2-and-it-is-still-deferred) re-rate I10                              | Medium   | Audit update + issue, not code                       |
| [B7](#b7--no-property-test-across-the-three-width-consumers) width property test                                        | Low      | Yes if P1 is fixed — it is the regression net        |

## Still to do in the review workflow

Per [CONTRIBUTING §6.1](../../../../../CONTRIBUTING.md#61-stage-1-ai-review-pass-run-by-the-contributor),
this file currently holds steps 1 and 4 only:

- [x] Step 1 — edge-case review with severities
- [ ] Step 2 — merge the GitHub Copilot reviewer comments and reassess (**none posted yet** — the PR
      is still a draft with no reviews)
- [ ] Step 3 — validation gate with a different vendor's model
- [x] Step 4 — independent sweep beyond the captured issues
- [ ] Stage 2 — author decision and reasoning on each **Decision** line above

Before the PR moves to ready for review, the Case 2 command list in
[copilot-instructions.md](../../../../../.github/copilot-instructions.md) applies in full —
`npm run l10n` will be needed if any option above adds a `vscode.l10n.t()` string.
