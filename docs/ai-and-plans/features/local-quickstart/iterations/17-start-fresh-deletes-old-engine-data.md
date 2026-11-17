---
feature: local-quickstart
kind: plan
status: active
created: 2026-11-17
prs: [1096]
decisions: [0014]
code:
  - src/services/localQuickStart/QuickStartService.ts
  - src/services/localQuickStart/quickStartStore.ts
  - src/services/localQuickStart/quickStartTypes.ts
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.details.test.tsx
---

# 17 - Start fresh deletes the old instance, including when switching engines

> **Recorded-owner implementation complete; legacy policy and manual acceptance deferred.**
> Corrects iteration 16's preserve-and-abandon behavior and decision 0014's original
> engine-switch consequence for records with a saved engine. The original planning-only
> restriction was superseded by the execution authorization below. No PR readiness change.

> **Execution authorized (2026-11-17):** the operator subsequently invoked `/lead advisor
> opus 5.5` to implement this plan, emphasizing pragmatic fixes and simpler flow rather than
> added complexity. The original plan was committed as `c4690a2c0` before application work.
> PR #1096 remains a draft: Case 1 verification applies; full Case 2 checks, including
> localization generation and formatting, are deferred until ready for review.

## 1. Operator direction

The operator clarified:

> "start fresh should delete everything, and start fresh"
>
> "switching engine should say that we delete the other one. we need to align backend, ux, and the tests"
>
> "the deletion warning should be there, so we can have that action/footer note that mentiones that we'll delete the old data."

The operator also said that a recorded engine can be assumed to exist. Use the recorded owner as
the authoritative cleanup target, not a discovery guess. This does not make a failed cleanup
successful: an unavailable engine or a rejected deletion still needs an explicit failure.

Scope of "everything": the managed instance's containers, data volume, obsolete credentials, and
cached connection state. Never prune an engine, delete unrelated containers or volumes, remove
images, or uninstall Docker/Podman.

## 2. Required behavior

| Path | Required result |
| --- | --- |
| Keep existing data | Unchanged: use the recorded owner, saved credentials and saved image; keep the volume. |
| Start fresh, same engine | Delete the managed instance and its data, then create an empty instance. |
| Start fresh, different recorded engine | Delete the managed instance and data in the old engine, then create the replacement in the resolved target engine. No unmanaged old instance is left behind on success. |
| Preferred target CLI missing | Keep the existing target fallback rule. Start fresh authorizes deletion, including when fallback returns to the old engine. Report the actual target through existing execution evidence. |
| Both CLIs address the same backend | Cleanup is idempotent and completes before replacement creation. Never run old-engine cleanup after the replacement exists. No backend-identity detection feature is needed. |
| Old-engine inspection or deletion fails | Stop with an actionable error. Do not claim a clean slate or continue with an orphaned old instance. Do not silently switch the cleanup target. |
| No existing instance / data already confirmed removed | Preserve existing new-setup behavior. Do not require an irrelevant old engine. |

Keep Configure free of engine probes. Opening the panel or selecting Start fresh never deletes
anything. Preserve the existing healthy/stopped guards, tree action ordering, singleton panel
behavior, explicit port selection, and user-initiated engine startup.

### Legacy records: an implementation decision still needed

A record without `engineCli` cannot identify the original engine. The current legacy
Docker-first resolver is a selection rule, not proof of where the old data lives.

Do not silently expand this correction into engine-wide discovery, or claim that all old data
was erased after checking only the newly selected engine. Before implementing the legacy
cross-engine branch, agree how to establish its cleanup target: bounded label/alias discovery in
Docker and Podman, or an explicit user choice of the old engine. Recommended safety default:
block a cross-engine reset whose old cleanup target cannot be established, explaining why.
Recorded-owner paths are fully specified and do not depend on that discovery decision.

> **Deferred, escalated (2026-11-17), legacy source policy:** the operator was unavailable
> when asked to approve blocking an ambiguous cross-engine reset. That remains the
> recommendation, not an accepted decision. Do not introduce discovery, an engine selector,
> or a new legacy policy. Keep the existing legacy path unchanged and report this limitation.

