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
| 2     | WI7 to WI13  | ⏳ In progress |
| 3     | WI14, WI15   | ⏳ In progress |
| 4     | WI16, WI17   | ☐ Not started  |
| 5     | WI18 to WI20 | ☐ Not started  |
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

---

## Phase 3: validation harness

_WI15 is being delivered incrementally alongside the work items it covers, rather than as one late
commit. The round-trip test (plan risk #9) landed with WI7 and WI8 in `e4c6c36b`; handler and error
tests landed with phase 1 in `1e2a42a8`._

<!-- Entries are appended below as work items complete. -->

---

## Deviations from the plan

Recorded here in one place as well as in the individual entries, so a reviewer can see the whole
set at a glance.

| Where               | Divergence                                                                                                  | Rationale                                                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| WI4                 | `expiresInSecondsFromTimestamp` subtracts a 300 second safety margin instead of returning the raw remainder | Avoids handing the driver a token that expires in flight. Floor-at-zero preserved. Reversible by changing one constant.               |
| WI4                 | Helper takes an optional `now` argument                                                                     | Makes the unit tests deterministic. Defaulted, so callers are unaffected.                                                             |
| WI6                 | Second export `classifyManagedIdentityError()` alongside `describeManagedIdentityError()`                   | §12 telemetry needs the reason code; deriving it from a localized message string would break under translation.                       |
| WI1 to WI6 (commit) | All of phase 1 in one commit rather than six                                                                | The intermediate states do not build a working feature; five of the six commits would be dead code.                                   |
| WI7                 | A `weak` hint does **not** preselect the auth method; only an `explicit` hint does                          | The plan's own `weak` row requires the user to be able to switch to interactive Entra ID, which is impossible once the method is set. |
| WI7                 | The hint object is carried on the wizard context as `managedIdentityHint`, not just the config              | WI10 needs to know explicit versus weak in order to decide whether to skip the identity step.                                         |
| WI7                 | A GUID username under a managed identity hint is never stored as `nativeAuthConfig`                         | It is an identity selector, not a database user; storing it as one produces a connection that reads as native auth.                   |

---

## Deferred and follow-up

Items the plan explicitly pushes past this PR, tracked so they are not lost:

- **WI21** (`azureEnvironmentProbe.ts`): on hold, blocked on [D3](./decisions.md#d3-azure-environment-detection-open), currently expected to be dropped.
- **WI26**: file the [D4](./decisions.md#d4-scope-managed-identity-only-not-a-general-default-credential-mode) issue after this work lands.
- **WI27**: file the [D6.1](./decisions.md#d61-token-expiry-and-caching-out-of-scope-dedicated-issue) token-expiry issue after this work lands.
- **WI28**: Microsoft Learn documentation correction.
