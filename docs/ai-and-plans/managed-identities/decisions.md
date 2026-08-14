# Managed Identity Support: Decisions

**Status:** Confirmed by the maintainer on 2026-08-10, except **D3**, which is open
**Date:** 2026-08-10

These decisions were first proposed autonomously and marked provisional. The maintainer has now
reviewed them; this file records the confirmed position, what changed from the proposal, and the
reasoning. Rejected alternatives are kept so that reversing any one of them is a small, well-scoped
edit to `managed-identities.md` rather than a redesign.

| ID  | Status                       | Changed from the proposal?                                              |
| --- | ---------------------------- | ----------------------------------------------------------------------- |
| D0  | **Confirmed**                | New. Supported-platform claims narrowed to Azure VMs                    |
| D1  | **Confirmed as proposed**    | Option C. Unchanged, plus an explicit normalisation rule                |
| D1a | **Confirmed**                | New. `Copy Connection String` behaviour, round-trips with D1            |
| D2  | **Confirmed, shape changed** | Now follows the Atlas database-user quick pick pattern                  |
| D3  | **OPEN**                     | Maintainer sees no benefit in the probe; under discussion               |
| D4  | **Confirmed, deferred**      | Issue filed **after** this work lands, so progress can inform its scope |
| D5  | **Confirmed**                | Unchanged                                                               |
| D6  | **Confirmed, rescoped**      | D6.1 out of scope, D6.2 simplified, D6.3 retargeted to `docs/`          |
| D7  | **Confirmed**                | Unchanged, not contested                                                |
| D8  | **Confirmed**                | Keep additive managed identity fields in storage v3.0                   |

---

## D0. Supported platforms: Azure VMs only

**Decision:** Design for, document, and test **Azure VMs only**. Do not advertise App Service,
Container Apps, Azure Arc, AKS workload identity, or Cloud Shell.

### Reasoning

We can only validate on hardware we actually have, and there is no appetite for standing up test
environments on other Azure hosting platforms for this iteration. A claim we cannot test is a
support ticket we cannot answer.

The engine chosen in D1 (`ManagedIdentityCredential`) happens to work on those other hosts, and we
are not going out of our way to break that. The decision is about **what we claim and test**, not
about artificially restricting the code path. If a user succeeds on App Service, good; it is simply
not a scenario we assert, document, or regression-test.

### Consequences