## 3. UX changes

Use the same destructive meaning for explicit and forced Start fresh, whether credentials are
readable or not. All user-facing strings remain localized; no em dashes.

| Surface | Planned copy / behavior |
| --- | --- |
| Fresh radio | Always **Erase the existing data and start empty**. Remove the engine-dependent preservation label. |
| Different-engine explanation | **Starting fresh deletes the existing DocumentDB Local container and its data in {old engine}, then sets up a new instance using your selected container engine.** Do not promise the preferred target is final before execution-time fallback resolves. |
| Configure footer, Start fresh | Always show the destructive action note. Never hide it because the engine changed. |
| Footer with recorded owner | **This deletes the DocumentDB Local container and its data volume in {old engine}, then creates a new instance. All data in the existing instance is permanently erased.** |
| Footer without a recorded owner | Use engine-neutral deletion wording only on a path whose cleanup scope has been established; do not invent an owner. |
| Primary action in Configure | **Start fresh** whenever `startFresh` is true, not only when `forcedFresh` is true. Keep **Recreate container** and new-install **Start DocumentDB Local** unchanged. |
| Credentials warning | Explain why Keep is unavailable, but remove every promise that the old data is preserved or merely becomes unmanaged. The deletion footer remains visible. |
| Failed setup / retry | When the next action is still a fresh reset, show the deletion note alongside it. If deletion already happened, report that fact instead of implying the old data can be restored. |

Retain the telemetry/privacy note alongside the action note. There is still no additional
confirmation dialog: the explicit choice, primary label and visible footer communicate the
destructive action before execution.

## 4. Implementation work

Record progress against each item below when implemented; do not rewrite this plan as if those
changes were already present.

### P1. Separate the source of cleanup from the target of creation

> **Execution grouping:** P1 and P2 share the `provision()` lifecycle block and are scheduled
> as one backend commit, with their P4 tests. Advisor recommendation: `gpt-6.1-sol`, because
> ownership, cancellation and reload recovery span the lifecycle. Actual model:
> `gpt-6.1-sol` (no substitution).

> **Done (2026-11-17), commit `c15b898ea`:** recorded-owner resets pin cleanup to the
> saved source engine and resolve creation separately, including CLI fallback. All owned
> source containers are removed before replacement creation; standalone Delete is unchanged.
> Leader coordination decision, confidence 95%: combine P1/P2 and their P4 tests because
> they share the provisioning lifecycle lines. The operator's implementation request
> authorizes the recorded-owner correction, not a new legacy source policy.

- [x] In [QuickStartService.ts](../../../../../src/services/localQuickStart/QuickStartService.ts),
  capture the existing record and resolve the target once for the attempt.
- [x] Pin source cleanup to the record's `engineCli`, independently of the selected target and
  independently of later lease writes. Keep target fallback separate from source selection.
- [x] Reuse `findManagedContainers(alias, { propagateErrors: true }, engine)` and the existing
  label/alias ownership rules. Remove all owned containers for this alias, not only the first.
- [x] Do not call public `deleteContainer()` from `provision()`: it owns a separate lifecycle
  guard and tolerates volume-deletion failure with a warning. A fresh reset must not continue
  unless required cleanup succeeds. Extract only a small private engine-scoped helper if needed;
  leave the standalone Delete command's behavior unchanged.

### P2. Order destructive work and make retries truthful

Depends on P1.

> **Done (2026-11-17), commit `c15b898ea`:** target readiness, explicit-port validation and
> image preparation precede destruction. The source retains its record and credentials
> through preparation; existing `operationId`/`leaseAt` fields claim the attempt without a
> new persisted shape. Cleanup errors stop creation and identify the source engine through
> existing localized error formatting. Source erasure clears obsolete state and credentials;
> replacement failure, cancellation and timeout discard cannot revive the erased source.
> The internal optional `StageEvent.existingDataErased` reports the boundary truthfully.
>
> Advised (`claude-opus-5.5`): the final source-reviewed implementation was approved at
> 90% confidence. The advisor found and the worker corrected a readiness-adoption race:
> finalization accepts this attempt's provisioning lease or an unclaimed ready record
> on the target with the same newly stored secret. Foreign claims and secrets remain
> rejected; the pre-volume-removal ownership guard remains. Four added regressions cover
> adoption during readiness, adoption before Wait longer, and foreign-secret/claim rejection,
> including a changed bound port. The store still does not provide cross-window atomicity;
> an interrupted claim can block another reset until the existing 20-minute lease expires.

