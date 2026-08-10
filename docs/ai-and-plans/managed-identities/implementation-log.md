# Managed Identity Support: Implementation Log

**Plan:** [`managed-identities.md`](./managed-identities.md)
**Decisions:** [`decisions.md`](./decisions.md)
**Evidence:** [`research-findings.md`](./research-findings.md)
**Branch:** `dev/tnaum/managed-identities`
**Baseline commit:** `77e905d9` (research findings only, no code)

---

## How to read this log

One section per work item, in the order the work was actually done, which is the order the plan's
phases prescribe. Each entry records:

- **What** was changed, at file granularity.
- **Commit** reference, so the diff can be found without archaeology.
- **Why**, citing the plan section or the decision that motivated it.
- **Notes / divergences**, whenever the implementation departed from the plan. Divergences are
  called out explicitly rather than folded into the "what", because a plan that quietly drifts is
  worse than no plan.

Work items that produced no commit of their own (because they were folded into a neighbouring
commit) say so and name the commit that carries them.

---

## Status overview

| Phase | Work items   | Status         |
| ----- | ------------ | -------------- |
| 1     | WI1 to WI6   | ✅ Done        |
| 2     | WI7 to WI13  | ✅ Done        |
| 3     | WI14, WI15   | ✅ Done        |
| 4     | WI16, WI17   | ✅ Done        |
| 5     | WI18 to WI20 | ⏳ In progress |
| 6     | WI22 to WI25 | ☐ Not started  |

Legend: ☐ not started, ⏳ in progress, ✅ done, ⛔ on hold, ➖ folded into another item.

---

## Phase 1: core authentication path

_Goal per the plan: a connection created from a pasted connection string can authenticate with a
managed identity. This alone closes the reported incident._

All six work items landed in a single commit, because they are not independently useful: the enum
value without the handler is dead code, and the handler without the factory case is unreachable. A
six-commit sequence would have produced five commits that do not build a working feature and one
that does.

**Commit:** `1e2a42a8` — _Add managed identity authentication method and handler_

### WI1 — `AuthMethodId.ManagedIdentity` ✅

**What.** Added `ManagedIdentity` to the `AuthMethodId` enum and a `ManagedIdentityAuthMethod`
`AuthMethodInfo` record, registered in `authMethodsArray` between the interactive Entra ID entry and
`NoAuth`, in [src/documentdb/auth/AuthMethod.ts](src/documentdb/auth/AuthMethod.ts).

