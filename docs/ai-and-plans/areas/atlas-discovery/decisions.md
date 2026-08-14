# PR #733 — Atlas MongoDB Discovery: Work Items and Design Decisions

**Branch:** `dev/bchoudhury/atlas-mongodb-discovery`
**Plugin path:** `src/plugins/service-atlas-mongodb/`
**Date:** 2026-06-15

---

## What Was Built

A new **Service Discovery provider** for MongoDB Atlas, enabling users to browse their Atlas
**Projects → Clusters** hierarchy directly in the VS Code extension's Discovery View — alongside
the existing Azure DocumentDB provider.

### Scope

| Area                                  | Files                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Plugin registration                   | `AtlasDiscoveryProvider.ts`, `config.ts`                                    |
| Auth: Quick Pick + two flows          | `AtlasAuthQuickPick.ts`, `AtlasApiKeyFlow.ts`, `AtlasServiceAccountFlow.ts` |
| Auth: session state machine + storage | `AtlasSession.ts`, `AtlasSessionManager.ts`, `AtlasServiceAccountClient.ts` |
| Atlas Admin API client                | `api/AtlasApiClient.ts`, `api/AtlasDigestAuth.ts`                           |
| Tree items                            | `AtlasServiceRootItem.ts`, `AtlasProjectItem.ts`, `AtlasClusterItem.ts`     |
| Data models                           | `AtlasClusterModel.ts`, `AtlasProjectModel.ts`                              |
| New Connection Wizard integration     | `SelectAtlasSteps.ts`, `AtlasExecuteStep.ts`                                |

---

## Work Items

### 1. Initial plugin scaffold and Atlas tree

Created the full plugin structure: `DiscoveryProvider` implementation, tree items (root / project / cluster), Atlas Admin API client, session management, and the two auth flows (API key, service account).

### 2. Service Account session refresh on expiry

Added silent token refresh: when the Atlas API returns 401, the caller asks `sessionManager.tryRefreshIfPossible()` to mint a new Service Account token (from the stored `client_id`/`client_secret`) before giving up and signing the user out. `AtlasSessionManager.getSession()` also detects expiry from the stored `expiresAt` timestamp and refreshes before returning to callers.

---

## Design Decisions

### 1. Plugin folder, not a service (`src/plugins/` vs `src/services/`)

The Atlas provider lives under `src/plugins/service-atlas-mongodb/` rather than `src/services/`. The rationale: it is self-contained (auth, API client, tree items, models all together) and follows the same pattern as any future third-party discovery source. A `services/` placement would imply a singleton shared across the whole extension; this is scoped to Discovery View only.

### 2. Two authentication methods via a single QuickPick entry point

The `AtlasAuthQuickPick` presents two options: API Key, Service Account. Both map to the same `AtlasSession` union type consumed by `AtlasApiClient`.

**Why two methods, not one?**

- **API Key (HTTP Digest)** — long-lived, no expiry; good for users who already manage Atlas API keys.
- **Service Account** — machine-to-machine (CI/CD, team shared credentials); uses `client_credentials` grant.

A design that forced a single auth method would exclude large groups of Atlas users.

### 3. Interactive browser sign-in (OAuth): rejected — no officially supported third-party path today

An interactive, browser-based sign-in would be the most user-friendly option for human use. We investigated it and **rejected it for now**: MongoDB Atlas does not expose an officially supported, documented path that a third-party tool like this extension can rely on (no supported redirect-URI registration for unregistered apps, and no public device-authorization client registration). Building on undocumented or unsupported endpoints would create a fragile dependency we are not willing to ship.

**Decision:** Ship with the two officially supported mechanisms — **API Key** (HTTP Digest) and **Service Account** (`client_credentials`). Revisit interactive sign-in as **future work** if and when MongoDB provides a supported integration path.

### 4. HTTP Digest authentication required a custom implementation

The Atlas Admin API uses **HTTP Digest Auth** for API Key authentication — not HTTP Basic and not Bearer. The native `fetch` API in Node.js does not handle Digest challenges automatically (unlike browsers or `curl`). A small custom implementation was written:

- `api/AtlasDigestAuth.ts` — parses the `WWW-Authenticate: Digest ...` challenge header and computes the `Authorization: Digest ...` response per RFC 7616 (MD5, qop=auth).
- `AtlasApiClient` makes two requests per call for API key sessions: one unauthenticated to obtain the challenge, one authenticated with the computed header.