- [x] Check target readiness, validate the chosen port and prepare the target image before erasing
  the old data. A failed pull or cancellation during preparation must preserve the old volume.
- [x] Preserve the existing port suggestion and never silently choose another port. An unrelated
  occupant blocks setup before deletion. If the chosen port belongs to the owned source container,
  verify that ownership and recheck the port after removal rather than treating it as unrelated.
- [x] Establish ownership of the attempt before destructive operations. Preserve lease/race guards;
  do not mistake the store's per-process serialization for cross-window atomicity.
- [x] Remove the source containers and volume with errors propagated. Also clean any existing
  managed same-alias resources in the resolved target before creation, as Start fresh already does.
  When source and target share a backend, a second authoritative check can confirm absence; do not
  turn an inspection failure into "already gone."
- [x] Keep source ownership recoverable through preparation and interrupted cleanup. Prefer retaining
  the source record until cleanup completes, then reserving the target before creating its resources.
  Do not overwrite the only durable source reference early and make reload forget pending cleanup.
- [x] Separate rollback before and after the destructive boundary. Before the old volume is erased,
  retain its credentials and recoverable record, with truthful container state after partial cleanup.
  After it is erased, never restore its old ready record, image pin or credentials as a usable instance.
- [x] Update `replacedRecord`, `rollBackAttempt`, pending readiness, timeout discard and reconciliation
  consistently. A failed new-container creation cannot undo deletion of the old data. Persist only
  the minimal additional reset state if existing record ordering cannot satisfy reload recovery.
- [x] Once source data is gone, invalidate stale client/credential caches and metadata. Persist the
  target lease and new credentials before creating the replacement, preserving crash recovery.
- [x] A timeout's **Wait longer** concerns only the replacement. **Start over** or cancellation after
  deletion must not resurrect the deleted source. Keep cleanup scoped to this attempt's resources.
- [x] Surface old-engine failures as old-engine failures, with the original error available in the
  setup log. Never launch the selected new engine as a purported repair for failed old-engine cleanup.

### P3. Align Configure and failure presentation

Can be developed after P1's source/target contract is settled; integration depends on P2's outcomes.

> **Execution grouping:** a separate UI commit carries P3 and its P4 tests. Advisor
> recommendation: `gpt-6.1-terra`, for the self-contained view changes. New failure-footer
> prose proposed during consultation was not approved because the operator was unavailable;
> prefer the copy already specified in section 3.

> **Done (2026-11-17), commit `7a85ace39`:** actual model
> `gpt-6.1-terra` (no substitution); six regression cases added, with all 118 details tests
> passing. Advised (`claude-opus-5.5`), confidence 85%: the view consumes only confirmed
> `existingDataErased`, keeps it through Wait longer, and resets it for a new attempt.
> The advisor's neutral voluntary-retry footer correction was applied and tested.
> The destructive label, explanation and footer use section 3's copy for recorded-owner
> resets, including unavailable credentials, collapsed engine settings and failure retries.
> The post-erasure sentence is also taken verbatim from section 3; no unapproved new prose
> or additional confirmation dialog was introduced.

- [x] Apply section 3 in
  [LocalQuickStart.tsx](../../../../../src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx):
  fresh radio, engine note, credentials messages, primary action and both footer branches.
- [x] Replace the `!engineChanged && actionNote` suppression and the failed-step suppression.
  Keep the warning visible with the engine editor collapsed and on forced-fresh recovery.
- [x] Use existing stage-event/error mechanisms for deletion failures and post-deletion outcomes.
  Extend typed facts only where the view needs a fact it cannot currently represent; do not infer
  that deletion happened from `startFresh` alone.