**Why.** Plan §1. The label and detail copy are taken verbatim from the plan; the `detail` line
("Use when VS Code is running on an Azure VM that has a managed identity assigned") is doing real
work here, because it carries the discovery hint that the IMDS probe was originally meant to provide
(see [D3](./decisions.md#d3-azure-environment-detection-open), currently leaning "no probe"). The
platform wording is scoped to Azure VMs per [D0](./decisions.md#d0-supported-platforms-azure-vms-only).

**Notes.** The enum doc comment now states explicitly that this value has no ARM
`authConfig.allowedModes` counterpart and must never arrive by pass-through of service metadata. The
plan flags this as a naming caveat; putting it in the source is cheaper than expecting a future
reader to find the plan.

No existing behaviour changes from the array insertion:
`createAuthMethodQuickPickItems` already shows every method in the manual/editing scenario and
annotates unsupported ones with "Cluster support unknown", exactly as it does for interactive Entra
ID. Verified by the existing `AuthMethod` tests, which still pass unmodified.

### WI2 — Shared Entra token resource and scope constants ✅

**What.** New [src/documentdb/auth/entraScopes.ts](src/documentdb/auth/entraScopes.ts) exporting
`DOCUMENTDB_TOKEN_RESOURCE` (`https://ossrdbms-aad.database.windows.net`) and `DOCUMENTDB_ENTRA_SCOPE`
(the same value with `/.default`). Both existing literal occurrences now import it:
[MicrosoftEntraIDAuthHandler.ts](src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts) and
[playgroundWorker.ts](src/documentdb/playground/playgroundWorker.ts).

**Why.** Plan §3 and WI2. This work adds a fourth consumer, and §5.1 needs the resource form (without
`/.default`) for the copied connection string, so the two forms need to be derived from one another
rather than typed out again.

**Notes.** The constants file deliberately has no `vscode` import, so the worker thread can consume
it; `playgroundWorker.ts` already imports from `../auth/` for `getOidcAllowedHosts`, so this adds no
new coupling.

Per [D6.1](./decisions.md#d61-token-expiry-and-caching-out-of-scope-dedicated-issue), the existing
handler's `expiresInSeconds: 0` was **not** touched. The only change to that file is the constant
substitution.

### WI3 — `ManagedIdentityAuthConfig` ✅

**What.** Added the interface to [src/documentdb/auth/AuthConfig.ts](src/documentdb/auth/AuthConfig.ts)
and extended the `AuthConfig` union.

**Why.** Plan §2.

**Notes.** The doc comment states the rule the plan calls out as important: an empty `{}` is
meaningful and selects the system-assigned identity, so persisting `undefined` in its place would
make the method un-inferable after a reload. That rule is enforced downstream in WI12 and WI13, but
it is stated at the type so the constraint travels with it.

### WI4 — `ManagedIdentityAuthHandler` ✅

**What.** New [src/documentdb/auth/ManagedIdentityAuthHandler.ts](src/documentdb/auth/ManagedIdentityAuthHandler.ts),
structurally parallel to the interactive Entra ID handler, plus the `expiresInSecondsFromTimestamp`
helper. Unit tests in `ManagedIdentityAuthHandler.test.ts`.

**Why.** Plan §3 and §4; engine choice per [D1](./decisions.md#d1-token-acquisition-mechanism).

**Notes and divergences.**

- `@azure/identity` is loaded through `await import()` inside `configureAuth()`, per plan risk #1, so
  MSAL stays off the activation path.
- The handler strips `authMechanism`, `authMechanismProperties`, `tls`, and the credentials from the
  connection string, and there is an explicit test asserting that. This is plan risk #2: leaving a
  competing `ENVIRONMENT:azure` in the URL risks the driver preferring the URL form and taking its
  own instance-metadata path, which is precisely the mechanism [D1](./decisions.md#d1-token-acquisition-mechanism)
  rejects.
- **Divergence (small):** `expiresInSecondsFromTimestamp` subtracts a 300 second safety margin rather
  than returning the raw remainder. The plan's signature is "seconds until expiry, floored at zero".
  Handing the driver a token that expires while a request is in flight is a failure mode with no
  upside, and a five minute margin is the conventional value. The floor-at-zero behaviour is
  preserved and tested. Confidence that this is the right call: high; it is also trivially
  reversible by changing one constant.
- **Divergence (signature):** the helper takes an optional `now` parameter so the tests are not
  time-dependent. Defaulted, so callers are unaffected.

### WI5 — Factory registration ✅

**What.** Added the `AuthMethodId.ManagedIdentity` case to the switch in
`ClustersClient.initClient()`.

**Why.** Plan §3. Without it the method resolves to the `default` branch and throws "Unsupported
authentication method".

### WI6 — Error translation ✅

**What.** New [src/documentdb/auth/managedIdentityErrors.ts](src/documentdb/auth/managedIdentityErrors.ts)
exporting `describeManagedIdentityError()` and `classifyManagedIdentityError()`. Unit tests in
`managedIdentityErrors.test.ts`.

**Why.** Plan §10, scoped by [D6.2](./decisions.md#d62-error-mapping-simplified-to-plain-language-translation):
plain-language translation only, no commands, no deep links, no branching remediation UI. The four
mapped conditions and their wording are taken from the plan's table.

**Notes and divergences.**

- **Divergence (addition):** the plan specifies one exported function. A second export,
  `classifyManagedIdentityError()`, returns the coarse reason as a `ManagedIdentityFailureReason`
  union. This exists because §12 requires a `managedIdentityFailureReason` telemetry property with
  exactly those four values, and deriving it by pattern-matching the localized message string would
  break the moment anyone translates the extension. Splitting classification from wording keeps
  telemetry language-independent. Low risk, clearly within the plan's intent.
- Matching is defensive on both error `name` and message substring, and walks the `cause` chain up to
  four levels, because `@azure/identity` 4.13 delegates to `@azure/msal-node` and the informative
  message is typically wrapped one or two levels down. There is always a pass-through fallback, so an
  unrecognized error degrades to a prefixed message rather than a misleading one.
- The substrings are currently **educated guesses**, exactly as plan risk #5 anticipates. WI14 (the
  fake identity-endpoint harness) is scheduled specifically to capture the real shapes and feed them
  back here. Until that lands, treat the `multipleIdentities` and `identityNotAssigned` branches as
  provisional.

### Carried forward from WI11 (partial)

`CachedClusterCredentials.managedIdentityConfig`, a `CredentialCache.getManagedIdentityConfig()`
accessor, and a seventh positional parameter on `setAuthCredentials()` landed in this commit rather
than in WI11, because the handler cannot compile without the field. The rest of WI11 (storage
secrets, ephemeral credentials, wizard context) remains open.

The seventh positional parameter is knowingly past the point of readability; the plan accepts this
(risk #8) and tracks an options-object refactor as separate follow-up work.

---

## Phase 2: connection creation and persistence

### WI7, WI8, WI9 — Connection string round-trip ✅

**Commit:** `e4c6c36b` — _Read and write the driver-native managed identity connection string_

Grouped into one commit on purpose. [D1a](./decisions.md#d1a-copy-connection-string-for-a-managed-identity-connection)
and the [D1](./decisions.md#d1-token-acquisition-mechanism) normalisation rule are a symmetric pair,
and plan risk #9 is precisely that they drift apart. Landing them together with a single round-trip
test makes that drift a test failure rather than a support ticket.

#### WI7 — `detectManagedIdentityHint()` and normalisation

**What.** New [src/documentdb/auth/managedIdentityConnectionString.ts](src/documentdb/auth/managedIdentityConnectionString.ts)
with `detectManagedIdentityHint()`, `stripManagedIdentityMarkers()`, `managedIdentityConfigFromHint()`,
and the `MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES` constant. Wired into
[PromptConnectionStringStep.ts](src/commands/newConnection/PromptConnectionStringStep.ts). Tests in
`managedIdentityConnectionString.test.ts`.

**Why.** Plan §5.2. The detection table (explicit / weak / none) is implemented as written.

**Notes and divergences.**

- The hint is computed **before** the unconditional username clearing, which the plan calls "the
  single easiest thing to get wrong in this work item". The call site carries a comment saying why
  the ordering matters, because the next person to tidy up that function will otherwise move it.
- When a hint is found, `nativeAuthConfig` is explicitly **not** populated from the username. A
  GUID in the username position of an OIDC string is an identity selector, not a database user, and
  storing it as one would produce a connection that silently reads as native auth.
- **Divergence (behaviour, deliberate):** the plan's §5.2 normalisation step 1 says "set
  `selectedAuthMethod = AuthMethodId.ManagedIdentity`" without qualification, but the same table's
  `weak` row says the user should "still see the prompt so the user can confirm or switch to
  interactive Entra ID". Those two cannot both be true, because
  `PromptAuthMethodStep.shouldPrompt()` returns `!context.selectedAuthenticationMethod`: setting the
  method **is** the thing that skips the prompt.

  Resolved as: **explicit** hint preselects the method and settles the identity; **weak** hint
  prefills `managedIdentityAuthConfig` but leaves the method unset, so the auth-method quick pick
  still runs. This is the only reading under which the `weak` row's stated intent ("switch to
  interactive Entra ID") is reachable, and it matches the manual checklist, which expects the method
  to be preselected only for the verbatim documented Learn string. Confidence: high.

- To let the identity step (WI10) distinguish the two cases, the hint itself is carried on the
  wizard context as `managedIdentityHint`, rather than adding a separate boolean.
- The client ID is pushed to `context.valuesToMask`, and only the hint **confidence** goes to
  telemetry, per the plan's conventions item 3.

#### WI8 — `Copy Connection String`

**What.** `buildParsedConnectionString()` in
[copyConnectionString.ts](src/commands/copyConnectionString/copyConnectionString.ts) now has a
`ManagedIdentity` branch that sets `authMechanism=MONGODB-OIDC`, sets `authMechanismProperties` to
`ENVIRONMENT:azure,TOKEN_RESOURCE:<resource>`, and puts the client ID in the username position.
Telemetry gains `copiedAuthMechanism: 'managedIdentity'`.

**Why.** Plan §5.1, decision [D1a](./decisions.md#d1a-copy-connection-string-for-a-managed-identity-connection).
As the plan notes, this is a correctness fix as much as a feature: without it a managed-identity
connection fell through and produced a string with no OIDC mechanism and an empty username, which
reads as native auth.

**Notes.**

- No change was needed to suppress the password prompt: `canIncludeNativePassword()` already returns
  false for any non-native method. Asserted by test T-13 rather than assumed.
- Four new tests: user-assigned output, system-assigned output, and two round-trip tests (T-15,
  T-16) that feed the clipboard content straight back through `detectManagedIdentityHint()`. T-16
  specifically pins the `{}` versus `undefined` distinction for the system-assigned case.

#### WI9 — Availability for vCore hosts

**What.** `PromptConnectionStringStep` now pushes `AuthMethodId.ManagedIdentity` alongside
`MicrosoftEntraID` when the host has the vCore domain suffix.

**Why.** Plan §6. On the wire the two methods are the same mechanism and differ only in token
source, so anywhere one is offered the other should be too.

#### WI11 (partial) — Context and ephemeral credential plumbing

`managedIdentityAuthConfig` was added to `NewConnectionWizardContext`, `AuthenticateWizardContext`,
`UpdateCredentialsWizardContext`, and `EphemeralClusterCredentials`. Each declaration repeats the
"`{}` means system-assigned" note, because that is the invariant most likely to be broken by someone
writing `?? undefined`.

Still open in WI11: `ConnectionSecrets` in the storage service.

### WI10, WI11, WI12, WI13 — Identity selection and persistence ✅

**Commit:** `dc991856` — _Select, persist and restore the managed identity of a connection_

Grouped because they form one testable behaviour: a connection is not usable until the identity can
be chosen, saved, and read back. WI12 in particular cannot be verified without WI13, since the bug it
fixes only appears on the reload path.

#### WI10 — `SelectManagedIdentityStep` and the recently-used store

**What.** New [SelectManagedIdentityStep.ts](src/documentdb/wizards/authenticate/SelectManagedIdentityStep.ts)
and [recentManagedIdentities.ts](src/documentdb/auth/recentManagedIdentities.ts), with tests.
Registered in three places: the New Connection sub-wizard
([PromptConnectionModeStep.ts](src/commands/newConnection/PromptConnectionModeStep.ts)), the Update
Credentials wizard, and the connections-view authenticate wizard in
[DocumentDBClusterItem.ts](src/tree/connections-view/DocumentDBClusterItem.ts).

**Why.** Plan §7, decision [D2](./decisions.md#d2-how-the-user-selects-the-identity). The list shape
follows `SelectAtlasDatabaseUserStep`: manual entry first with an `edit` icon, known values below
under `QuickPickItemKind.Separator` headings.

Source of the known rows is D2's option 1, **system-assigned plus recently used**, as the plan
proposes. ARM enumeration of user-assigned identities and enumeration of the identities actually
assigned to this VM remain phase 2, and the second still depends on
[D3](./decisions.md#d3-azure-environment-detection-open).

**Notes and divergences.**

- **Divergence (shape):** the step is generic over its context
  (`SelectManagedIdentityStep<T extends ManagedIdentitySelectionContext>`) and takes a predicate for
  "is managed identity selected". The plan describes one class in the authenticate wizard plus a
  sibling in the New Connection wizard. Two classes would have been near-identical, and the reason
  they cannot share a context is trivial: `AuthenticateWizardContext` calls the field
  `selectedAuthMethod` while the other two call it `selectedAuthenticationMethod`. A one-line
  predicate at each call site is cheaper than a duplicated step, and it serves all three wizards
  rather than two. Confidence: high.
- **Divergence (addition):** a fourth group, **From the connection string**, appears above
  "Recently used" when a `weak` hint supplied a client ID. Without it, a value the user just pasted
  would be invisible in a list whose whole purpose is to avoid retyping it. It is de-duplicated
  against the recent list.
- `managedIdentityHint` was added to `AuthenticateWizardContext` as well, so the step's `shouldPrompt`
  contract is the same in every wizard.
- The recently-used list is capped at five, de-duplicated case-insensitively, and validated on read
  with a type guard, since `globalState` content is untrusted input after a downgrade or manual edit.
  It lives in `globalState` and not `SecretStorage` because a client ID is a tenant-scoped
  identifier, not a credential.
- Tests cover the invariants the plan asks for: manual entry is always first, separators appear only
  for non-empty groups, the list is never empty, plus `shouldPrompt` for explicit versus weak hints
  and the GUID validation.

#### WI11 (completed) — Storage secrets

**What.** `managedIdentityAuthConfig` added to `ConnectionSecrets` and `StoredItem.secrets`, with
read and write paths in [connectionStorageService.ts](src/services/connectionStorageService.ts).

**Why.** Plan §8.

**Notes and divergences.**

- **Divergence (storage encoding):** secrets are persisted as a flat `string[]`, which cannot express
  "present but empty". A new slot `SecretIndex.ManagedIdentityClientId = 5` therefore holds either the
  client ID or the sentinel `'system-assigned'`. An absent slot means the connection does not use
  managed identity at all.

  The alternative, inferring the empty config from `properties.selectedAuthMethod`, was rejected:
  it would make the secrets reader depend on the properties reader, and a sentinel that can never
  collide with a GUID costs one constant. Two slots (a marker plus a value) were also considered and
  rejected as more storage for no additional information. Confidence: high; contract tests pin all
  three cases.

#### WI12 — Inference ladder

**What.** `CredentialCache.setFromConnectionItem()` now honours a persisted `selectedAuthMethod` for
**every** known method rather than only `NoAuth`, falling through to inference only when the field is
absent or unrecognized. `managedIdentityConfig` is cleared for explicit `NoAuth`, matching the
existing defense-in-depth rule.

**Why.** Plan §8. This is the subtle one: adding a rung to the old ladder would not have worked,
because a managed-identity connection discovered through ARM legitimately carries an
`entraIdAuthConfig` (tenant and subscription), so the Entra rung would win and the connection would
silently become an interactive Entra ID connection after a reload.

**Notes.** The plan flags this as a behaviour change for existing connections (risk #4), so it comes
with a dedicated regression block asserting that stored Native, Entra ID and NoAuth connections still
resolve identically, that records with no persisted method still fall back to inference, and that an
**unrecognized** method string falls through to inference rather than being trusted.

#### WI13 — Persistence

**What.** [newConnection/ExecuteStep.ts](src/commands/newConnection/ExecuteStep.ts) persists
`managedIdentityAuthConfig` behind a `usesManagedIdentity` gate that mirrors the existing native and
Entra gates, defaulting to `{}` rather than `undefined`.
[updateCredentials/ExecuteStep.ts](src/commands/updateCredentials/ExecuteStep.ts) gains a
`ManagedIdentity` branch and clears the config in every other branch, so switching methods cannot
leave it behind. The same is done on the connections-view save path.

**Why.** Plan §8 and the review precedent recorded in
[755-no-auth-support/review-2026-06-23.md](docs/ai-and-plans/PRs/755-no-auth-support/review-2026-06-23.md),
which is the same class of bug: a config for one method surviving a switch to another.

**Notes.** `rememberManagedIdentity()` is called after a successful save, keyed by the connection
label, so the "Recently used" group is populated from what the user actually did rather than from
anything they had to configure ([D5](./decisions.md#d5-no-vs-code-settings-for-managed-identity):
no settings).

---

## Phase 3: validation harness

_WI15 is being delivered incrementally alongside the work items it covers, rather than as one late
commit. The round-trip test (plan risk #9) landed with WI7 and WI8 in `e4c6c36b`; handler and error
tests landed with phase 1 in `1e2a42a8`; the credential-cache regression block landed with WI12 in
`dc991856`._

### WI14 — Fake identity-endpoint harness ✅

**Commits:** `bd1c6f4d` — _Add a fake identity-endpoint harness and correct the error mapping_,
`95b0d197` — lint fixup.

**What.** New [managedIdentityEndpoint.harness.test.ts](src/documentdb/auth/managedIdentityEndpoint.harness.test.ts),
which points `IDENTITY_ENDPOINT` and `IDENTITY_HEADER` at a local `http.Server` and drives the real
`ManagedIdentityCredential`. Six cases: system-assigned success, user-assigned success, expiry
propagation, and the three failure shapes.

**Why.** Plan Phase 3 and risk #5. WI6 was written against guessed error strings and could not be
reviewed honestly until someone had seen the real ones.

**What it found.** All three guesses in WI6 were wrong in ways that mattered:

| Guess                                                                                                              | Reality                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failures arrive as a mix of `CredentialUnavailableError` and `AuthenticationError`, so the name is a useful signal | **Every** failure arrives as `CredentialUnavailableError`, whatever the cause. The old `'unavailable'` and `'credentialunavailable'` matches would have classified the multiple-identity incident as "no endpoint" if the ordering had ever changed. Both are gone. |
| The MSAL error code is on the thrown error                                                                         | It is on the `cause` (`ServerError`), together with an `errorMessage` field the collector did not read. Both are now read at every level of the chain.                                                                                                              |
| `'please specify'` and `'was not found'` are safe discriminators                                                   | Far too broad. Removed in favour of the observed phrases.                                                                                                                                                                                                           |

Two further corrections came out of it:

- **Errors are not always `instanceof Error`.** Under Jest the thrown value did not satisfy
  `instanceof Error`, which silenced the whole classifier. The collector is now duck-typed on
  `name`, `message`, `errorCode`, `errorMessage` and `cause`. This is not a test-only concern: the
  same thing happens to an error crossing a worker boundary, which is exactly what
  [§9](./managed-identities.md) does for the Playground and Shell.
- **The `other` fallback message now prefers `message` alone** rather than the flattened matching
  text, which repeated the error name and the entire cause chain at the user.

The observed messages are recorded verbatim as constants in `managedIdentityErrors.test.ts`, so an
`@azure/identity` upgrade that changes the wording fails in CI rather than in front of a user.

**Notes and divergences.**

- **Divergence (test design):** the plan's case 5 is "endpoint unreachable (env vars unset, and no
  IMDS in the test environment)". That assumption is false on some developer machines: the machine
  this was written on is an Azure-hosted Cloud PC whose instance metadata service answers in 45ms
  with `Identity not found`. Unsetting the environment therefore produces a **different**
  classification depending on where the test runs. The harness instead points `IDENTITY_ENDPOINT` at
  a closed port, which forces a transport failure deterministically everywhere. Confidence: high;
  the alternative is a test that is green on CI and red on an Azure workstation.
- Each test calls `jest.resetModules()` first. MSAL selects and caches its managed identity source
  from the environment at import time, so without it the later tests keep talking to the earlier
  tests' now-closed servers. Diagnosing that took longer than writing the harness.
- Timeouts are 30 seconds. The unreachable case takes about 5.7 seconds because of MSAL's internal
  retries, which is over Jest's 5 second default.

---

## Phase 4: Azure Resources and Discovery views

### WI16, WI17 — Availability and plumbing outside the Connections view ✅

**Commit:** `6f287d9a` — _Offer managed identity in the Azure Resources and Discovery views_

#### WI16 — Synthesizing the method from ARM metadata

**What.** `extractCredentialsFromCluster()` in
[clusterHelpers.ts](src/plugins/service-azure-mongo-vcore/utils/clusterHelpers.ts) now pushes
`AuthMethodId.ManagedIdentity` whenever the cluster's `allowedModes` include `MicrosoftEntraID`. New
test file `clusterHelpers.test.ts`.

**Why.** Plan §6. Managed identity is Entra ID on the wire and has no ARM `allowedModes` value of its
own, so it can only ever arrive by an explicit rule. The naming caveat in plan §1 exists precisely to
stop a future reader from assuming it comes through `allowedModes.filter(isSupportedAuthMethod)`.

**Notes.** The plan asks that the `receivedAuthMethods` and `unknownAuthMethods` telemetry keep
reporting the **raw** `allowedModes`. That is now a test rather than a comment: the third case
asserts the counts and strings are unchanged by the synthesized entry, so someone moving the push a
few lines earlier breaks a test instead of quietly skewing service-side numbers.

#### WI17 — Threading the config through the connect paths

**What.** `managedIdentityAuthConfig` is now carried through:

- [VCoreResourceItem.ts](src/tree/azure-resources-view/documentdb/VCoreResourceItem.ts) and
  [DocumentDBResourceItem.ts](src/plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem.ts)
  `authenticateAndConnect()`, including the seventh argument to `setAuthCredentials()` and a
  managed-identity line in the output channel;
- both of their `promptForCredentials()` wizards, which gained `SelectManagedIdentityStep`;
- [AzureExecuteStep.ts](src/plugins/service-azure-mongo-vcore/discovery-wizard/AzureExecuteStep.ts)
  and [addConnectionFromRegistry.ts](src/commands/addConnectionFromRegistry/addConnectionFromRegistry.ts),
  so a connection saved from Discovery keeps its identity.

**Why.** Plan §6 and §7: the method must work from all three entry points.

**Notes and divergences.**

- **Divergence (scope):** the plan lists only the two resource items. `AzureExecuteStep` and
  `addConnectionFromRegistry` were added because they are the path by which a discovered cluster
  becomes a **saved** connection. Without them the identity would be chosen, used once, and then
  silently dropped on save, which is the same class of bug WI13 fixes elsewhere. Confidence: high.
- As in the Connections view, the config defaults to `{}` rather than `undefined` when the selected
  method is managed identity, so the system-assigned case survives.
- `KubernetesResourceItem` was deliberately left alone: managed identity is only offered for Azure
  vCore hosts, so it can never appear in that item's `availableAuthMethods`.

---

## Deviations from the plan

Recorded here in one place as well as in the individual entries, so a reviewer can see the whole
set at a glance.

| Where               | Divergence                                                                                                  | Rationale                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --- | ---- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| WI4                 | `expiresInSecondsFromTimestamp` subtracts a 300 second safety margin instead of returning the raw remainder | Avoids handing the driver a token that expires in flight. Floor-at-zero preserved. Reversible by changing one constant.               |
| WI4                 | Helper takes an optional `now` argument                                                                     | Makes the unit tests deterministic. Defaulted, so callers are unaffected.                                                             |
| WI6                 | Second export `classifyManagedIdentityError()` alongside `describeManagedIdentityError()`                   | §12 telemetry needs the reason code; deriving it from a localized message string would break under translation.                       |
| WI1 to WI6 (commit) | All of phase 1 in one commit rather than six                                                                | The intermediate states do not build a working feature; five of the six commits would be dead code.                                   |
| WI7                 | A `weak` hint does **not** preselect the auth method; only an `explicit` hint does                          | The plan's own `weak` row requires the user to be able to switch to interactive Entra ID, which is impossible once the method is set. |
| WI7                 | The hint object is carried on the wizard context as `managedIdentityHint`, not just the config              | WI10 needs to know explicit versus weak in order to decide whether to skip the identity step.                                         |
| WI7                 | A GUID username under a managed identity hint is never stored as `nativeAuthConfig`                         | It is an identity selector, not a database user; storing it as one produces a connection that reads as native auth.                   |     | WI10 | One generic step with a predicate, instead of two near-identical step classes                          | The contexts differ only in the name of the selected-method field. Serves three wizards rather than two.                         |
| WI10                | Extra "From the connection string" group in the quick pick                                                  | A client ID the user just pasted would otherwise be invisible in a list whose purpose is to avoid retyping it.                        |
| WI11                | Storage uses one secret slot with a `'system-assigned'` sentinel                                            | The `string[]` secrets format cannot express "present but empty", and a sentinel can never collide with a GUID.                       |     | WI14 | The unreachable case points at a closed port instead of unsetting the environment variables            | Some developer machines, including Azure Cloud PCs, do answer on 169.254.169.254, which made the planned version host dependent. |
| WI6 (revised)       | Error text collection is duck-typed instead of using `instanceof Error`                                     | The thrown value is not always a real `Error`, under Jest and across worker boundaries, which silenced the classifier entirely.       |     | WI17 | Also threaded through `AzureExecuteStep` and `addConnectionFromRegistry`, which the plan does not list | They are how a discovered cluster becomes a saved connection; without them the chosen identity is dropped on save.               |

---

## Deferred and follow-up

Items the plan explicitly pushes past this PR, tracked so they are not lost:

- **WI21** (`azureEnvironmentProbe.ts`): on hold, blocked on [D3](./decisions.md#d3-azure-environment-detection-open), currently expected to be dropped.
- **WI26**: file the [D4](./decisions.md#d4-scope-managed-identity-only-not-a-general-default-credential-mode) issue after this work lands.
- **WI27**: file the [D6.1](./decisions.md#d61-token-expiry-and-caching-out-of-scope-dedicated-issue) token-expiry issue after this work lands.
- **WI28**: Microsoft Learn documentation correction.