**Considered alternative:** Use a third-party Digest-auth library. Rejected: adds a dependency for ~80 lines of well-understood crypto (just MD5 + nonce counting), which would need to be vetted for security and kept up to date.

### 5. Two-layer auth model: Atlas Admin API ≠ MongoDB wire protocol

Atlas has two completely independent authentication layers:

- **Layer 1 — Atlas Admin API** (API Key / Service Account): used only for discovery — listing projects and clusters. This is `AtlasSession`.
- **Layer 2 — MongoDB wire protocol** (SCRAM username/password): used to actually connect to a cluster's database. This is handled by the existing `CredentialCache` / `ClustersClient` / `ClusterItemBase` machinery.

`AtlasClusterItem` extends the shared `ClusterItemBase`, which already knows how to prompt for Layer 2 credentials. `getCredentials()` returns the connection string from the Atlas API response; the rest of the auth flow (username/password prompt) is inherited from `ClusterItemBase`.

This separation is intentional: an Atlas Admin API session does not grant database-level access. Users must still authenticate with SCRAM credentials.

### 6. `clusterId` format: stable, slash-free composite key

The `BaseClusterModel` dual-ID pattern requires a stable `clusterId` for credential and client caching. Atlas cluster identifiers from the API are in the form `<projectId>/<clusterName>`, which contains `/`. Since `/` is used as a path separator in tree IDs, the `clusterId` is constructed as:

```
atlas-mongodb-discovery_{projectId}_{clusterName}
```

This is stable even if the user moves the connection to a different folder (the `treeId` changes; `clusterId` does not). The provider prefix ensures no collision with Azure or other future discovery sources.

### 7. Session state stored across VS Code restarts

- **Secrets** (tokens, private keys, client secrets): stored in `vscode.SecretStorage` (OS-level keychain encryption).
- **Preferences** (auth method, selected projects, user display name): stored in `vscode.Memento` (globalState, plaintext, non-sensitive).

`AtlasSessionManager.restoreSession()` rehydrates from SecretStorage on extension activation, so users do not have to re-authenticate every time they open VS Code.

### 8. Silent Service Account token refresh before giving up on 401

When `getChildren()` receives a 401 from the Atlas API, the first action is `tryRefreshIfPossible()` — for a Service Account session, mint a fresh access token from the stored `client_id`/`client_secret`. Only if that refresh fails is the session cleared and the user shown a sign-in node.

This prevents a jarring sign-out when the access token simply expired between sessions.

**The opposite strategy (always re-prompt on 401) was rejected** because it would require users to re-authenticate whenever the short-lived token expired, making the discovery view unusable across a normal working day.

### 9. 401 vs 403 handled differently

- **401 Unauthorized**: the session is invalid/expired and refresh failed. Sign out completely (`sessionManager.signOut()`), reset to None state, show a "Sign in" node.
- **403 Forbidden**: the session authenticated, but the credentials lack the required permissions (e.g., an API key without the right project/org roles). For Service Account sessions, a silent token refresh is attempted first; if it still fails, the cached session is cleared via `sessionManager.signOut()` and an error node with the API message is shown.

> **Revised (see Bug 5):** The original design did **not** sign out on 403, on the assumption that the credentials were correct and the user merely needed to be added to the project. In practice, the common 403 case is an under-privileged API key. Leaving the session cached meant "Manage Credentials" took the already-signed-in path and never let the user re-enter credentials. The session is now cleared on 403 so that "Manage Credentials" re-prompts for authentication.

### 10. User display name loaded lazily, fire-and-forget

The `getCurrentUser()` call is deliberately non-blocking (a `void`-dispatched promise). If it fails (network blip, partial permissions), the display name simply stays empty — no error is surfaced to the user. This avoids making the tree load feel slow for a cosmetic UI element.

Service Accounts do not have a user profile, so the call is skipped entirely for `type === 'serviceaccount'`.

### 11. Organization filter lives in "Manage Credentials", project filter in the Filter icon

Two separate filtering mechanisms were built:

- **Org filter** (`Manage Credentials` command): persisted in `globalState`, scopes the visible projects to those belonging to a selected Atlas organization. Intended for users who belong to many orgs.
- **Project filter** (tree `enableFilterCommand` context): further narrows which projects are shown within the already-scoped org view.

