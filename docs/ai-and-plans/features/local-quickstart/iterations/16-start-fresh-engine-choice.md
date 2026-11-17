---
feature: local-quickstart
kind: plan
status: active
created: 2026-11-17
decisions: [0014]
code:
  - src/services/localQuickStart/QuickStartService.ts
  - src/services/localQuickStart/quickStartTypes.ts
  - src/commands/localQuickStart/openLocalQuickStart.ts
  - src/webviews/documentdb/localQuickStart/LocalQuickStart.tsx
  - src/webviews/documentdb/localQuickStart/localQuickStartController.ts
  - src/webviews/documentdb/localQuickStart/localQuickStartRouter.ts
  - src/tree/connections-view/LocalQuickStart/LocalQuickStartItem.ts
---

# 16 — Start fresh is always offered and unlocks the engine

> **Implemented (2026-11-17), manual checks pending.** Implements
> [decision 0014](../decisions.md). An existing instance can always be started fresh, and starting
> fresh is how the user changes its container engine. Keeping the data keeps the engine locked,
> as before. No PR exists for this branch; nothing was pushed.

### Implementation coordination (2026-11-17)

The operator requested implementation with `claude-opus-5.5` advising, particularly on UX.
The seven accepted items below remain the scope; P6 tests travel with the behavior they cover.
The advisor recommends these buildable groups, using the recommended models without substitution:

1. **G1, P1 + P5 and their P6 tests, `gpt-6.1-sol`:** service selection, reservation,
   telemetry and the cross-module `existingInstance` rename, including router and shape-only
   webview/scenario consumers. Lifecycle and rollback require the default coding tier.
2. **G2, P2 + P3 and their P6 tests, `gpt-6.1-sol`:** panel entry and the approved UX;
   depends on G1. Derived state and messaging cross module boundaries.
3. **G3, P4 and its P6 tests, `gpt-6.1-terra`:** the self-contained tree recovery row;
   depends on G1, parallel with G2 in disjoint files.
4. **G4, P7, `gpt-6-luna`:** mechanical user/feature documentation; after G2 and G3.

The initial advisor identified implementation corrections needed to preserve decision 0014:
reserve only for Start fresh or a removed-owner record, not legacy Keep; let the reservation's
race check accept an unchanged ready owner; clear the ready-record flag after reservation so
the old cleanup path cannot delete the lease and credentials; retain forced Start fresh for
`CredentialsMissing` even without a record; omit contradictory erase-all footers when switching.
These are corrections to the implementation recipe, not changes to the accepted behavior.
Keep the existing recovery rows on storage errors using repository-standard error reporting,
not a silent fallback. The different-engine explanation belongs in the engine value cell so
closing its editor does not hide it.

No PR exists at the start of this run. Verification is Case 1, plus the plan's explicit
`npm run l10n`; real-engine/workbench checks remain manual. The create-or-reveal singleton
limitation in P2.3 remains accepted and must be mentioned in any eventual PR.

## 1. The dead end this fixes

Found in pre-release testing on a record written before Podman support (no `engineCli`), with
Docker installed but not running.

| Step                   | What happens today                                                                                                                                                         | Source                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Startup reconciliation | The record's owner resolves to Docker (legacy order). Docker is unreachable, so the alias is skipped and set to `Error`. Credentials are never examined.                   | `performReconciliation`, `skippedUnavailableEngine` |
| Tree                   | `Error` with no container shows **View setup log** and **Retry setup…** only. No Delete.                                                                                   | `LocalQuickStartItem.getChildren`                   |
| Configure, engine row  | `getInstanceEngine` returns `'notRecorded'`; any value hides the editor. Shows **Not recorded**.                                                                           | `getInstanceEngine`, `settingItems.engine`          |
| Configure, data choice | Shown only when `canReuseExistingData` (stored credentials readable) or the state is `CredentialsMissing`. Neither holds, so no **Start fresh**.                           | `dataChoiceBlock`, `forcedFresh`                    |
| Start                  | `engineRequestFor` returns `{ preferred: record ? 'docker' : preferred }`: Docker first, Podman only if the Docker CLI is missing. Fails at **Checking container engine**. | `engineRequestFor`                                  |