- **Azure VM is the only platform named as an example.** Where a string or a page needs to name a
  host, it names Azure VM and no other platform. It does **not** state that Azure VM is a
  requirement, because that is not true of the mechanism: `ManagedIdentityCredential` reaches the
  identity endpoint the same way on every Azure host, and we never detect which one we are on
  ([D3](#d3-azure-environment-detection-open) removed the probe). A string that asserted "requires an
  Azure VM" would be claiming knowledge we do not have.
- Documentation, the user manual, and the manual validation checklist keep the **hard** Azure VM
  scoping: that is what we test and what we support.
- Adding a platform later is a documentation and test change, not a code change.

> **Correction, 2026-08-10.** This section originally read "Every user-facing string, doc page, and
> error message names **Azure VM** and nothing else." That phrasing was intended to mean "drop the
> other platform examples, keep Azure VM", but it was read during implementation as "assert Azure VM
> as a requirement", and three strings were written that way. The wording above is the corrected
> intent. See the [implementation log](./implementation-log.md) for the strings that changed.

---

## D1. Token acquisition mechanism

**Decision: option C.** `@azure/identity`'s `ManagedIdentityCredential` is the **only engine**. A
pasted connection string in the driver-native
`authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:...` form is **accepted on input and
normalised into our own `ManagedIdentityAuthConfig`**.

The critical word is _normalised_. Accepting form B does **not** mean handing form B to the driver.
On paste we read the intent out of the string, translate it into our configuration, and then throw
the string form away. From that moment the connection is indistinguishable from one created through
the wizard: same config shape, same handler, same errors, same storage. There is exactly **one**
runtime path.

### Options considered

| Option                                       | Verdict    |
| -------------------------------------------- | ---------- |
| A. `@azure/identity` only                    | Rejected   |
| B. Driver-native `ENVIRONMENT: 'azure'` only | Rejected   |
| C. A as the engine, B accepted on input      | **Chosen** |

### Reasoning

Option B as a runtime mechanism is hardcoded to `http://169.254.169.254` and surfaces failures as an
opaque `MongoAzureError` carrying an HTTP status code, which is precisely the wrong error experience
for the multi-identity case that triggered this work. So it cannot be the engine.

Option A gives typed errors, `clientId` selectors, a real `expiresOnTimestamp`, and it matches the
structure of our existing `MicrosoftEntraIDAuthHandler` almost exactly. `@azure/identity` is already
a declared dependency (`~4.13.0`) and currently unused, so this costs no new dependency, only bundle
weight, mitigated by a dynamic import.

Option A **alone**, however, means we emit a connection string (see D1a) that we cannot read back.
Copy from one VS Code window, paste into another, and the connection silently stops being a managed
identity connection. That is a bad property to ship deliberately.

Option C removes that asymmetry for the price of one parser branch, and it makes the connection
string printed in Microsoft Learn work when pasted, which is the single most likely way a user
arrives at this feature.

### The normalisation rule

On paste, when the string carries `authMechanism=MONGODB-OIDC` **and** an `ENVIRONMENT:azure` entry
in `authMechanismProperties`:

1. Select `AuthMethodId.ManagedIdentity`.
2. Take the username, if present and GUID-shaped, as the user-assigned `clientId`. Absent username
   means system-assigned.
3. Discard `authMechanism`, `authMechanismProperties`, and the username **from the stored connection
   string**. They are inputs to a decision, not state.
4. Store the result as `ManagedIdentityAuthConfig`, exactly as the wizard would have.

A username that is present but not GUID-shaped is not silently dropped: keep the method selection,
leave the client ID empty, and let the identity step ask. Guessing here would be worse than asking.

### Consequences

- Bundle grows by the `@azure/identity` and MSAL chunk unless lazily imported. **Must** be a dynamic
  `await import()`.
- We own the retry and error-mapping story rather than delegating it to the driver.
- `PromptConnectionStringStep.prompt()` today clears the username unconditionally before any
  inspection, so normalisation must run **before** that credential-stripping block.
- Copy and paste round-trip, both within our extension and to and from mongosh (D1a).
- If we later add service principal or workload identity, the same credential library covers them.

### How to reverse

Swap the body of `ManagedIdentityAuthHandler.configureAuth()` to emit
`{ ENVIRONMENT: 'azure', TOKEN_RESOURCE: ... }` and put the client ID back in the username. The
method, storage, wizard, and telemetry work is unaffected.

---

## D1a. Copy Connection String for a managed-identity connection

**Decision:** Emit the **driver-native, documented form**, with no password prompt.

Together with D1's normalisation rule this is a **symmetric pair**: what we write, we can read. The
same string works in mongosh and application drivers on that VM, and pasting it back into our own
New Connection flow reproduces the connection.

The extension already contributes `Copy Connection String`
(`src/commands/copyConnectionString/copyConnectionString.ts`), and today
`buildParsedConnectionString()` handles exactly two cases: it sets the username from
`nativeAuthConfig` and sets `authMechanism=MONGODB-OIDC` when the method is `MicrosoftEntraID`. A
managed-identity connection would currently fall through and produce a string that is silently wrong:
no OIDC mechanism and an empty username, so it reads as native auth. Fixing that is part of this
work, not an optional extra.

### What gets copied

For a **user-assigned** identity:

```text
mongodb+srv://<client-id>@<host>/?authMechanism=MONGODB-OIDC
  &authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:https://ossrdbms-aad.database.windows.net
  &<existing params preserved>
```

For a **system-assigned** identity, the same string without the username component.

`TOKEN_RESOURCE` is the resource form of the scope our handler already requests
(`https://ossrdbms-aad.database.windows.net/.default`, see `MicrosoftEntraIDAuthHandler`).

### Options considered

| Option                                                                        | Verdict                                |
| ----------------------------------------------------------------------------- | -------------------------------------- |
| A. Emit the documented driver-native form                                     | **Chosen**                             |
| B. Emit `authMechanism=MONGODB-OIDC` only, like the interactive Entra ID case | Rejected                               |
| C. Two-item quick pick: "for this extension" and "for mongosh and drivers"    | Rejected, moot once D1 = C round-trips |
| D. Refuse to copy and explain why                                             | Rejected                               |

### Reasoning

People copy a connection string to use it **somewhere else**: mongosh, an application, a teammate's
`.env`. Option A produces a string that actually works in those places when run on the same Azure VM,
and it is what Microsoft Learn documents, so it matches what a user who has read those docs expects
to see. It is also the exact form D1 knows how to read back.

Option B produces a string that our extension would understand but that no other tool can act on,
because nothing in it says where the token comes from. That is the worst of both worlds: it looks
like a working string and is not one.

Option C existed only to paper over an asymmetry that D1 = C removes. With one form that works
everywhere, asking the user to choose a flavour is a question with no wrong answer, which means it is
not a question worth asking.

Option D is defensible but unhelpful, and it makes managed-identity connections feel second-class
next to every other connection type in the tree.

### Consequences and behaviour details

- **No with/without-password prompt.** `canIncludeNativePassword()` already returns false for
  non-native auth, so the existing code path skips it naturally. There is no secret in this string.
- **Nothing sensitive is copied.** A client ID is a tenant-scoped identifier, not a credential, so
  the string is safe to paste into a bug report. Worth stating in the user manual, because users have
  been trained to be careful with connection strings.
- **Round-trips.** Copy in one window, paste in another, get the same connection back. Assert this
  as a single unit test over `buildParsedConnectionString` composed with the D1 normalisation, so the
  two halves can never drift apart unnoticed.

---

## D2. How the user selects the identity

**Decision:** A quick pick that leads with the system-assigned identity, optionally shows a client ID
from the pasted connection string, and always ends with manual client-ID entry.

The proposed "Recently used" group was removed before merge. It was only populated by New Connection,
not Update Credentials or the Azure-backed tree entry points, and its expected usage did not justify
maintaining a global-state store. Preview builds may leave behind the bounded
`managedIdentity.recentClientIds` key; it contains at most five non-secret client IDs and is left
orphaned rather than adding migration code.

The reference implementation is
`src/plugins/service-atlas-mongodb/connect/SelectAtlasDatabaseUserStep.ts`, whose `buildItems()` puts
the manual escape hatch first with an `edit` theme icon, then groups the discovered values under
`QuickPickItemKind.Separator` headings.

### Shape

```text
Select the managed identity to use

─────────── This machine ─────────────────────────────────────────
$(vm)       System-assigned managed identity
            Use the identity built into this Azure VM
─────────── From the connection string ──────────────────────────
$(account)  11111111-2222-3333-4444-555555555555
$(edit)     Enter a client ID
            Type the client ID of a user-assigned managed identity
```

Picking "Enter a client ID" opens a GUID-validated input box. Picking any other row writes the result
straight into `context.managedIdentityAuthConfig` and skips the input box, exactly as the Atlas step
skips `ProvideUserNameStep`.

### Options considered

| Option                                                    | Verdict                              |
| --------------------------------------------------------- | ------------------------------------ |
| A. Two-item quick pick, system vs user, then an input box | Rejected (was the original proposal) |
| B. Connection-string username only                        | Rejected (removed entirely by D1)    |
| C. Atlas-pattern quick pick, manual entry first           | **Chosen**                           |
| D. C plus ARM enumeration of user-assigned identities     | Phase 2, see the open item below     |

### Reasoning

The original proposal asked "system or user assigned?" first and only then let the user type. That is
a question about Azure taxonomy, asked before the user has seen any of their own values, and it makes
the common case (I already have a GUID in my clipboard) take two steps instead of one.

The Atlas pattern inverts it: the escape hatch is row one, so anyone who knows what they want is one
keystroke away, and the curated rows are there for everyone else. We already ship this pattern, users
have already met it, and reusing it costs nothing.

### Consequences

- One new prompt step class, gated by `shouldPrompt`.
- No global state is maintained for identity suggestions. The optional known row comes only from the
  connection string currently being entered.
- The list must never be a dead end: if nothing is known, the step still shows with just the manual
  entry row, or is skipped in favour of a plain input box.

### Open item, needs a call

**Where do the "known options" come from in v1?** Three candidate sources, in ascending cost:

1. **System-assigned only.** No network, works in every entry point, and requires no state. Chosen
   for v1 after the recently-used proposal was removed.
2. **ARM enumeration of `Microsoft.ManagedIdentity/userAssignedIdentities` in the subscription.**
   Names instead of GUIDs, which is the genuinely good experience. Only possible in the Azure
   Resources and Discovery views, where we hold an `AzureSubscription`; needs a new ARM client.
3. **The identities actually assigned to this VM.** The correct list, and the one that would have
   prevented the reported incident. Requires reading the VM resource ID from IMDS compute metadata and
   then an ARM `GET` on that VM. Note this needs IMDS, which interacts with D3.

Proposal: **ship 1 now, record 2 and 3 as phase 2.** Flagged for discussion.

---

## D3. Azure environment detection: **OPEN**

**Original proposal:** probe IMDS for annotation and telemetry only, never to gate availability.

**Maintainer position:** sees no benefit in having the probe at all, and has asked for the case to be
argued before deciding.

**Current lean:** **option A, no probe.** The argument is set out in the chat discussion and
summarised below. Nothing in the plan depends on the outcome except WI20 and one telemetry property.

### Options

| Option                                                           | Verdict           |
| ---------------------------------------------------------------- | ----------------- |
| A. Never probe at all                                            | **Leaning yes**   |
| B. Probe to annotate and sort, never to gate                     | Original proposal |
| C. Probe to gate availability (vscode-cosmosdb `auto` behaviour) | Rejected outright |

### Summary of the argument against probing

1. `ManagedIdentityCredential` already performs this detection authoritatively, at the only moment it
   matters, and reports it as a typed `CredentialUnavailableError`. Our probe would be a less
   accurate copy of a check we are about to run anyway.
2. The probe can disagree with the credential. IMDS answering does not mean an identity is assigned,
   so "Azure environment detected" can appear on a machine where the connection then fails.
3. An unsolicited request to `169.254.169.254` is the exact shape of an SSRF or credential-theft
   probe. Endpoint protection and security review will flag it, and "it changes a label" is a poor
   answer.
4. It buys a cosmetic annotation. The same discovery benefit is available from static text in the
   quick pick `detail` line, at zero network cost.
5. The telemetry it was meant to provide is better obtained from the **outcome** of the real
   credential call, which we are instrumenting regardless.
6. Correctness costs are real: timeout, cache, single-flight, plus staleness when a laptop changes
   network.

### If A is chosen

- Delete WI20 and `azureEnvironmentProbe.ts` from the plan.
- Drop the `azureEnvironmentDetected` telemetry property; `managedIdentityFailureReason` already
  distinguishes `noEndpoint`.
- Put the discovery hint in static copy instead: _"Use when VS Code is running on an Azure VM that has
  a managed identity assigned."_
- Note this does **not** forbid using IMDS after the user has explicitly chosen managed identity,
  which keeps D2 open item 3 available later.

---

## D4. Scope: managed identity only, not a general "default credential" mode

**Decision:** ship `ManagedIdentity` only. Everything else goes into a **dedicated GitHub issue,
filed after this work lands**.

The timing is deliberate. What we learn while building this, particularly the real error shapes from
the harness and whatever the Azure VM validation turns up, will change what that issue should say.
Writing it first would mean rewriting it later, and a stale issue is worse than a late one.

### Reasoning

Unchanged from the proposal: a chained credential on the repro VM would land on the same ambiguous
managed identity and fail the same way, so it does not close the incident; vscode-mssql's own
documentation warns that the chained mode has performance costs and is not recommended where response
times matter; and adding it later is purely additive.

What changed is the disposition. Rather than a paragraph of future work, this becomes a real issue,
because the surrounding area has more in it than `DefaultAzureCredential` alone.

### The issue should cover, at minimum

- `DefaultAzureCredential` / "Active Directory Default" chained mode, for `az login` developer
  machines and CI agents with federated credentials.
- **Entra ID accounts subject to MFA and Conditional Access**, and how our interactive path behaves
  when a policy requires re-authentication mid-session.
- Service principal authentication (client ID plus secret).
- Workload identity federation as a first-class mode rather than an incidental one.
- Sovereign clouds, which today are out of scope for interactive Entra ID as well.
- Anything the implementation of this work surfaced that belongs in the same family.

The design consequence for this work is unchanged: the auth config type, handler interface, identity
selector, and error mapping are written so those modes can reuse them.

---

## D5. No VS Code settings for managed identity

**Decision:** confirmed as proposed. Configure per connection only. Contribute no new settings.

> Maintainer: "no settings, no magic, nothing to forget."

### Reasoning

vscode-cosmosdb has `authManagedIdentityClientId` plus a preferred-method setting, and the genuine
use case is fleet-provisioned dev boxes where every user would otherwise type the same GUID.

Against that: settings are global and invisible, they create a second source of truth that silently
conflicts with per-connection configuration, and they make "why did this connection use identity X"
much harder to answer. The extension currently contributes **no** auth-related settings at all, and
that is a property worth preserving until there is demand.

The selector deliberately keeps no cross-connection state. Repeated client-ID entry is accepted for
v1 rather than introducing a hidden global source of truth before demand is established.

### Revisit when

Someone reports having to enter the same client ID across many connections on managed hardware. At
that point, compare an explicit setting with ARM-backed identity enumeration rather than restoring an
entry-point-dependent MRU list.

---

## D6. Adjacent fixes

**Decision:** rescoped. One of the three stays in this work, one becomes an issue, one is simplified.

### D6.1 Token expiry and caching: **out of scope, dedicated issue**

`MicrosoftEntraIDAuthHandler` returns `expiresInSeconds: 0`, which disables the driver's token cache,
while `playgroundWorker.ts` computes it correctly from the JWT `exp` claim.

The original proposal was to fix this here. The maintainer's position is that **there may have been a
reason** for the zero, and changing token-lifetime behaviour underneath a working, battle-tested
interactive Entra ID path is not something to do as a side effect of adding a new auth method.

So: raise a dedicated issue to revisit token expiry and refresh across all Entra-based methods,
covering what the driver does at expiry, whether refresh is silent, and why the zero is there. As
with D4, **file it after this work lands**: building the managed identity handler will produce
first-hand evidence about how the driver behaves with a real `expiresInSeconds`, and that evidence
belongs in the issue.

The new managed identity handler reports a correct `expiresInSeconds` from
`AccessToken.expiresOnTimestamp` for itself, without touching the existing handler.

### D6.2 Error mapping: **simplified to plain-language translation**

Full actionable error mapping, with commands and remediation links, is more work than this iteration
warrants, and it cannot be written honestly until real error shapes are captured from hardware.

Instead, follow the approach already used in the Local Quick Start work: **translate** the raw error
into something a human can read, and stop there. No suggested commands, no deep links, no branching
remediation UI. The multi-identity case still gets a sentence that names the cause and says a client
ID is needed, because that is the incident we are closing, but it is a sentence rather than a
workflow.

Richer, actionable mapping stays on the table as an **option to evaluate when we get there**, once
WI13 has captured what the errors actually look like.

### D6.3 Documentation: **our `docs/` folder**

Retargeted. The original item was a correction to a Microsoft Learn page; that stays as a follow-up
note, but the committed work is updating **our own** documentation under `docs/`:

- A new user-manual page on connecting with a managed identity, scoped to Azure VMs per D0.
- `docs/user-manual/copy-connection-string.md`: what a managed-identity connection copies, and why
  there is no password prompt (D1a).
- `docs/user-manual/how-to-construct-url.md` and
  `src/documentdb/utils/connection-string-parameters.md`: the `ENVIRONMENT` and `TOKEN_RESOURCE`
  properties, and the fact that we produce but do not consume them (pending the D1a open item).

---

## D8. Managed identity fields remain additive in storage v3.0

**Decision:** keep the storage version at `3.0` and allocate managed identity fields in new,
append-only `SecretIndex` slots.

Storage versions are exact shape tags, not ordered compatibility versions. Released extension
versions reconstruct `3.0` records while ignoring trailing array slots they do not know. By contrast,
an unknown `3.1` or `4.0` record falls into the unversioned-v1 compatibility path, which can discard
folder membership and authentication settings if the older extension subsequently saves it. Keeping
the additive fields in `3.0` therefore avoids persistent data loss for preview users switching
between extension versions.

Assigned secret indexes are never reordered or reused. A future version bump must first ship a
tolerant reader that distinguishes a genuinely unversioned v1 record from an unknown future version.

---

## D7. Validation strategy

**Decision:** confirmed as proposed, not contested. Unit tests, plus a fake identity-endpoint harness,
plus a written manual checklist for whoever holds the Azure VM repro.

### Reasoning

We cannot provision Azure infrastructure from this environment. But `ManagedIdentityCredential`
honours the App Service protocol environment variables (`IDENTITY_ENDPOINT`, `IDENTITY_HEADER`), which
means the **real** credential object can be pointed at a local HTTP stub and exercised end to end,
including the multi-identity error path. That is a much stronger signal than mocking the credential.

Per D0 this is a **test mechanism only**. Using the App Service protocol to drive a local stub does
not imply App Service is a supported platform.

The manual checklist exists because the incident can only be closed on real hardware, and the person
who runs it should not have to reverse-engineer which cases matter.

---

## Resolved review questions

- **Label wording.** Confirmed: keep **"Managed Identity (Azure hosted)"**.
- **Round-trip of the copied connection string.** Resolved by D1 = option C: what we copy, we can
  paste back.
- **ARM-backed identity picker.** Superseded by the D2 open item, which asks the narrower and more
  useful question of where the v1 list comes from.
- **`DefaultAzureCredential` sooner?** No. Tracked in the D4 issue, filed after this work lands.

## Still open

1. **D3**, probe or no probe. Argued above and in chat; leaning no probe.

D3 does not block implementation; its default is not to build the probe.
