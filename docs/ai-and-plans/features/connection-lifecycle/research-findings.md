---
feature: connection-lifecycle
kind: research
status: active
created: 2026-11-19
verified: 2026-11-19
code:
    - src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
    - src/documentdb/auth/oidcClientOptions.ts
    - src/documentdb/ClustersClient.ts
    - src/documentdb/ClusterSession.ts
    - src/tree/documentdb/ClusterItemBase.ts
    - src/commands/retryAuthentication/retryAuthentication.ts
    - src/plugins/api-shared/azure/AzureSubscriptionProviderWithFilters.ts
    - src/utils/azureClients.ts
    - src/connectionDiagnostics/checks/resolveTarget.ts
---

# Why connections stop working in long-running sessions (#1102)

> Evidence gathered on 2026-11-18/19 for [#1102](https://github.com/microsoft/vscode-documentdb/issues/1102).
> Code was read at `main` @ `1180ceb2f`: mongodb driver 7.2.0, `@microsoft/vscode-azext-azureauth`
> 4.1.1, `@microsoft/vscode-azext-azureutils` 4.2.0, `@microsoft/vscode-azext-utils` 4.1.0.
> Telemetry comes from `ddtelvscode/VSCodeExt.RawEventsVSCodeExt`, last 28 full days. "Machines"
> means distinct `VSCodeMachineId`. Line numbers are at that commit and will drift; function names
> are the stable pointer.

## Summary

There are three separate defects. Two are about tokens that expire. The third is about a stale
client. Together they explain "everything is disconnected, and only restarting VS Code helps".

| #   | Defect                                                                                                                                                                   | Who                                     | Telemetry (28 days)                                                                                               | Confidence                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | The **Entra ID database token is captured once** and the OIDC callback returns it forever                                                                                | Interactive Entra ID (Azure DocumentDB) | ≥60 of 153 long-running Entra machines. No failures between 30 and 60 min; the first failures appear at 60–75 min | Verified (code + telemetry)                        |
| 2   | The **ARM token is frozen inside the `AzureSubscription`** that discovery tree items hold, and the ARM 401 challenge handler crashes with `e.endsWith is not a function` | Azure Discovery (vCore + RU)            | 27 of 350 discovery machines. **Every** ARM challenge in 28 days failed. Median onset is about 13 h               | Verified (code + telemetry)                        |
| 3   | **No recovery path.** The cached `ClustersClient` is never evicted, Retry reuses it, and Collection View tabs hold the old instance                                      | All auth methods                        | Amplifies #1. 16 machines saw "Client must be connected before running operations" in the Collection View         | Code verified; the trigger for #3b is a hypothesis |

Native (username and password) authentication is **not** affected by expiry. The driver signs every
new socket in again with SCRAM. Native failures are mostly timeouts, and a few code 18 errors that do
not depend on how long the connection has been open.

## 1. Entra ID (interactive) database connections

### Mechanism

- `MicrosoftEntraIDAuthHandler.configureAuth` acquires one VS Code session (`getSessionFromVSCode`,
  [MicrosoftEntraIDAuthHandler.ts:93-107](../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts)).
  It then builds the OIDC callback as a closure over that session
  ([MicrosoftEntraIDAuthHandler.ts:155-162](../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts)):
  `Promise.resolve({ accessToken: session.accessToken, expiresInSeconds: 0 })`.
- The wrapper in [oidcClientOptions.ts:151](../../../../src/documentdb/auth/oidcClientOptions.ts)
  (`buildOidcClientConfiguration`) checks the destination policy around the callback. It does not
  change the token.
- The driver can recover on its own. In `node_modules/mongodb/lib/cmap/auth/mongodb_oidc/automated_callback_workflow.js:22-51`,
  when the cached token gets code 18, the driver drops it and **calls the callback again**. Our
  callback returns the same expired token, so the code 18 error reaches the user.
- The driver gives `OIDC_CALLBACK` a hard **60 s timeout** (`AUTOMATED_TIMEOUT_MS`,
  `automated_callback_workflow.js:67-74`). The callback runs under a lock
  (`callback_workflow.js`, `withLock`).
- The `MongoClient` lives in the static `ClustersClient._clients` map until it is explicitly deleted
  ([ClustersClient.ts:196](../../../../src/documentdb/ClustersClient.ts)). Every new pool connection
  signs in through that callback. New pool connections appear after idle sockets close, or after the
  server drops sockets when the token expires.
- These paths are already correct, because they acquire a token for each callback:
  - managed identity ([ManagedIdentityAuthHandler.ts:103-148](../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts));
  - the shell and playground workers, whose `tokenRequest` IPC is answered on the main thread
    ([playgroundWorker.ts:189-230](../../../../src/documentdb/playground/playgroundWorker.ts) decodes
    the JWT `exp` claim; [ShellSessionManager.ts:450](../../../../src/documentdb/shell/ShellSessionManager.ts);
    [PlaygroundEvaluator.ts:467](../../../../src/documentdb/playground/PlaygroundEvaluator.ts)).
    However, both of these use **`createIfNone: true` inside the callback**, so a token refresh in
    the background can open a sign-in prompt.
- VS Code's Microsoft auth provider (MSAL) refreshes access tokens silently from its refresh token.
  `getSession(..., { silent: true })` inside the callback returns a valid token without a prompt in
  the normal case.

### Telemetry

Failures were attributed to auth methods through successful `connect.startup` events in the same
`VSCodeSessionId`, using single-auth sessions only. "Late" means at least 60 min after the last
successful startup in that session.

| Auth     | Signature                      | Surface                  | Machines late     | Machines early |
| -------- | ------------------------------ | ------------------------ | ----------------- | -------------- |
| Entra ID | code 18 `AuthenticationFailed` | tree                     | **60** (430 rows) | 15             |
| Entra ID | `connection N to … closed`     | tree                     | **41**            | 13             |
| Entra ID | `connection N to … closed`     | Collection/Document View | **40**            | 5              |
| Native   | code 18                        | tree                     | 14                | 11             |
| Native   | timeout                        | tree / webview           | 26 / 18           | 9 / 7          |

Denominators, from sessions with a successful connect:

| Auth     | Machines | Machines active ≥60 min after connect |
| -------- | -------- | ------------------------------------- |
| Native   | 921      | 674                                   |
| Entra ID | 187      | 153                                   |
| No Auth  | 107      | 48                                    |

Age of the **first** failure in sessions that used only Entra ID:

| Age        | Sessions with code 18 | Sessions with socket closed |
| ---------- | --------------------- | --------------------------- |
| <30 min    | 4                     | 0                           |
| 30–60 min  | **0**                 | **0**                       |
| 60–75 min  | 8                     | 12                          |
| 75–90 min  | 11                    | 16                          |
| 90–120 min | 27                    | 25                          |
| 2–4 h      | 28                    | 36                          |
| 4–8 h      | 17                    | 17                          |
| ≥8 h       | 49                    | 55                          |

Failures start at 60–90 min, which matches the lifetime of an Entra access token. The socket-closed
errors start at the same time. **Hypothesis, not confirmed with the service team:** the server closes
connections when the token expires, and the following reconnects then fail with code 18.

## 2. Azure Discovery (ARM) credentials

### Mechanism

1. In azureauth 4.1.1, `VSCodeAzureSubscriptionProvider.getSubscriptionsForTenant`
   (`out/src/VSCodeAzureSubscriptionProvider.js:319-331, 364-391`) creates every subscription with
   `authentication.getSession = () => session` and a credential that returns the token captured at
   listing time.
2. Discovery tree items keep that subscription (`readonly subscription` in
   [DocumentDBResourceItem.ts:45](../../../../src/plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem.ts),
   and the same in the RU and VM items).
3. ARM clients are built through `createSubscriptionContext` ([azureClients.ts](../../../../src/utils/azureClients.ts) →
   azext-utils `credentialUtils.js:33-44`). The credential wraps `subscription.authentication.getSession`,
   which is the frozen session.
4. After the token expires, ARM answers 401 with a challenge. The azureutils 4.2.0 `BearerChallengePolicy`
   (`createAzureClient.js:76-98`) calls `createCredentialsForScopes(challengeRequest)`, which leads to
   `getSessionWithScopes(requestObject)`. azureauth 4.1.1 expects a list of scope strings and calls
   `scope.endsWith(...)`, which throws **`TypeError: e.endsWith is not a function`**. azureutils
   4.2.0 is built against azureauth `^6.0.0-alpha.6`.
5. Diagnostics turns this into `target.sourceInaccessible` with reason `other`, which shows as
   "Azure details unavailable". The TypeError has no HTTP status and no sign-in error name
   ([resolveTarget.ts:52-82](../../../../src/connectionDiagnostics/checks/resolveTarget.ts),
   [readCredentialsForDiagnostics.ts](../../../../src/tree/documentdb/readCredentialsForDiagnostics.ts)).
6. Refresh or Retry on a cluster node reuses the subscription stored on the item. Only listing the
   subscriptions again creates a new session.

azureauth 5.1.1, the latest stable version, still captures the token. **v6 (alpha) fixes this:**
`AzureSubscriptionProviderBase.getToken` calls `getSessionFromVSCode(..., { silent: true })` on every
call. Upgrading is tracked in [#990](https://github.com/microsoft/vscode-documentdb/issues/990).

### Telemetry

- `challenge=true` occurs only together with `challengeSuccess=false` and
  `challengeError="e.endsWith is not a function"`. **There is no successful challenge** in the 28 days.
  Affected events include `azure-discovery.getchildren` (12 machines), `connect` from vCore discovery
  (8), `getcredentials` from RU discovery (8), and `azure-mongo-ru-discovery.getchildren` (3).
- 27 of the 350 machines that used Azure discovery were affected (about 8%). Onset was a median of
  about 13 h after the session's first discovery event; the 25th percentile is 96 min.

## 3. No recovery path, and stale references

- `ClustersClient.getClient` returns the cached instance and calls `mongoClient.connect()`
  ([ClustersClient.ts:571-619](../../../../src/documentdb/ClustersClient.ts)). That call does nothing
  on a live topology. On a closed topology it reconnects with the same options, so with the same
  stale callback.
- No error path evicts a client on code 18, code 391 or a network failure. `deleteClient` is called
  only by Update Credentials ([updateCredentials.ts:142](../../../../src/commands/updateCredentials/updateCredentials.ts)),
  Update Connection String, Remove Connection and Local Quick Start cleanup.
- The tree's **Retry** ([retryAuthentication.ts](../../../../src/commands/retryAuthentication/retryAuthentication.ts))
  only resets the node's error state and refreshes it. `getChildren` then reuses the cached client
  and fails again ([ClusterItemBase.ts:358-447](../../../../src/tree/documentdb/ClusterItemBase.ts)).
- Different surfaces get their client differently:
  - **`ClusterSession` holds a direct client reference.** Collection View queries and the AI
    services use it ([ClusterSession.ts:65-78, 688-725](../../../../src/documentdb/ClusterSession.ts);
    `initNewSession` is called from [openCollectionView.ts:67](../../../../src/commands/openCollectionView/openCollectionView.ts)).
  - **These resolve the client per operation**, with no identity check:
    - Document View ([documentsViewRouter.ts:54,91](../../../../src/webviews/documentdb/documentView/documentsViewRouter.ts));
    - the index and Query Insights routers;
    - the Cluster Dashboard.

    After an identity change, these would quietly use the new identity.

- The Cluster Dashboard `measureRtt` polls the cached client
  ([clusterDashboardRouter.ts:221-225](../../../../src/webviews/documentdb/clusterDashboard/clusterDashboardRouter.ts)).
  Polling backoff is tracked in [#1091](https://github.com/microsoft/vscode-documentdb/issues/1091).
- **Possible triggers for "Client must be connected before running operations"** (16 machines):
  - `updateCredentials` calls `deleteClient` while Collection View tabs still hold the closed client.
  - The `getClient` abort handler closes the **shared** cached client when someone cancels a cached
    reuse ([ClustersClient.ts:586-592](../../../../src/documentdb/ClustersClient.ts)).
- There is no Disconnect command. It is proposed in [#1059](https://github.com/microsoft/vscode-documentdb/issues/1059),
  and its overlap with Remove Connection is [#566](https://github.com/microsoft/vscode-documentdb/issues/566).
- Under sovereign-clouds decision D12 ([decisions.md](../sovereign-clouds/decisions.md)), open
  shells snapshot their identity and token audience, and Update Credentials does not touch them. That
  snapshot is a precedent for the identity binding proposed here.

## 4. Native auth, RU and others

- **Native (SCRAM):** idle socket closes recover on their own. Late failures are timeouts, which
  points to sleep, VPN or idle firewalls. The code 18 errors appear about as often early as late,
  so they point to changed credentials rather than expiry.
- **RU:** the extension authenticates with account keys only. These are fetched from ARM through
  `listConnectionStrings` ([ruClusterHelpers.ts](../../../../src/plugins/service-azure-mongo-ru/utils/ruClusterHelpers.ts)).
  Signing in to Azure matters only for discovery, which is defect #2. A regenerated key causes
  code 18 until the client is recreated, which is defect #3.
- **Managed identity:** already correct.

## 5. How telemetry reports this today

- `connect.startup` masks its whole error, which is by design. Failure events after the connection
  has been established carry neither `authMethod` nor connection age. Attributing them needs a join
  on `connectionCorrelationId` (1.1.0+) or on `VSCodeSessionId`.
- `connectionCorrelationId` is present on only about 2% of the tree failures with code 18 in the
  window.
- Webview RPC failures keep the real message only in `errorcause`.
- Some code 18 messages are replaced by the secret scanner.
- Diagnostics reports the ARM challenge crash as `other` instead of `signInRequired`.
- No event records "a client that had worked failed" or "recovered".

## 6. How vscode-cosmosdb handles this (origin/main `3b19fd92`, 2026-11-19)

- **Data-plane Entra tokens are never captured.** `aadCredentials.getToken` calls `getSessionFromVSCode`
  on every request and returns `expiresOnTimestamp: 0` (`src/cosmosdb/getCosmosClient.ts:98-124`).
  This is the pattern this plan adopts.
- **Prompting:** as a last resort, they call `createIfNone: true` from inside the token callback
  (`getCosmosClient.ts:151-190`). That causes the open P1 microsoft/vscode-cosmosdb#3110: the sign-in
  prompt keeps coming back after the session expires, even after the user dismisses it. Users ask for
  a disconnected or read-only mode. **Avoid this.**
- **Subscriptions** come from the Azure Resources host extension, which owns token refresh. Their azext
  major versions match (azureauth 5.1.1, azureutils 5, utils 5).
- **No client cache:** a new `CosmosClient` is created for each operation, and tabs hold a connection
  descriptor. Cosmos traffic is stateless HTTP, so this works for them. It is **not** suitable for us;
  see decision [0002](./decisions.md).
- **Query Editor connection state:** a `connectionVersion` counter. A connection change disposes its
  sessions, and stale results are rejected with "These query results are no longer current. Run the
  query again before using them." (`panels/trpc/queryEditorConnectionState.ts`).
- **Gaps they share with us:**
  - Remove does not close or notify open tabs.
  - There is no `onDidChangeSessions` listener.
  - There is no identity binding: `getSession` is called without `account`, so a tab can quietly use
    a different account.
  - The shell receives a captured token.

## 7. Cost of creating a client (why the cache stays)

Successful `connect.startup` durations over the last 14 days. The value is `Measures.duration`,
read as seconds:

| Auth     | Startups | p50     | p90    |
| -------- | -------- | ------- | ------ |
| Native   | 2,102    | ~1.1 s  | ~4.3 s |
| Entra ID | 912      | ~2.0 s  | ~9.0 s |
| No Auth  | 188      | ~0.07 s | ~1.8 s |

A `MongoClient` also owns server sessions and monitoring, and the shell and playground hold cursors.
Collection View pagination does **not** hold a cursor: each page is a separate offset (`skip`) query, as
`ClusterSession.runFindQueryWithCache` shows (corrected 2026-11-19; an earlier version of this document
said it used `getMore`). A per-operation client would still cost seconds per action.

## Appendix: queries

The queries were run in the local telemetry dashboards devbox worktree, using the
`vscode-documentdb-telemetry-dashboards` skill. They are summarized here so they can be rerun.

- **Failure signatures:** failed events whose `errormessage` or `errorcause` matches
  `Authentication failed` or `error == "18"`, `connection … closed`, `ECONNRESET`,
  `Client must be connected`, or `timed out`, grouped by event.
- **Attribution by session:**
  - Failures joined to successful `connect.startup` (`startupoutcome == "succeeded"`) on
    `VSCodeSessionId`, with `StartTs <= FailTs`.
  - Only sessions where every startup used the same `authmethod`.
  - Late means `FailTs - max(StartTs) >= 60 min`.
- **Histogram of the first failure:** sessions that used only Entra ID, from
  `min(FailTs) - min(StartTs)`.
- **ARM challenge:** `Properties.challenge == "true"` or a non-empty `challengeerror`. Reach is
  measured against machines with any Azure discovery event (`discoveryproviderid` starting with
  `azure-`).