### P4. Change behavior contracts with the implementation

Tests travel with P1-P3, rather than being deferred to a separate cleanup.

> **Done for the implemented scope (2026-11-17), commits `c15b898ea` and `7a85ace39`:**
> 39 backend durability cases (`gpt-6.1-sol`) and six view cases (`gpt-6.1-terra`) were
> added. Both engine directions, preparation versus post-erasure rollback, cleanup
> failures, fallback/shared backend, lost ownership, interrupted reconciliation and
> adopted replacements are covered. Existing intent assertions remain, including
> image preparation before deletion, explicit ports, ownership and probe-free Configure.
> Preservation contracts changed only for recorded-owner resets as the accepted plan
> specifies; legacy preservation remains pinned. No `TDD:` contract was weakened.
>
> **Verification:** final `npm run build` passed (37.474 s). One invocation of the four
> focused suites in section 5 passed all 476 tests (27.584 s). The backend worker's
> `npx tsc --noEmit -p .` also passed before the final narrow correction; the final build
> validates the corrected source. Earlier 472-test results precede that correction.
> No existing browser scenario covered switched-engine fresh reset or pinned changed
> strings, so there was no scenario edit or browser-harness run. Legacy-policy tests
> remain deferred with the unresolved policy. Real-engine/workbench acceptance is unverified.

- [x] Replace the durability test promising Docker remains untouched after a Podman switch.
  For both directions, assert source container/volume removal before target creation and a ready
  record owned by the resolved target.
- [x] Split the current switched-engine rollback tests at the destructive boundary: pull failure
  and pre-delete cancellation preserve the source; create failure, cancellation after deletion,
  and timeout discard never restore a deleted source.
- [x] Cover source listing/removal/volume failures: no target creation, no false success, useful
  error, and retryable state without losing surviving data credentials.
- [x] Cover missing preferred CLI fallback and both CLI handles sharing one resource store.
  Assert cleanup finishes before creation, and no subsequent cleanup removes the replacement.
- [x] Cover interruption/reload between source cleanup and target creation, a lost reservation,
  unrelated name/port collisions, and target cleanup failure.
- [x] Keep focused regression assertions for Keep, same-engine fresh, new install, unavailable
  credentials, label ownership, explicit ports and image-pull-before-data-deletion.
- [x] In [LocalQuickStart.details.test.tsx](../../../../../src/webviews/documentdb/localQuickStart/LocalQuickStart.details.test.tsx),
  replace preservation assertions with the deletion warning, the old engine name, and **Start fresh**
  for voluntary and forced choices. Assert warnings remain in Configure and the applicable retry
  footer, including after collapsing the engine editor. Keep no-probes/no-delete-on-selection tests.
- [x] Adjust existing typed browser scenarios for a switched-engine fresh reset and validate the
  visible footer/primary action. Update telemetry tests only for changed behavior; retain the
  existing bounded engine-change classification rather than adding unrelated instrumentation.
  Not applicable to scenarios in this tree: no existing scenario covers this path or pins the
  changed copy; no scenario was changed or added. The view tests validate the footer and action.
- [ ] Add legacy cases once section 2's unresolved source-selection policy is agreed. If an affected
  `TDD:` contract fails, stop for the operator's contract decision; do not automatically rewrite it.

### P5. Documentation and localization

Depends on P2 and P3.

> **Execution grouping:** documentation is a separate commit. Advisor recommendation:
> `gpt-6-luna`, for mechanical alignment with verified behavior. Preserve the operator's
> pre-existing README and design edits. An additional decision entry and external PR edits
> are not authorized by an unavailable operator; the accepted correction to decision 0014
> can be recorded factually without inventing rationale.

