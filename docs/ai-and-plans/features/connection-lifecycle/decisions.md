---
feature: connection-lifecycle
kind: decisions
status: active
created: 2026-11-19
---

# Connection lifecycle: decisions

> Why connections stay usable across token expiry and idle drops, and how open surfaces behave
> when credentials or the identity change. Evidence: [research-findings.md](./research-findings.md).

| #    | Decision                                                                                                   | Status   | Changed from the proposal?                             | Date       | PR  |
| ---- | ---------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------ | ---------- | --- |
| 0001 | Entra tokens are renewed silently in every OIDC callback; the callback never prompts                       | Accepted | Operator accepted the explanation (2026-11-19)         | 2026-11-19 | —   |
| 0002 | Keep one cached client per cluster; surfaces resolve it per operation with identity + generation           | Accepted | Operator position: per-operation clients cost too much | 2026-11-19 | —   |
| 0003 | An open surface never moves to a different identity; it becomes disconnected, keeps its state and says why | Accepted | Operator requirement                                   | 2026-11-19 | —   |
| 0004 | Disconnect lets the user choose: close all affected tabs, or keep them open and disabled                   | Accepted | Operator position; the default is still open (Q2)      | 2026-11-19 | —   |
| 0005 | Fix stale ARM credentials by upgrading azureauth to v6 (#990), not with a local shim                       | Accepted | Operator: open to updating dependencies                | 2026-11-19 | —   |
| 0006 | Deliver through `feature/connection-lifecycle` with sub-PRs, avoid PRs on top of open PRs, ship once       | Accepted | Operator chose this over one big PR and GitHub stacks  | 2026-11-19 | —   |

> Entries below are **semantically** immutable: append new entries rather than rewriting old ones,
> and record reversals as a new entry plus a status change above. Heading text is frozen once
> written; a retitle means a new decision.

**Status vocabulary:** `Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

---

## 0001. Entra tokens are renewed silently in every OIDC callback; the callback never prompts

**Accepted** by the operator on 2026-11-19.

The OIDC callback calls `getSession` with `silent: true` and pins the account and tenant that the
connection started with. VS Code's MSAL refreshes the access token from its refresh token, so the
normal case is silent. The driver already calls the callback again after a code 18 rejection
(`automated_callback_workflow.js`), so a callback that returns a fresh token is enough to recover.

When silent renewal is impossible, the operation fails with a typed "sign-in required" error, and
the UI offers a single **Sign in again** action. Silent renewal is impossible when:

- the refresh token has expired or been revoked;
- a Conditional Access sign-in frequency policy, an MFA challenge or a CAE event requires the user;
- the account was signed out of, or removed from, VS Code.

The action calls `getSession` with `createIfNone` for the same account and tenant, then reconnects.

Rejected:

- **`createIfNone: true` inside the callback.** This is what vscode-cosmosdb does as a last resort,
  and it is behind their open P1 microsoft/vscode-cosmosdb#3110 (repeated prompts, even after
  dismissal). It is rejected for four reasons:
  - The callback also runs for background work: pool reconnects, dashboard polling, tree refresh
    and completions. Prompts would appear with no user action.
  - The driver gives `OIDC_CALLBACK` a hard 60 s timeout, and an MFA sign-in can take longer.
  - The callback runs under a driver lock, so every operation queues behind the modal.
  - The prompt lets the user pick another account, which changes the identity behind open tabs
    (see 0003).
- **Proactive refresh timers.** Unnecessary, because the driver's code 18 retry together with
  silent acquisition covers expiry.

## 0002. Keep one cached client per cluster; surfaces resolve it per operation with identity + generation

**Accepted** by the operator on 2026-11-19 ("keeping versions or username/clusterid hash would be
sufficient/better").

`ClustersClient._clients` keeps one `MongoClient` per `clusterId`. Each client records:

- an **identity fingerprint**: the existing `getConnectionAuthIdentity` plus the signed-in Entra
  account;
- a **generation** that increases every time the client is replaced.

Surfaces hold `{ clusterId, fingerprint, generation }` and resolve the client per operation:

- same fingerprint and generation: proceed;
- same fingerprint, new generation: reconnect transparently, and re-run reads from the first page
  because cursors are lost;
- different fingerprint, or no client: disconnected (0003).

Rejected:

- **A new client for each operation** (vscode-cosmosdb). Creating a client costs about 1.1 s (p50)
  and 4.3 s (p90) for Native, and about 2.0 s and 9.0 s for Entra. It also loses cursors (pagination),
  server sessions and monitoring. This fits Cosmos's stateless HTTP; it does not fit a `MongoClient`.
- **Caching by `clusterId` + identity.** Two clients for one cluster could coexist, and tabs opened
  under the old credentials would keep working after Update Credentials. That is the permission
  risk 0003 removes, and it also leaks pools.

## 0003. An open surface never moves to a different identity; it becomes disconnected, keeps its state and says why

**Accepted.** Operator requirement (2026-11-19):

> we need to be careful about ensuring that a connection is tied to the user name, otherwise.. a
> user could change credentials and the user name, then the tabs would get a new permissions
> possibly, this is risky. so basically, when a user disconnects/updates credentials, we might need
> to "disconnect" the open tabs, like have valid disconnected state with discoverable info why no
> 'actions' are now allowed

- Triggers:
  - Disconnect;
  - Remove Connection;
  - Update Credentials or Update Connection String, when the fingerprint changes;
  - sign-out or removal of the bound Entra account (`onDidChangeSessions`);
  - silent renewal that is impossible (reason "Sign-in expired").
- A disconnected surface disables every action that talks to the server. It keeps the query text,
  filter, sort, projection, page position and unsaved document edits. It shows the reason and the
  matching action: Reconnect, Sign in again, or Close.
- A password change for the **same** user keeps the fingerprint. Tabs continue on the new client,
  because the permissions follow the user.
- Today, Document View, the index and Query Insights routers, and the Cluster Dashboard already
  resolve a client per operation **without** an identity check. They would quietly continue under
  the new identity, so they are in scope.

## 0004. Disconnect lets the user choose: close all affected tabs, or keep them open and disabled

**Accepted** in principle by the operator on 2026-11-19 ("we could give an option to the user:
close all, or keep open but disabled"). The default, and whether the choice is remembered, are
still open (plan Q2). The proposal is to keep tabs open and disabled by default, and to remember the
choice in `globalState`, the same way the Atlas and Kubernetes view modes are remembered.

## 0005. Fix stale ARM credentials by upgrading azureauth to v6 (#990), not with a local shim

**Accepted.** The operator is open to updating dependencies, and the upgrade is already planned for
1.2.0 in #990.

azureauth v6 calls `getSessionFromVSCode(..., { silent: true })` for every `getToken`. It also
satisfies the request-object contract that azureutils 4.2's `BearerChallengePolicy` already expects.

Rejected:

- **A local wrapper in `AzureSubscriptionProviderWithFilters`.** It would duplicate upstream v6
  logic, and it would be thrown away when #990 lands.
- **Staying on 5.1.1, the latest stable.** It still captures the token.

## 0006. Deliver through `feature/connection-lifecycle` with sub-PRs, avoid PRs on top of open PRs, ship once

**Accepted** by the operator on 2026-11-19. Source: operator input during planning.

> I'm for 'one big PR', I had some bad experience with stacked PRs and the need of moving updates up
> the chain before being able to recover and in the end, I had to merge them individually anyway. so
> maybe a 'feature' branch for this and then PRs against it, sometimes on top of other PRs, but
> without the 'stack' feature from github. [...] it won't be a partial release, it all will go out
> at once.

After the evaluation, the operator chose the feature-branch model and asked to reduce PRs opened on
top of other open PRs: "not required, just welcomed".

- It follows CONTRIBUTING §1.4 (large features).
- It fits the repository's enforcement:
  - CI runs on PRs to `feature/**`;
  - the `feature/**` ruleset requires a reviewed PR and blocks force pushes;
  - only merge commits are allowed, and head branches are deleted on merge.
- Merge commits keep the original commits. A PR opened on top of another one therefore shrinks to
  its own diff, and is retargeted automatically, once its base merges. That makes the exception
  workable without moving updates up the chain.
- The split and the rules are in [the plan's Delivery section](./iterations/01-implementation-plan.md#delivery).

Rejected:

- **One big PR to `main`:**
  - The diff mixes a dependency migration, host lifecycle changes, three webviews and teardown, so
    review and AI pre-review get worse.
  - Each push dismisses the approval.
  - There are no reviewed checkpoints, and conflicts with `main` are resolved only at the end.
- **GitHub stacked PRs:** the operator's experience was that updates must move up the chain and the
  PRs end up merged one by one anyway.
- **Shipping WI-1 and WI-2 early as a patch (plan Q5):** no partial release.
