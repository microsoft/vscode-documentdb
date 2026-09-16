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

## Work Items

### WI1: Replace confidence hints with authentication facts

**Commit:** `6e7b7420`, `refactor: report connection string auth facts`

`ConnectionStringAuthFacts` now reports whether a string uses OIDC, declares the Azure machine
workflow, supplies a token resource, supplies a username, and whether that username is GUID-shaped.
The parser no longer recommends a wizard action.

`PromptConnectionStringStep` owns the policy. OIDC establishes the Microsoft Entra ID family. Only
`ENVIRONMENT:azure` with no username or a GUID username settles managed identity without a prompt.
A GUID without that property remains a candidate for the identity picker. A non-GUID machine
identity stays visible for correction and is never silently replaced by this machine's identity.

Focused verification: 4 suites, 54 tests. `npm run build` passed.

### WI2: Unify Entra identity selection

**Commit:** `267b738f`, `feat: unify Entra identity selection`

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

**Commit:** `dab936bb`, `fix: keep tenant selection in sign-in flow`

Both tenant steps now check sign-in before tenant enumeration. A signed-out user enters the existing
centralized Azure account-management flow first. After account management, tenant enumeration and
the picker continue in place instead of showing restart instructions and throwing
`UserCancelledError`.

Tenant enumeration and sign-in-state checks have a five-second bound. Failure or timeout falls back
to the picker, where manual tenant entry remains available. The picker still appears with exactly
one enumerable tenant because that tenant is a suggestion, not proof that a guest tenant is not
needed.

Focused verification: 1 suite, 4 tests covering both tenant steps. `npm run build` passed.

## Outcome

The implementation now matches the handoff's three dependent stages. Focused tests and a project
build passed after each work item. Localization generation, formatting, lint, the full Jest suite,
packaging, and hands-on Azure VM validation were not run because this branch is still in the
working/draft phase.
