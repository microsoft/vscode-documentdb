---
feature: copy-paste-collections
kind: review
status: historical
prs: [930]
created: 2026-09-18
verified: 2026-09-18
code:
    - src/commands/copyIndexes/**
    - src/commands/pasteIndexes/**
    - src/commands/pasteCollection/**
    - src/services/taskService/data-api/indexes/**
    - src/services/taskService/data-api/writers/DocumentDbStreamingWriter.ts
    - src/services/taskService/tasks/copy-indexes/**
    - src/services/taskService/tasks/copy-and-paste/CopyPasteCollectionTask.ts
---

# Index copy: data-loss and telemetry review (PR #930)

**Reviewed:** `dev/tnaum/copy-indivisual-indexes` against `origin/main`, whole-branch diff.
**Scope requested by the operator:** data-loss edge cases and telemetry coverage for the new
copy/paste index operations. Inability to perform an operation was explicitly de-scoped as low
severity.
**Status of this document:** completed resolution record. The original findings and proposals remain
in place; implementation results, alternatives, and decisions are recorded inline beneath each item.

## Operator rulings (2026-09-18)

The table below records the initial ruling before implementation. It settled D3 and D5.
Subsequently, the operator requested resolution of every review issue and authorized deviations when
implementation confidence exceeded 80%, provided alternatives, trade-offs, and decisions were
documented inline. That instruction authorized the remaining resolutions recorded below.

| #   | Question                                | Ruling                                                                                                               |
| --- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Abort scope when the source is affected | **Hard abort the whole paste** with an explanatory error. Do not silently downgrade to a documents-only copy.        |
| 2   | Where the guarantee lives               | **Whichever arrangement is simplest to maintain.** Author's reading of that is recorded in D3 below.                 |
| 3   | Which index options are refused         | **Exactly `expireAfterSeconds` and `unique: true`.** `sparse`, `partialFilterExpression` and `collation` still copy. |

Rationale accepted with the ruling: the dedicated Copy Indexes / Paste Indexes commands now exist,
so a user who needs a TTL or unique index on the target can create it deliberately, through a flow
that confirms the consequence and does not interleave with document streaming.

## Baseline

Nothing in this branch deletes indexes or documents directly. `dropIndex` is never called, the
target collection is never dropped or cleared, and `LlmEnhancedFeatureApis.createIndex()` only
issues `createIndexes`. Every data-loss finding below is therefore _indirect_: it arises from the
semantics the copied index acquires once it exists on the target.

## Findings

| ID  | Severity | Area                   | Summary                                                                                      |
| --- | -------- | ---------------------- | -------------------------------------------------------------------------------------------- |
| D1  | High     | Copier naming          | Collision rename creates a second index over the same key, shortening an existing TTL.       |
| D2  | Medium   | Copier equivalence     | Signature includes server-generated options, so identical indexes fall into the rename path. |
| D3  | High     | Collection paste order | Indexes created before documents cause silent document drops and TTL deletion during copy.   |
| D4  | Low      | Confirm/execute race   | Warnings are computed at confirm time; the copy re-reads the catalog at execution time.      |
| D5  | —        | Warning wording        | Superseded by the D3 ruling: the wording it describes becomes unreachable.                   |
| T1  | High     | Telemetry              | No signal that a TTL/unique warning was shown or confirmed.                                  |
| T2  | Medium   | Telemetry              | `renamedIndexCount` does not separate the D1 case from a benign name collision.              |
| T3  | Medium   | Telemetry              | Paste wizard event lacks scope/selected count and cannot be joined to the task events.       |
| T4  | Low      | Telemetry              | Inconsistent `indexCopyError` naming between the two tasks.                                  |
| T5  | Low      | Telemetry              | `CopyPasteCollectionTask` never records `indexCopyFailed = 'false'` on success.              |
| T6  | Low      | Telemetry              | `pasteIndexes` and `copyIndex` early exits carry no failure-reason property.                 |
| T7  | Low      | Telemetry              | Hidden-index re-hide failure has no dedicated signal.                                        |

---

### D1 — Name-collision rename turns an options conflict into a second index over the same key

**Severity:** High. Permanent, silent deletion of documents that were already on the target.

**Where:** [DocumentDbCollectionIndexCopier.ts](../../../../../src/services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier.ts),
lines 99-112 (`targetSignatures.has(...)` then `getAvailableName(...)`), and `getAvailableName` at
line 321.

**Mechanism:** equivalence is decided by a key+options signature. When the target already has an
index with the _same key_ but _different options_, the signature differs so the index is not
skipped; the name is taken so it is renamed to `<name>_copy` and created.

**Concrete case:** target has `createdAt_1` with `expireAfterSeconds: 2592000` (30 days). Source has
`createdAt_1` with `expireAfterSeconds: 3600`. The target ends up with two TTL indexes on
`createdAt`, and the shorter expiry wins. Documents the target owner expected to keep for a month
are deleted within minutes, permanently, after the task has reported success.

The confirmation modal warned only that "TTL indexes may delete expired documents". It never states
that an existing retention policy on the target is being shortened.

**Why the usual server guard does not cover this:** strict MongoDB rejects two indexes on the same
key pattern with different options (`IndexOptionsConflict`). This extension targets
DocumentDB-compatible and RU-based endpoints where that behaviour is not guaranteed, so the rename
must not rely on the server refusing.

**Proposed resolution:** fail closed. Before renaming, check whether any target index shares the
source index's key pattern. If one does, skip the index and report it as a conflict rather than
renaming. Renaming should remain valid only for a name collision on a _different_ key. Whatever is
chosen must be reflected in the confirmation text and in a regression test.

**Resolution progress (commit `fix(indexes): prevent same-key option conflicts`):** implemented as
proposed. The copier now skips and counts a same-key options conflict before name generation, while
different-key name collisions still receive deterministic suffixes. The dedicated task summary and
both task telemetry paths expose the conflict count. Regression coverage uses the concrete shorter-
TTL case above.

**Alternatives evaluated:** aborting the entire dedicated paste was stronger but would prevent
independent safe indexes in the selection from being copied; retaining rename and relying on server
rejection preserved throughput but left the documented cross-endpoint data-loss risk. Skipping only
the conflicting index preserves safe work and fails closed for the dangerous definition.

---

### D2 — Equivalence check feeds the rename path more often than it appears

**Severity:** Medium on its own; it is the main amplifier for D1.

**Where:** `getDefinitionSignature` at line 298 and `toIndexDefinition` at line 273 of
[DocumentDbCollectionIndexCopier.ts](../../../../../src/services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier.ts).

**Mechanism:** `toIndexDefinition()` strips only `key`, `name`, `v`, `ns`, `background` and
`hidden`. Every other server-reported field stays in `options` and therefore in the signature —
`2dsphereIndexVersion`, `textIndexVersion`, `weights`, `default_language`, `language_override` and
similar. Copying between endpoints on different server versions makes genuinely identical indexes
compare as different, so "skip equivalent" silently degrades into "rename and duplicate", i.e.
straight into D1.

**Proposed resolution:** compare a normalized subset — key pattern plus semantic options such as
`unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`, `collation`, `weights` — rather
than the raw catalog document. Server-version artefacts must not participate in equivalence.

**Resolution progress (commit `fix(indexes): prevent same-key option conflicts`):** implemented with
an explicit semantic-option allowlist. Server-generated fields such as `textIndexVersion` and
`2dsphereIndexVersion` no longer change equivalence; key order and options that alter index behavior
still do. A cross-version text-index regression test proves the intended comparison.

**Alternatives evaluated:** a denylist of known generated fields was smaller initially but would
silently regress when a server adds another catalog-only field; retaining raw options required every
endpoint to normalize identically. The allowlist costs maintenance when a new semantic option is
supported, but errs toward conflict-skipping rather than duplicate creation.

---

### D3 — Indexes-before-documents silently drops documents in the collection paste flow

**Severity:** High. The task reports success while the target is missing data.

**Where:** [CopyPasteCollectionTask.ts](../../../../../src/services/taskService/tasks/copy-and-paste/CopyPasteCollectionTask.ts)
`doWork()` lines 260-266 (index phase runs first), and
[DocumentDbStreamingWriter.ts](../../../../../src/services/taskService/data-api/writers/DocumentDbStreamingWriter.ts)
lines 285-310.

Two distinct consequences:

1. **Unique index active before streaming.** The writer treats _any_ `11000` as a duplicate-key
   skip. Before this branch the only reachable `11000` was `_id`. Now, with the Skip strategy,
   documents rejected by a _copied secondary unique index_ are counted as "skipped duplicates" and
   the task reports success. The user chose a conflict policy about `_id` collisions and silently
   received a different one. With the Abort strategy the whole copy aborts partway, leaving a
   partial target.
2. **TTL index active before streaming.** Already-expired documents are inserted and then removed by
   the TTL monitor. The summary reports N inserted; the target holds fewer.

Neither loses source data, but both produce "copy reported success, the data is not there".

#### Resolution (operator ruling, 2026-09-18)

The collection paste **refuses to run at all** when the user opted into index copying and the source
carries a TTL or unique index. It does not reorder index creation, and it does not downgrade to a
documents-only copy on the user's behalf. The user re-runs the wizard choosing "No, only copy
documents", then uses Paste Indexes for the remaining indexes if they want them.

The guarantee this establishes: **a collection paste never creates an index that can delete or
reject documents.** Document fidelity is the contract of that operation; index semantics that can
compromise it belong to the explicit, separately-confirmed operation.

Refused exactly when an index definition carries `expireAfterSeconds` or `unique: true`. `sparse`,
`partialFilterExpression` and `collation` are unaffected and keep copying.

#### Implementation notes

Ruling 2 asked for the arrangement that is simplest to maintain. The author's reading, which the
coding agent should follow unless it finds something clearly simpler:

1. **One shared predicate.** A single exported helper beside the copier — something like
   `isDocumentAffectingIndex(options)` — is the only place the `expireAfterSeconds` / `unique` rule
   is written. Both call sites below use it. Do not re-derive the rule anywhere else.
2. **Wizard guard, for the message.** Put the check in
   [CountSourceIndexesStep.ts](../../../../../src/commands/pasteCollection/CountSourceIndexesStep.ts),
   immediately after the summary is stored. That step already runs only when `context.copyIndexes`
   is true, already owns the source-index read, and already populates `sourceUniqueIndexNames` and
   `sourceTtlIndexNames` — so the guard is one condition, with no new read and no new step. Renaming
   the step is reasonable once it both counts and gates.
3. **Copier guard, for the guarantee.** Add `allowDocumentAffectingIndexes?: boolean` to
   `CopyIndexesOptions`, **defaulting to `false`**. `CopyIndexesTask` (dedicated flow) passes `true`;
   `CopyPasteCollectionTask` passes nothing. The copier throws before creating any index matching the
   predicate.

   The default must be deny, not allow. The wizard check alone is advisory — the copier re-reads the
   source catalog at execution time (that is D4), so a TTL index added between confirmation and
   execution would still be created. Fail-closed also means a future third caller gets the safe
   behaviour without knowing this finding exists.

**Message surface:** follow the existing `Cannot copy collection to itself` precedent in
[pasteCollection.ts](../../../../../src/commands/pasteCollection/pasteCollection.ts) — modal
`showErrorMessage` with a `detail` body. Name the offending indexes, state that a collection paste
cannot copy TTL or unique indexes automatically, and direct the user to Copy Indexes / Paste Indexes.
Add a **Learn More** button opening
[docs/user-manual/copy-and-paste.md](../../../../../docs/user-manual/copy-and-paste.md). Because the
guard lives inside a wizard step rather than the command function, throw `UserCancelledError` after
the modal so the failure is not reported twice.

**Also required:**

- `PromptIndexConfigurationStep`'s "Yes, copy indexes" detail must state the limitation up front, so
  the refusal is not the first the user hears of it.
- Add the user-manual section that Learn More points at.
- `formatIndexCopyWarnings.ts` and its test become dead code in this flow — delete them, and drop
  `indexWarnings` from `ConfirmOperationStep`. Keep `sourceUniqueIndexNames` / `sourceTtlIndexNames`
  on the wizard context; the guard needs them.
- Telemetry: record a stable `wizardFailureReason` for the refusal plus measurements for the two
  counts. This overlaps T1 and T6 — implement them together.
- Tests: guard fires for TTL, fires for unique, does not fire for `sparse` /
  `partialFilterExpression` / `collation`, does not fire when the user chose documents-only; copier
  throws by default; dedicated flow still copies TTL and unique when it opts in.

**This reverses a decision from PR #848**, where index copying inside the collection paste was a
headline behaviour. Append the reversal and its rationale to
[decisions.md](../decisions.md).

**What this does not fix:** D1 stays open, and this ruling makes it more important. The
rename-on-collision path that can shorten an existing TTL lives in the copier and still applies to
the dedicated Paste Indexes flow — which is now the recommended way to move a TTL index.

**Resolution progress (commit `fix(collection-copy): refuse document-affecting indexes`):**
implemented the ruled design. One exported predicate defines the TTL/unique rule; summary
classification and the copier consume it. The collection wizard refuses after its existing source
read, names the affected indexes in a modal, links to the user guide, records stable reason and count
telemetry, and preserves documents-only behavior. The copier defaults to deny before target work,
while `CopyIndexesTask` explicitly opts in. The old collection confirmation warnings were deleted.

**Alternatives evaluated:** index-after-documents, warning-and-continue, and silent documents-only
downgrade were rejected for the reasons recorded in D0026. The shared helper remains beside the
copier rather than in presentation code because it operates on driver options and protects every
future caller by default.

**Follow-up (commit `fix(collection-copy): format refusal modal details`):** formatted the modal
detail as separate explanation, affected-index, and recovery blocks, following the tree-view index
action dialog's newline pattern. The behavior and decision are unchanged.

---

### D4 — Warnings are computed at confirm time, the copy re-reads at execution time

**Severity:** Low. Narrow race, but it defeats the warning that is the primary mitigation for D1/D3.

**Where:** [LoadSourceIndexesStep.ts](../../../../../src/commands/pasteIndexes/LoadSourceIndexesStep.ts)
lines 92-99 builds the unique/TTL warning list; [CopyIndexesTask.ts](../../../../../src/services/taskService/tasks/copy-indexes/CopyIndexesTask.ts)
line 89 passes `sourceIndexNames: undefined` for the `allIndexes` scope and the copier re-reads the
source catalog.

A TTL or unique index added to the source between confirmation and execution is copied with no
warning.

**Proposed resolution:** for the `allIndexes` scope, pass the already-computed
`context.copyableIndexNames` as `sourceIndexNames` so the executed set equals the confirmed set.
Note the trade-off: the copier throws `Source indexes were not found` if a confirmed index is
dropped in the meantime, which converts a silent divergence into a visible failure. Confirm that
this is the intended behaviour before implementing.

**Resolution progress (commit `fix(index-copy): freeze confirmed index selection`):** implemented
with high confidence after evaluating the stated trade-off. `allIndexes` remains live until the
Paste Indexes loading step, then the classified copyable names are passed to both the summary and
task. Additions after confirmation are excluded; a removed confirmed index fails visibly through
the existing unresolved-name guard.

**Alternatives evaluated:** execution-time expansion kept the newest catalog but admitted
unconfirmed TTL/unique indexes; freezing at Copy Indexes time discarded useful live-parent behavior;
silently shrinking removed names hid divergence. The paste-time snapshot retains freshness until
the user begins the operation and makes confirmation authoritative.

---

### D5 — Collection-flow TTL warning understates the risk — superseded

**Status:** superseded by the D3 ruling. No separate work item.

**Where:** [formatIndexCopyWarnings.ts](../../../../../src/commands/pasteCollection/formatIndexCopyWarnings.ts)
lines 24-30.

The text said TTL indexes "may delete expired documents **while the copy is running**", when
deletion is in fact permanent, continues indefinitely afterwards, and reaches documents that were
already in an existing target collection.

Under the D3 ruling the collection paste can never create a TTL or unique index, so this warning
becomes unreachable and the helper is deleted rather than reworded. The dedicated flow already
states the consequence correctly —
[ConfirmPasteIndexesStep.ts](../../../../../src/commands/pasteIndexes/ConfirmPasteIndexesStep.ts)
lines 95-100, "including after this task finishes" — and keeps that wording unchanged.

**Resolution progress (commit `fix(collection-copy): refuse document-affecting indexes`):** closed
by D3. The unreachable helper and its tests were deleted, and `ConfirmOperationStep` no longer
assembles index warnings.

---

## Telemetry findings

### What is already tracked (no action needed)

- Copy commands: per-command events for `copyIndex`, `copySelectedIndexes` and `copyIndexes`, with
  `copyScope` and `copyCancelled`.
- Paste wizard: `catalogIndexCount`, `copyableIndexCount`, `excludedIndexCount`,
  `sourceIndexLoadError`, `operationConfirmed`.
- Tasks: `copyScope`, `isCrossConnection`, `isCrossDatabase`, `selectedIndexCount`,
  `createdIndexCount`, `skippedIndexCount`, `renamedIndexCount`, `indexCopyCancelled`,
  `indexCopyFailed`, `indexCopyError`, `sourceClusterDisconnected`, `sourceCollectionNotFound`.

Coverage of the happy path and of task outcomes is good. The gaps are concentrated on the
destructive surface and on joining events.

### T1 — No signal that a destructive warning was shown or confirmed

**Severity:** High relative to the rest of the telemetry list. TTL and unique indexes are the entire
data-loss surface of this feature, and nothing records how often users are shown that warning or
accept it.

**Where:** [ConfirmPasteIndexesStep.ts](../../../../../src/commands/pasteIndexes/ConfirmPasteIndexesStep.ts).

**Proposed resolution:** emit boolean properties such as `ttlIndexWarningShown` and
`uniqueIndexWarningShown`, plus measurements for the counts, from the dedicated confirmation step.
Index names must not be sent. Follow
[skills/telemetry-instrumentation/SKILL.md](../../../../../.github/skills/telemetry-instrumentation/SKILL.md).

The D3 ruling narrows this finding: after it lands, the dedicated flow is the only surface that
still shows a TTL or unique warning, so `ConfirmOperationStep` needs nothing here. The equivalent
signal for the collection flow is the refusal itself — the `wizardFailureReason` and counts listed
under D3. Implement both at the same time so the two flows stay comparable in the data.

**Resolution progress (commit `feat(telemetry): record index warning exposure`):** implemented on
the dedicated confirmation event. `uniqueIndexWarningShown` and `ttlIndexWarningShown` are explicit
boolean properties; `sourceUniqueIndexCount` and `sourceTtlIndexCount` are zero-inclusive
measurements matching the collection-refusal event. Existing `operationConfirmed` distinguishes
warnings that were accepted from those dismissed. Index names are not emitted.

**Alternatives evaluated:** sending names was rejected as unnecessary user-derived data; one
combined document-affecting flag could not separate deletion and rejection risk; task-only
telemetry occurs after confirmation and cannot measure dismissed warnings. Reusing
`operationConfirmed` avoids a redundant pair of warning-confirmed fields.

### T2 — `renamedIndexCount` does not isolate the risky rename

**Severity:** Medium. Without this there is no field evidence for how often D1 actually fires.

**Proposed resolution:** add a separate measurement for renames where the target already held an
index with the same key pattern, distinct from renames caused by a name collision on a different
key. This should be added alongside whatever fix D1 receives.

**Resolution progress (commit `fix(indexes): prevent same-key option conflicts`):** deviated from the
proposed field with high confidence. D1 removes same-key renames entirely, so a risky-rename count
would be permanently zero. Both tasks instead emit `conflictingIndexCount`, measuring prevented
same-key option conflicts; `renamedIndexCount` now exclusively measures benign different-key name
collisions.

**Alternatives evaluated:** retaining a zero-valued same-key rename measurement matched the proposal
literally but supplied no field evidence; counting conflicts only in logs was not aggregatable. The
chosen measurement directly answers how often the former D1 path would have fired, at the cost of a
new name that dashboards must adopt.

### T3 — Paste wizard event cannot be joined to the task events

**Severity:** Medium.

**Where:** [pasteIndexes.ts](../../../../../src/commands/pasteIndexes/pasteIndexes.ts) sets no
`copyScope` and no selected-index count. The `taskExecution` event has both, but nothing links the
two events: `journeyCorrelationId` in
[commandTelemetry.ts](../../../../../src/utils/commandTelemetry.ts) originates from the tree node's
discovery journey, not from the copy-to-paste journey.

**Proposed resolution:** record `copyScope` and the selected count on the paste wizard event, and
propagate a correlation id from the wizard into the task's telemetry context so the wizard and task
events can be joined. Check whether `pasteCollection` has the same gap before choosing a mechanism,
so one approach covers both flows.

**Resolution progress (commit `feat(telemetry): correlate copy wizard and tasks`):** implemented for
both Paste Indexes and Paste Collection. Each wizard generates `copyOperationCorrelationId` and
passes it through task config to initialization and execution telemetry. Paste Indexes records the
original `copyScope` and confirmed `selectedIndexCount`; scope is explicit in task config so D4's
frozen parent name array is not mislabeled as a selected subset.

**Alternatives evaluated:** `journeyCorrelationId` is already discovery lineage and can span
unrelated commands; task IDs do not exist during prompting; plain `correlationId` has no repository
telemetry contract and would obscure which lifecycle it joins. The purpose-qualified field matches
the existing `journeyCorrelationId` / `connectionCorrelationId` convention at the cost of a longer
name.

### T4 — Inconsistent `indexCopyError` naming between the two tasks

**Severity:** Low.

[CopyPasteCollectionTask.ts](../../../../../src/services/taskService/tasks/copy-and-paste/CopyPasteCollectionTask.ts)
line 412 sets the constant `'copyIndexesFailed'`, which carries no diagnostic information.
[CopyIndexesTask.ts](../../../../../src/services/taskService/tasks/copy-indexes/CopyIndexesTask.ts)
line 125 correctly uses `error.name`. The repository convention is a codename or `error.name`, never
`error.message`.

**Proposed resolution:** align the collection task on `error.name`.

**Resolution progress (commit `fix(telemetry): align index copy outcomes`):** implemented. The
collection task now records `error.name`, or `UnknownError` for non-Error throws, matching the
dedicated task and avoiding message data.

**Alternatives evaluated:** retaining the constant preserved the old category but discarded the
diagnostic class; recording `error.message` was rejected by repository convention and could include
user-derived server text. `error.name` provides stable grouping without message content.

### T5 — Success path leaves `indexCopyFailed` unset

**Severity:** Low.

`CopyPasteCollectionTask` sets `indexCopyFailed` only on failure, so "succeeded", "failed" and "not
attempted" have to be inferred from the presence of the property plus `copyIndexes`.

**Proposed resolution:** set `indexCopyFailed = 'false'` on the success path, matching
`CopyIndexesTask.recordResultTelemetry`.

**Resolution progress (commit `fix(telemetry): align index copy outcomes`):** implemented as
proposed. Successful, failed, and not-attempted collection index phases are now distinguishable
without inferring property absence.

**Alternatives evaluated:** deriving success from `copyIndexes` plus absent failure remained
ambiguous for cancellation and future early returns. An explicit false value matches the dedicated
task and the repository's boolean-property convention.

### T6 — Early exits carry no failure-reason property

**Severity:** Low.

[pasteIndexes.ts](../../../../../src/commands/pasteIndexes/pasteIndexes.ts) throws for no buffer,
unavailable source and same-collection target;
[copyIndexes.ts](../../../../../src/commands/copyIndexes/copyIndexes.ts) throws for `builtInId`,
`notCopyable` and cross-collection selections. None of these are tagged.
[pasteCollection.ts](../../../../../src/commands/pasteCollection/pasteCollection.ts) already
establishes the convention with `wizardFailureReason` and `wizardCompletedSuccessfully`.

**Proposed resolution:** tag each early exit with a stable reason code, and record wizard outcome
properties for `pasteIndexes` to match `pasteCollection`.

**Resolution progress (commit `feat(telemetry): classify index command exits`):** implemented.
Copy Index commands emit `copyFailureReason` for missing, built-in, non-copyable, empty, and
cross-collection selections. Paste Indexes records `wizardStarted`,
`wizardCompletedSuccessfully`, cancellation, and `wizardFailureReason` codes for missing buffer,
unavailable source, same-collection target, cancellation, and execution failure.

**Alternatives evaluated:** one generic `failureReason` property across commands was shorter but
removed the owning workflow from the schema; reusing `wizardFailureReason` for Copy Index mislabeled
a single command as a wizard. Purpose-specific properties keep queries clear, and stable codes avoid
server/user text.

### T7 — Hidden-index re-hide failure has no dedicated signal

**Severity:** Low.

`createIndex` in
[DocumentDbCollectionIndexCopier.ts](../../../../../src/services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier.ts)
lines 253-266 throws when a created index cannot be hidden, leaving the target with a visible index
the user expected to be hidden. The failure is indistinguishable from any other index-copy failure
in telemetry.

**Proposed resolution:** record a distinct error code for this branch.

**Resolution progress (commit `fix(telemetry): classify index visibility failures`):** implemented
as `IndexVisibilityError`. The copier preserves that name through its user-facing wrapper, and both
tasks' existing `indexCopyError = error.name` path emits the dedicated signal. The original failure
remains available as `cause`.

**Alternatives evaluated:** a new boolean duplicated the existing error classifier and required
expanding result contracts for an exceptional path; log-only classification was not aggregatable;
raw hide messages were unstable and may contain server text. A stable error name reuses the current
schema and identifies the specific partial-state risk.

---

## Handoff notes (pre-implementation)

The notes below describe the state at the original review handoff. They are retained as historical
context and are superseded by the inline resolution notes and Outcome.

- **D3 is decided and ready to implement.** Everything else is still a proposal and needs an
  operator ruling before behaviour changes.
- Groupings: D1 + D2 are one change. D1 + T2 (the measurement depends on the fix chosen for D1).
  D3 + T1 + T6 (the refusal telemetry and the early-exit reason codes are the same convention).
- D5 is closed by the D3 ruling; do not open it as separate work.
- D4 is unchanged by the D3 ruling, but its urgency drops: once the copier denies TTL and unique by
  default, the confirm/execute race can no longer introduce an index that deletes or rejects
  documents in the collection flow. It still applies to the dedicated flow.
- D3 reverses a decision recorded for PR #848 and changes behaviour described in
  [design-dedicated-index-copy.md](../design-dedicated-index-copy.md) and
  [decisions.md](../decisions.md). Update both in the same PR as the code.
- D4 also changes documented behaviour in those two files. Do not implement it without an operator
  ruling, and append the ruling to `decisions.md` when one is given.
- Any string change requires `npm run l10n` at Case 2, not during implementation.
- While the PR stays draft, verify with Case 1 only: `npm run build` plus the targeted Jest files
  for the touched code. Run the full Case 2 suite only when moving to ready for review.

## Outcome

All findings are resolved. D5 was closed through D3 as ruled; the other items landed with their
alternatives and decisions recorded at the finding that motivated them.

Implementation commits:

- `59dfd23a` — prevent same-key option conflicts (D1, D2, T2)
- `ae7ac596` — refuse document-affecting indexes during collection paste (D3, D5)
- `a37d6f19` — freeze the confirmed index selection (D4)
- `3ddce15f` — record dedicated warning exposure (T1)
- `567e3ae7` — correlate paste wizards and tasks (T3)
- `1f50dfad` — align collection-task outcomes (T4, T5); this commit also contains the two
  collection-task correlation assignments because an earlier commit invocation reported success
  without committing the remaining T3 files
- `9c473a07` — classify command early exits (T6)
- `ba66d445` — classify visibility restoration failures (T7)
- `d47cbad4` — correct the Learn More test mock overload found by the build

Verified on 2026-09-18 under draft-PR Case 1:

- `npm run build` — passed
- 10 targeted Jest suites, 86 tests — passed with `--no-coverage`

Per repository rules, localization generation, formatting, lint, the full Jest suite, and packaging
were not run while the PR remains draft. They remain required only when moving the PR to ready for
review.
