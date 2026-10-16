---
feature: copy-paste-collections
kind: review
status: active
prs: [848]
created: 2026-09-16
verified: 2026-09-17
code:
    - src/commands/pasteCollection/**
    - src/services/taskService/data-api/indexes/**
    - src/services/taskService/tasks/copy-and-paste/**
---

# Review — copy secondary indexes during paste (PR #848)

**Reviewed:** `copilot/add-copy-indexes-feature` @ `ea5360db`, base `be6e3d11` (`main`).
**PR:** [#848](https://github.com/microsoft/vscode-documentdb/pull/848) — draft, base `main`.
**Scope:** 19 files, ~1,655 insertions. New `CollectionIndexCopier` boundary, a DocumentDB API
implementation, a wizard step, a task phase, and the feature knowledge base folder.

Each finding carries the operator's ruling inline under **Decision**. Rulings were given on
2026-09-16 in the review session; the rationale recorded is the operator's, not the reviewer's.

## Rulings at a glance

| ID  | Finding                                                     | Ruling                                     |
| --- | ----------------------------------------------------------- | ------------------------------------------ |
| H1  | Localization bundle is stale                                | Fix — run `npm run l10n`                   |
| H2  | Unproven round-trip for server-normalized index shapes      | **Accept** — fail-fast is the right answer |
| M1  | A benign `note` is treated as a failure                     | Fix                                        |
| M2  | Failure reason never reaches the user                       | Fix — message detail **and** Show Output   |
| M3  | Blocking, uncancellable network I/O inside `prompt()`       | Fix — dedicated loading step               |
| M4  | `unique` and TTL indexes created before documents           | Fix — confirmation warning only            |
| M5  | Prettier reports 6 unformatted files                        | Defer to the full pre-PR check             |
| L1  | Five-second presentation pause                              | **Accept** — keep as designed              |
| L2  | `background: true` is forced                                | **Accept** — background creation is intent |
| L3  | Copier constructed twice from duplicated endpoint logic     | Fix — extract a factory                    |
| L4  | Telemetry naming inconsistency                              | Fix — confirmed still open                 |
| L5  | Telemetry error properties diverge from the repo convention | Fix — use a codename                       |
| P1  | No iteration or pre-review artifact existed                 | Addressed by this document                 |
| P2  | Working tree not clean                                      | Fix before push                            |
| P3  | Two doc statements overstate current behavior               | Fix                                        |

## Verification observed during review

| Check                                       | Result                                                                |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `npm run build`                             | pass, no type errors                                                  |
| `npx jest` (index, copy-paste, paste steps) | pass — 3 suites, 18 tests                                             |
| `npx eslint` (changed folders)              | pass                                                                  |
| `npx prettier --check` (changed folders)    | **fail** — 6 files                                                    |
| `l10n/bundle.l10n.json` freshness           | **stale** — one new string missing, one orphan string left behind     |
| Full `npx jest` / `npm run package`         | not run — the PR is a draft, so Case 1 applies; both are Case 2 gates |

## What is good

- The `CollectionIndexCopier` contract is genuinely small and the task depends on nothing
  DocumentDB-specific. Decisions 0002 and 0003 name the rejected pipeline and the revisit condition,
  which is the part that is hard to reconstruct later.
- `countSourceIndexes` is only reachable after the user opts in. The document-only path never
  touches an index catalog, and there is a test that holds that line.
- Definition-before-name comparison, deterministic `_copy` suffixes, and `_id` exclusion are all
  covered by focused unit tests.
- Creating the index and then hiding it — rather than passing `hidden` to `createIndexes` — is the
  correct reading of `hidden` as post-creation state, and it is tested in both directions.
- Vector (`cosmosSearchOptions`) preservation is tested, which is the option most likely to be
  silently dropped by the driver.

## Severity scale

| Level       | Meaning                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| **High**    | Ship-blocking unless explicitly accepted with a recorded reason.            |
| **Medium**  | Should be fixed in this PR or explicitly deferred with a recorded decision. |
| **Low**     | Worth fixing, but reasonable to defer.                                      |
| **Process** | Not a code defect. A convention or hand-over gap.                           |

---

## H1 — The localization bundle is stale (High)

`l10n/bundle.l10n.json` does not contain `"Copying {0} indexes..."`, which commit `8ed8d195`
introduced in [CopyPasteCollectionTask.ts](src/services/taskService/tasks/copy-and-paste/CopyPasteCollectionTask.ts).
It still contains the string that commit removed, `"Copying indexes: {0}/{1} ({2})"`.

The bundle was regenerated at the first index commit and not again. The new progress message is
therefore untranslatable, and the bundle carries a dead entry.

### Options considered

| Approach                      | Pros                                                           | Cons                                                                |
| ----------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| Run `npm run l10n` and commit | The only correct fix; the file is generated, never hand-edited | None                                                                |
| Hand-add the missing key      | Smaller diff                                                   | Leaves the orphan; the next generated run reorders the file anyway  |
| Defer until ready-for-review  | Less regeneration churn on a moving branch                     | Easy to forget; the gate exists precisely because it is forgettable |

### Decision — run `npm run l10n`

No hand-editing. The bundle is generated; regenerating it fixes the missing key and the orphan in
one step. Folded into the pre-PR check described under M5.

### Implementation record

Completed in `e78c0d2b`. `npm run l10n` regenerated the bundle, adding the new index-copy strings
and removing obsolete entries. No deviation; the generated file was not edited by hand.

---

## H2 — Unproven round-trip for server-normalized index shapes (High)

`toIndexDefinition` strips only `key`, `name`, `v`, `ns`, `background`, `hidden` and forwards
everything else verbatim to `createIndexes`. That is the right default for simple and vector
indexes. It is not obviously correct for index types the server **normalizes on read**:

- **Text** — the catalog commonly reports `key: { _fts: "text", _ftsx: 1 }` plus `weights`,
  `default_language`, `language_override`, `textIndexVersion`. Replaying that key is not a valid
  index specification. Text indexes are creatable from the Create Index drawer
  ([CreateIndexDrawer.tsx](src/webviews/documentdb/collectionView/indexesTab/components/CreateIndexDrawer.tsx)),
  so real collections will have them.
- **Geospatial** — `2dsphereIndexVersion`, `bits`, `min`, `max` are server-chosen and version
  dependent across a cross-cluster copy.
- **Wildcard / partial / collation** — `wildcardProjection`, `partialFilterExpression`, `collation`
  are forwarded but untested.

Neither the unit tests nor the feature docs record evidence for these. Because decision 0008 makes
any creation failure abort the phase, **and** the phase runs before document streaming, a single
unsupported index means no documents are copied.

### Options considered

| Approach                                                                    | Pros                                                                          | Cons                                                                                                   |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Continue on per-index failure; report a `failedCount` and the failing names | Documents always arrive; the user learns which indexes need manual recreation | Reverses decision 0008; leaves the target half-indexed in a way the user did not ask for               |
| Pre-flight classification, block the phase with a named warning             | The user decides before anything is written                                   | Requires a classifier that is correct up front — the thing currently unproven                          |
| Keep fail-fast but move index copy **after** documents                      | Documents survive any index failure                                           | Loses the point of copying indexes first; contradicts decision 0005                                    |
| Allowlist options known to round-trip; report anything else as "not copied" | Honest and bounded                                                            | The allowlist will lag DocumentDB; silently not copying an index is its own surprise                   |
| Keep as-is: fail the phase, tell the user, let them retry without indexes   | No half-indexed target; no new failure taxonomy; the retry is one wizard away | The user pays for a failed attempt before learning their collection holds an index we cannot reproduce |

### Decision — accept as-is

Fail-fast stands. The user is shown an error that names the index-copy phase as the thing that
failed, so the recovery is obvious and cheap: run the paste again and choose **No, only copy
documents**. That is preferable to a partially indexed target or a speculative allowlist, and it
keeps decision 0008 intact.

This ruling depends on the failure message actually being legible, which is what M2 fixes. The two
are a pair: **H2 is only acceptable once M2 has landed.**

Worth doing as follow-up, not as a blocker: fixture tests for text, geospatial, wildcard, partial,
and collation definitions, so we learn which shapes fail without a user having to discover it.

---

## M1 — A benign `note` is treated as a failure (Medium)

```typescript
if (result.ok === 0 || result.note) {
    throw new Error(typeof result.note === 'string' ? result.note : vscode.l10n.t('Failed to create index.'));
}
```

`createIndexes` returns `ok: 1` together with `note: "all indexes already exist"` for a no-op, and
`LlmEnhancedFeatureApis.createIndex` passes `note` through on success as well as on failure
([LlmEnhancedFeatureApis.ts](src/documentdb/LlmEnhancedFeatureApis.ts)). Any successful-but-noted
creation aborts the whole phase — and under H2's fail-fast ruling, that costs the user the documents
as well.

### Options considered

| Approach                                                                       | Pros                                                        | Cons                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Fail on `ok !== 1` only; log `note` at warn level                              | Matches the wire contract; `note` is advisory by definition | Relies on the API layer setting `ok: 0` for real failures — it does    |
| Keep `note` as a failure signal but allowlist known-benign notes               | Defensive against an API layer that swallows an error       | String matching against server text; brittle across versions           |
| Make `LlmEnhancedFeatureApis.createIndex` rethrow instead of returning `ok: 0` | Removes the ambiguity and preserves the driver error code   | Touches a shared API used by the Indexes tab; wider regression surface |

### Decision — fix

Fail on `ok !== 1` only, and log `note` at warn level. The shared-API change is out of scope for this
PR; the local check is where the bug is.

### Implementation record

Completed in `acd176b0`. Successful responses with a `note` now continue and write the note to the
output channel; a focused regression covers `ok: 1` with `"all indexes already exist"`. No
deviation. Changing the shared API remained rejected because it would widen the regression surface.

---

## M2 — The user is told the phase failed, but never why (Medium)

The task wraps the copier error in `vscode.l10n.t('Failed to copy indexes before copying
documents.')` with the original as `cause`. The notification surfaces the wrapper message only; the
index name and server reason exist solely in the output channel, which the user has no prompt to
open.

### Options considered

| Approach                                                   | Pros                                                            | Cons                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Include index name and server reason in the thrown message | Actionable with no new UI; the copier already has both          | Notification length; server text is not localizable              |
| Add a **Show Output** action to the failure notification   | Full detail, no truncation, consistent with other task failures | Requires a failure-notification hook in the task layer           |
| Route through `ConnectionDiagnosticsService` translation   | Consistent with the error-translation skill                     | That layer targets connectivity, not index semantics; a poor fit |

### Decision — fix, do both

Put the index name and the server reason in the thrown message **and** add a **Show Output** action
to the failure notification. This is the message the H2 ruling leans on: it has to tell the user that
index copying specifically failed, so that retrying without indexes is the obvious next move.

### Implementation record

Completed in `396ee40b`. Copier errors now retain the target index name and server reason, and the
task includes that detail in its final failure. The proposed task-layer notification hook was not
added because the shared failed-task notifier already offered **Show Output** and opened the
extension output channel; duplicating that behavior in this task was rejected.

---

## M3 — Blocking, uncancellable network I/O inside `prompt()` (Medium)

[PromptIndexConfigurationStep.ts](src/commands/pasteCollection/PromptIndexConfigurationStep.ts) calls
`countSourceIndexes()` directly after the quick pick resolves. There is no progress indication, no
cancellation, and a rejection propagates out of `wizard.prompt()` and ends the paste flow — which
the test `fails the paste flow when selected index counting fails` locks in as intended.

The count feeds one clause in the confirmation dialog, `({indexCount} available)`.
`CollectionIndexCopier` also declares `countSourceIndexes(signal?: AbortSignal)` while the
implementation ignores the parameter, so the contract advertises cancellation that does not exist.

### Options considered

| Approach                                                               | Pros                                                                                                   | Cons                                                                                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Make the count best-effort; omit `(N available)` on failure            | The user keeps the operation they asked for                                                            | Loses the early signal that the source is unreachable                                                                               |
| `vscode.window.withProgress` around the count                          | Shows something                                                                                        | Renders as a notification toast, detached from the wizard — the user's attention is on the quick pick, not the corner of the window |
| A dedicated step that only performs the count, shown as a loading pick | Progress appears **inside** the wizard, where the user is looking; separately cancellable and testable | One more step class; a step that never really prompts                                                                               |
| Drop the count entirely                                                | Removes a whole failure mode                                                                           | Loses a useful confirmation detail                                                                                                  |

### Decision — fix with a dedicated loading step

Combine the first and third options, and do **not** use `vscode.window.withProgress` — its
notification surface is in the wrong place. The user is looking at the wizard quick pick, so the
progress belongs there.

Add a separate prompt step that runs after the copy-indexes choice and does nothing but count. Use
the established pattern from Azure discovery account management:
[InitializeFilteringStep.ts](src/plugins/api-shared/azure/subscriptionFiltering/InitializeFilteringStep.ts)
passes a `Promise` to `context.ui.showQuickPick()` with a `loadingPlaceHolder`, so the pick renders a
spinner in the wizard while the async work runs, then terminates via a sentinel error. That file also
documents _why_ `shouldPrompt` is not the right hook here — no UI shows while it is evaluated.

The step should honour the `signal` the interface already declares, and a count failure should
degrade the confirmation text rather than discard the user's wizard progress. Either implement
`countSourceIndexes(signal)` or drop the parameter from `CollectionIndexCopier`.

`PromptIndexConfigurationStep.test.ts` needs updating with it — the
`fails the paste flow when selected index counting fails` contract is being deliberately reversed.

### Implementation record

Completed in `e6cc35b7`, with lint-driven cancellation normalization in `3f0fb1d6`. Counting moved
to `CountSourceIndexesStep`, which renders a loading quick pick, degrades failures to an unknown
count, and records details in the output channel. Cancellation is passed to client acquisition and
stops awaiting the catalog read.

Deviation: the installed driver does not accept an `AbortSignal` for `indexes()`, so an already
issued catalog request cannot be terminated at the transport layer. The step races that request
against abort instead. Dropping cancellation from the contract was considered and rejected because
it would leave the wizard waiting after dismissal. A direct confirmation-dialog unit test was also
attempted, then skipped after three unrelated VS Code mock-constructor failures; the loading-step,
summary, and warning formatter tests cover the underlying state and text without that brittle mock.

---

## M4 — `unique` and TTL indexes are created before the documents they constrain (Medium)

Decision 0005 records the ordering but not its data consequences:

- **TTL** (`expireAfterSeconds`): the index is live while documents stream in. Documents already past
  their expiry are eligible for deletion as they land. The user asked for a copy and may get a
  partially reaped collection, with no error anywhere.
- **`unique` with `GenerateNewIds`**: that strategy re-inserts source documents under fresh `_id`
  values. A unique index on any other field is then violated by the copies themselves, and every
  affected write fails.
- **`unique` into an existing collection** (merge): the source satisfies its own constraint, but the
  union with the target may not.

The new-collection + Abort path — the most common one — is safe, which is why this is Medium rather
than High.

### Options considered

| Approach                                                                  | Pros                                                 | Cons                                                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Create `unique` and TTL indexes after document streaming; the rest before | Removes both hazards                                 | Two index phases to report and cancel; a post-copy failure leaves documents without the index; contradicts decision 0005 |
| Warn in `ConfirmOperationStep`, listing the TTL and unique indexes        | Cheap; keeps the user in control; no ordering change | Warning fatigue; does not prevent the reaping if the user proceeds                                                       |
| Block `copyIndexes` + `GenerateNewIds` as unsupported                     | Closes the sharpest edge with one guard              | Leaves TTL untouched; an extra rule for the user to learn                                                                |
| Document only                                                             | No code change                                       | Silent data loss is not a documentation problem                                                                          |

### Decision — warning only

Add the warning to the confirmation dialog, naming the TTL and unique indexes found on the source. No
ordering change and no hard block: the user can still proceed, and if the warning is unwelcome they
have the same escape hatch as in H2 — run the paste again without indexes. Decision 0005 stays as it
is; this consequence should be appended to it in `decisions.md`.

### Implementation record

Completed in `662f4456`. One source-catalog summary now returns the count plus unique and TTL index
names; the confirmation lists those names in separate warnings, and decision 0005 records the
consequences. This deliberately evolved the count-only method instead of adding a second catalog
read. A separate warning lookup was considered and rejected because it would duplicate network I/O.

---

## M5 — Prettier reports 6 unformatted files (Medium)

`DocumentDbCollectionIndexCopier.ts`, `indexes/README.md`, `CopyPasteCollectionTask.ts`,
`CopyPasteCollectionTask.test.ts`, `PromptIndexConfigurationStep.ts`, and `decisions.md`.

### Decision — defer to the full pre-PR check

Not fixed piecemeal. `npm run prettier-fix` runs as part of one full Case 2 pass at hand-over,
together with `npm run l10n` (H1), `npm run lint`, the full Jest suite, `npm run build`, and
`npm run package`.

### Implementation record

Completed in `b4876a2c`. The repository-wide formatter output was committed as one mechanical
change, including formatting inherited from the branch outside the index-copy files. No formatter
changes were split into the behavioral commits.

---

## L1 — A five-second presentation pause in the middle of a data operation (Low)

`INDEX_PRESENTATION_DELAY_MS = 5000`, with `waitForPresentationDelay` blocking `doWork` whenever at
least one index was created. Decision 0011 is honest that this is presentation-only, and it is
abort-aware and injectable for tests. It is still a sleep on a data path, working around a
1-second progress-notification poll.

### Decision — accept, keep as-is

Decided and documented in decision 0011. The phase is otherwise invisible, and five seconds is the
cost of the user knowing it happened.

---

## L2 — `background: true` is forced (Low)

`createIndex` hardcodes `background: true` and `toIndexDefinition` strips the source value.

### Decision — accept, keep as-is

Background creation is the intent, not an accident: index builds during a copy should not block the
target. Forcing it regardless of what the source reported is correct.

The follow-up is in P3: the README says options are "preserved", which is not true of `background`
(or `hidden`). Fix the sentence, not the code.

---

## L3 — The copier is constructed twice from duplicated endpoint logic (Low)

Both [PromptIndexConfigurationStep.ts](src/commands/pasteCollection/PromptIndexConfigurationStep.ts)
and [ExecuteStep.ts](src/commands/pasteCollection/ExecuteStep.ts) rebuild the same two endpoint
literals, including the `isTargetExistingCollection ? targetCollectionName : newCollectionName`
resolution with its own `nonNullValue` calls. The two copies have already drifted — `ExecuteStep`
passes `'context.targetCollectionName'` as the property path for `newCollectionName`.

### Decision — fix

Extract a single `createIndexCopier(context)` helper in the command folder. With M3 adding a third
construction site, the duplication would otherwise triple.

### Implementation record

Completed in `7e29627d`. Both prompting and execution now use `createIndexCopier(context)`, with
direct tests for new and existing target collection resolution. No deviation.

---

## L4 — Telemetry naming inconsistency (Low)

`copyIndexesEnabled` (`ConfirmOperationStep`) and `copyIndexes` (task) describe the same choice on
two different events. `sourceIndexCount` is recorded as a measurement by both the prompt step and the
confirm step.

### Decision — fix; re-verified as still open

Re-checked against the working branch at review time: `ConfirmOperationStep.ts:94` still writes
`copyIndexesEnabled` while `CopyPasteCollectionTask.ts:207` writes `copyIndexes`, and
`sourceIndexCount` is still set at `PromptIndexConfigurationStep.ts:57` and again at
`ConfirmOperationStep.ts:96`. Not yet addressed. Pick one property name and set the measurement once.

### Implementation record

Completed in `70083d53`. Both events use `copyIndexes`, and only the loading step records
`sourceIndexCount`. No deviation.

---

## L5 — Telemetry error properties diverge from the repo convention (Low)

The index-copy failure path records free-form error text:

```typescript
context.telemetry.properties.indexCopyError = error instanceof Error ? error.message : String(error);
```

The prevailing convention across the codebase is a **stable codename or `error.name`**, not free
text — roughly 25 sites do this (`connectionErrorType`, `credentialsManagementError`, `actionError`,
`errorKind`, `parseError`, and so on), against 5 that carry a message. Codenames also keep telemetry
cardinality bounded and make the data groupable, which free text is not.

### Decision — fix, use a codename

Replace the message with a codename or `error.name`, consistent with the majority convention. Full
detail stays in the output channel, which M2 makes reachable from the failure notification.

### Implementation record

Completed in `9545ae60`. Telemetry now records the bounded codename `copyIndexesFailed`; the detailed
server text remains in the user-facing error and output channel. `error.name` was considered but
rejected because the wrapped errors are usually the non-specific name `Error`.

---

## P1 — No iteration or pre-review artifact existed for this PR (Process)

`features/copy-paste-collections/` had `README.md`, `decisions.md`, and `design.md` but no
`iterations/` entry, so there was no record of what this round of work set out to do or what it
verified. `docs/ai-and-plans/README.md` expects the plan to be written before the work and annotated
during it; CONTRIBUTING §6 expects the AI pre-review file in the same folder.

### Decision — addressed by this document

This is the first file in `iterations/`. It covers the review half only; there is no retrospective
plan document and one will not be reconstructed.

### Implementation record

Completed in `6fb24ac2`, which committed this review artifact. No retrospective plan was added, as
decided.

---

## P2 — The working tree is not clean (Process)

Seven files carry uncommitted trailing-newline fixes, including three feature documents.

### Decision — commit before pushing

So that the reviewed tree matches the PR.

### Implementation record

Completed in `7c6639ea`. The tracked formatting and final-newline cleanup was committed separately
from behavioral changes. No unrelated untracked files were included.

---

## P3 — Two doc statements overstate current behavior (Process)

- README: _"DocumentDB API options, including vector index options, are preserved."_ — `background` is
  deliberately overridden (L2) and `hidden` is deliberately re-applied separately, and no exotic index
  type has round-trip evidence (H2).
- `docs/user-manual/copy-and-paste.md` explains what happens to already-created indexes on
  **cancellation** but not on **failure**, where the same partial state applies — and under the H2
  ruling, failure is the path the user is expected to recover from.

### Decision — fix both

Correct the README sentence to name `background` and `hidden` as intentional exceptions. Add the
failure case to the user manual, together with the "retry without indexes" recovery that H2 relies
on.

### Implementation record

Completed in `6d6fa22c`. The feature README now bounds the fidelity claim, and the user guide covers
count-read degradation, partial index state after failure, detailed diagnostics, and retrying
without indexes. No deviation.

---

## Suggested order

1. **M2** — the H2 acceptance is contingent on it. Do this first.
2. **M1** — one-line fix on the same failure path.
3. **M3** — the loading step, plus the reversed test contract and the `signal` parameter.
4. **M4** — confirmation warning, and append the consequence to decision 0005.
5. **L3**, **L4**, **L5** — small and local; L3 is easier before M3 adds a third call site.
6. **P2**, **P3** — commit the tree, correct the two documents.
7. **H1 + M5** — one full Case 2 pass at hand-over: `l10n`, `prettier-fix`, `lint`, full Jest,
   `build`, `package`.

Accepted without change: **H2**, **L1**, **L2**.

Follow-up, not blocking: fixture tests for text, geospatial, wildcard, partial, and collation index
round-trips (see H2).

## Outcome

All fix rulings were implemented and committed separately. H2, L1, and L2 remain accepted without
code changes. Verification completed on 2026-09-17:

- `npm run l10n` — passed; bundle regenerated.
- `npm run prettier-fix` — passed; formatter output committed in `b4876a2c`.
- `npm run lint` — passed with the existing `eslint-env` migration warning for
  `webpack.config.views.js`.
- `npx jest --no-coverage` — passed: 246 suites, 3,722 tests, and 4 snapshots.
- `npm run build` — passed.
- `npm run package` — passed; produced `vscode-documentdb-0.10.2.vsix`. Webpack reported its
  existing dynamic dependency and bundle-size warnings.

The final diff audit found no unaddressed review finding. The M5 formatter commit also reformatted
three authentication telemetry tests already present on the branch; those changes are mechanical
and do not alter behavior.
