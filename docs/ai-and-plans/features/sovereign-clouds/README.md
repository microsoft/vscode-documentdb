---
feature: sovereign-clouds
kind: design
status: active
code:
  - src/documentdb/auth/entraScopes.ts
  - src/documentdb/auth/documentdbTokenResource.ts
  - src/documentdb/auth/entraErrors/EntraDiagnosticsProvider.ts
  - src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
  - src/documentdb/auth/ManagedIdentityAuthHandler.ts
  - src/documentdb/auth/managedIdentityConnectionString.ts
  - src/documentdb/auth/oidcAllowedHosts.ts
  - src/documentdb/playground/playgroundWorker.ts
  - src/services/connectionDiagnosticsService.ts
---

# Sovereign Clouds (Azure Government, Azure China)

Microsoft Entra ID sign-in to Azure DocumentDB clusters in sovereign clouds, and readable
explanations when Entra sign-in fails.

## Status

**Parts A and B implemented; sovereign-cloud verification pending.** Draft
[PR #1050](https://github.com/microsoft/vscode-documentdb/pull/1050). Nobody on the team
has access to a sovereign cloud, so every change here is made without being able to test it end to end. See
[D2](decisions.md#d2-implement-without-sovereign-cloud-access).

## The problem in one paragraph

An issue was reported: in Azure US Government, listing Azure resources works, but connecting to a
DocumentDB cluster with Entra ID fails with `AADSTS65002`. VS Code's sign-in app is not preauthorized
for the **Azure OSSRDBMS Database** app in that cloud. Listing works because management calls use the Azure
Resource Manager scope, which VS Code is preauthorized for in every cloud. Connecting uses the
database scope, which it is not, in US Government. This is a Microsoft-side directory configuration
gap that the extension cannot fix. A separate extension-side defect was that we always requested
the public-cloud audience `https://ossrdbms-aad.database.windows.net`, whatever cloud the user
selected. Part A now resolves the audience for the cloud.

Full evidence: [research-findings.md](research-findings.md).

## What is being done

| #   | Track                                                                                               | Who                         | State                                                                                                                           |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Microsoft preauthorizes VS Code for the Azure OSSRDBMS Database resource in US Government and China | Microsoft, outside the code | Not tracked in this repository                                                                                                  |
| 2   | Request the DocumentDB token for the selected cloud, not always the public one                      | This repo                   | Implemented: [iteration 01, part A](iterations/01-cloud-aware-scope-and-entra-diagnostics.md#part-a-cloud-aware-token-audience) |
| 3   | Explain Entra sign-in failures (AADSTS codes, broker errors) through one classifier table           | This repo                   | Implemented: [iteration 01, part B](iterations/01-cloud-aware-scope-and-entra-diagnostics.md#part-b-entra-error-classifier)     |

Track 2 alone does not fix the reported failure; track 1 does. Track 2 is needed so that the token
is issued for the right audience once track 1 lands. Track 3 makes the next failure of this kind
readable without a support round trip.

## Code map (today)

- [entraScopes.ts](../../../../src/documentdb/auth/entraScopes.ts): the built-in cloud audience
  table and unchanged public `DOCUMENTDB_TOKEN_RESOURCE` and `DOCUMENTDB_ENTRA_SCOPE`.
- [documentdbTokenResource.ts](../../../../src/documentdb/auth/documentdbTokenResource.ts):
  interactive and managed identity audience resolution, custom clouds, and mismatch checks.
- [MicrosoftEntraIDAuthHandler.ts](../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts):
  interactive sign-in through `getSessionFromVSCode`, which already picks the sovereign VS Code
  auth provider and requests the resolved cloud's scope.
- [ManagedIdentityAuthHandler.ts](../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts):
  managed identity, using the VM and cluster's resolved cloud scope.
- [playgroundWorker.ts](../../../../src/documentdb/playground/playgroundWorker.ts): the shell and
  playground worker asks the main thread for a token; the main thread resolves its scope.
- [managedIdentityConnectionString.ts](../../../../src/documentdb/auth/managedIdentityConnectionString.ts):
  writes a best-effort cloud-aware `TOKEN_RESOURCE` into copied connection strings.
- [oidcAllowedHosts.ts](../../../../src/documentdb/auth/oidcAllowedHosts.ts): already accepts
  `*.azure.us` and `*.azure.cn` hosts (#639, #934). Custom suffixes come from the machine-scoped
  `documentDB.customEnvironment` object, not workspace overrides; bare TLDs and common two-label
  public suffixes are rejected. The same closed Azure TLD list and validated suffix recognize
  DocumentDB hosts in New Connection and Update Credentials, making managed identity available
  for public, Government, China, and configured service domains without matching lookalikes.
- [entraErrors/](../../../../src/documentdb/auth/entraErrors/): the single classifier table,
  pure text classifier, recent token-failure registry, and Entra diagnostics provider.
- [connectionDiagnosticsService.ts](../../../../src/services/connectionDiagnosticsService.ts): the
  provider registry that routes Entra explanations to existing foreground error surfaces.

Azure management (subscription listing, ARM clients) already follows the selected cloud through
`AzureSubscription.environment`; nothing is planned there.

Entra and managed identity attempts attach only `cloudCategory`, `tokenResourceReason`,
`configuredCloud`, `hostCloud`, and `errorKind` closed enums to existing `connect.startup` and
`worker.startup` telemetry. The attempt's trace context owns these properties; raw resolution
details (including resources and local IMDS evidence) are never spread into telemetry.
See [telemetry correlation IDs](../../telemetry-correlation-ids.md#entra-cloud-resolution).

## Documents

- [research-findings.md](research-findings.md): the reported failure, error analysis, where the GUIDs
  come from, precedent, how other extensions handle sovereign clouds, per-cloud values with sources,
  and open questions.
- [decisions.md](decisions.md): operator decisions and proposals awaiting confirmation.
- [iterations/01-cloud-aware-scope-and-entra-diagnostics.md](iterations/01-cloud-aware-scope-and-entra-diagnostics.md):
  the plan for tracks 2 and 3.
- [iterations/01-cloud-aware-scope-and-entra-diagnostics-review.md](iterations/01-cloud-aware-scope-and-entra-diagnostics-review.md):
  the correctness review, local reproductions, and remaining verification gates for PR #1050.

## Open gaps

- No sovereign-cloud test access. Behavior after the change is inferred, not observed.
- Not confirmed which audience DocumentDB accepts in US Government. ARM metadata publishes the
  `usgovcloudapi.net` URI as the OSSRDBMS resource there, but no DocumentDB document confirms it.
- Whether China clusters accept the public audience today (check telemetry before shipping, D11).