> **Done for local documentation (2026-11-17), commit `c2b72e4f1`:** actual model
> `gpt-6-luna`, as recommended (no substitution), aligned the user manual, README, design
> and decision 0014 with recorded-owner cleanup and pre/post-erasure recovery. The existing
> operator banners were integrated, not discarded. Decision 0014 was factually amended to
> cite this implementation request; no new operator rationale or decision 0015 was invented.
> Leader review, confidence 95%: remaining preservation descriptions explicitly concern
> Keep, historical behavior or deferred legacy paths. Documentation-only; no tests added.
>
> **Deferred, escalated (2026-11-17), external PR edit:** the operator was unavailable
> when asked to authorize updating draft PR #1096's description and manual checks.
> Recommendation: update them before pushing or requesting review, replacing the obsolete
> preservation/unconditional-restore promises with the implemented recorded-owner flow.
> No PR edit, push or readiness change was performed. Localization generation and the
> remaining full Case 2 commands are deliberately deferred until ready for review.

- [x] Align the [user manual](../../../../user-manual/local-quick-start.md), feature README and design
  with actual deletion and failure behavior. Remove preserve-and-abandon instructions; explain that
  old-engine cleanup must succeed before a cross-engine reset can finish.
- [ ] Update draft PR #1096's description and manual checks: it currently promises preservation and
  unconditional restoration of the previous record after switched-engine failure.
- [x] Keep iteration 16 as historical implementation evidence. Record changes and verification here.
- [ ] Generate localization at Case 2 handoff, not during Case 1 work. Do not hand-edit the bundle.

## 5. Verification and acceptance

During implementation, **Case 1**: `npm run build` and one focused Vitest invocation covering the
changed suites. Start with `QuickStartProvisionDurability.test.ts`, `QuickStartService.test.ts`,
`QuickStartProvisionTelemetry.test.ts` and `LocalQuickStart.details.test.tsx`; include store/router
tests only if their behavior changes. For changed browser scenarios, use their dedicated config:

```bash
npx vitest run --config build/verification/browser/vitest.config.ts build/verification/browser/scenarios.test.ts
```

Before handing this PR over for review, run the complete Case 2 list from the repository instructions:
localization generation for the changed strings, formatting, localization check, lint, build,
`npm run typecheck:tests`, the full Vitest suite and packaging. Report each result and remaining
pre-review/manual blockers. Earlier iteration 16 results do not validate this changed behavior.

Real-engine acceptance requires explicitly disposable test instances, never the operator's existing
data: both switch directions, same-engine fresh, selected-CLI fallback, shared Podman backend,
unavailable source engine, cancellation during pull, failure after deletion, and reload at the cleanup
boundary. Verify resource absence/presence and the new stored owner, not just a successful page.
Check the Configure and retry warnings in light, dark and high-contrast themes.

Acceptance: a successful recorded-owner engine switch leaves no old managed container or data volume;
the replacement is created only after cleanup; Keep still preserves data; the UX never promises
preservation on Start fresh; and failed cleanup never masquerades as a successful clean slate.

## Outcome

Recorded-owner P1/P2 and backend P4 are committed as `c15b898ea` (`gpt-6.1-sol`).
P3 and view P4 are committed as `7a85ace39` (`gpt-6.1-terra`).
Local P5 documentation is committed as `c2b72e4f1` (`gpt-6-luna`).
There were no model substitutions, authorization retries or failed/cancelled agents.

### Unverified acceptance and parked questions

Before pushing, use explicitly disposable instances to check both switch directions,
same-engine fresh, missing-target-CLI fallback, a shared Podman backend, unavailable source
engine, cancellation during image preparation, failure after erasure, and reload at the cleanup
boundary. Check actual old-resource absence, replacement presence and stored target owner.
In the workbench, check voluntary/forced Configure and retry warnings with the engine editor
collapsed, post-erasure failure and Wait longer, in light, dark and high-contrast themes.
No real containers or workbench sessions were operated by this run.

Legacy source selection remains parked; the existing unknown-owner behavior was not changed.
The draft PR description/manual-check edit remains parked for explicit external-edit approval.
The proposed additional decision entry and alternative new footer prose were not approved;
neither was introduced. Accepted section 3 copy and an internal event fact were sufficient.

### Verification

- Final `npm run build`: passed, exit 0, 37.474 s.
- Final single focused Vitest invocation: passed, four files, 476 tests, exit 0, 27.584 s.
- Backend worker `npx tsc --noEmit -p .`: passed before the final narrow correction;
  final corrected source was checked by the final build.
