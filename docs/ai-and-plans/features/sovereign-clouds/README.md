---
feature: sovereign-clouds
kind: design
status: active
code:
  - src/documentdb/auth/entraScopes.ts
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

**Plan approved, implementation in progress.** No PR yet. Nobody on the team has access to a
sovereign cloud, so every change here is made without being able to test it end to end. See
[D2](decisions.md#d2-implement-without-sovereign-cloud-access).

## The problem in one paragraph

An issue was reported: in Azure US Government, listing Azure resources works, but connecting to a
DocumentDB cluster with Entra ID fails with `AADSTS65002`. VS Code's sign-in app (`aebc6443-…`) is
not preauthorized for the **Azure OSSRDBMS Database** app (`123cd850-…`) in that cloud. Listing works because management calls use the Azure
Resource Manager scope, which VS Code is preauthorized for in every cloud. Connecting uses the
database scope, which it is not, in US Government. This is a Microsoft-side directory configuration
gap that the extension cannot fix. A separate extension-side defect also exists: we always request
the public-cloud audience `https://ossrdbms-aad.database.windows.net`, whatever cloud the user
selected.

Full evidence: [research-findings.md](research-findings.md).

## What is being done

| #   | Track                                                                                       | Who                                  | State                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | Ask the owner of `123cd850` to preauthorize VS Code `aebc6443` in US Government (and China) | Microsoft internal, outside the code | Followed up through internal channels; not tracked in this repository                                                       |
| 2   | Request the DocumentDB token for the selected cloud, not always the public one              | This repo                            | Planned: [iteration 01, part A](iterations/01-cloud-aware-scope-and-entra-diagnostics.md#part-a-cloud-aware-token-audience) |
| 3   | Explain Entra sign-in failures (AADSTS codes, broker errors) through one classifier table   | This repo                            | Planned: [iteration 01, part B](iterations/01-cloud-aware-scope-and-entra-diagnostics.md#part-b-entra-error-classifier)     |

Track 2 alone does not fix the reported failure; track 1 does. Track 2 is needed so that the token
is issued for the right audience once track 1 lands. Track 3 makes the next failure of this kind
readable without a support round trip.

## Code map (today)

- [entraScopes.ts](../../../../src/documentdb/auth/entraScopes.ts): the single public-cloud
  `DOCUMENTDB_TOKEN_RESOURCE` and `DOCUMENTDB_ENTRA_SCOPE`.
- [MicrosoftEntraIDAuthHandler.ts](../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts):
  interactive sign-in through `getSessionFromVSCode`, which already picks the sovereign VS Code
  auth provider, but is handed the public scope.
- [ManagedIdentityAuthHandler.ts](../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts):
  managed identity, public scope.
- [playgroundWorker.ts](../../../../src/documentdb/playground/playgroundWorker.ts): the shell and
  playground worker asks the main thread for a token with the public scope.
- [managedIdentityConnectionString.ts](../../../../src/documentdb/auth/managedIdentityConnectionString.ts):
  writes `TOKEN_RESOURCE:<public>` into copied connection strings; parses `TOKEN_RESOURCE` but the
  value is not used afterwards.
- [oidcAllowedHosts.ts](../../../../src/documentdb/auth/oidcAllowedHosts.ts): already accepts
  `*.azure.us` and `*.azure.cn` hosts (#639, #934).
- [connectionDiagnosticsService.ts](../../../../src/services/connectionDiagnosticsService.ts): the
  provider registry the Entra classifier plugs into.

Azure management (subscription listing, ARM clients) already follows the selected cloud through
`AzureSubscription.environment`; nothing is planned there.

## Documents

- [research-findings.md](research-findings.md): the reported failure, error analysis, where the GUIDs
  come from, precedent, how other extensions handle sovereign clouds, per-cloud values with sources,
  and open questions.
- [decisions.md](decisions.md): operator decisions and proposals awaiting confirmation.
- [iterations/01-cloud-aware-scope-and-entra-diagnostics.md](iterations/01-cloud-aware-scope-and-entra-diagnostics.md):
  the plan for tracks 2 and 3.

## Open gaps

- No sovereign-cloud test access. Behavior after the change is inferred, not observed.
- Not confirmed which audience DocumentDB accepts in US Government. ARM metadata publishes the
  `usgovcloudapi.net` URI as the OSSRDBMS resource there, but no DocumentDB document confirms it.
- Whether China clusters accept the public audience today (check telemetry before shipping, D11).
