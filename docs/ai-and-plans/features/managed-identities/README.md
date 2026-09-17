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

## Troubleshooting Output

Use **Output > DocumentDB for VS Code** at the default Info level. `Authentication` entries record
family and identity picker option IDs, selections, skip reasons, connection-string inference,
interactive session acquisition, and managed identity credential reuse, SDK loading, token requests,
and tenant-check outcomes. `Azure tenant lookup` entries distinguish empty results, failures,
timeouts, and late responses. Operation IDs correlate start/completion/failure entries; managed
identity callbacks and token-provider stages share a correlation ID, including shell/playground requests.

Gate and skip decisions are logged only when the wizard reaches or revisits the step. Repeated
`shouldPrompt()` calls used to calculate UI metadata are silent, so they cannot appear as premature
authentication decisions before the connection string or identity has been chosen.

Environment diagnostics report platform/architecture and only the presence of relevant endpoint,
header/secret, and proxy settings. They do not identify the SDK-selected endpoint or claim an SDK
token-cache hit. New trace entries omit account labels, tenant/client IDs, connection strings,
environment values, tokens, claims, and raw exception messages. Error output uses allowlisted codes
and existing managed identity failure categories. Picker durations include time spent choosing.

## Wizard Telemetry

Authentication steps add properties to the existing wizard/command telemetry context. No extra
per-interaction events, reporting helper, event history, or correlation IDs are created. Existing
journey/connection correlation, result, duration, and cancellation handling remain unchanged.

| Shared property                 | Meaning                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `authFlowOrigin`                | `newConnection`, `updateCredentials`, `savedConnection`, `azureResources`, `azureDiscovery`, `atlasDiscovery`, or `kubernetesDiscovery` |
| `authMethod`                    | Latest resolved `AuthMethodId`, including the final account versus managed identity choice                                              |
| `authMethodSelectionSource`     | `prompt`, `autoSelected` (one supported family), or `preselected` (known before the family step)                                        |
| `entraIdentityPrompted`         | Whether the current identity step prompts (`true`/`false`); evaluated only when reached                                                 |
| `entraIdentitySkipReason`       | Why the identity picker is skipped, such as `explicitMachineWorkflow` or `managedIdentityUnavailable`                                   |
| `entraIdentityChoice`           | Latest identity-picker choice: `account`, `systemAssigned`, `clientId`, `manual`, `authMethod`, or `back`                               |
| `managedIdentityKind`           | Existing `system`/`user` dimension when managed identity is resolved                                                                    |
| `managedIdentityClientIdSource` | Existing `none`, `connectionString`, or `prompt` dimension when known                                                                   |

Existing `connectionMode`, tenant counts, and tenant-selection properties remain available. New
Connection and Update Credentials enrich their command event; resource authentication enriches
the existing connect context shared by its wizard. These are summaries, not a chronological history.
Use the existing operation result and last-step fields when analyzing cancellation or failure.

Starting a new family choice clears stale selection fields; switching away from managed identity
clears its dimensions. Manual entry records `entraIdentityChoice=manual` before asking for a client
ID, but user-assigned dimensions are only set after completion. The added fields contain categories,
not client/tenant IDs, account labels, connection strings, or input values. Detailed troubleshooting
continues to use Output tracing, which is unchanged.

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
