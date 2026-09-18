---
feature: managed-identities
kind: iteration
status: active
created: 2026-09-16
verified: 2026-09-16
code:
  - src/commands/newConnection/**
  - src/commands/updateCredentials/**
  - src/documentdb/auth/managedIdentityConnectionString.ts
  - src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.ts
  - src/documentdb/auth/AuthMethod.ts
---

# Entra Identity Flow Presentation

## Goal

Present managed identity as a way to obtain a Microsoft Entra ID token, not as a peer authentication
family. Ask only what a pasted connection string did not state, keep every alternative reachable,
and make tenant selection answerable without restarting the parent wizard.

This is a presentation and wizard-timing change. `AuthMethodId.ManagedIdentity`, its stored config,
token handler, cache identity, connection-string interoperability, and telemetry vocabulary remain
intact for compatibility.

## Settled Decisions

The operator supplied an implementation handoff with these decisions already settled. Their durable
forms are D9 through D12 in [decisions.md](../decisions.md).

- Parse connection strings into stable facts, not a `weak` or `explicit` UI verdict.
- Present username/password, Microsoft Entra ID, and no authentication as the top-level families.
- Use one identity picker for account sign-in, the pasted managed identity candidate, this machine's
  identity, manual client ID entry, and the inferred-family escape.
- Keep `AuthMethodId.ManagedIdentity` unchanged in storage and runtime code.
- Run tenant selection after identity selection. Managed identity skips it; account sign-in keeps it.
- A single enumerable tenant remains a suggestion, so the picker still appears and manual guest
  tenant entry stays reachable.
- Account management returns to the tenant picker and re-enumerates instead of terminating the
  connection wizard.
- Apply the family presentation consistently to all seven authentication entry points.

## Rationale Retained From Design Exploration

The temporary design discussions were deleted after this summary was recorded. The durable points
below are the parts that are not obvious from the implementation alone.

### The reported incident was ambiguity, not an authentication failure

The tester was running on an Azure VM, and the saved managed identity connection worked. The
confusing behavior happened while interpreting the pasted URI, before token acquisition.

Microsoft Learn published two forms for the same managed identity scenario. Its Visual Studio Code
example used OIDC with a GUID username but omitted `authMechanismProperties`; its shell and Compass
example also supplied `ENVIRONMENT:azure` and `TOKEN_RESOURCE`. A GUID alone cannot distinguish a
managed identity client ID from an application client ID or Entra object ID. The shorter URI can
therefore establish the Microsoft Entra ID family, but it cannot establish the token source.

The upstream correction remains precise: make the Visual Studio Code example use the complete form
already shown for the other clients:

```text
authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:https://ossrdbms-aad.database.windows.net
```

If the Azure portal also emits the short form, that should be verified separately before including
it in the same correction request.

### Alternatives considered

| Option | Approach                                                                                 | Decision and reason                                                                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A      | Tune the old flat picker by treating OIDC plus a GUID as managed identity                | Rejected. The GUID remains ambiguous, and the UI would still present a token source as a peer authentication family.                                                                                                           |
| B      | Separate authentication family from identity selection, using one shared identity picker | **Chosen.** It represents "family known, source unknown" directly and keeps every source reachable without duplicating pickers.                                                                                                |
| C      | Probe IMDS silently and use the result to select or rank the source                      | Rejected. A successful probe proves availability, not user intent. It duplicates the authoritative credential call, adds link-local traffic and timeout/cache complexity, and can still disagree with the later token request. |

Telemetry was not used to gate this decision. The available signal measured the `weak` or
`explicit` confidence model being removed, so optimizing the replacement around that aggregate
would have made the obsolete classification a hidden design dependency.

### The tenant picker is historical compatibility behavior

The tenant step predates managed identity and was created specifically for pasted connection
strings in commit `ffa5152` (`feat: provide tenantId when entraid + connection string`). Commit
`4b7e76c` added the Update Credentials twin, and the surrounding multi-account and multi-tenant
work shipped in 0.5 after issue #276 exposed failures to respect non-default tenant context.

Passing no tenant to `getSessionFromVSCode` is not neutral. It omits the `VSCODE_TENANT:<id>` scope
constraint, so VS Code can return the account's home-tenant token. That is wrong for a user who is a
guest in the cluster tenant and typically ends as an opaque server rejection. The tenant also forms
part of `getConnectionAuthIdentity`; dropping it would collapse otherwise distinct same-host Entra
connections onto the same duplicate-detection identity.

This history is why the choice was retimed rather than removed. One enumerable tenant is still only
a suggestion because enumeration covers authenticated tenants, while manual entry may be the only
route to a guest tenant.

### No client ID is not proof of a system-assigned identity

`new ManagedIdentityCredential()` without a selector means "ask the managed identity endpoint to
resolve the identity." It can return the sole user-assigned identity on a machine with no
system-assigned identity, and it fails when several identities make the request ambiguous. The UI
therefore describes sending no client ID, while the runtime keeps its readable multiple-identities
error. It must never silently replace an unusable supplied identity with an unselected principal.

This distinction is also why a silent IMDS probe would not settle intent: knowing that some identity
can issue a token does not prove that it is the identity the user meant to use.

## Work Items

### WI1: Replace confidence hints with authentication facts

**Commit:** `21d2e955`, `refactor: report connection string auth facts`

`ConnectionStringAuthFacts` now reports whether a string uses OIDC, declares the Azure machine
workflow, supplies a token resource, supplies a username, and whether that username is GUID-shaped.
The parser no longer recommends a wizard action.

`PromptConnectionStringStep` owns the policy. OIDC establishes the Microsoft Entra ID family. Only
`ENVIRONMENT:azure` with no username or a GUID username settles managed identity without a prompt.
A GUID without that property remains a candidate for the identity picker. A non-GUID machine
identity stays visible for correction and is never silently replaced by this machine's identity.

Focused verification: 4 suites, 54 tests. `npm run build` passed.

### WI2: Unify Entra identity selection

**Commit:** `3fd88975`, `feat: unify Entra identity selection`

The top-level family picker no longer displays managed identity. Its Microsoft Entra ID detail keeps
managed identity discoverable and searchable. `SelectManagedIdentityStep` became
`SelectEntraTokenSourceStep` and now owns one list containing account sign-in, managed identity
sources, client ID correction, and the route to choose another family when OIDC inference skipped
the family picker.

The step is registered behind the same Entra-family gate in New Connection, Update Credentials,
Connections reconnect, Azure Resources, vCore Discovery, Atlas Discovery, and Kubernetes Discovery.
The latter two normally do not advertise Entra today, but the gate prevents a future capability
change from exposing a family with no token-source choice.

Tenant selection moved after this step in New Connection and Update Credentials. The token-source
choice can therefore switch the provisional Entra family to managed identity before tenant gating
runs.

**Implementation deviation:** the handoff mock placed account sign-in first while highlighting a
pasted client ID. The Azure quick-pick wrapper cannot activate an arbitrary item in a single-select
list. When a candidate exists, it is placed first so the settled requirement to highlight the most
specific known identity is honored. Building a custom quick pick was rejected because it would
replace the wizard input abstraction for ordering alone. Silently highlighting account sign-in was
rejected because it biases the reported managed-identity scenario toward a different principal.

Focused verification: 3 suites, 37 tests. `npm run build` passed.

### WI3: Keep tenant selection in the sign-in flow

**Commit:** `7c5d52d4`, `fix: keep tenant selection in sign-in flow`

Both tenant steps now check sign-in before tenant enumeration. A signed-out user enters the existing
centralized Azure account-management flow first. After account management, tenant enumeration and
the picker continue in place instead of showing restart instructions and throwing
`UserCancelledError`.

Tenant enumeration and sign-in-state checks have a five-second bound. Failure or timeout falls back
to the picker, where manual tenant entry remains available. The picker still appears with exactly
one enumerable tenant because that tenant is a suggestion, not proof that a guest tenant is not
needed.

Focused verification: 1 suite, 4 tests covering both tenant steps. `npm run build` passed.

### WI4: Clarify quick-pick groups and authentication icons

**Commit:** `f5b2b586`, `fix: clarify authentication quick picks`

The identity picker now groups account sign-in under **Microsoft Entra account**, machine choices
under **Managed identity**, and the inferred-family escape under the conditional **Other options**
heading. The earlier **This machine** heading was rejected because it described a location rather
than the authentication concept shared by both identity rows.

System-assigned and user-assigned terminology now appears in complete detail sentences instead of
standalone parenthetical labels. The pasted candidate says that its supplied client ID will be used
as a user-assigned managed identity. The no-client-ID choice states that it uses the system-assigned
option, and manual entry says that it expects a user-assigned managed identity client ID.

The top-level family picker now uses the `key` icon for username/password, the `azure` icon for
Microsoft Entra ID, and the `unlock` icon for no authentication. Theme icons were chosen over new
image assets so they follow the active VS Code theme and match existing Azure tree surfaces.

Focused verification: 2 suites, 36 tests. `npm run build` and `git diff --check` passed.

### WI5: Add a visible route back to family selection

**Commit:** `a5c9a85c`, `fix: add visible Entra flow back action`

When the user reaches the identity picker by selecting Microsoft Entra ID in a displayed family
picker, **Other options** now includes **Back to authentication method selection** with an
`arrow-left` icon. It raises `GoBackError`, following the visible action-row pattern used by Azure
account management instead of relying only on the small Back button in the quick-pick title.

The family picker records whether it actually displayed. The Back row is omitted when OIDC inferred
the family or a single available method was auto-selected, because `AzureWizard` cannot return to a
step that did not prompt. Inferred OIDC continues to use the inline **Choose a different
authentication method...** action.

Focused verification: 1 suite, 32 tests. `npm run build` and `git diff --check` passed.

## Outcome

The implementation now matches the handoff's three dependent stages and the operator's follow-up
quick-pick refinement. Focused tests and a project build passed after each work item. Localization
generation, formatting, lint, the full Jest suite, packaging, and hands-on Azure VM validation were
not run because this branch is still in the working/draft phase.
