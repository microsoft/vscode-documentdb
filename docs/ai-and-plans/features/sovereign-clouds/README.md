---
feature: sovereign-clouds
kind: design
status: active
code:
  - src/documentdb/auth/entraScopes.ts
  - src/documentdb/auth/documentdbTokenResource.ts
  - src/documentdb/auth/entraErrors/EntraErrorExplainer.ts
  - src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
  - src/documentdb/auth/ManagedIdentityAuthHandler.ts
  - src/documentdb/auth/managedIdentityConnectionString.ts
  - src/documentdb/auth/oidcAllowedHosts.ts
  - src/documentdb/playground/playgroundWorker.ts
  - src/services/errorExplanationService.ts
---

# Sovereign Clouds (Azure Government, Azure China)

Microsoft Entra ID sign-in to Azure DocumentDB clusters in sovereign clouds, and readable
explanations when Entra sign-in fails.

## Status

**Parts A and B implemented; sovereign-cloud verification pending.**
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
  managed identity, using an explicit audience override, the cluster host's cloud, or public-only
  IMDS recognition (`AZUREPUBLICCLOUD`). An unclassified private hostname on a Government or
  China VM requires `documentDB.customEnvironment.ossrdbmsEndpoint`; the VS Code sign-in cloud
  is not a managed identity signal.
- [playgroundWorker.ts](../../../../src/documentdb/playground/playgroundWorker.ts): the shell and
  playground worker asks the main thread for a token; the main thread resolves its scope.
- [managedIdentityConnectionString.ts](../../../../src/documentdb/auth/managedIdentityConnectionString.ts):
  writes a best-effort cloud-aware `TOKEN_RESOURCE` into copied connection strings.
- [oidcAllowedHosts.ts](../../../../src/documentdb/auth/oidcAllowedHosts.ts): narrows Entra
  destinations to hosts below `mongocluster.cosmos.azure.com`, `mongocluster.cosmos.azure.us`,
  `mongocluster.cosmos.azure.cn`, or the validated single custom suffix. Every seed must qualify.
  The existing `documentDB.customEnvironment.hostnameSuffix` is machine-scoped; workspace/folder
  settings and Settings Sync cannot grant trust. Broad Azure/service parents, `cloudapp` labels,
  sovereign customer-hosting parents, bare TLDs and common public suffixes are rejected.
- [oidcClientOptions.ts](../../../../src/documentdb/auth/oidcClientOptions.ts): sanitizes URI
  authentication, TLS-bypass and CA/proxy overrides, narrows `ALLOWED_HOSTS`, and forces certificate
  validation plus policy-first `checkServerIdentity` for main-thread and worker OIDC clients.
  Custom trust does not waive certificate or all-host requirements.
- [entraErrors/](../../../../src/documentdb/auth/entraErrors/): the single classifier table,
  pure text classifier, recent token-failure registry, and Entra error explainer.
- [errorExplanationService.ts](../../../../src/services/errorExplanationService.ts): the
  provider registry that routes Entra explanations to existing foreground error surfaces.

Azure management (subscription listing, ARM clients) already follows the selected cloud through
`AzureSubscription.environment`; nothing is planned there.

Entra and managed identity attempts attach only `cloudCategory`, `tokenResourceReason`,
`configuredCloud`, `hostCloud`, and `entraFailureKind` closed enums to existing `connect.startup` and
`worker.startup` telemetry. The attempt's trace context owns these properties; raw resolution
details (including resources and local IMDS evidence) are never spread into telemetry.
See [telemetry correlation IDs](../../telemetry-correlation-ids.md#entra-cloud-resolution).
Destination checks additionally project bounded `entraDestinationClass` and, on rejection,
`microsoftCloudDomain` / `serviceLabel` flags through `authTrace` into existing startup properties.
See the [unexecuted WI0 query](../deep-links/iterations/04-entra-token-destination-hardening.md#wi0-bounded-measurement-query-not-executed);
no production sizing or measurement-first release is claimed.

`ClustersClient` sends the same extension `appName` to known `azure.com`, `azure.us`, and
`azure.cn` endpoints using the existing closed Azure suffix matcher. Lookalikes are excluded.
Domain telemetry keeps its historical classification and hashes, so the D11 query remains valid.

Local resolution traces retain an IMDS `azEnvironment` only when it matches
`^Azure[A-Za-z]{1,40}$`; other nonempty values are `other`. Existing case-insensitive
`AZUREPUBLICCLOUD` recognition is unchanged. No new IMDS-to-cloud mapping is inferred (D7),
and this local evidence is excluded from startup telemetry.

The Entra diagnostics rule table also recognizes the driver's precise OIDC `ALLOWED_HOSTS`
host-rejection message through `ErrorExplanationService`, without echoing the host, changing the
error, or requiring a recent token failure. Destination rejections use the trusted-server explanation and
Learn More/recovery flow; neither a driver error nor a picker row grants trust. Compare portal
connection strings and report a missing endpoint before considering a narrow suffix override.

Both custom-environment properties have Settings schema patterns and actionable validation
messages. The audience validation added in R1 is reused. The hostname-suffix schema checks DNS
shape, an optional leading dot and common public suffixes; the runtime destination policy also
rejects broad service/customer-hosting parents. Empty or whitespace-only values still clear either
property. The audience/resource-manager configuration is independent of destination trust.

The hostname property is `hostnameSuffix`, renamed before shipping without a compatibility alias.
Earlier iteration records retain the original property name.

`sovereignAuth.integration.test.ts` exercises the real default audience resolvers and cloud
configuration reader through Government/China handlers, plus Government shell/playground worker
token requests. Only token APIs and worker transport are simulated; worker/session managers and
credential lookup remain real. These are offline wiring checks, not live sovereign-cloud validation.

## Documents

- [Entra destination hardening](../deep-links/iterations/04-entra-token-destination-hardening.md):
  accepted Option B scope, local enforcement evidence, and live verification limits.
- [Trusted-server user guide](../../../user-manual/entra-id-trusted-servers.md): service FQDNs,
  certificate requirements, and the existing narrow machine trust override.
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
- The new service suffix policy does not supply live Government/China/private-link endpoint or
  certificate evidence. Manual recovery/picker/navigation and localization layout are pending.
- Not confirmed which audience DocumentDB accepts in US Government. ARM metadata publishes the
  `usgovcloudapi.net` URI as the OSSRDBMS resource there, but no DocumentDB document confirms it.
- Whether China clusters accept the public audience today (check telemetry before shipping, D11).
