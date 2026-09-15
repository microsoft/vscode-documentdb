---
feature: managed-identities
kind: design
status: active
prs: [886]
code:
  - src/documentdb/auth/ManagedIdentityAuthHandler.ts
  - src/documentdb/wizards/authenticate/SelectManagedIdentityStep.ts
---

# Managed Identity Authentication

Explicit managed identity authentication for Azure DocumentDB (vCore) connections from VS Code
running on an Azure VM. System-assigned and user-assigned identities are supported; interactive
Microsoft Entra ID authentication remains a separate method.

## Status

Implemented in [PR #886](https://github.com/microsoft/vscode-documentdb/pull/886), targeting `main`.
Real Azure VM validation remains pending; see the [manual checklist](manual-validation-checklist.md).
The side-loaded preview version is `0.10.2-managed-identity` after merging main's `0.10.2` baseline.
This is not a Marketplace release version or a claim that the feature shipped in `0.10.2`.

## Design And Decisions

- [Design](design.md): authentication flow, connection-string handling, storage, shell integration,
  and implementation plan.
- [Decisions](decisions.md): supported platforms, token acquisition, explicit identity selection,
  error handling, and rejected alternatives. Consult each entry's status before relying on it.
- [Research](research-findings.md): historical evidence behind the design.
- [User guide](../../../user-manual/connect-with-managed-identity.md): setup and connection workflow.

## Code Map

- [ManagedIdentityAuthHandler](../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts):
  managed identity token acquisition and authentication.
- [SelectManagedIdentityStep](../../../../src/documentdb/wizards/authenticate/SelectManagedIdentityStep.ts):
  explicit identity selection in the authentication wizard.
- [Connection strings](../../../../src/documentdb/auth/managedIdentityConnectionString.ts):
  parsing and serialization of managed identity connection settings.
- [CredentialCache](../../../../src/documentdb/CredentialCache.ts): authentication state for connections.

## Iterations

| Iteration | Record |
| --- | --- |
| Implementation | [Work items and deviations](iterations/01-implementation-log.md) |
| Code review | [Findings and resolutions](iterations/02-code-review.md) |
| UX review | [Workflow findings and operator feedback](iterations/03-ux-review.md) |

Historical records retain their original review baselines and packaging observations. The current
branch target and preview version are recorded above; the earlier records are not current release guidance.