If Docker was reachable instead, setup would refuse at the volume-wipe gate, set
`CredentialsMissing`, and only then show the forced Start fresh. With Docker down there is no path.

## 2. Target behavior

`owner` is the engine the instance record names. `legacy` is a ready record without one.
"Record exists" means a `ready` record whose data was not confirmed removed (today's
`getInstanceEngine !== undefined`).

| Situation                                                                     | Data choice                               | Engine row                                                    |
| ----------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| No record                                                                     | none (unchanged)                          | editable, Docker default (unchanged)                          |
| Data confirmed removed                                                        | none, existing notice (unchanged)         | editable (unchanged, 0009 amendment)                          |
| Record, credentials readable                                                  | **Keep** (default) / **Start fresh**      | Keep: read-only owner. Fresh: editable, pre-selected to owner |
| Record, credentials not readable (incl. `CredentialsMissing` and the §1 case) | **Start fresh** only, with the reason     | editable, pre-selected to owner                               |
| Healthy or stopped instance                                                   | blocked by the existing guard (unchanged) | n/a                                                           |

Engine pre-selection for `legacy` is Docker, described truthfully (see §3).

What Start fresh does, by chosen engine:

| Chosen engine        | Effect                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Same as owner        | Erase that engine's container and volume, create a new instance (today's Start fresh).                                        |
| Different from owner | Create a new, empty instance in the chosen engine. The old container and volume are left untouched and are no longer managed. |
| `legacy` record      | The engine actually used decides: whatever data that engine holds is erased; the other engine is not touched.                 |

## 3. User-visible text

No em dashes in any added or changed string (decision 0014 §6). All strings through
`vscode.l10n.t()`.

| Where                                                           | Text                                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Engine row value, Keep selected                                 | `{0}, used by the existing instance` (`Docker` / `Podman`). Replaces `{0} · kept from the existing instance`.                                                                  |
| Engine row value, Keep selected, legacy                         | `Docker or Podman, not recorded by an earlier version`                                                                                                                         |
| Engine field hint, legacy record                                | `Earlier versions did not record the engine. They used Docker if it was installed, otherwise Podman.`                                                                          |
| Fresh radio, same engine (unchanged)                            | `Erase the existing data and start empty`                                                                                                                                      |
| Fresh radio, different engine                                   | `Start empty in {0} and leave the {1} data as it is`                                                                                                                           |
| Note under engine row, different engine                         | `Setup creates a new, empty instance in {0}. The existing container and data in {1} are not erased, and DocumentDB Local stops managing them.`                                 |
| Data notice, credentials not readable, not `CredentialsMissing` | `DocumentDB Local was set up on this machine before, and its saved credentials are unavailable, so its data cannot be kept. Setup starts fresh. Nothing has been changed yet.` |
| `CredentialsMissing` warning, different engine selected         | Replace the trailing `Starting fresh erases the existing instance and its data, then creates a new one.` with the different-engine note above.                                 |
| Tree action                                                     | `Start fresh…`                                                                                                                                                                 |

Run `npm run l10n` after the strings change.

## 4. Implementation

### P1. Service: setup picks the engine when starting fresh

`QuickStartService.ts`

1. `engineRequestFor(alias, setupPreference?, startFresh = false)`: when `setupPreference` is set and
   either `startFresh` or `isRemovedOwnerRecord(...)`, return
   `{ kind: 'preferred', preferred: setupPreference }`. Otherwise unchanged (lifecycle and
   reconciliation still pin the owner; Keep still pins it).
2. Thread `startFresh` through the three setup callers: `checkInstanceDockerReadiness`,
   `startDockerProvider`, and `provision` (`options?.startFresh`). Without this, the readiness
   check and the **Start Docker / Start Podman machine** buttons would target the old owner.
3. In `provision`, generalize the reservation branch at the lease step. Today it runs only for
   `!startFresh && preferred && isRemovedOwnerRecord`. New condition:

   ```ts
   const engineChanged =
       engineRequest.kind === 'preferred' && hasReadyRecord && recordAtGate?.engineCli !== resolved.cli;
   ```

   Covers the removed-owner case, a switched engine, and a legacy record (its `undefined` owner
   differs from any resolved CLI, so the engine is reserved before resources are created). The
   branch body is unchanged: write a `provisioning` lease with the new `engineCli`, keep
   `replacedRecord` for rollback, fail with `setupAlreadyInProgress` if the update loses the race.
   Same-engine Start fresh of a recorded owner keeps today's path.

