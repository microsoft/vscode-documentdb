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

> **Approved, not implemented.** Implements [decision 0014](../decisions.md). An existing instance
> can always be started fresh, and starting fresh is how the user changes its container engine.
> Keeping the data keeps the engine locked, as before.

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

### P2. Open the panel with Start fresh selected

1. `OpenLocalQuickStartOptions` gains `initialDataChoice?: 'fresh'`;
   `QuickStartActivationSource` gains `'treeStartFreshRow'`.
2. `openLocalQuickStart` passes it to `LocalQuickStartConfigurationType.initialDataChoice` and opens
   on `configure` when it is set (as it already does for `CredentialsMissing`).
3. The panel is a create-or-reveal singleton. When it is already open, the initial data is not
   re-applied. Accept this for now: the user lands on an open panel and can pick Start fresh there.
   Note it in the PR; do not add a push channel for it.

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

### P4. Tree

`LocalQuickStartItem.ts`: in `createErrorRecoveryChildren`, when
`await QuickStartService.hasExistingInstance()` is true, add **Start fresh…** (icon `discard`)
before **Retry setup…**. It runs `localQuickStart.open` with
`{ activationSource: 'treeStartFreshRow', initialDataChoice: 'fresh' }` and erases nothing.
`getChildren` is already async. Do not add it to the `CredentialsMissing` row: **Review setup…**
already lands on the forced Start fresh.

### P5. Telemetry

On `documentDB.quickstart.provision`, add `containerEngineChanged` (`true` / `false` / `legacy`,
from the P1 `engineChanged` computation and the record). `startFresh`, `preferredContainerEngine`
and `priorState` already exist. `activationSource=treeStartFreshRow` covers the tree entry. Follow
the telemetry skill; do not name the property with `error`.

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

### P7. Docs

- `docs/user-manual/local-quick-start.md` §Container engine requirement: replace "Start fresh also
  recreates within that same engine; changing the preference never moves an existing instance to
  another engine" with the 0014 behavior, including that the old engine's data is left in place.
  Add **Start fresh…** next to the recovery actions it lists.
- Feature `README.md` summary and `design.md` engine note: "including Start fresh" becomes the 0014
  rule.
- Mark this plan implemented, with the PR, when done.

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
