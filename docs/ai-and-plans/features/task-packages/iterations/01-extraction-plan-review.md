---
feature: task-packages
kind: review
status: active
prs: [1068]
created: 2026-11-05
code:
    - src/services/taskService/**
    - src/commands/pasteCollection/**
---

# Task package preparation: consolidated PR review

## Scope and method

- **PR:** [#1068](https://github.com/microsoft/vscode-documentdb/pull/1068), still a draft.
- **Reviewed head:** [`af58b5ad`](https://github.com/microsoft/vscode-documentdb/commit/af58b5adb799ad4d2dcca19ca4f72489bfee90f5).
- **Base branch tip:** `b1b543ead1c0efc19998ebcb82ada2f0e4b05d90`.
- **Actual merge-base:** `a4b8451359f91cc54a27dfaf2a8289506c4e98d7`.
  The review covers the PR's three-dot diff: 61 files, 4,009 additions and 1,085 deletions.
- **Independent passes, run in parallel:**
  - **Sol:** `rubber-duck` on **gpt-6.1-sol**.
  - **Opus:** `code-review` on **claude-opus-5.5**.
- **Validation gate:** a subsequent, narrowly scoped `code-review` pass on
  **claude-opus-5.5** checked the five collected findings against the code, base and
  active design/decisions. It did not perform another independent sweep.
- **Existing Copilot feedback:** the PR reviews and inline review comments APIs both returned
  no entries; there were no Copilot reviewer findings to merge or comment links to preserve.

The report follows [CONTRIBUTING sections 5 and 6](../../../../../CONTRIBUTING.md#6-ai-assisted-review-workflow)
and accompanies [iteration 01](./01-extraction-plan.md). The reviewers considered the
[design](../design.md) and [decisions](../decisions.md), not just the diff.

Both reviewers checked introduction against the base. The initialization-failure behavior,
progress reporter detach-ID bug, UI localization, reader-client injection item 1.5 and
deferred phases 3-5 are not reported as new defects.

## Findings and agreement

**Five validated findings: four med, one low; no high findings.** These concern the newly
introduced reusable contracts. Neither reviewer confirmed a regression in the default
DocumentDB copy/paste path: the current adapter does not use returned retry outcomes or
custom writer settings, and shipped tasks inject the extension telemetry runner.
These seams are implemented in this PR; package extraction/publication remains deferred.

Severity reflects consequences for a consumer using the new contract:
**high** = critical/widespread failure; **med** = substantial correctness or availability
failure on a supported path; **low** = constrained edge case.

| ID | Finding | Severity | Independent agreement | Validation gate |
| --- | --- | --- | --- | --- |
| F1 | Abort conflicts disappear from intermediate retry outcomes | med | **BOTH: Sol + Opus**, including severity | Confirmed |
| F2 | Explicit `undefined` settings overwrite defaults and can hang flushing | med | **BOTH: Sol + Opus** on the defect; initially med vs low | Confirmed; med for the new contract |
| F3 | A returned retry outcome without `remaining` can retry forever without backoff | med | Opus only | Confirmed with contract qualification |
| F4 | Default telemetry runner turns a stopped task into Failed and duplicates failure events | med | Opus only | Confirmed with cancellation qualification |
| F5 | Server waits exceeding Node's timer limit become approximately 1 ms | low | Sol only | Confirmed and independently reproduced in the gate |

**BOTH** means independently discovered by both original reviewers, not merely accepted after
being shown the other report. Gate confirmation of F3-F5 is not a second independent discovery.
F2's original severity difference is retained below rather than presented as unanimous.

### Proposed resolutions (agent, awaiting author decision)

These proposals were written after the findings were checked against the code at the reviewed head.
They are calibrated to where the work stands: the packages are unpublished, this extension is still
the only consumer, and the writer contract stays open until the NoSQL contract review
([decision 0013](../decisions.md)). So each proposal is the smallest change that removes a hang,
crash or silent data-loss path now. Wider contract hardening is deferred to that review rather than
locked in early. Each finding below has a **Proposed resolution** paragraph. The author decision is
still pending.

| ID | Proposal | Cost |
| --- | --- | --- |
| F1 | **Fix now**, using the reviewer's recommended option (return early under Abort when a returned outcome carries errors). | A few lines and one test |
| F2 | **Fix now, narrowly:** ignore `undefined` leaves when merging, and guard only the values that hang or crash. **Defer** the full validation matrix. | A small helper and a few assertions |
| F3 | **Fix now:** default omitted `remaining` to the unwritten suffix, as decision 0009 already specifies. **Defer** the discriminated type and the zero-progress guard. | One line and one test |
| F4 | **Fix now**, using the recommended `isFinalState()` guard on both outer catches. | Two lines and two tests |
| F5 | **Won't fix**; record it as a known limitation. | Docs only |
| Lint | **Fix now:** assign the picked enum ID directly instead of switching on it. | A few lines |

## F1 - Abort conflicts disappear from intermediate retry outcomes

**Severity:** med. **Confidence:** high; reproduced independently by both reviewers.
**Agreement:** BOTH. **Gate:** confirmed.

**Location:** [returned outcome processing](../../../../../src/services/taskService/data-api/writers/StreamingDocumentWriter.ts#L726),
[partial progress callback](../../../../../src/services/taskService/data-api/writers/StreamingDocumentWriter.ts#L565),
and [final Abort handling](../../../../../src/services/taskService/data-api/writers/StreamingDocumentWriter.ts#L600).

**Trigger:** under Abort, a batch returns a mixed outcome containing one insertion, one
duplicate conflict and other throttled documents:

```typescript
{
    result: {
        processedCount: 2,
        insertedCount: 1,
        abortedCount: 1,
        errors: [duplicateError],
    },
    remaining: throttledDocuments,
    errorType: 'throttle',
}
```

**Observed:** `onPartialProgress` records counts but ignores `errors`. The engine retries
the remaining documents and can finish successfully. Sol reproduced a successful result
with `insertedCount: 2` and `abortedCount: 1`; Opus reproduced the same failure mode.
The copy task does not turn a nonzero aborted count into failure.

**Expected:** retain accurate partial statistics, stop further attempts and report the Abort
failure. For unordered adapters, this means stopping after the current attempt, not undoing
documents that the server already inserted.

**Why introduced:** the new return route permits intermediate results containing errors.
At the base, returned results reached the outer fatal-error handler, while intermediate
throw-route statistics did not contain these errors.

### Fix proposals

| Option | Pros | Cons |
| --- | --- | --- |
| **Recommended:** before forwarding a returned outcome to partial-progress handling, return its result immediately when Abort and `result.errors` are present. Let existing outer handling record statistics and fail. | Small change; records counts once; preserves the original error; avoids writing the remaining documents. | Adds strategy-specific logic inside the retry loop; intermediate errors under other strategies still need separately defined treatment. |
| Extract shared processing for statistics, progress, errors and fatal Abort behavior. | One consistent path for intermediate and final results. | Larger refactor; a thrown `StreamingWriterError` must bypass generic write-error handling or it can be logged/wrapped twice. |

**Regression checks:** mixed conflict/throttle outcome under Abort rejects with
`StreamingWriterError`, counts insertion and abort once, and makes no subsequent write.
Repeat after an earlier successful partial attempt and with a zero-insertion conflict.
Verify Skip/Overwrite partial retries still work.

**Proposed resolution (agent):** fix now, using the recommended option. The return route exists for
the NoSQL bulk adapter, the first external consumer, and a lost Abort conflict means a copy that
should have failed reports success. In `writeBatchWithRetry`, right after the `writeBatch` call,
return `outcome.result` when `strategy === Abort` and `outcome.result.errors?.length`, before
any partial-progress or remaining handling. `flushBuffer` already records the statistics once and
calls `handleFatalError`. Don't define intermediate errors for other strategies yet. Skip and
Overwrite do not fail on conflicts, and their semantics for scattered unordered errors belong in the
NoSQL contract review. Keep the shared-processing refactor out of this PR. Tests: the first two
regression checks above (mixed outcome, and the same after an earlier partial attempt).

**Author decision and reasoning:** accepted the proposed resolution above (operator, 2026-11-06:
"perform the work as now noted in the review file"). No further rationale was given.

**Done (2026-11-06), commit `a63ad13e`:** `writeBatchWithRetry` now returns a returned outcome
straight away when the strategy is Abort and `result.errors` is nonempty, before partial-progress
or remaining handling. `flushBuffer` records the counts once and fails with `StreamingWriterError`.
Model: sol (retry-loop logic). No decisions beyond the accepted resolution. Tests: 2 added in
`StreamingDocumentWriter.outcome.test.ts` (mixed conflict/throttle outcome; the same after an
earlier partial attempt), both failing before the fix.

## F2 - Explicit `undefined` settings overwrite defaults

**Severity:** med for the new contract. **Confidence:** high; reproduced by both reviewers.
**Agreement:** BOTH on the defect. Sol initially assigned med; Opus initially assigned low
because no current extension caller supplies custom settings. The gate selected med because
valid optional configuration can cause an event-loop-blocking hang.

**Location:** [settings resolution](../../../../../src/services/taskService/data-api/writers/streamingWriterSettings.ts#L51),
[batch adapter construction](../../../../../src/services/taskService/data-api/writers/BatchSizeAdapter.ts#L69),
and [retry attempts](../../../../../src/services/taskService/data-api/writers/StreamingDocumentWriter.ts#L683).

**Trigger:** a caller constructs an optional override in the normal way:

```typescript
{ batching: { fast: { initialBatchSize: optionalValue } } }
```

When `optionalValue` is `undefined`, the current types/configuration accept it.
Object spreading overwrites the adapter/package default with `undefined`.

**Observed:** an undefined initial batch size produces empty slices and `NaN` growth;
flushing repeatedly makes no progress and can monopolize the event loop. An undefined
`startMode` crashes construction. An undefined retry-attempt limit skips attempts and
eventually throws instead of writing. Zero/non-finite values are also not validated.

**Expected:** omitted optional values inherit lower-priority defaults, and invalid effective
settings fail explicitly before streaming starts.

**Why introduced:** these values were fixed constants at the base. This PR adds optional
overrides and returns a supposedly resolved settings object that can still contain undefined
or invalid leaves.

### Fix proposals

| Option | Pros | Cons |
| --- | --- | --- |
| **Recommended:** resolve leaves with caller -> adapter -> package nullish fallback, or remove undefined leaves before merging; validate the resulting settings. | Supports ordinary optional configuration; prevents hangs/crashes; preserves layered defaults. | Requires explicit validation rules and additional merge/validation code. |
| Reject explicit undefined overrides and all invalid values immediately. | Fails clearly and keeps configuration strict. | Rejects the common `{ x: maybeValue }` pattern; still requires numeric validation. |

Validate finite numeric values, positive integral batch sizes/attempt limits, maximum batch
size not below initial size, nonnegative delays, supported start modes, and suitable
growth/multiplier/jitter bounds. Do not silently clamp invalid settings.

**Regression checks:** explicit undefined at both override layers inherits the next layer
for every optional leaf; existing precedence/default tests still pass. Invalid zero,
negative, non-finite and inconsistent values fail before any stream work. Include an
end-to-end finite stream proving configuration cannot create an empty-batch spin.

**Proposed resolution (agent):** fix now, but narrowly. In `resolveStreamingWriterSettings`,
strip `undefined` leaves from each layer before spreading (a small local helper), so
`{ x: maybeValue }` inherits the next layer. This matches decision 0010's "field by field"
wording and costs almost nothing. Then validate only what can hang or crash the writer, throwing a
plain `Error` at construction:

- `initialBatchSize`, `maxBatchSize` and `minBatchSize` must be integers of at least 1.
- `maxAttemptsWithoutProgress` must be an integer of at least 1.
- `startMode` must be `fast` or `ru-limited`.

Defer the rest of the matrix (growth/multiplier/jitter bounds, max at or above initial, nonnegative
delays) until the NoSQL contract review. Those values degrade behavior but do not spin or crash, and
the extension passes no caller overrides today. Tests: one explicit-`undefined` inheritance case per
layer, plus one invalid-value case that throws before any write.

**Author decision and reasoning:** accepted the proposed resolution above (operator, 2026-11-06:
"perform the work as now noted in the review file"). No further rationale was given.

**Done (2026-11-06), commit `60d88cc5`:** `resolveStreamingWriterSettings` drops `undefined` leaves
from each layer before merging (`definedOnly` helper), then requires the batch sizes, the minimum
batch size and `maxAttemptsWithoutProgress` to be integers of at least 1, and `startMode` to be
`fast` or `ru-limited`. Because `BatchSizeAdapter` resolves through the same function, both
construction paths are covered. Model: terra (self-contained). Leader decision, 90%: the
validation errors are plain English `Error`s, not injected strings. They signal a programming
error, and injecting them would widen the public options API. Tests: 35 cases added in
`streamingWriterSettings.test.ts` (undefined inheritance per layer, invalid values, adapter
construction).

## F3 - Missing `remaining` bypasses retry controls

**Severity:** med. **Confidence:** high; reproduced by Opus.
**Agreement:** Opus only in the independent passes. **Gate:** confirmed, with qualification.

**Location:** [optional outcome fields](../../../../../src/services/taskService/data-api/types.ts#L311),
[return-route remaining calculation](../../../../../src/services/taskService/data-api/writers/StreamingDocumentWriter.ts#L738),
and [flush progress/removal](../../../../../src/services/taskService/data-api/writers/StreamingDocumentWriter.ts#L616).

**Trigger:** an adapter returns a type-accepted outcome with a retry reason but omits
`remaining`:

```typescript
{
    result: { processedCount: 0, insertedCount: 0 },
    errorType: 'throttle',
    retryAfterMs: 1000,
}
```

**Observed:** `outcome.remaining ?? []` empties the internal batch and exits the retry loop.
The outer flush removes zero pending documents and immediately tries again. Neither the
server wait nor the no-progress retry limit applies. Opus's yielding reproduction made
521,022 adapter calls in two seconds; synchronously resolving attempts starved timers.

**Expected:** honor retry delay and attempt limits, or reject an inconsistent adapter result
explicitly. Never silently enter an unbounded retry storm.

**Contract qualification:** design section 5.1 describes `errorType` as explaining why
`remaining` is nonempty, implying an adapter should provide both. However, the public type
does not enforce that relationship, and the thrown route already defaults missing
`remaining` to the unprocessed suffix. Even if considered malformed input, the current
failure mode needs an explicit guard.

**Why introduced:** this PR introduces the returned retry-outcome branch; base retries
used the thrown route, which calculated the remaining suffix.

### Fix proposals

| Option | Pros | Cons |
| --- | --- | --- |
| **Recommended:** default omitted `remaining` to `currentBatch.slice(processedCount)`, matching the thrown route; also fail explicitly if a completed attempt on a nonempty batch reports no total progress. | Restores route consistency; the outer guard protects against other zero-progress results too. | Prefix inference is unsuitable for scattered unordered successes; those adapters must explicitly supply `remaining`, which needs documentation. |
| Require `remaining` for retryable outcomes through a discriminated type and runtime validation. | Makes the contract unambiguous and rejects mistakes early. | Changes the newly introduced type and is more verbose for adapters; runtime validation remains necessary for JavaScript callers. |

**Regression checks:** omitted remaining plus throttle waits, increments attempts and
exhausts the configured retry limit; a partial prefix is not rewritten; unordered explicit
remaining is preserved; a plain zero-progress result fails rather than spinning. Include
Skip pre-filtering so already-accounted-for documents are not mistaken for zero progress.

**Proposed resolution (agent):** fix now, using the first half of the recommended option only.
Replace `currentBatch = outcome.remaining ?? []` with
`outcome.remaining ?? currentBatch.slice(outcome.result.processedCount)`. This is not a new policy:
[decision 0009](../decisions.md) already says an omitted `remaining` drops the written prefix, and
the return route was simply not following it. With the suffix as the default, a zero-progress throttle
increments `attempt`, waits, and stops at `maxAttemptsWithoutProgress`, so the storm cannot happen.
In the type's TSDoc, state that unordered adapters must supply `remaining` explicitly.

Defer the discriminated type until the NoSQL contract review, which will settle the outcome shape
anyway. Don't add the outer zero-progress guard in this PR. A plain success with
`processedCount: 0` on a nonempty batch spun at the base as well, so it is not introduced here. If
it is wanted, track it as a follow-up issue (CONTRIBUTING 6.5). Tests: omitted `remaining` with
throttle exhausts the retry limit, and an omitted `remaining` after a partial prefix does not
rewrite that prefix.

**Author decision and reasoning:** accepted the proposed resolution above (operator, 2026-11-06:
"perform the work as now noted in the review file"). No further rationale was given.

**Done (2026-11-06), commit `224b63c6`:** the returned-outcome route now sets
`currentBatch = outcome.remaining ?? currentBatch.slice(outcome.result.processedCount)`, and
`BatchAttemptOutcome.remaining` documents that default and that unordered adapters must supply it.
Model: terra (one line plus tests). No decisions beyond the accepted resolution. Tests: 2 added in
`StreamingDocumentWriter.outcome.test.ts` (omitted remaining exhausts the retry limit with waits;
an omitted remaining after a partial prefix retries only the suffix). Noticed, not changed: the
throttle debug line logs 0 remaining when `remaining` is omitted; it is cosmetic.

## F4 - Default telemetry runner corrupts terminal task state

**Severity:** med for consumers using the default runner. **Confidence:** high; reproduced
by Opus. **Agreement:** Opus only in the independent passes. **Gate:** confirmed.

**Location:** [default runner](../../../../../src/services/taskService/taskService.ts#L31),
[outer start catches](../../../../../src/services/taskService/taskService.ts#L289),
and [work error handling](../../../../../src/services/taskService/taskService.ts#L338).

**Trigger:** a task omits the optional telemetry runner, and its abort-aware `doWork`
rejects after the user presses Stop.

**Observed:** `runWork` records Stopped, then rethrows. The default runner passes through
the rejection; an outer catch overwrites the terminal state with Failed:
`Initializing -> Running -> Stopping -> Stopped -> Failed`.
Ordinary work failures similarly emit Failed twice. Lifecycle logging can report both a
stop and a failure.

**Expected:** preserve the first appropriate terminal state and emit its notification once.

**Qualification:** cooperative work that returns normally after Stop is not affected.
All shipped tasks inject the extension runner, which swallows the rethrow as at the base.
This is not the separately documented pre-existing initialization-failure bug.

**Why introduced:** the rethrow is old, but the newly added default runner exposes a path
that did not exist with the previously mandatory extension telemetry wrapper.

### Fix proposals

| Option | Pros | Cons |
| --- | --- | --- |
| **Recommended:** guard both outer start catches with `!this.isFinalState()`; keep the work-handler rethrow. | Small change; retains the original error and telemetry reporting; preserves Stopped; runner failures before terminal handling still become Failed. | Outer handlers must distinguish an already-handled work failure from a runner failure; regression coverage is needed for both. |
| Make the default runner swallow errors like the extension runner. | Aligns runner behavior. | Inherits the deferred initialization-swallowing behavior and hides errors from consumers. |

Removing the `runWork` rethrow instead would prevent the extension telemetry wrapper from
observing the original failure and is not recommended.

**Regression checks:** default-runner work rejecting after Stop remains Stopped with one
terminal notification; ordinary failure emits Failed once with the original error; runner
failure before work still fails the task; the injected extension runner remains unchanged.

**Proposed resolution (agent):** fix now, using the recommended option. No shipped task uses the
default runner today, so this could wait, but the fix is two `if (!this.isFinalState())` guards on
the `runWork().catch` handlers in `start()`. Its regression would surface only after extraction, in
a consumer that cannot see this history. Keep the `runWork` rethrow. Tests: Stop then reject stays
Stopped with one terminal notification, and an ordinary failure emits Failed once. Leave the
initialization-swallowing behavior to its separately tracked item.

**Author decision and reasoning:** accepted the proposed resolution above (operator, 2026-11-06:
"perform the work as now noted in the review file"). No further rationale was given.

**Done (2026-11-06), commit `dfc896c0`:** both `runWork().catch` handlers in `start()` now set
Failed only when the task is not already final. The `runWork` rethrow and the initialization path
are unchanged. Model: sol (task lifecycle). No decisions beyond the accepted resolution. Tests: 4
added in `taskService.test.ts` with the default runner (Stop then reject stays Stopped with one
terminal notification; ordinary failure emits Failed once with the original error; runner failures
still fail the task), three of them failing before the fix.

## F5 - An uncapped server delay can overflow Node's timer

**Severity:** low. **Confidence:** high; reproduced by Sol and again in the gate.
**Agreement:** Sol only in the independent passes. **Gate:** confirmed.

**Location:** [server-delay resolution](../../../../../src/services/taskService/data-api/writers/StreamingDocumentWriter.ts#L800)
and [native timeout](../../../../../src/services/taskService/data-api/writers/StreamingDocumentWriter.ts#L817).

**Trigger:** either retry route supplies a finite server minimum greater than
`2_147_483_647` milliseconds, approximately 24.8 days.

**Observed:** the inline `setTimeout` receives the uncapped value. Node emits
`TimeoutOverflowWarning` and substitutes a 1 ms timeout; the two reproductions observed
approximately 2 ms and 6 ms. The engine can retry almost immediately instead of respecting
the accepted minimum.

**Expected:** honor the uncapped server floor while allowing Stop to interrupt, as
[decision 0011](../decisions.md) and design section 5.3 require.

**Why introduced:** base backoff was bounded to approximately 6.5 seconds including jitter;
the new server hint can exceed the native timer range. Current DocumentDB adapters do not
provide such hints, and a multi-week server delay is an unusual edge case, hence low severity.

### Fix proposals

| Option | Pros | Cons |
| --- | --- | --- |
| **Recommended:** wait in abortable chunks no larger than the native timer maximum, tracking the remaining duration. | Honors the uncapped-floor contract and retains cancellation. | Adds timer bookkeeping and abort-listener cleanup requirements. |
| Reject oversized hints explicitly rather than passing them to a timer. | Simple and avoids an early retry. | Introduces a limit contrary to decision 0011; requires an explicit design decision before implementation. |

Silently clamping to the timer maximum also violates the accepted minimum and is not a fix.

**Regression checks:** with fake timers, a `2_147_483_648` ms hint never retries early;
Stop interrupts during a chunk; both thrown-hook and returned-outcome routes behave the
same. Cover the native-limit boundary and ordinary hints.

**Proposed resolution (agent):** won't fix. Triggering it needs a server to suggest waiting more than
24.8 days. No current adapter supplies hints, and realistic `Retry-After` / `x-ms-retry-after-ms`
values are milliseconds to seconds. Chunked waiting adds timer and listener bookkeeping to guard a
case no server is expected to produce, and rejecting oversized hints would reopen decision 0011
without a known need. Record a one-line known limitation in design §5.3 (hints above about 24.8 days
are not honored, because of Node's timer limit). Revisit only if the NoSQL contract review turns up
a real source of such hints.

**Author decision and reasoning:** accepted the proposed resolution above (operator, 2026-11-06:
"perform the work as now noted in the review file"). No further rationale was given.

**Done (2026-11-06), commit `8272dd9b`:** won't fix. Design §5.3 now lists the timer maximum as a
known limitation, with a link back to this finding. Written by the leader (docs only). No code or
tests changed.

## Draft readiness observations - separate from runtime findings

The existing [CI run on the reviewed head](https://github.com/microsoft/vscode-documentdb/actions/runs/42049819193)
has **Static checks: failed**, **Merge gate: failed**, and **Unit tests: passed**.
The parent review session independently confirmed these results and the static job's
`l10n=failure, lint=failure, prettier=failure` summary.

Opus identified these specific cleanup items:

| Observation | Suggested action | Trade-off |
| --- | --- | --- |
| Four unsafe enum-comparison lint errors in the [conflict picker switch](../../../../../src/commands/pasteCollection/PromptConflictResolutionStep.ts#L57) | Compare against the enum members rather than string literals. | Small source cleanup without intended runtime change; adds an implementation item beyond this report. |
| The [localization bundle](../../../../../l10n/bundle.l10n.json) is stale after string moves/removals | Regenerate with `npm run l10n` at ready-for-review. | Restores source/bundle consistency; generation is intentionally deferred while the PR remains a draft. |
| Prettier reports 12 files | Run `npm run prettier-fix` at ready-for-review. | Satisfies formatting checks; avoid unrelated formatting churn during this review-only pass. |

These are readiness observations, not additional behavioral defects. Their cleanup does
not replace addressing or explicitly deciding on F1-F5.

**Proposed resolution (agent):**

- **Lint:** fix now; it fails CI on every push. The quick-pick items already use
  `ConflictResolutionStrategy` members as their `id`, so replace the switch with
  `context.conflictResolutionStrategy = selectedItem.id`. Throw only if the ID is not one of the
  supported strategies. This removes the four errors and the duplicated mapping.
- **l10n and Prettier:** defer to the Case 2 run at ready-for-review, as the observations already
  suggest. Running them now would add churn to every later commit in the draft.

**Author decision and reasoning:** accepted the proposed resolution above (operator, 2026-11-06:
"perform the work as now noted in the review file"). No further rationale was given.

**Done (2026-11-06), commit `ec046c0a`:** lint item only. `PromptConflictResolutionStep` now
checks the picked ID against `documentDbSupportedConflictStrategies` and assigns it directly,
removing the four `no-unsafe-enum-comparison` errors. The existing localized error string is
unchanged. Model: luna (mechanical). Tests: existing picker tests pass unchanged. l10n and
Prettier remain deferred to Case 2.

## Outcome

**Review status:** independent review, feedback lookup, consolidation and the scoped
cross-vendor validation gate are complete. Author decisions are recorded under each item
(2026-11-06: all proposals accepted).

**Implementation (2026-11-06, `/lead`):** F1-F4 and the lint item are fixed in one commit each, and
F5 is closed as won't-fix with a design note; see the done notes above. After the batch, Case 1
passed: `npm run build`, plus `npx vitest run src/services/taskService src/commands/pasteCollection`
(22 files, 298 tests). The PR is still a draft; Case 2 (including `l10n` and `prettier-fix`) is
deferred until ready-for-review. No `vscode.l10n.t` strings were added or removed. The sections below
describe the original review passes.

### Verified

- Sol reported **277 passing tests in 22 files**, covering task services, transfer engines,
  paste hooks/pickers, index execution and affected connection commands, plus root
  TypeScript checking with `--noEmit --incremental false`.
- Opus reported **322 passing tests in 30 files** using focused selections for taskService,
  pasteCollection, pasteIndexes and connections-view, plus passing `npx tsc --noEmit -p .`.
  These suites overlap; their totals must not be added.
- The original reviewers reproduced all five reported failure modes in memory without
  source-file edits. The validation gate checked all five against source/design and
  independently reran the timer overflow.
- Opus additionally ran the non-mutating `npm run l10n:check` and observed failure.
  This isolated check is not a full Case 2 run.
- The worktree was clean after the review passes, before this report was added.

### Not verified or changed

- No live database, manual copy/paste, packaged VSIX or extension-host validation.
- `npm run build` and `npm run typecheck:tests` were not run during these review passes;
  the reported root TypeScript and runtime checks do not substitute for either.
- **Case 1 applies: the PR remains a draft. The full Case 2 checks, including
  `prettier-fix`, were deferred until it is ready for review.** No claim is made that the
  ready-for-review suite passed.
- No production/test changes, finding fixes, PR comments, review resolutions, push or
  ready-for-review transition were performed.

Next, the author should record a decision and reasoning inline under each finding, as
required by [CONTRIBUTING section 6.2](../../../../../CONTRIBUTING.md#62-stage-2-author-decisions).
If a proposal changes an existing design constraint, record the approved rationale in
the feature decisions before implementing it. This report is the review artifact to
check in; it is not an approval to implement all recommendations.