4. Volume-wipe gate and removal need no change: they already act only through `engine` (the
   resolved, new engine), and `startFresh` already bypasses the refusal.
5. `getWizardContext` / `InstanceStatusUpdate`: replace `instanceEngine?: ContainerCli | 'notRecorded'`
   with `existingInstance?: { ownerEngine?: ContainerCli }`, present when a record exists (same
   predicate as today's non-`undefined` result). `ownerEngine` absent means legacy. Rename
   `getInstanceEngine` to `getExistingInstance` and update the router's status key in
   `onInstanceChanged`.
6. Add `hasExistingInstance(alias)` for the tree (true when `getExistingInstance` is defined).

> **Done (2026-11-17), commit `15359d174`:** implemented by `gpt-6.1-sol`, as recommended.
> Setup readiness, provider launch and provisioning honor Start fresh while lifecycle and Keep
> retain ownership. The context migration includes its router, webview and scenario consumers.
> Decisions: advised (`claude-opus-5.5`, 90%) to reserve only fresh/removed-owner switches,
> preserve credentials by skipping the old cleanup after reservation, and stream the existing
> `setupAlreadyInProgress` message when a reservation loses. Storage failures retain their
> truthful `unexpectedFailure` detail (advisor clarification, 92%); no tests were weakened.
> The existing no-resource, winner-record and secret assertions remain. Build passed; 1,315
> service/webview tests and 47 scenario tests passed. After the race-message correction,
> 209 durability/telemetry tests passed. Final combined validation is still pending.

### P2. Open the panel with Start fresh selected

1. `OpenLocalQuickStartOptions` gains `initialDataChoice?: 'fresh'`;
   `QuickStartActivationSource` gains `'treeStartFreshRow'`.
2. `openLocalQuickStart` passes it to `LocalQuickStartConfigurationType.initialDataChoice` and opens
   on `configure` when it is set (as it already does for `CredentialsMissing`).
3. The panel is a create-or-reveal singleton. When it is already open, the initial data is not
   re-applied. Accept this for now: the user lands on an open panel and can pick Start fresh there.
   Note it in the PR; do not add a push channel for it.

> **Done (2026-11-17), commit `b4f68c70b`:** implemented by `gpt-6.1-sol`, as recommended,
> with P3 because the same configuration and view tests cover the entry choice. Decisions:
> advised (`claude-opus-5.5`, 93%) to accept only the literal `fresh` option, open Configure,
> and retain the accepted reveal-only singleton behavior. Command tests cover forwarding,
> invalid input and an already-open panel; no destructive operation occurs on open.

### P3. Webview

`LocalQuickStart.tsx`

1. State: replace `instanceEngine` with `existingInstance`. Seed `dataChoice` from
   `configuration.initialDataChoice ?? 'reuse'`.
2. Seed `preferredEngine` from `existingInstance.ownerEngine ?? 'docker'` **once**, when it first
   arrives (ref guard), so later `onInstanceChanged` pushes do not overwrite the user's pick.
3. Derived values:

   ```ts
   const hasExistingInstance = existingInstance !== undefined;
   const forcedFresh = hasExistingInstance && !canReuseExistingData;   // was: state === CredentialsMissing
   const startFresh = forcedFresh || (canReuseExistingData && dataChoice === 'fresh');
   const engineLocked = hasExistingInstance && !startFresh;
   const engineChanged = startFresh && existingInstance?.ownerEngine !== undefined
       && preferredEngine !== existingInstance.ownerEngine;
   ```

   Check every current use of `forcedFresh`. It also covers the `CredentialsMissing` warning, so
   that path is unchanged in effect.

4. Engine row: one branch for the value (`engineLocked` shows the §3 owner text, otherwise the
   chosen engine) and `action`/`editor` present whenever `!engineLocked`. Drop the three-way
   `instanceEngine` ternaries. Add the legacy hint to the field and the different-engine note
   under it when `engineChanged`.
5. Data choice block: show the radio when `hasExistingInstance && canReuseExistingData`
   (unchanged condition except the record check); show the §3 "credentials unavailable" notice when
   `forcedFresh` and the guard is not already `credentialsMissing`. Fresh radio label follows §3.
6. `buildAdvancedOptions` already sends `preferredEngine` and `startFresh`. Pass `startFresh` to
   `getDockerStatus` and `startDockerProvider` too (router inputs gain `startFresh: z.boolean().optional()`).

> **Done (2026-11-17), commit `b4f68c70b`:** implemented by `gpt-6.1-sol`, as recommended.
> Keep locks the owner; fresh unlocks and seeds it once without overriding user edits.
> Unreadable records get the approved explanation, including legacy Error records; the
> no-record `CredentialsMissing` path remains forced fresh. All three readiness calls forward
> that choice. Decisions: advised (`claude-opus-5.5`, 93%) to keep the changed-engine explanation
> visible when its editor closes, suppress contradictory erase text, and return `undefined`
> rather than `false` for an absent failed-step footer note. The regression assertion for the
> empty info row was confirmed failing before that correction. Sixteen webview/command cases
> were added; 465 focused tests and 47 scenario tests passed. After the correction, all 112
> details tests and `npm run build` passed. Generated strings are in `be6107768`; no added or
> changed user-visible string contains an em dash.

### P4. Tree

`LocalQuickStartItem.ts`: in `createErrorRecoveryChildren`, when
`await QuickStartService.hasExistingInstance()` is true, add **Start fresh…** (icon `discard`)
before **Retry setup…**. It runs `localQuickStart.open` with
`{ activationSource: 'treeStartFreshRow', initialDataChoice: 'fresh' }` and erases nothing.
`getChildren` is already async. Do not add it to the `CredentialsMissing` row: **Review setup…**
already lands on the forced Start fresh.

> **Done (2026-11-17), commit `63b695e43`:** implemented by `gpt-6.1-terra`, as recommended.
> Error rows offer **Start fresh…** before Retry only for an existing record; its command only
> opens the panel. Decisions: advised (`claude-opus-5.5`, 88%) to preserve recovery rows and
> explicitly meter a failed existence lookup. Four new cases cover availability, arguments and
> lookup failure; all 60 tree tests passed. Localization will be generated after P3's strings.
> P2/P3 must land before shipping this entry point.

### P5. Telemetry

On `documentDB.quickstart.provision`, add `containerEngineChanged` (`true` / `false` / `legacy`,
from the P1 `engineChanged` computation and the record). `startFresh`, `preferredContainerEngine`
and `priorState` already exist. `activationSource=treeStartFreshRow` covers the tree entry. Follow
the telemetry skill; do not name the property with `error`.

> **Done (2026-11-17), commit `15359d174`:** implemented with P1 by `gpt-6.1-sol` because
> the same provision gate owns the classification (leader coordination decision, 99%).
> `containerEngineChanged` is a closed `true`/`false`/`legacy` classification and is omitted
> before the gate is reached. Advised (`claude-opus-5.5`, 90%); focused telemetry tests passed.

### P6. Tests

Replace, do not duplicate:

- `LocalQuickStart.details.test.tsx`: replace `locks the existing %s engine…` with
  - Keep locks the engine for `docker`, `podman` and legacy, with the §3 text;
  - Start fresh unlocks it, pre-selects the owner, and the different-engine label and note appear
    only after switching;
  - a legacy `existingInstance` with `canReuseExistingData: false` in `Error` (the §1 case) shows the notice and an editable engine, and Start sends `startFresh: true` with the
    chosen engine;
  - `initialDataChoice: 'fresh'` opens with Start fresh selected.
- `QuickStartService` tests:
  - `engineRequestFor` returns `preferred` for setup with `startFresh`, `pinned` without;
  - provision with a Docker owner, Start fresh and Podman preferred reserves Podman, never calls the
    Docker engine's remove operations, and on failure restores the Docker record and credentials;
  - legacy record with Start fresh and Podman preferred reserves Podman before pull.
- `LocalQuickStartItem.test.ts`: the error rows include **Start fresh…** only when an instance
  record exists, with the expected command arguments.

> **Done (2026-11-17), commits `15359d174`, `63b695e43`, `b4f68c70b`:** tests travel with the
> behavior they cover, as recorded in the implementation grouping. `15359d174` adds 19
> service/router/telemetry cases, including
> switched-engine failure/cancellation rollback, reserve-before-pull, legacy Keep, and readiness
> forwarding. `63b695e43` adds four tree cases; `b4f68c70b` adds 16 webview/command cases and
> the empty-footer regression assertion. The approved obsolete fresh-engine expectations
> were replaced; intent-bearing removal/order assertions remain. No `TDD:` contract was weakened.
> Combined verification passed 1,438 tests in 36 files. The final footer-only correction was
> then validated by the 112-test details suite and another successful build.

### P7. Docs

- `docs/user-manual/local-quick-start.md` §Container engine requirement: replace "Start fresh also
  recreates within that same engine; changing the preference never moves an existing instance to
  another engine" with the 0014 behavior, including that the old engine's data is left in place.
  Add **Start fresh…** next to the recovery actions it lists.
- Feature `README.md` summary and `design.md` engine note: "including Start fresh" becomes the 0014
  rule.
- Mark this plan implemented, with the PR, when done.

> **Done (2026-11-17), commit `22b290532`:** implemented by `gpt-6-luna`, as recommended.
> The user manual, current feature summary and design now distinguish Keep, same-engine fresh,
> different-engine fresh, legacy ownership, and the tree's reveal-only panel entry. The provision
> telemetry catalog includes `containerEngineChanged`. Decision: leader, 98%, documentation-only
> synchronization of accepted decision 0014; no new UX or design decision. Targeted searches
> found no obsolete current same-engine-all-fresh claims; scoped `git diff --check` passed.
> Plan status, inline done notes and the outcome below are leader-maintained records.

## 5. Verification

Case 1 while working: `npm run build` and the touched tests
(`npx vitest run src/webviews/documentdb/localQuickStart src/services/localQuickStart src/tree/connections-view/LocalQuickStart`).
Case 2 at ready-for-review, including `npm run l10n` (strings change).

Manual, on a machine with both engines:

1. Recreate the §1 state: legacy record (remove `engineCli` from the stored item), Docker stopped.
   Tree shows **Start fresh…**; it opens Configure with Start fresh and an editable engine; Podman
   setup succeeds; the tree then manages the Podman instance; the Docker container and volume are
   still present.
2. Recorded Docker instance with readable credentials: Keep shows Docker read-only; Start fresh with
   Docker erases and recreates; Start fresh with Podman leaves Docker untouched.
3. Cancel a switched-engine setup during pull: the Docker record and credentials are restored and the
   tree returns to the previous state.
4. Search the changed strings for `—` (none).

## 6. Risks

- **Orphaned data in the old engine** is intended (0014 §3), and the panel says so. A running old
  container holds its port; the port suggestion already skips busy ports.
- **Port check vs. the old container** when the user forces the same port: the existing `portInUse`
  error explains it.
- **Singleton panel** ignores `initialDataChoice` when already open (P2.3).

## Outcome

### Unverified workbench and real-engine checks

Run the three manual scenarios in §5 before pushing: the legacy/Docker-down recovery into Podman,
same-engine versus switched-engine recreation, and cancellation during switched-engine pull.
Check that the old engine's resources survive switching and that cancellation restores its record
and credentials. These are covered by mocked regression tests, not by an actual dual-engine run.
This shared environment was not used to mutate real containers, volumes or stored credentials.
The existing singleton limitation remains: an already-open panel is revealed without reapplying
the tree action's initial data choice.

### Verification and decisions

- **Case 1** applies: there is no PR and no ready-for-review request.
- `npm run l10n` passed (55.353s), explicitly required by this plan; generated changes committed
  separately as `be6107768`.
- `npm run build` passed (41.337s in the combined batch), and passed again after the final
  footer correction.
- `npx vitest run src/webviews/documentdb/localQuickStart src/services/localQuickStart src/tree/connections-view/LocalQuickStart src/commands/localQuickStart`:
  **36 files, 1,438 tests passed** (31.810s).
- `npx vitest run --config build/verification/browser/vitest.config.ts build/verification/browser/scenarios.test.ts`:
  **47 passed** on the G2 implementation. The later footer-only correction does not change scenarios.
- `npx vitest run src/webviews/documentdb/localQuickStart/LocalQuickStart.details.test.tsx`:
  **112 passed** on the final revision; the new empty-note assertion failed before the fix.
- Scoped and combined `git diff --check` passed. Added/changed UI strings were checked for em dashes.
- Full Case 2 checks, including `prettier-fix`, lint, `l10n:check`, `typecheck:tests`, the full
  runtime suite and packaging, were **not run**. Run them before a future review handoff.
- Four advisor contexts (`claude-opus-5.5`), eight consultations including follow-ups: planning/UX,
  G1 lifecycle, G3 tree and G2 UX. The leader followed their final verdicts. The G1 advisor's
  initial storage-error expectation was corrected after the worker identified the mismatch;
  storage errors were not misleadingly reclassified as reservation races.
- No operator questions were parked or escalated, no tier substitutions or authorization retries
  occurred, and no external systems were edited. The source plan was already committed at start.
  Review-driven rework consisted of the reservation-race terminal event and the empty footer row.

### Usage evidence

Window: **2026-11-17T09:18:59.515Z to 2026-11-17T09:52:06Z**, about **33m06s** wall-clock.
Snapshot from the host event log via `agent-stats.mjs --summary`, with explicit advisor/coding/checks
roles. Final source-recording work and the final response are excluded. Request times overlap:
the model rows sum to about **35m55s**, not wall-clock elapsed. The combined check batch took
**2m09s**; the final focused rerun/build is reported above, not added to a purported serial total.
No CI was run. AIU are not dollars; rounded totals may differ slightly.

| Model | Role | Requests | Model time | AIU | AIU share |
| --- | --- | ---: | ---: | ---: | ---: |
| claude-opus-5.5 | advisor | 103 | 13m20s | 469.8 | 63.6% |
| gpt-6-luna | coding | 14 | 2m38s | 2.6 | 0.4% |
| gpt-6-luna | checks | 6 | 26s | 0.4 | 0.1% |
| gpt-6.1-sol | leader | 49 | 7m50s | 100.5 | 13.6% |
| gpt-6.1-sol | coding | 57 | 10m13s | 152.0 | 20.6% |
| gpt-6.1-terra | coding | 11 | 1m28s | 12.9 | 1.8% |

| Role | Requests | Model time | AIU | AIU share |
| --- | ---: | ---: | ---: | ---: |
| leader | 49 | 7m50s | 100.5 | 13.6% |
| coding | 82 | 14m20s | 167.6 | 22.7% |
| advisor | 103 | 13m20s | 469.8 | 63.6% |
| checks | 6 | 26s | 0.4 | 0.1% |

**Totals:** leader **100.5 AIU**, subagents **637.7 AIU**, run **738.3 AIU**.

| Model | Role | Input | Output | Cache read | Cache write | Reasoning |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| claude-opus-5.5 | advisor | 7,750,988 | 76,770 | 7,415,086 | 335,680 | 46,730 |
| gpt-6-luna | coding | 863,008 | 16,681 | 783,411 | 79,555 | 11,928 |
| gpt-6-luna | checks | 105,969 | 1,538 | 87,203 | 18,748 | 1,075 |
| gpt-6.1-sol | leader | 4,544,483 | 25,795 | 4,422,407 | 121,929 | 6,133 |
| gpt-6.1-sol | coding | 5,511,268 | 40,330 | 5,275,545 | 235,552 | 14,162 |
| gpt-6.1-terra | coding | 565,549 | 4,868 | 501,526 | 63,990 | 806 |

Cache and reasoning fields may overlap input/output; they are not additive token totals.

Advisor work was the largest measured category (63.6%). A future run could bound the initial
planning read more tightly around an already-approved plan and send the reviewed call signatures
with decision packets, while retaining the operator-requested Opus UX and lifecycle reviews.
The models handled different work; these figures do not rank their quality.