These are stored independently because they serve different use cases (org scoping is a credential-level setting; project filtering is a view preference).

### 12. Failed-children cache must be explicitly cleared after successful authentication

`DiscoveryBranchDataProvider` (inherited from `BaseExtendedTreeDataProvider`) caches the error nodes that were returned by `getChildren()` for a given tree path. Without explicit clearance, a successful authentication followed by a tree `refresh()` would re-serve the cached sign-in error node rather than re-calling `getChildren()`.

The `onDidChangeSession` listener in `AtlasDiscoveryProvider` therefore calls `resetNodeErrorState(rootId)` **before** `refresh()`:

```
transitionTo(Active)
  → onDidChangeSession fires
    → resetNodeErrorState(rootId)   // clear cached error/sign-in node
    → refresh()                     // VS Code re-calls getChildren()
```

Without the `resetNodeErrorState()` call, a user who authenticates successfully would still see the "Sign in" node until they manually collapsed and re-expanded the tree.

### 13. Projects and organizations fetched in parallel

`AtlasServiceRootItem.fetchProjectItems()` issues both `client.listProjects()` and `client.listOrganizations()` concurrently via `Promise.all`. The organization list is needed to resolve org names for the org-filter label and the "Manage Credentials" display — but it is not needed to build the project tree items themselves. Fetching them in parallel shaves one full round-trip off the perceived load time.

**Considered alternative:** Fetch organizations lazily only when the "Manage Credentials" flow is opened. Rejected because the organization list is small (rarely more than a handful) and the parallel fetch cost is negligible, while a lazy fetch would add a noticeable delay to the manage-credentials dialog at a moment when the user is actively waiting.

### 14. Atlas Admin API version pinned via `Accept` header

All requests to the Atlas Admin API include:

```
Accept: application/vnd.atlas.2023-02-01+json
```

Atlas uses versioned media types to gate breaking schema changes. By pinning to `2023-02-01`, the extension is insulated from future response-shape changes (new required fields, renamed properties) that could silently break parsing. If Atlas introduces a newer, preferable schema in a future version, opting in is a deliberate one-line change in `AtlasApiClient`.

### 15. Provider info resolved from `providerSettings` (legacy) with fallback to `replicationSpecs` (API v2)

The Atlas Admin API v2 moved cloud provider metadata from the top-level `providerSettings` object to `replicationSpecs[].regionConfigs[]`. Both shapes appear in real responses depending on the cluster's age and tier:

- **Legacy / free-tier clusters**: return `providerSettings: { providerName, regionName, instanceSizeName }` at the top level.
- **Newer clusters / API v2**: return `replicationSpecs[0].regionConfigs[0]` with the same fields nested inside.

`createAtlasClusterModel()` checks `providerSettings` first; if absent, walks down into `replicationSpecs`. This ensures tier/provider/region labels (`M10, AWS, us-east-1`) display correctly for both old and new clusters without requiring two separate code paths.

### 16. SRV connection string preferred over standard

`AtlasClusterModel.connectionString` is populated as:

```typescript
cluster.connectionStrings.standardSrv ?? cluster.connectionStrings.standard;
```

SRV records (`mongodb+srv://`) encode replica set membership and routing dynamically via DNS — the driver resolves the current set of replica nodes at connection time, and failover is handled transparently. The `standard` (host-list) format hard-codes the initial seed list, which can become stale after cluster scaling events or node replacements.

Free-tier (M0) clusters and some legacy deployments do not publish an SRV record; for those the `standard` URI is the fallback.

### 17. Sign-in placeholder node and "Manage Credentials" share a single command entry point

When no session exists, `AtlasServiceRootItem` returns a `createSignInNode()` placeholder. That node is wired to the `discoveryView.manageCredentials` command with the root item as argument — the same command that appears in the right-click context menu on the "Atlas MongoDB" root node.

This was intentional: rather than adding a bespoke `atlas.signIn` command, the sign-in node re-uses the existing credential management flow. There is one code path through `AtlasDiscoveryProvider.configureCredentials()` for all authentication triggers (initial sign-in, re-authentication, account switch), which makes the state machine easier to reason about and test.

---

## Bugs Encountered and Fixed

### Bug 1 — 401 on project-level cluster fetch signed the user out entirely

