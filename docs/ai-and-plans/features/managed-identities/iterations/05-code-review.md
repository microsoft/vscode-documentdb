---
feature: managed-identities
kind: review
status: active
prs: [886]
---

# PR #886 second code review: Add managed identity authentication

**PR:** [microsoft/vscode-documentdb#886](https://github.com/microsoft/vscode-documentdb/pull/886)
**Head:** `dev/tnaum/managed-identities` @ `43d63832` → **Base:** `main`
**Diff vs `origin/main`:** 80 files, +8348 / −214
**Reviewed:** 2026-09-16
**Reviewer:** agent-assisted code review

This is an independent second pass, taken after the findings of
[02-code-review.md](02-code-review.md) (F1–F8, C1–C3) were resolved and after the base branch moved
from `release/0.10.0` to `main`. It does not repeat those findings. Where a resolved finding was
applied unevenly, that is called out (R7).

---

## Verification performed

| Check                                                    | Result                                               |
| -------------------------------------------------------- | ---------------------------------------------------- |
| `npm run build`                                          | **Pass** — no TypeScript errors, no bundler warnings |
| `npm run lint`                                           | **Pass** — 0 errors, 0 warnings                      |
| `npx jest --no-coverage` (auth, newConnection, services) | **Pass** — 42 suites, 607 tests                      |
| `npx prettier --check "src/**/*.ts"`                     | **Fail** — 7 files (see R3)                          |
| l10n bundle completeness for new strings                 | **Fail** — 5 strings missing (see R2)                |

---

## Verdict

**Approve with changes.** The core is sound: token acquisition is correctly confined to the main
thread, `clusterId` is used consistently for cache keys, the system-assigned identity is modelled as
a meaningful empty config rather than `undefined`, duplicate detection was genuinely reworked rather
than patched, and the new test surface is real.

Two items must be handled before merge: the preview **version string in `package.json`** (R1) and
the **stale l10n bundle** (R2), which currently leaves the feature's primary new UI untranslatable.
One correctness item, R4, writes managed identity state onto connections that do not use managed
identity and should be fixed before this ships. Everything else is quality-of-implementation.

| ID  | Finding                                                                      | Severity |
| --- | ---------------------------------------------------------------------------- | -------- |
| R1  | `package.json` carries the preview version `0.10.2-managed-identity`         | Blocker  |
| R2  | l10n bundle is stale — 5 new identity-picker strings are missing             | Medium   |
| R3  | 7 source files fail `prettier --check`, one with visibly broken indentation  | Medium   |
| R4  | Managed identity config is written to non-managed-identity Azure connections | Medium   |
| R5  | Entra-only clusters lost their single-method auto-select                     | Medium   |
| R6  | Identity picker is wired into Atlas and Kubernetes cluster items             | Low      |
| R7  | Worker JWT decode still uses `base64` and has no expiry safety margin        | Low      |
| R8  | Nested "different authentication method" pick has no step name or back route | Low      |
| R9  | Entra handler strips `authMechanism` but not `authMechanismProperties`       | Low      |
| R10 | CHANGELOG does not mention the headline feature                              | Low      |
| R11 | Token-failure telemetry fires once per OIDC callback invocation              | Low      |
| R12 | Adjacent pre-existing: save-credentials path drops `entraIdAuthConfig`       | Low      |

---

## R1 — `package.json` carries the preview version — Blocker

**Where:** [package.json](../../../../../package.json), `package-lock.json`

```diff
-  "version": "0.10.2",
+  "version": "0.10.2-managed-identity",
```

The feature README documents this as a deliberate side-load marker, and that is reasonable for a
branch build. It is not mergeable into `main`: it would ship a Marketplace version that sorts
unpredictably against `0.10.2` and `0.10.3`, and `npm run package` would produce a VSIX that is not
a valid release candidate.

### Options

| Approach                                                                          | Pros                                                                                                 | Cons                                                                        |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **A. Revert to `0.10.2` in a final commit before ready-for-review** (recommended) | Smallest change; keeps the preview marker useful for the whole validation window; one obvious commit | Easy to forget — needs to be on the merge checklist                         |
| B. Bump to the real next version (e.g. `0.11.0`) now                              | Leaves the branch permanently mergeable                                                              | Pre-empts the release decision; collides with any other PR that bumps first |
| C. Move the marker out of `package.json` into a build-time flag                   | Preview builds stay distinguishable without ever touching the released manifest                      | New build machinery for a one-off need                                      |

**Recommendation:** A, recorded explicitly in the PR description so it is not lost.

**Decision:** Revert to `0.10.2` in the final commit before the PR is ready for review.

**Resolution (commit `d311d312`):** Restored `0.10.2` in `package.json` and both root version
fields in `package-lock.json`. Updated the active feature README so the preview marker is historical
validation context rather than current branch guidance. This follows approach A; the real-version
bump and build-time marker alternatives were not taken because they either pre-empt release planning
or add one-off build machinery.

---

## R2 — l10n bundle is stale — Medium

**Where:** [l10n/bundle.l10n.json](../../../../../l10n/bundle.l10n.json),
[SelectEntraTokenSourceStep.ts](../../../../../src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.ts)

These strings are called through `l10n.t()` but have no entry in the bundle:

- `Sign in with my account`
- `Use the identity assigned to this machine`
- `Use a different managed identity...`
- `Choose a different authentication method...`
- `Back to authentication method selection`

That is every label in the new identity quick pick — the single most visible surface this PR adds.
Other new strings (`Managed Identity (Azure hosted)`, the tenant-mismatch message, the client-ID
prompt) are present, so the bundle was regenerated at some point and then drifted as the Entra-flow
rework (iteration 04) renamed the items.

**Severity rationale:** No functional impact in English — `l10n.t()` falls back to the literal. In
every other locale the picker silently stays English while the surrounding wizard is translated.

### Options

| Approach                                                                  | Pros                                                        | Cons                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| **A. Run `npm run l10n` and commit the regenerated bundle** (recommended) | Exactly the documented Case 2 step; removes the whole class | None                                                      |
| B. Hand-add the five keys                                                 | Minimal diff                                                | Bypasses the generator; the next drift is invisible again |
| C. Add a CI check that fails when `npm run l10n` produces a diff          | Prevents recurrence permanently                             | Out of scope for this PR; worth a follow-up issue         |

**Recommendation:** A now, C as a follow-up. The bundle drifting mid-PR after a UI rework is exactly
the failure mode C catches.

**Decision:** A, resolved by the final PR check set: `npm run l10n` regenerates and verifies the
bundle. Do not create a separate CI follow-up.

**Resolution (commit `4e6458f9`):** Ran `npm run l10n`, which added all five picker labels to the
generated bundle, then verified it with `npm run l10n:check`. No deviation: the bundle was not
hand-edited, and the rejected CI follow-up was not created.

---

## R3 — Formatting not applied — Medium

**Where:** 7 files fail `npx prettier --check "src/**/*.ts"`:

- [src/documentdb/auth/AuthMethod.ts](../../../../../src/documentdb/auth/AuthMethod.ts)
- [src/documentdb/auth/managedIdentityConnectionString.ts](../../../../../src/documentdb/auth/managedIdentityConnectionString.ts)
- [src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.ts](../../../../../src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.ts)
- `src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.test.ts`
- [src/commands/newConnection/PromptTenantStep.ts](../../../../../src/commands/newConnection/PromptTenantStep.ts)
- `src/commands/newConnection/PromptTenantStep.test.ts`
- [src/commands/updateCredentials/PromptTenantStep.ts](../../../../../src/commands/updateCredentials/PromptTenantStep.ts)

Not purely cosmetic: in `createAuthMethodQuickPickItems` the `iconPath` line sits at a different
indentation level from its siblings, which reads like a merge artifact rather than a choice:

```ts
    return methodsToShow.map((method) => ({
        label: method.label,
        detail: method.detail,
        authMethod: method.id,
                iconPath: getAuthMethodIconPath(method),
        alwaysShow: true,
```

`npm run lint` passes, so nothing here is caught today — the formatting gate is Prettier only.

**Recommendation:** Run `npm run prettier-fix`. No alternatives worth weighing.

**Decision:** Resolve this through the final PR check set, which runs `npm run prettier-fix`.

**Resolution (commits `697260a1`, `2d9eb623`):** Applied Prettier to every source file reported by
the current `npx prettier --check "src/**/*.ts"` run and verified the same check passes. The current
set was 13 files rather than the review-time seven because newly added regression tests and helpers
also needed formatting. The dedicated source commit used a targeted Prettier write to avoid mixing
the uncommitted review record into that work item; the full repository formatter then produced the
second, documentation-only formatting commit.

---

## R4 — Managed identity config written to connections that do not use it — Medium

**Where:**
[clusterHelpers.ts](../../../../../src/plugins/service-azure-mongo-vcore/utils/clusterHelpers.ts),
[addConnectionFromRegistry.ts](../../../../../src/commands/addConnectionFromRegistry/addConnectionFromRegistry.ts),
[connectionStorageService.ts](../../../../../src/services/connectionStorageService.ts),
[CredentialCache.ts](../../../../../src/documentdb/CredentialCache.ts)

`extractCredentialsFromCluster` populates a managed identity config for **every** Entra-capable
Azure vCore cluster, before any identity has been chosen:

```ts
if (credentials.availableAuthMethods.includes(AuthMethodId.MicrosoftEntraID)) {
    credentials.availableAuthMethods.push(AuthMethodId.ManagedIdentity);
    credentials.entraIdAuthConfig = { tenantId, subscriptionId };
    credentials.managedIdentityAuthConfig = { tenantId };   // unconditional
}
```

Seeding the tenant here is the correct fix for F1. The problem is what consumes it.

Every other write path gates on the selected method. `newConnection/ExecuteStep` does
(`usesManagedIdentity ? … : undefined`), `updateCredentials/ExecuteStep` does, `VCoreResourceItem`
and `DocumentDBResourceItem` do. **`addConnectionFromRegistry` does not**:

```ts
secrets: {
    connectionString: parsedCS.toString(),
    nativeAuthConfig: credentials.nativeAuthConfig,
    entraIdAuthConfig: credentials.entraIdAuthConfig,
    managedIdentityAuthConfig: credentials.managedIdentityAuthConfig,   // ungated
},
```

`VCoreResourceItem.getCredentials()` returns `extractCredentialsFromCluster(...)` verbatim and never
runs the authenticate wizard, so on this path `credentials.selectedAuthMethod` is `undefined` and
`managedIdentityAuthConfig` is `{ tenantId }`. Consequences:

1. **Storage writes a managed identity marker onto a non-managed-identity connection.**
   `connectionInputToStorageItem` maps `managedIdentityAuthConfig` with no client ID to
   `secretsArray[SecretIndex.ManagedIdentityClientId] = 'system-assigned'`. Any Azure cluster saved
   through _Add Connection_ now claims, in secret storage, to use the system-assigned identity.
2. **The record is internally contradictory** — it carries both an Entra config and a managed
   identity config while `selectedAuthMethod` is empty. This is the same class of problem the
   no-auth review called out for stale `entraIdAuthConfig`.
3. **The inference ladder resolves it the wrong way.** `CredentialCache.setFromConnectionItem`
   checks `managedIdentityAuthConfig` _before_ `entraIdAuthConfig`, so such a record infers
   `ManagedIdentity`. This is **currently dormant** — `setFromConnectionItem` has no production
   callers left, only tests — which is why this is Medium and not High. It is a public method and
   the trap is live the moment someone calls it.

Duplicate detection is unaffected: `getConnectionAuthIdentity` prefers the explicit method and, when
absent, `inferAuthMethod` checks `nativeAuthConfig.connectionUser` first, which an Azure cluster with
an administrator will have.

### Options

| Approach                                                                                                                                                                     | Pros                                                                                                                    | Cons                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **A. Gate the write in `addConnectionFromRegistry`, matching the other four execute paths** (recommended)                                                                    | One-line, consistent with the established rule, keeps the tenant seed available to the wizard, no storage-format change | The rule now lives in five places — easy for the sixth writer to miss                                                   |
| B. Centralise the rule in one `buildAuthSecrets(selectedAuthMethod, configs)` helper and call it from all writers                                                            | Makes it structurally impossible to persist a config that contradicts the method; retires five copies of the same `?:`  | Touches four working call sites; larger diff late in the PR                                                             |
| C. Stop seeding `managedIdentityAuthConfig` in `extractCredentialsFromCluster`; carry the tenant only on the Entra config and copy it across when managed identity is chosen | Nothing to gate — the ambiguous value never exists                                                                      | Re-opens F1: the selector would have to reach into the Entra config, which decision D8 deliberately avoided             |
| D. Reorder the `setFromConnectionItem` ladder to check Entra before managed identity                                                                                         | Removes the misclassification without touching writers                                                                  | Treats the symptom; the contradictory record still gets written, and the ladder is a fallback for legacy records anyway |

**Recommendation:** A for this PR, B as a follow-up if a sixth writer appears. Add a regression test
asserting that an Azure discovery connection saved with Entra ID has no
`managedIdentityAuthConfig` in its stored secrets.

**Decision:** A. Gate the write in `addConnectionFromRegistry` and add the regression test.

**Resolution (commit `09149f99`):** Gated `managedIdentityAuthConfig` on an explicit
`ManagedIdentity` selection in `addConnectionFromRegistry` and added a command-level regression test
proving an Entra connection does not persist the seeded managed identity config. No deviation;
centralizing all writers was considered too broad for this fix, matching the review's rationale.

---

## R5 — Entra-only clusters lost their single-method auto-select — Medium

**Where:**
[ChooseAuthMethodStep.ts](../../../../../src/documentdb/wizards/authenticate/ChooseAuthMethodStep.ts),
[clusterHelpers.ts](../../../../../src/plugins/service-azure-mongo-vcore/utils/clusterHelpers.ts)

`ChooseAuthMethodStep` auto-selects when exactly one method is available:

```ts
if (availableMethods.length === 1) { context.selectedAuthMethod = availableMethods[0]; return; }
```

Synthesizing `ManagedIdentity` alongside `MicrosoftEntraID` takes an Entra-only cluster from one
available method to two, so that shortcut no longer fires. Those users now see a family picker that
lists **Username and Password** and **No Authentication** annotated "Cluster support unknown" — for
a cluster whose ARM `allowedModes` explicitly says neither is permitted — before reaching the
identity picker they actually need.

The extra decision point is not wrong in itself (an identity choice genuinely has to be made), but
it is presented at the wrong level: the question asked is "which family?", and for these clusters
there is only one answer.

### Options

| Approach                                                                                                                                                       | Pros                                                                                                       | Cons                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **A. Auto-select when all available methods collapse to one _family_** (recommended) — map `availableMethods` through the family array before the length check | Restores the old behaviour exactly where it applied; the identity picker still runs, so nothing is skipped | Needs a small family-mapping helper in `AuthMethod.ts`                                         |
| B. Leave as is                                                                                                                                                 | Zero work; the identity step is reachable either way                                                       | A visible regression for the most Azure-native configuration, plus two misleading entries      |
| C. Hide methods marked "Cluster support unknown" when `allowedModes` was actually reported                                                                     | Fixes the misleading entries for every cluster, not just Entra-only ones                                   | Behaviour change well beyond this PR; removes a deliberate escape hatch for stale ARM metadata |

**Recommendation:** A. It is contained, and it is what the pre-PR behaviour promised.

**Decision:** A. Also remove all `Cluster support unknown` annotations: they are confusing and do
not help users make an authentication choice.

**Resolution (commit `de0fc152`):** Added an authentication-family mapping that collapses managed
identity into the Microsoft Entra ID family, used it to restore single-family auto-selection, and
removed the support-unknown descriptions from auth quick picks. Added focused model and wizard tests.
No deviation; hiding unsupported methods globally was not used because it would remove the deliberate
manual escape hatch.

---

## R6 — Identity picker wired into Atlas and Kubernetes cluster items — Low

**Where:**
[AtlasClusterItem.ts](../../../../../src/plugins/service-atlas-mongodb/discovery-tree/AtlasClusterItem.ts),
[KubernetesResourceItem.ts](../../../../../src/plugins/service-kubernetes/discovery-tree/documentdb/KubernetesResourceItem.ts)

`SelectEntraTokenSourceStep` was added to both. Its `shouldPrompt` returns `true` whenever the
selected method is Entra ID and no connection-string facts are present — which is always the case on
these paths. `ChooseAuthMethodStep` already offers Microsoft Entra ID for every cluster (marked
"Cluster support unknown"), so a user who picks it against an Atlas cluster is now offered
_"Use the identity assigned to this machine"_, which cannot ever authenticate to Atlas.

Before this PR the same user reached a username prompt. Now they reach a plausible-looking dead end
whose failure surfaces from the driver, not from us.

Adding the step keeps the wizards uniform, and uniformity has real value. The question is whether
uniformity is worth offering an option that is known not to apply.

### Options

| Approach                                                                                     | Pros                                                                                         | Cons                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **A. Gate `shouldPrompt` on managed identity being in `availableAuthMethods`** (recommended) | Azure paths are unchanged; Atlas and Kubernetes keep their previous flow; no call-site churn | `availableAuthMethods` is a `string[]` on `AuthenticateWizardContext` and needs mapping     |
| B. Remove the step from the Atlas and Kubernetes wizards                                     | Most explicit                                                                                | Re-diverges the four wizards; the next wizard author has to know which list to copy         |
| C. Leave as is and rely on R9-style error translation to explain the failure                 | No code change                                                                               | Turns a preventable wrong turn into an error message; contradicts the feature's own premise |

**Recommendation:** A. It is the same "is this offered here?" check `ChooseAuthMethodStep` already
performs, applied one level down.

**Decision:** A. Gate the identity picker on `ManagedIdentity` being available.

**Resolution (commit `cb646654`):** Updated `SelectEntraTokenSourceStep.shouldPrompt` to map either
wizard availability field and require `ManagedIdentity` before showing identity-source choices. Added
a regression test for an Entra selection on a cluster that does not advertise managed identity. No
call sites were removed, preserving the uniform wizard composition selected by approach A.

---

## R7 — Worker JWT decode not aligned with the C1 fix — Low

**Where:** [playgroundWorker.ts](../../../../../src/documentdb/playground/playgroundWorker.ts),
[ManagedIdentityAuthHandler.ts](../../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts)

Finding C1 from the previous review changed JWT payload decoding to `base64url`. That was applied to
`managedIdentityTenant.ts` only. The worker's OIDC callback still does:

```ts
const decoded = JSON.parse(Buffer.from(payload, 'base64').toString()) as { exp?: number };
```

Node's base64 decoder accepts the URL-safe alphabet, so the practical impact is the same as it was
for C1 — none. The reason C1 was accepted was self-documentation and removal of a hidden reliance;
that reasoning applies identically here.

A second, more substantive divergence: the main-thread handler subtracts a 300-second safety margin
via `expiresInSecondsFromTimestamp`, while the worker returns `exp − now` with no margin. The
playground and interactive shell can therefore hand the driver a token with a few seconds of life,
where the direct connection path would have refreshed.

### Options

| Approach                                                                                                    | Pros                                                                 | Cons                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **A. Export `expiresInSecondsFromTimestamp` and use it in the worker; switch to `base64url`** (recommended) | One expiry policy for every surface; deletes duplicated JWT parsing  | The worker bundle picks up one more import from the auth folder                                    |
| B. Send `expiresOnTimestamp` over IPC in `tokenResponse` and drop worker-side JWT parsing entirely          | The worker stops parsing tokens at all; the value comes from the SDK | `workerTypes` change; the interactive-Entra branch has no such timestamp and would need a fallback |
| C. Change only the encoding spelling                                                                        | Minimal                                                              | Leaves the margin divergence, which is the part with behaviour                                     |

**Recommendation:** A. B is cleaner in principle but the Entra branch has no equivalent timestamp,
so it would need its own fallback anyway.

**Decision:** A. Share `expiresInSecondsFromTimestamp` with the worker and use `base64url` decoding.

**Resolution (commit `50b77e3d`):** Switched worker JWT decoding to `base64url` and routed the `exp`
claim through `expiresInSecondsFromTimestamp`, giving playground and shell sessions the same
300-second safety margin as direct connections. Minor implementation note: the helper was already
exported, so no export change was necessary. Sending SDK timestamps over IPC was not adopted because
interactive Entra tokens still require a parsing fallback.

---

## R8 — Nested authentication-method pick has no step name or back route — Low

**Where:**
[SelectEntraTokenSourceStep.ts](../../../../../src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.ts)

`selectDifferentAuthMethod` opens a second quick pick from inside `prompt()`, without `stepName`:

```ts
const selected = await context.ui.showQuickPick(authMethodItems, {
    placeHolder: l10n.t('Select an authentication method'),
    ...
});
```

Escape there raises `UserCancelledError` and abandons the whole wizard rather than returning to the
identity picker the user opened it from. Missing `stepName` also means the choice is absent from
wizard step tracking.

The deliberate `GoBackError` route (`choice === 'back'`) is well guarded — it is only shown when
`authenticationMethodPrompted` is true, so `AzureWizard.goBack()` always finds a prompted step and
can never fall through to a silent cancel. That part is correct; this is about the other exit.

### Options

| Approach                                                                                    | Pros                                               | Cons                                                                                                      |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **A. Add `stepName`, and add an explicit "Back" item to the nested list** (recommended)     | Keeps the nested pick, makes both exits deliberate | One more item in a short list                                                                             |
| B. Convert the choice into a real `GoBackError` to the family step instead of a nested pick | No nesting at all; the framework owns navigation   | Only works when the family step actually prompted — the connection-string path is exactly when it did not |
| C. Leave as is                                                                              | No work                                            | Escape silently discards a partly completed wizard                                                        |

**Recommendation:** A.

**Decision:** A with one change: add `stepName`, but do not add a second explicit `Back` quick-pick
item. Rely on the wizard's built-in back affordance, which displays a small back arrow.

**Resolution (commit `36c2db2b`):** Added `stepName: 'selectDifferentAuthMethod'` to the nested
picker and asserted it in the existing navigation test. This follows the amended decision: no extra
Back row was added, so the built-in wizard back affordance remains the only nested-picker back route.

---

## R9 — Entra handler leaves `authMechanismProperties` in the URL — Low

**Where:**
[MicrosoftEntraIDAuthHandler.ts](../../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts)

`ManagedIdentityAuthHandler` correctly removes both markers before handing the string to the driver:

```ts
dbConnectionString.searchParams.delete('authMechanism');
dbConnectionString.searchParams.delete('authMechanismProperties');
```

`MicrosoftEntraIDAuthHandler` deletes only `authMechanism`, then sets its own
`authMechanismProperties` with an `OIDC_CALLBACK`. A stored string that still carries
`ENVIRONMENT:azure` therefore reaches the driver with both an environment and a callback — the exact
conflict decision D1 exists to prevent.

The new paste path cannot produce this: `PromptConnectionStringStep` calls
`stripManagedIdentityMarkers` whenever OIDC and `ENVIRONMENT:azure` appear together. The exposure is
strings saved by a pre-PR build, or hand-edited in place — narrow, but this PR is what makes the
`ENVIRONMENT:azure` form something users are actively told to write down, so the population that can
hold such a string is about to grow.

### Options

| Approach                                                                                           | Pros                                                   | Cons                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **A. Delete `authMechanismProperties` in the Entra handler too** (recommended)                     | One line; makes the two OIDC handlers symmetric        | None identified                                                                       |
| B. Factor both handlers onto a shared `stripOidcMarkers(cs)` used by `stripManagedIdentityMarkers` | Single definition of "inputs to a decision, not state" | Small refactor across three files                                                     |
| C. Do nothing — rely on paste-time stripping                                                       | No change                                              | Leaves a failure mode with no diagnostic, on the exact string form the new docs teach |

**Recommendation:** A, or B if the shared helper is written anyway.

**Decision:** A. Track broader OIDC option handling in [#927](https://github.com/microsoft/vscode-documentdb/issues/927), an exploratory driver investigation covering other OIDC authentication methods and whether normalization can move out of the extension. It references the user-raised OIDC host-allowlist report [#639](https://github.com/microsoft/vscode-documentdb/issues/639).

**Resolution (commit `c32ef34d`):** Deleted `authMechanismProperties` alongside `authMechanism` in
the interactive Entra handler and added a regression test using a legacy `ENVIRONMENT:azure`
connection string. No deviation; broader normalization remains in #927 rather than being folded into
this PR.

---

## R10 — CHANGELOG omits the headline feature — Low

**Where:** [CHANGELOG.md](../../../../../CHANGELOG.md)

The `Unreleased` section records only the auth-method persistence improvement. Managed identity
authentication itself — the reason for the PR — is not mentioned.

**Recommendation:** Add a `Features` entry under `Unreleased` naming managed identity support and
linking the user guide. No alternatives worth weighing; see the `writing-release-notes` skill for
wording.

**Decision:** No separate issue. The changelog is normally updated during release preparation.

**Resolution:** Intentionally deferred with no implementation commit. This follows the recorded
decision: release preparation owns the changelog entry, and creating a separate issue or adding an
unversioned headline entry here would move that release-owned work into this PR.

---

## R11 — Token-failure telemetry fires per callback invocation — Low

**Where:**
[managedIdentityTelemetry.ts](../../../../../src/documentdb/auth/managedIdentityTelemetry.ts)

`reportManagedIdentityTokenFailure` is called from inside the driver's `OIDC_CALLBACK`. The driver
may invoke that callback more than once per connection attempt, and `ClustersClient` may itself
retry, so one user-visible failure can emit several `connect.managedIdentityToken` events. Rate
analysis on `managedIdentityFailureReason` will over-count the retry-prone reasons
(`endpointUnreachable`) relative to the terminal ones (`multipleIdentities`).

### Options

| Approach                                                                                            | Pros                                                                                             | Cons                                                            |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| **A. Add a correlation ID to the event so duplicates can be collapsed at query time** (recommended) | Keeps every observation; matches the correlation pattern already used elsewhere in the extension | Dashboards must remember to deduplicate                         |
| B. Deduplicate in-process per `(clientId, reason)` within a short window                            | Emits one event per user-visible failure                                                         | Hides genuine repeat failures; needs state and a window to tune |
| C. Leave as is and document the multiplier                                                          | No code change                                                                                   | The multiplier is not constant, so it cannot be corrected for   |

**Recommendation:** A. See the `telemetry-instrumentation` skill for the correlation-ID pattern.

**Decision:** A. Add a correlation ID so the duplicate callback observations can be collapsed in
queries.

**Resolution (commit `8ab03e76`):** Added `managedIdentityTokenCorrelationId` to failure telemetry
and generated one stable ID per direct handler, playground worker session, or shell session. Provider
and tenant-mismatch failures share that ID, and tests verify callback retries reuse it. No deviation;
in-process deduplication was rejected because it would hide observations rather than make them
queryable as one attempt.

---

## R12 — Adjacent pre-existing: save-credentials drops `entraIdAuthConfig` — Low

**Where:**
[DocumentDBClusterItem.ts](../../../../../src/tree/connections-view/DocumentDBClusterItem.ts)

The `wizardContext.saveCredentials` branch rebuilds `connection.secrets` wholesale:

```ts
connection.secrets = {
    connectionString: connectionString.toString(),
    nativeAuthConfig: /* … */,
    managedIdentityAuthConfig: managedIdentityAuthConfig,
};
```

`entraIdAuthConfig` is not carried over, so re-authenticating a saved Entra ID connection with
"save credentials" loses its stored `tenantId` and `subscriptionId`.

This predates the PR — the only added line is `managedIdentityAuthConfig`. It is raised because the
PR edits this exact object literal, and because the managed identity path was explicitly hardened
against the same mistake (empty config preserved rather than collapsed). Worth fixing here while the
block is already being touched, or splitting into its own PR if the reviewer prefers a clean diff.

### Options

| Approach                                                                    | Pros                                                   | Cons                                                                      |
| --------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| **A. Preserve `entraIdAuthConfig` when the method is Entra ID, in this PR** | The block is already open; two lines and one test      | Widens an already large PR                                                |
| B. File a separate bug and fix it independently                             | Keeps this PR's scope honest                           | The next reader of this block sees a half-handled pattern                 |
| C. Spread the existing secrets and override only what changed               | Structurally prevents the whole class of dropped field | Conflicts with the deliberate clearing the no-auth work added; needs care |

**Recommendation:** A or B, operator's call. Not C without revisiting the no-auth clearing rules.

**Decision:** A. Preserve `entraIdAuthConfig` when the selected method is Entra ID, with a regression
test.

**Resolution (commit `d607683a`):** Preserved `entraIdAuthConfig` only for the Entra method in the
save-credentials path and retained the existing clearing behavior for every other method. A narrow
`buildSavedConnectionSecrets` helper and two tests were used because this class had no existing unit
harness; constructing a full tree-item/connection mock would have added substantially broader test
machinery. Spreading old secrets was not used because it could reintroduce stale auth state.

---

## What was checked and found correct

Recorded so a later reviewer does not re-derive it:

- **Token acquisition is main-thread only.** Workers request tokens over IPC; `@azure/identity` is
  dynamically imported and stays off the activation path. One `ManagedIdentityCredential` per client
  ID, so the credential's own cache is actually useful.
- **`clusterId` vs `treeId`.** Every cache and client lookup on the new paths uses
  `cluster.clusterId`. No `this.id` misuse found.
- **System-assigned identity as `{}`.** Consistently distinguished from `undefined` across the
  wizard, the cache, storage (`'system-assigned'` sentinel in an append-only slot), and duplicate
  detection.
- **Duplicate detection.** `getConnectionAuthIdentity` correctly replaces the username-only
  comparison; two user-assigned identities on one host no longer collide, and the Entra tenant is a
  real discriminator. Test coverage is thorough.
- **Credential hygiene.** Client IDs are pushed to `valuesToMask`; telemetry emits only
  `managedIdentityKind` and a classified reason, never the client ID; no token or connection string
  is logged.
- **Storage compatibility.** Version stays `3.0` with additive trailing slots, per the F8 resolution,
  and `SecretIndex` now documents the append-only invariant beside the enum.
- **Connection-string round trip.** Copy emits the documented `ENVIRONMENT:azure,TOKEN_RESOURCE:…`
  form with the client ID in the username position; paste reads it back as facts rather than a
  confidence verdict and strips the markers before storage.
