---
feature: managed-identities
kind: design
status: active
prs: [886]
code:
  - src/documentdb/auth/ManagedIdentityAuthHandler.ts
  - src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.ts
---

# Managed Identity Authentication

Managed identity authentication for Azure DocumentDB (vCore) connections from VS Code running on
an Azure VM. System-assigned and user-assigned identities are supported. The UI presents managed
identity and interactive account sign-in as identity choices inside the Microsoft Entra ID family,
while their stored authentication methods and token handlers remain separate.

Interactive account tenant selection reports empty, failed, and timed-out lookups separately.
The initial lookup allows five seconds; an explicit retry allows 30 seconds. Manual tenant entry
and account management remain available. See D11 in [Decisions](decisions.md).

## Status

Implemented in [PR #886](https://github.com/microsoft/vscode-documentdb/pull/886), targeting `main`.
Real Azure VM validation remains pending; see the [manual checklist](manual-validation-checklist.md).
Side-loaded validation used the preview marker `0.10.2-managed-identity`; the package version was
restored to the branch's `0.10.2` baseline before review handoff. This is not a claim that the feature
shipped in `0.10.2`.

## Design And Decisions

- [Design](design.md): authentication flow, connection-string handling, storage, shell integration,
  and implementation plan.
- [Decisions](decisions.md): supported platforms, token acquisition, explicit identity selection,
  Entra-family presentation, tenant handling, error handling, and rejected alternatives. Consult
  each entry's status before relying on it.
- [Research](research-findings.md): historical evidence behind the design.
- [User guide](../../../user-manual/connect-with-managed-identity.md): setup and connection workflow.

## Code Map

- [ManagedIdentityAuthHandler](../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts):
  managed identity token acquisition and authentication.
- [SelectEntraTokenSourceStep](../../../../src/documentdb/wizards/authenticate/SelectEntraTokenSourceStep.ts):
  account and managed identity selection inside the Microsoft Entra ID family.
- [Connection strings](../../../../src/documentdb/auth/managedIdentityConnectionString.ts):
  parsing and serialization of managed identity connection settings.
- [CredentialCache](../../../../src/documentdb/CredentialCache.ts): authentication state for connections.

## Iterations

| Iteration      | Record                                                                   |
| -------------- | ------------------------------------------------------------------------ |
| Implementation | [Work items and deviations](iterations/01-implementation-log.md)         |
| Code review    | [Findings and resolutions](iterations/02-code-review.md)                 |
| UX review      | [Workflow findings and operator feedback](iterations/03-ux-review.md)    |
| Entra flow     | [Unified identity and tenant flow](iterations/04-entra-identity-flow.md) |
| PR feedback    | [Review discussions and resolutions](iterations/06-pr-feedback.md)       |

Historical records retain their original review baselines and packaging observations. The current
branch target and preview version are recorded above; the earlier records are not current release guidance.