**Symptom:** If the Atlas API returned 401 when expanding a **project** node (to load its clusters), the session was cleared and the root "Atlas MongoDB" node reverted to the sign-in state — even though the access token for the root-level project list had been working fine moments earlier.

**Root cause:** `AtlasProjectItem.getChildren()` in the initial implementation handled 401 errors by calling `sessionManager.signOut()` immediately:

```typescript
// BEFORE (broken — in AtlasProjectItem)
if (error instanceof AtlasApiError && error.statusCode === 401) {
  await this.sessionManager.signOut();
  return [this.createSignInNode()];
}
```

There was no attempt to refresh the token first. A 401 on a cluster fetch (e.g., after the access token expired mid-session while projects were already displayed) would destroy the entire session.

**Fix:** Added the same refresh-then-retry logic to `AtlasProjectItem.getChildren()` that `AtlasServiceRootItem` already had:

```typescript
// AFTER (fixed — in AtlasProjectItem)
if (error instanceof AtlasApiError && error.statusCode === 401) {
    const refreshedSession = await this.sessionManager.tryRefreshIfPossible();
    if (refreshedSession) {
        try {
            const retryClient = new AtlasApiClient(refreshedSession);
            const retryClusters = await retryClient.listClusters(this.project.id);
            return retryClusters.sort(...).map(...);
        } catch {
            // Refresh succeeded but retry still failed — fall through to sign out
        }
    }
    await this.sessionManager.signOut();
    return [this.createSignInNode()];
}
```

**Why only the root item had the retry in the initial commit:** The refresh logic was added to `AtlasServiceRootItem` during design, but `AtlasProjectItem` was written later as a separate class and the pattern wasn't duplicated. This highlights a latent maintenance risk: if a new tree level is added (e.g., a database-level item that also calls the Atlas API), the refresh-then-retry pattern must be applied there too. A future refactor could centralise this in `AtlasApiClient` itself.

---

### Bug 2 — 403 "Access denied" left a stale session cached, so "Manage Credentials" never re-prompted for credentials

**Symptom:** When the Atlas Admin API returned `403 Forbidden` ("Access denied. Verify your API key has the required permissions.") — typically because the supplied API key lacked the required project/org roles — the tree showed an error node, but the under-privileged session stayed cached as `Active`. Clicking **Manage Credentials** then took the "already signed in" path (showing the account with a _Sign Out_ option) instead of letting the user re-enter their credentials. The only way to recover was to manually sign out first, then sign back in.

**Root cause:** `AtlasServiceRootItem.getChildren()` treated 403 as a non-destructive "lacks permissions" case and returned an error node **without** clearing the session:

```typescript
// BEFORE (broken — in AtlasServiceRootItem)
if (error.statusCode === 401) {
  await this.sessionManager.signOut();
  return [this.createSignInNode()];
}

// 403 — genuinely lacks permissions
return [this.createErrorNode(error.message)];
```

Because the session remained `Active`, `AtlasDiscoveryProvider.configureCredentials()` short-circuited into the signed-in branch and never reached `authenticateAndFetchUserInfo()` (which prompts for the auth method and credentials). `AtlasProjectItem.getChildren()` had the same gap — it only cleared the session on 401, not 403.

**Fix:** On a 403, clear the cached session via `sessionManager.signOut()` in both tree levels (after the token refresh-then-retry attempt still fails). With the session reset to `None`, the next **Manage Credentials** invocation skips the already-signed-in path and prompts for authentication again.

```typescript
// AFTER (fixed — in AtlasServiceRootItem)
if (error.statusCode === 401) {
  await this.sessionManager.signOut();
  return [this.createSignInNode()];
}

// 403 — genuinely lacks permissions. Clear the cached session so that
// "Manage Credentials" re-prompts for authentication instead of showing
// the already-signed-in path with a stale, under-privileged session.
await this.sessionManager.signOut();
return [this.createErrorNode(error.message)];
```

`AtlasProjectItem.getChildren()` received the matching 403 branch (sign out + error node) alongside its existing 401 handling.

**Why the original design was reconsidered:** The initial reasoning (Decision #9) assumed a 403 always meant "valid credentials, missing project membership," where signing out would be destructive. In practice the dominant 403 case is an API key that was never granted sufficient permissions — and for that case the user genuinely needs to supply different credentials, which the cached session was actively blocking.
