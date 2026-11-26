---
feature: connection-lifecycle
kind: decisions
status: active
created: 2026-11-19
---

# Connection lifecycle: decisions

> Why connections stay usable across token expiry and idle drops, and how open surfaces behave
> when credentials or the identity change. Evidence: [research-findings.md](./research-findings.md).

| #    | Decision                                                                                                   | Status                      | Changed from the proposal?                                                           | Date       | PR                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------- |
| 0001 | Entra tokens are renewed silently in every OIDC callback; the callback never prompts                       | Accepted                    | Operator accepted the explanation (2026-11-19)                                       | 2026-11-19 | —                                                                |
| 0002 | Keep one cached client per cluster; surfaces resolve it per operation with identity + generation           | Accepted (modified by 0010) | Operator position: per-operation clients cost too much                               | 2026-11-19 | —                                                                |
| 0003 | An open surface never moves to a different identity; it becomes disconnected, keeps its state and says why | Accepted                    | Operator requirement                                                                 | 2026-11-19 | —                                                                |
| 0004 | Disconnect lets the user choose: close all affected tabs, or keep them open and disabled                   | Accepted                    | Operator position; the default is still open (Q2)                                    | 2026-11-19 | —                                                                |
| 0005 | Fix stale ARM credentials by upgrading azureauth to v6 (#990), not with a local shim                       | Accepted                    | Operator: open to updating dependencies                                              | 2026-11-19 | —                                                                |
| 0006 | Deliver through `feature/connection-lifecycle` with stacked sub-PRs, ship once                             | Accepted (amended)          | Operator removed the intermediate merge wait                                         | 2026-11-19 | —                                                                |
| 0007 | The Disconnect choice is a VS Code modal with nothing remembered; a setting can set the default            | Accepted (modified by 0018) | Operator: modal cannot pre-select; saved edits are close-only                        | 2026-11-19 | —                                                                |
| 0008 | Upgrade the azext stack as high as viable without breaking workflows, using Azure Resources as reference   | Accepted                    | Operator: replaces the "minimal versions" proposal                                   | 2026-11-19 | —                                                                |
| 0009 | Kubernetes tunnel recovery, cluster ID case handling and wider network-resilience testing move to #1105    | Accepted                    | Operator: keep 1.2.0 focused; schedule after release                                 | 2026-11-19 | —                                                                |
| 0010 | Rely on the server to reject expired tokens; replacing a client for the same identity is transparent       | Accepted                    | Operator: no rotation, no out-of-date notices                                        | 2026-11-19 | —                                                                |
| 0011 | Disconnect keeps the cached credentials and the verified identity; only Remove drops them                  | Accepted                    | Operator: reverses the #1059 proposal (plan Q3)                                      | 2026-11-19 | —                                                                |
| 0012 | Keep the lifecycle design minimal: no state machine, one epoch, no prompts in getClient, one-step teardown | Accepted                    | Operator: approved every proposed simplification                                     | 2026-11-19 | —                                                                |
| 0013 | Correct the minimal design where it lost edits, identity or recovery: latch before save, epoch checks      | Accepted (modifies 0012)    | Operator: "update the plan" after the omissions review                               | 2026-11-19 | —                                                                |
| 0014 | Keep in-memory connection settings after a rejection for a verified Entra identity                         | Accepted                    | Operator selected A to make sign-in recovery smoother                                | 2026-11-23 | Yes; WI-5 previously said to delete the entry                    |
| 0015 | Use the existing latch to block startup after authentication rejection                                     | Accepted                    | Operator selected A; keep the approach simple and pragmatic                          | 2026-11-23 | Yes; expands the existing latch rather than adding a second hold |
| 0016 | Keep disconnected webviews open under a full-view overlay                                                  | Accepted (modified by 0017) | Operator chose a simple disabled state with explicit actions                         | 2026-11-24 | Yes; replaces the inline banner and single-action layout         |
| 0017 | Limit unavailable webview recovery to Retry and Close view                                                 | Accepted (modified by 0018) | Operator wants credential repair in the tree and no extra recovery workflow in a tab | 2026-11-24 | Yes; removes in-view credential repair                           |
| 0018 | Saved connection edits permanently lock existing views                                                     | Accepted                    | Operator prefers simple reconnect for unchanged settings over recovery after edits   | 2026-11-24 | Yes; removes same-identity recovery after a saved edit           |
| 0019 | Require a fresh Dashboard delete after Disconnect and keep Paste Collection in the tree                    | Accepted                    | Operator: a lifecycle change cancels the pending delete and never replays it         | 2026-11-24 | —                                                                |
| 0020 | Defer the cross-release comparison of late failures                                                        | Accepted                    | Operator: keep descriptive telemetry and defer the comparison                        | 2026-11-26 | Yes; removes the WI-9 before/after comparison for 1.2.0           |

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

## 0006. Deliver through `feature/connection-lifecycle` with stacked sub-PRs, ship once

**Accepted** by the operator on 2026-11-19. Source: operator input during planning.

> I'm for 'one big PR', I had some bad experience with stacked PRs and the need of moving updates up
> the chain before being able to recover and in the end, I had to merge them individually anyway. so
> maybe a 'feature' branch for this and then PRs against it, sometimes on top of other PRs, but
> without the 'stack' feature from github. [...] it won't be a partial release, it all will go out
> at once.

After the evaluation, the operator initially asked to reduce PRs opened on top of other open PRs:
"not required, just welcomed".

**Amended by the operator on 2026-11-19:** Approvals will take time, so build and open each next
sub-PR on the preceding PR's branch without waiting for it to merge. The operator will follow up
with approvals and merges. This changes neither the explicit operator test gates nor the single
release from the feature branch.

**Amended by the operator on 2026-11-20:** PR publication is pre-approved. Push the topic branch
and open its draft PR without asking for separate confirmation. This does not authorize merges
or remove review, verification, or operator test gates.

- It follows CONTRIBUTING §1.4 (large features).
- It fits the repository's enforcement:
  - CI runs on PRs to `feature/**`;
  - the `feature/**` ruleset requires a reviewed PR and blocks force pushes;
  - only merge commits are allowed, and head branches are deleted on merge.
- Merge commits keep the original commits. A PR opened on top of another one therefore shrinks to
  its own diff once its base merges and GitHub retargets it. Verify the retargeting after each merge.
- The split and the rules are in [the plan's Delivery section](./iterations/01-implementation-plan.md#delivery).

Rejected:

- **One big PR to `main`:**
  - The diff mixes a dependency migration, host lifecycle changes, three webviews and teardown, so
    review and AI pre-review get worse.
  - Each push dismisses the approval.
  - There are no reviewed checkpoints, and conflicts with `main` are resolved only at the end.
- **GitHub's stack feature:** not needed; use ordinary PRs targeting the preceding branch.
- **Shipping WI-1 and WI-2 early as a patch (plan Q5):** no partial release.

## 0007. The Disconnect choice is a VS Code modal with nothing remembered; a setting can set the default

**Accepted** by the operator on 2026-11-19. It answers plan Q2, which decision 0004 left open. Source:
operator input on the dev plan's provisional answer A2.

> this will be a modal dialog from vs code, so we can't preselect, we don't need to remember. we can add
> a setting for users to control their default if they want.

- The Close all / Keep open (disabled) choice from 0004 is a VS Code modal. A modal has no pre-selected
  button, and its built-in Cancel cancels the whole operation.
- The choice is **not remembered** between uses.
- A setting lets users pick a default: `ask` (the default) shows the modal; `closeAll` or
  `keepOpenDisabled` skips it. The setting never skips the unsaved-edits confirmation.
- The choice applies to Disconnect and Remove Connection. Decision 0018 makes a saved identity or
  settings edit close-only instead: existing views keep their contents but are not moved to the
  new connection.

Rejected:

- **Pre-select Keep open and remember the last choice in `globalState`** (the earlier proposal): a modal
  cannot pre-select a button, and a remembered answer that silently changes what the next Disconnect does
  is less predictable than an explicit setting.

## 0008. Upgrade the azext stack as high as viable without breaking workflows, using Azure Resources as reference

**Accepted** by the operator on 2026-11-19. Source: operator input on the dev plan's provisional
answer A4.

> check what 'azure resoruces' extension is using, that's the same team that's behind the auzreauth
> package, and that azure resources extnesion is heavily used., I'd update / upgrade as hihgh as viable
> and not breaking our fworkflows.

- The #990 upgrade (0005) targets the highest versions of azureauth, azureutils, utils and
  `@microsoft/vscode-azureresources-api` that keep our workflows working, with one installed copy of each.
- The Azure Resources extension is the reference, because the same team owns azureauth and the extension
  is heavily used. On 2026-11-19 its `main` used azureauth `^6.1.0-alpha.2`, azureutils `^4.3.0` and
  utils `^4.1.0`.
- The dev plan ([iterations/01-dev-plan.md](./iterations/01-dev-plan.md), WI-3 step 1) holds the version
  ladder, the evidence and the workflow checks that define "not breaking".

Rejected:

- **The minimal set** (azureauth `6.0.0-alpha.8` with azureutils 4.2 and utils 4.1, the earlier
  proposal): it stays behind the line the azureauth owners run, and it would mean a second migration
  later. It remains only as the last fallback if a higher level breaks a workflow that cannot be fixed.

## 0009. Kubernetes tunnel recovery, cluster ID case handling and wider network-resilience testing move to #1105

**Accepted** by the operator on 2026-11-19. Source: operator input during dev planning.

> I'd consider moving kubernetes fixes and the adding 'network resilience' as a new issue to work on
> once 1.2.0 ships, this would also simplify this dev plan.

Moved to [#1105](https://github.com/microsoft/vscode-documentdb/issues/1105), to be scheduled after
1.2.0:

- re-creating Kubernetes port-forward tunnels outside the tree. Today only `beforeCachedClientConnect`
  restores a tunnel, when a tree node expands;
- tunnel ownership on Disconnect and Remove, and running the teardown when a kubeconfig source is
  removed;
- provider-specific cluster ID matching, which the approved plan had put in WI-7. Today
  `CredentialCache` folds case, so Kubernetes `Prod` and `prod` collide, and task conflict matching does
  not fold, so it misses Azure case aliases. Both behaviors already exist today;
- Kubernetes API credential expiry (the AKS exec plugin);
- a network-resilience test matrix beyond OT-4, including a Kubernetes acceptance test.

**Amended by the operator on 2026-11-23:** Stable fingerprints across Kubernetes forwarded-port
changes also move to #1105. Until then, keep the identity check unchanged: if a closed binding
still exists and the forwarded port changes, automatic replacement can reject it as an identity
change. Do not ignore port changes for ordinary connections or bypass the fingerprint check.

**Stays in iteration 1:** generic idle and network-drop recovery. That means closed-client and transient
classification, the cancelled-reuse fix, closed-client replacement and OT-4, which together are #1102's
"recover on the next operation without a restart".

**Guard:** tunneled connections must not get worse.

- Connection refused against a port-forward port is `transient`: the client is kept, not evicted.
- Per-operation resolution does no less than today's tree path.

A tab whose tunnel died therefore behaves exactly as it does today.

Rejected:

- **Doing it in 1.2.0:** it adds a second layer (tunnels) to a release that is already the largest
  connection change so far, for an authentication method that does not expire. The case-handling bugs
  already exist and are rarely hit (two contexts that differ only in case).

## 0010. Rely on the server to reject expired tokens; replacing a client for the same identity is transparent

**Accepted** by the operator on 2026-11-19. It answers T-1 in the dev plan. It modifies 0002's "re-run
reads from the first page", and drops the approved plan's WI-1 requirement that a known-expired token is
never offered on a new socket. Source: operator input at planning.

> I wouldn't worry about this guarantee, the server will tell us, then we can act, this is easier. sure
> we can have a local check for some expirations, but that's unreliable anyway.

> no banners about out of date, this can be another future work issue [...] this is really an edge case.

- **Expired tokens:**
  - No proactive client rotation and no local expiry checks.
  - The server rejects an expired token with code 18; the driver then calls the OIDC callback again,
    which renews silently (0001).
  - The operator test OP-1 in the dev plan confirms what the server actually returns. If it closes the
    socket instead, the failure classifier acts on that: the next foreground operation gets a new client
    with a fresh token cache.
- **Replacing a client for the same identity** (recovery from a closed client, Sign in again with the same
  account) is **transparent**: open views continue on the new client, with no re-run of the query and no
  notice. 0002's reason for re-running, lost cursors, does not apply: Collection View pages with offset
  queries.
- **No "results may be out of date" notice anywhere in this iteration,** including when a view returns
  from the disconnected state. Whether to indicate stale data (after a reconnect, a long idle, or writes)
  is [#1106](https://github.com/microsoft/vscode-documentdb/issues/1106).

Rejected:

- **Proactive rotation when the issued token expires:** it covers only host operations, not the pool's own
  sockets or the shell and playground workers, unless rotation is coordinated across all of them. It
  costs a reconnect about every hour, and local expiry checks are unreliable anyway.
- **Re-run page 1 with a "results are no longer current" notice** (0002 as written): it would appear after
  every reconnect, for no correctness benefit.

## 0011. Disconnect keeps the cached credentials and the verified identity; only Remove drops them

**Accepted** by the operator on 2026-11-19. It answers plan Q3 (dev plan A3), reversing the #1059
proposal that Disconnect drops `CredentialCache`. Source: operator input on the pre-hand-over review of
the dev plan.

> we should not drop the credential cache, that was too premature

- **Disconnect** closes the client, stops the shell and playground workers, latches the cluster and
  handles open surfaces (0004, 0007). It keeps the `CredentialCache` entry and `lastVerifiedIdentity`.
- **Remove Connection** drops both. An identity-changing credential update keeps the new credentials and
  replaces the verified identity on its next successful connect.
- Evidence from the review (the operator's reason is the quote above): `ClustersClient` can start a client only from a `CredentialCache` entry, and only the tree fills it
  (dev plan F-20). Dropping it on Disconnect would leave a tab's Reconnect with nothing to connect from,
  because surfaces never prompt. Keeping `lastVerifiedIdentity` makes that Reconnect silent and pinned to
  the same identity. If the Entra session is gone, it fails with **Sign in again** (0001), never with a
  prompt for another account.
- The same review found that the tree drops `CredentialCache` on **every** connect failure, including
  network errors. The dev plan (WI-5 step 3) now keeps the entry for recoverable failures and evicts it
  only when credentials were rejected.

Rejected:

- **Drop `CredentialCache` on Disconnect (#1059, the earlier provisional answer A3):** it needs a second
  credential-loading path outside the tree for every provider (storage, ARM, Atlas, Kubernetes), and the
  user must retype a password that was typed only for a discovery connection.

## 0012. Keep the lifecycle design minimal: no state machine, one epoch, no prompts in getClient, one-step teardown

**Accepted** by the operator on 2026-11-19, after a review of the dev plan for over-engineering. Source:
operator input.

> the premise is simple, so I don't want to have too many managers, controllers, and reconcile tools
> processes in the plan.

> apply all simplifications to the plan, and I approve all simplifications.

The dev plan ([iterations/01-dev-plan.md](./iterations/01-dev-plan.md)) now follows these rules:

- **No stored connection state.** There is no cluster state machine, no projected surface state, no state
  service with change events, and no tRPC state subscription. A surface learns its state when it resolves
  its binding; routers return a structured "unavailable" result. The only push is teardown calling
  `disable(reason)` on each registered surface, and that registry is a plain list.
- **One staleness guard:** the per-client generation plus one per-cluster epoch. The separate startup,
  lifecycle and surface epochs, the dashboard loop token and the worker instance IDs are gone. A stale
  result is checked once on the host, before it changes anything; the webview ignores responses while its
  banner shows.
- **`getClient` never prompts.** The `interaction` parameter and the audit of every call site are gone.
  Only the tree's first connect and Sign in again may prompt. Background callers pass `background: true`
  and never replace a client.
- **Teardown is two plain functions** (confirm, then commit), with a conflict recheck right before the
  commit. No reservation in TaskService and no rollback.
- **No `onDidChangeSessions` listener.** This changes the approved plan's WI-5. The next operation's
  silent lookup finds a signed-out account.
- **Four error classes:** `EntraSignInRequiredError`, `EntraIdentityMismatchError`, `TokenCallbackError`
  for any other callback throw (all auth methods), and `ConnectionUnavailableError { reason }`.
- **The fingerprint hashes the stored connection string without its password, plus the principal.** No
  normalization; any connection-string edit counts as an identity change.
- **Smaller removals:** the 30 s replacement backoff; startup abort only when every waiter aborted;
  two Sign in again paths (it always uses `forceNewSession`); shells and the playground in the surface
  registry; the changed-token telemetry, the remaining-validity measures and `connection.recovered`
  (this changes the approved plan's WI-9); the "outcome unknown" wording for writes; checkpoints CP-1 and
  CP-3, which become ordinary PR review. PR 5 stays one PR unless its diff becomes too large.

Unchanged: everything that carries an accepted decision (0001 to 0011), the single-flight startup, the
cancelled-reuse fix, closed-client replacement, the failure classifier and the export and import lease.

## 0013. Correct the minimal design where it lost edits, identity or recovery: latch before save, epoch checks

**Accepted** by the operator on 2026-11-19. It modifies 0012. Source: a review of the dev plan against the
code for omissions that could lose data, break reconnection or force a redesign; the operator agreed with
every finding and asked to "update the plan".

The findings, each confirmed in the code, and the corrections now in the dev plan
([iterations/01-dev-plan.md](./iterations/01-dev-plan.md)):

- **A credential change could be stored while teardown was refused**, and a failed save can still have
  written the secrets (F-21). Correction: an identity-changing update sets the latch **before** it saves,
  and new tasks and leases are refused while latched. After the save, the re-read stored connection
  decides: a changed fingerprint commits the teardown, an unchanged one clears the latch. This keeps 0012's
  "no reservation"; the latch is the only thing that can be undone.
- **An old reply could overwrite a newer edit after a Reconnect as the same user.** Correction: host-side
  results check the per-cluster epoch, not only the fingerprint and the latch, and the Document View
  applies a reply only if the editor has not changed since the request.
- **The binding was lost in handoffs** (F-23). Correction: a playground stores its fingerprint on the
  document's connection, not on the shared evaluator; Collection View passes its fingerprint to import and
  export, which check it before their first `getClient`.
- **Recovery was tied to tree expansion.** 0012 removed the operation wrapper. Correction: one stateless
  function, `runWithClient`, reports failures that happen during an operation; the dashboard sampler
  classifies errors before it turns them into strings (F-24).
- **Folder deletion bypassed teardown** (F-23). Correction: it runs the teardown for every connected
  descendant, with one combined confirmation.
- **Gates.** OP-1 is split: before the handler change it can only tell code 18 apart from a socket close;
  renewal is proven after it, on a new socket of the same client (`maxIdleTimeMS`). OT-7 no longer
  requires in-flight saves to fail, because `close(force)` cancels nothing (F-22); it requires no new
  submission, no replay, no stale UI update and no claim that an unacknowledged write was not applied.

None of the corrections adds a state machine or a service; 0012's other rules stand.

## 0014. Keep in-memory connection settings after a rejection for a verified Entra identity

A final Entra database authentication rejection still evicts the client. If the connection has a
verified Entra identity, keep its existing in-memory connection settings so **Sign in again** can
start from that identity, including when invoked with only `clusterId`. The operator chose this
over deleting the settings and losing that recovery action, to keep recovery smooth.

This does not retain the rejected token, write anything to persistent storage, change destination
checks, or start a silent retry. Native authentication and RU key handling are unchanged. The
explicit sign-in path still checks the epoch after prompting and never moves an open surface to a
different identity.

## 0015. Use the existing latch to block startup after authentication rejection

Evicting a rejected client is not enough: a subsequent operation could immediately start a new
one with the same settings. Set the existing in-memory latch to `credentialsRejected` before
evicting the rejected generation. The matching explicit recovery can clear that reason only if
the epoch still matches. It cannot clear a latch set by Disconnect, Remove or a credential change.

The operator chose to reuse the existing latch rather than introduce a separate authentication
hold, keeping one place to check for an unavailable connection. The rejection latch uses the
existing epoch and does not add a subscription, new persistence, or a retry loop.

## 0016. Keep disconnected webviews open under a full-view overlay

The operator chose a simple disabled state instead of the planned warning banner. Keep the
webview and its contents mounted, but make the background unavailable for interaction. Shade
the whole view and show a calm, centered explanation with a row of actions.

Always offer **Close**. If the connection has a supported recovery action, offer it alongside
Close. If there is no repair the tab can perform, show only **Close** and leave the tab open
until the user chooses it. Do not retry rejected credentials or navigate away automatically.
Keep this component local to the lifecycle webviews for now rather than adding a general
feature to the webview framework.

## 0017. Limit unavailable webview recovery to Retry and Close view

The operator decided that editing credentials from an open webview is not needed, including as
a WI-7 follow-up. Users repair credentials or sign in again from the tree. An unavailable view
keeps its contents under the Fluent dialog and offers **Close view** and, where safe, **Retry**.
Retry may attempt a connection with the credentials already available; it must not open a
credential wizard, bypass a credential rejection or removal, silently switch identities, or
resubmit the failed operation.

Retry keeps the tab bound to its original identity and does not clear a latch. After a
same-identity repair in the tree, Retry can use the repaired connection. After an identity
change, reopen from the tree instead of moving the old view or its draft to the new identity.
A dirty Document View warns that Close view discards unsaved changes, without a second prompt.

The operator approved testing the identity guard in OP-4 and testing the WI-7 **Keep open
(disabled)** choice and its disable message in OP-5. Neither check is dropped.

## 0018. Saved connection edits permanently lock existing views

The operator chose to optimize for the common workflow: reconnect with unchanged settings.
Recovering existing tabs after an explicit credentials or connection-string edit adds complexity
for an uncommon workflow. In WI-7, any such edit saved in this VS Code window that changes stored
connection details, including a password-only change, makes existing views **Close view** only.
Keep their contents and allow dismissal for copying. Do not prompt about tabs or close them when
saving; open new views from the tree after the edit. The Disconnect and Remove tab choices are
unchanged.

Silent renewal, a network reconnect and signing back in as the same account with unchanged
settings remain supported. A cancelled edit or a save that leaves storage unchanged does not lock
views. If a failed save partially changed storage, retire the old views and tell the user the
change may be incomplete. No cross-window watcher is added. The identity guard still checks
changes from other sources, and commands still check their originating binding after pickers
and confirmations.

## 0019. Require a new Dashboard delete after Disconnect

The operator chose to cancel any pending Dashboard delete confirmation when the
connection lifecycle changes, even if the user reconnects as the same identity.
The user must start a fresh delete. This check is limited to Dashboard deletes:
ordinary same-identity replacement remains transparent, and tree commands keep
their existing behavior.

The operator also kept **Copy Collection** in the Dashboard and **Paste Collection**
in the tree only. Copy stores a tree reference, not a snapshot of the data or
credentials. The later tree Paste uses the current connection; it does not resume
a Dashboard operation. Binding the whole clipboard and index-copy flow was not
part of this change.

## 0020. Defer the cross-release comparison of late failures

The operator chose to keep descriptive telemetry and defer the WI-9 before/after comparison
for 1.2.0. Auth and closed-client unavailability can now be returned as normal RPC responses,
which the SDK records as successes without a failure signature. An apparent drop across releases
could be a reporting change rather than improved recovery.

Keep renewal, client age and entry generation, and ARM challenge queries for a single version.
Do not add an instrumentation path or keep a socket-only comparison in this release. CP-5 still
checks pre-release ingestion and records that the late-failure trend is unmeasured.