- Browser scenario harness: not run, because no scenario was changed.
- Full Case 2 checks, including `prettier-fix`, localization generation, localization check,
  lint, strict package-test typecheck, full runtime suite and packaging: not run.
  This is still draft/Case 1 work, not a ready-for-review handoff.
- The source-confirmed advisor review is recorded inline above. This does not claim that a
  separate ready-for-review AI pre-review or real-engine acceptance has been completed.

### Advisor decisions and rework

Eight consultation packets used two `claude-opus-5.5` advisors: seven for planning/backend
and one for the UI. The first proposed backend ordering was revised because it removed
containers before image preparation and did not establish attempt ownership before deletion.
The final design reuses existing lease fields; no public API or persisted shape changed.
Review found the readiness-adoption regression and the neutral retry-footer omission;
both corrections and their focused regression tests were implemented. An early suggestion
to remove the pre-volume ownership check was withdrawn by the advisor after source inspection,
so that guard remains. All final advisor recommendations were followed. One narrow review
was repeated because the leader accidentally prohibited source tools, then corrected that
instruction; no code or tests were rerun for that reporting mistake.

### Usage snapshot for cost optimization

Window: 2026-11-17 12:28:07 UTC through the host's 13:10 UTC snapshot, approximately
42 minutes wall-clock. This is the current task's window, not cumulative earlier-session
usage. Snapshot excludes the final records commit and final response. Summed model-request
time is 51m33s, not wall-clock. The dedicated checks agent used 2m13s in build/test spans
across the initial and final runs; the final build and focused tests took 65.058 s combined.
Worker test spans overlap other work and are not additive to wall-clock time.

| Model | Role | Requests | Model time | AIU | AIU share |
| --- | --- | ---: | ---: | ---: | ---: |
| claude-opus-5.5 | advisor | 69 | 15m30s | 621.9 | 70.1% |
| gpt-6-luna | coding | 52 | 6m57s | 8.2 | 0.9% |
| gpt-6-luna | checks | 7 | 41s | 0.4 | 0.0% |
| gpt-6.1-sol | leader | 47 | 12m39s | 95.8 | 10.8% |
| gpt-6.1-sol | coding | 49 | 11m55s | 132.1 | 14.9% |
| gpt-6.1-terra | coding | 30 | 3m51s | 28.8 | 3.2% |

| Role | Requests | Model time | AIU | AIU share |
| --- | ---: | ---: | ---: | ---: |
| leader | 47 | 12m39s | 95.8 | 10.8% |
| coding | 131 | 22m43s | 169.1 | 19.1% |
| advisor | 69 | 15m30s | 621.9 | 70.1% |
| checks | 7 | 41s | 0.4 | 0.0% |

| Model | Role | Input | Output | Cache read | Cache write | Reasoning |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| claude-opus-5.5 | advisor | 9,645,351 | 87,644 | 9,116,758 | 528,437 | 62,927 |
| gpt-6-luna | coding | 4,958,671 | 35,972 | 4,832,849 | 125,666 | 19,690 |
| gpt-6-luna | checks | 126,233 | 1,664 | 106,870 | 19,342 | 921 |
| gpt-6.1-sol | leader | 3,675,701 | 31,898 | 3,562,451 | 113,109 | 12,619 |
| gpt-6.1-sol | coding | 5,623,491 | 38,150 | 5,466,268 | 157,076 | 16,579 |
| gpt-6.1-terra | coding | 2,288,712 | 11,494 | 2,192,152 | 96,470 | 3,805 |

Reported totals: leader 95.8 AIU, subagents 791.4 AIU, run 887.3 AIU.
Rounded role rows can differ slightly from the host total. Cache and reasoning fields may
overlap input/output and must not be added into a token total. AIU are not dollars.
The largest measured category was advising (70.1%); next time, start with a smaller,
source-scoped decision packet and avoid repeated broad planning/context, while retaining the
targeted lifecycle review that found the real adoption bug. No model-quality ranking is
inferred from these unlike tasks.
