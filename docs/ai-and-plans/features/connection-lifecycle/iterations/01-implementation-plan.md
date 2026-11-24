---
feature: connection-lifecycle
kind: plan
status: active
created: 2026-11-19
code:
    - src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
    - src/documentdb/auth/oidcClientOptions.ts
    - src/documentdb/auth/connectionAuthIdentity.ts
    - src/documentdb/ClustersClient.ts
    - src/documentdb/ClusterSession.ts
    - src/documentdb/shell/ShellSessionManager.ts
    - src/documentdb/playground/PlaygroundEvaluator.ts
    - src/tree/documentdb/ClusterItemBase.ts
    - src/commands/retryAuthentication/retryAuthentication.ts
    - src/commands/updateCredentials/updateCredentials.ts
    - src/webviews/documentdb/collectionView/collectionViewRouter.ts
    - src/webviews/documentdb/documentView/documentsViewRouter.ts
    - src/webviews/documentdb/clusterDashboard/clusterDashboardRouter.ts
    - src/plugins/api-shared/azure/AzureSubscriptionProviderWithFilters.ts
    - src/connectionDiagnostics/checks/resolveTarget.ts
---

# Iteration 1: keep connections usable across token expiry, idle drops and credential changes

**Issues:**

- [#1102](https://github.com/microsoft/vscode-documentdb/issues/1102) (this plan);
- folded in: [#1059](https://github.com/microsoft/vscode-documentdb/issues/1059) (Disconnect) and
  [#566](https://github.com/microsoft/vscode-documentdb/issues/566) (one teardown for Remove and
  Disconnect);
- executed as a dependency: [#990](https://github.com/microsoft/vscode-documentdb/issues/990)
  (azureauth v6);
- coordinated: [#1091](https://github.com/microsoft/vscode-documentdb/issues/1091) (dashboard polling).

**Branch:** `feature/connection-lifecycle` (sub-PRs from `dev/tnaum/*`; see [Delivery](#delivery)) ·
**Milestone:** 1.2.0, shipped as one release

The analysis, evidence and source pointers are in [../research-findings.md](../research-findings.md),
and the decisions in [../decisions.md](../decisions.md). Neither is repeated here. This plan orders the
work. **It deliberately does not specify interfaces**: a dedicated agent designs them per work item,
following the decisions. Progress is recorded **inline, against each work item**, when that item is
committed.

**Execution detail:** [01-dev-plan.md](./01-dev-plan.md) expands each work item into steps, cross-PR
contracts, advisor checkpoints and provisional answers to the open questions. Progress is recorded inline
there.

## Goal

A user who leaves VS Code open for hours, with tabs and shells open, **never has to restart VS Code**
and **never loses work** (query text, filters, sort, projection, unsaved document edits).

- Token expiry and idle drops recover silently.
- When the user really has to act (sign in again, credentials changed, they disconnected), every
  affected surface shows a clear disconnected state with the reason and one action. It never quietly
  continues under a different identity.

## Mapping to #1102 acceptance criteria

| #1102 criterion                                                                                         | Work items |
| ------------------------------------------------------------------------------------------------------- | ---------- |
| Entra: renew without prompting; never reuse an expired token for a new connection                       | WI-1, WI-2 |
| Standard auth: reconnect with the configured credential; if invalid, prompt to update, no endless retry | WI-5       |
| Interactive sign-in keeps Collection View tabs and their state, then uses the recovered connection      | WI-5, WI-6 |
| Recover on the next operation without a restart; never silently replay writes                           | WI-5, WI-6 |
| Discovery (signing in to Azure) is separate from database authentication                                | WI-3       |

## Execution order

```
WI-1 ──┐                                (Entra silent renewal)
      │
WI-3 ─┤                                 (azureauth v6 / #990, parallel track)
      │
WI-4 ─┴─> WI-5 ─> WI-6 ─> WI-7 ─> WI-8   (lifecycle core, then Disconnect, then dashboard)
                              └──> WI-2 (worker relays, after the disconnect guard)
                                    └──> WI-9 (telemetry check) ─> WI-10 (docs)
```

- WI-1 and WI-3 are independent of the lifecycle core. WI-2 needs WI-4's verified identity and
  fingerprint, and the disconnect latch used by WI-7.
- WI-1 and WI-2 remove most of the user impact (defect #1). They still ship with everything else;
  there is no partial release (decision [0006](../decisions.md)).

## Delivery

**Model (decision [0006](../decisions.md)):** a `feature/<name>` branch with sub-PRs, following
[CONTRIBUTING §1.4](../../../../../CONTRIBUTING.md#14-large-features).

- `feature/connection-lifecycle` is created from `main`.
- Each sub-PR comes from a `dev/tnaum/<topic>` branch and ultimately merges into the feature
  branch, where it gets its own review, AI pre-review and checks. The operator handles approvals
  and merges.
- **One** final PR, `feature/connection-lifecycle` → `main`, ships everything in a single release.
- Use ordinary PRs targeting the preceding branch, not GitHub's stack feature.

**How the repository enforces this** (checked 2026-11-19):

- `main.yml` runs on `pull_request` to `feature/**`.
- The `feature/**` ruleset:
  - every change goes through a PR with one code-owner approval;
  - the last push needs approval, and a new push dismisses stale approvals;
  - required checks are `license/cla` and `Merge gate`;
  - **force pushes and deletion are blocked**.
- Repository merge settings: **merge commits only** (squash and rebase are disabled), and head
  branches are deleted on merge.

### Rules for stacking sub-PRs

1. **Do not wait for approvals or an intermediate merge to start or open the next PR.** Branch from
   the preceding PR's head and target that branch while its PR is open. If it has already merged,
   branch from and target `feature/connection-lifecycle` instead.
2. **Keep implementation gates.** The stack order does not remove any advisor checkpoint or
   operator decision or test. Stop at those as specified. Run the existing verification locally
   even when CI does not run on a PR targeting an intermediate branch.
3. **Group work items into one PR** when they are strongly coupled and reviewable together. Keep
   commits per work item inside the PR, so the inline progress notes can name them.
4. **Integrate bottom-up.** Do not merge a sub-PR into the preceding topic branch. After the
   predecessor merges, verify the next PR targets `feature/connection-lifecycle` before merging it.
   To pick up later changes from the base, use `git merge <base>`. Never rebase or force-push after a
   human review (CONTRIBUTING §1.6).
5. **Sync `main` into the feature branch** through a PR, because force pushes are blocked:
   - weekly, and once more right before the final PR;
   - as a pure merge, with no feature work in it;
   - on `l10n/bundle.l10n.json` and `package-lock.json` conflicts, take either side and
     regenerate (`npm run l10n`, `npm install`). Never hand-merge them.

### PR split

| PR  | Content                                                                          | Base while predecessor is open             |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------ |
| 0   | This plan, `research-findings.md`, `decisions.md`, README and index row          | feature branch                             |
| 1   | WI-1: Entra silent renewal                                                       | PR 0 head                                  |
| 2   | WI-3: azureauth v6 (#990) + the diagnostics `signInRequired` mapping             | PR 1 head                                  |
| 3   | WI-4: client identity and generation, the two cache fixes, telemetry helper      | PR 2 head                                  |
| 4   | WI-5: failure classifier, recovery, Sign in again, Retry, `onDidChangeSessions`  | PR 3 head                                  |
| 5   | WI-6: surface binding and the disconnected state (host and webviews)             | PR 4 head                                  |
| 6   | WI-7 + WI-8: teardown, Disconnect, Remove, Update Credentials, dashboard polling | PR 5 head                                  |
| 7   | WI-9 + WI-10: telemetry signals and dashboards, documentation                    | PR 6 head                                  |
| F   | `feature/connection-lifecycle` → `main`                                          | `main` (all sub-PRs merged, OT-1–7 passed) |

- WI-4 consumes the verified account, provider and tenant contract from WI-1. Do not reconstruct
  the identity from a later cache read.
- **WI-2 scheduling (operator approved 2026-11-20):** Deliver the Shell and Playground token relays
  together, after WI-4's verified identity and connection fingerprint and WI-7's disconnect latch
  are available. Keep the planned **Sign in again** action. PR 1 is WI-1 only; it does not change
  worker relay behavior.
- **PR 5 is the largest.** If it becomes too large to review well, split it into host (5a) and
  webviews (5b). Stack 5b on 5a, and PR 6 on 5b, following rule 1.
- **#990 alternative:** #990 is its own issue in the 1.2.0 milestone. It can merge to `main` instead,
  which keeps the busiest lockfile changes off the feature branch; it would still ship in the same
  release. The default is the feature branch, so that the discovery fix and the WI-3 diagnostics
  mapping are reviewed together.

### Verification per PR

- **Sub-PRs (draft or in progress):** Case 1, as in the copilot instructions: `npm run build`,
  plus `npx vitest run <paths touched>`.
- **Sub-PRs marked ready for review:** Case 2 in full. That includes `l10n:check`, `lint`,
  `typecheck:tests`, the full Vitest suite and `package`. The AI pre-review is committed under
  `iterations/` as `01-<pr>-review.md`, following the knowledge-base naming rules.
- **Final PR F** has three gates:
  - Case 2;
  - the CONTRIBUTING §1.4 checklist: packaged-VSIX validation means the operator acceptance tests
    below; telemetry is WI-9; docs are WI-10;
  - a ~1-week watch after the merge.

---

## WI-1: Entra ID, renew silently on every OIDC callback (decision 0001)

**Problem:** the callback returns the token captured at connect time
([MicrosoftEntraIDAuthHandler.ts:155-162](../../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts)).

- The first connect stays as it is: interactive when the user asked for it (`createIfNone`), and it
  records the account that signed in (`onTokenAcquired` already exposes `account`).
- **Each callback** calls `getSessionFromVSCode([scope], tenantId, { silent: true, account })`, with
  the account pinned.
  - Return `expiresInSeconds` from the JWT `exp` claim. Reuse the decoding in
    [playgroundWorker.ts:215-230](../../../../../src/documentdb/playground/playgroundWorker.ts) and
    [tokenExpiry.ts](../../../../../src/documentdb/auth/tokenExpiry.ts).
  - Keep the destination policy checks that wrap the call
    ([oidcClientOptions.ts:151](../../../../../src/documentdb/auth/oidcClientOptions.ts)).
- If there is no session, or a different account comes back, throw a **typed sign-in-required
  error**. Never prompt from the callback. It must work with the existing `AuthInputUnavailableError`
  and with the Entra failure registry. Per the comment at
  [MicrosoftEntraIDAuthHandler.ts:117](../../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts),
  a silent miss is not a token failure.
- Route the typed error through `ErrorExplanationService`
  ([errorExplanationService.ts](../../../../../src/services/errorExplanationService.ts); see the
  error-translation skill) so every surface gets the same message: "Your Microsoft sign-in for
  '{cluster}' expired. Sign in again to continue."
- **Unit tests:**
  - A second callback consults the provider again and uses its result; identical token bytes are
    valid while the token is still good.
  - A silent miss gives the typed error, and `getSession` is never called with `createIfNone`.
  - A different account is reported as such.
  - The destination policy is still enforced.

**Driver verification gate:** in a local probe at `e22a39b8d`, driver 7.2.0 tried its cached token
on a new connection even with `expiresInSeconds: 0`. Code 18 on that token triggered the callback;
a transport failure did not. Returning the JWT lifetime alone does not meet #1102. Demonstrate
that a known-expired token is not offered on a new socket, including speculative authentication.
After a callback threw, the same driver workflow reused the rejection; a fresh workflow succeeded.
Test that explicit recovery replaces the failed workflow rather than retrying it indefinitely.

> **Changed 2026-11-19 (decision [0010](../decisions.md)):** the "known-expired token is not offered"
> requirement is dropped. The extension relies on the server rejecting an expired token, after which the
> driver calls the callback and renews silently. No proactive rotation, no local expiry checks. The
> operator test OP-1 in [01-dev-plan.md](./01-dev-plan.md) checks what the server actually returns.

## WI-2: Shell and Playground token relays use the same policy

**Problem:** both relays call `createIfNone: true` inside the worker's token request
([ShellSessionManager.ts:450](../../../../../src/documentdb/shell/ShellSessionManager.ts),
[PlaygroundEvaluator.ts:467](../../../../../src/documentdb/playground/PlaygroundEvaluator.ts)).

- Extend the [D12 snapshot](../../sovereign-clouds/decisions.md): it pins the audience today, **not**
  the VS Code account. Capture the verified account ID, provider/cloud and tenant on initial
  acquisition. Fail closed if the provider changes or the returned account does not match.
- A miss puts the shell or playground into a "sign in again" state: a printed line and an action. It
  never opens a modal during a background refresh.
- Fold in the #1059 note: `PlaygroundEvaluator.buildInitMessage`
  ([PlaygroundEvaluator.ts:288](../../../../../src/documentdb/playground/PlaygroundEvaluator.ts)) reads
  `CredentialCache` on every run.
- **Unit tests:** the current worker IPC drops a sign-in-required error's type. Verify that a
  bounded reason reaches the host action during both init and a warm evaluation. A healthy warm
  worker must not need a new cache read; build its init message only when spawning it.

## WI-3: Azure discovery, azureauth v6 (#990, decision 0005)

Execute #990 as written. The issue already lists the breaking APIs, call sites, dedupe rule, l10n
bundle, filter and cache behavior, and how to verify. Additions from this investigation:

- **Version alignment:**
  - azureutils 4.2.0 expects azureauth `^6.0.0-alpha.6`; the challenge contract is the cause of the
    `endsWith` crash.
  - Pick versions so the bundle contains a **single** azureauth copy (see #990 "Dedupe").
  - Decide together whether to move azext-utils and azureutils to v5, as vscode-cosmosdb did
    (azureauth 5.1.1 + azureutils 5 + utils 5; their host owns refresh). #626 is now stale; utils is
    already 4.1.0.
- **Discovery tree items keep `AzureSubscription` objects:**
  - Confirm that v6 `credential.getToken` and `authentication.getSession` acquire a token on every
    call, so a subscription that was stored hours ago still works.
  - Discovery item pointers: [DocumentDBResourceItem.ts](../../../../../src/plugins/service-azure-mongo-vcore/discovery-tree/documentdb/DocumentDBResourceItem.ts),
    [MongoRUResourceItem.ts](../../../../../src/plugins/service-azure-mongo-ru/discovery-tree/documentdb/MongoRUResourceItem.ts),
    and the VM items.
  - ARM client creation: [azureClients.ts](../../../../../src/utils/azureClients.ts).
- **Diagnostics:** classify ARM sign-in failures as `signInRequired`, not `other`:
  - `NotSignedInError`;
  - a failed challenge;
  - an `interaction_required` or AADSTS sign-in error.

  The place is `classifyResolutionFailure`
  ([resolveTarget.ts:52-82](../../../../../src/connectionDiagnostics/checks/resolveTarget.ts)). Keep it
  bounded: an error name and status only in the report, never messages (decision R2 in connectivity-troubleshooter).
  A local probe of `6.0.0-alpha.8` through `createSubscriptionContext` confirmed that a held
  subscription looks up a session again. On a silent miss the actual exception had `name: "Error"`
  and no HTTP status; the current test manufactures `name: "NotSignedInError"`. Use the package's
  `isNotSignedInError` guard and test the real exception. A challenge can request interactive
  step-up; do not infer that ARM discovery shares the database callback's no-prompt behavior.

- **Unit test:** a stored subscription whose first token "expires" still lists clusters (mock the
  session sequence).
- **Fallback:** if #990 is not merged by the time WI-6 is ready, raise it with the operator before
  changing course. Decision 0005 rejected a local shim.

## WI-4: Client identity, generation and two cache bugs (decision 0002)

In [ClustersClient.ts](../../../../../src/documentdb/ClustersClient.ts):

- **Identity and generation:** every client records, when it is created:
  - an identity fingerprint: [getConnectionAuthIdentity](../../../../../src/documentdb/auth/connectionAuthIdentity.ts)
    plus the signed-in Entra account id from WI-1;
  - a per-cluster **generation**;
  - its creation time.

  The fingerprint is derived from **what was used to connect**, not from the current `CredentialCache`.
  The helper alone returned `native:sam` for two hosts and two auth databases. Bind the logical
  deployment plus the effective principal (including auth source). Using a stable Kubernetes
  provider target instead of the forwarded local port is deferred to #1105 (decision 0009).
  Test managed identity using the actual runtime credential
  shape, a password-only change, and the same username on a different deployment or auth source.

- **Fix:** cancelling a _cached_ reuse must not close the shared client.
  - Pointer: the `getClient` abort handler at
    [ClustersClient.ts:586-592](../../../../../src/documentdb/ClustersClient.ts).
  - This is a likely trigger for "Client must be connected before running operations"
    (research §3).
- **Fix:** never hand out a client whose topology was closed.
  - Today `getClient` calls `connect()` on a closed client, which reconnects with the old options.
  - Replace it with a new generation that uses the current credentials, keeping the same fingerprint
    rule.
- **Telemetry base:** one helper adds `authMethod`, `connectionAgeMs` and `clientGeneration` to any
  failure that happens after the connection was established. The surfaces in WI-5 and WI-6 call it.
  Follow the telemetry-instrumentation skill; property names must not contain "error" (masking).
- **Concurrent startup and teardown:** two deferred cold gets produced two clients, and a pending
  connect repopulated the cache after deletion completed. Share one startup per cluster; invalidate
  the generation before teardown awaits and check it before publishing or returning a client.
  Test a late startup after Disconnect, an old Retry after replacement, and cancelling one of two waiters.
- **Optional test hook, development only:** a command that makes the Entra callback return an
  invalid token N times and drops pooled connections. It lets WI-5 and WI-6 be checked in minutes
  instead of 90.
  - Declare it in `LAZY_COMMANDS` ([checks.cjs](../../../../../build/verification/activation/checks.cjs)),
    as required for commands that are not registered in production.
  - Use a dashed context key if it needs one.

## WI-5: Classify failures and recover (main thread and tree)

- **One classifier** for failures on an established client. Inputs: the driver error (code 18, code
  391, `MongoNotConnectedError` / closed topology, network codes and timeouts) and the WI-1 typed
  error. Outputs:
  - `signInRequired` (Entra): offer **Sign in again**.
  - `credentialsRejected` (Native code 18 after a reconnect): offer **Update credentials**, and
    **no automatic retry loop**.
  - `credentialsRejected` (final Entra code 18): evict the client. With a verified Entra identity,
    keep its in-memory connection settings and offer explicit **Sign in again** (decision 0014).
  - `clientClosed`: create a new generation with the same identity.
  - `transient` (network or timeout): no eviction, because the driver recovers. Offer Retry.

  Reuse `ErrorExplanationService` for wording.

- **Sign in again** action:
  - It calls `getSession(..., { createIfNone: true, account })` for the pinned account and tenant.
  - Same account: evict and create a new generation. Surfaces continue (WI-6).
  - Different account: treat it as an identity change (decision 0003).
  - **One** prompt per user click. Dismissing it is respected: no reprompt until the user acts again.
  - `createIfNone` can return an existing session. Test a still-present but rejected token as well
    as a missing session; prove that the explicit action obtains usable credentials in both cases.
- **The tree's Retry must actually reconnect.**
  - [retryAuthentication.ts](../../../../../src/commands/retryAuthentication/retryAuthentication.ts)
    and the cached-client path in
    [ClusterItemBase.ts:358-447](../../../../../src/tree/documentdb/ClusterItemBase.ts) should evict
    the client when the last failure was `signInRequired`, `credentialsRejected` or `clientClosed`.
  - Keep the cached credentials (#1059 open question 1: dropping the client is not the same as
    forgetting the credentials). Exception: for a rejected RU Discovery key, explicit recovery must
    reread the primary key from ARM once, not reuse the cached key or open a password wizard.
    Test an old/new key pair and distinguish an ARM sign-in failure from database rejection.
  - Add **Sign in again** to `createErrorRecoveryChildren`
    ([ClusterItemBase.ts:304-326](../../../../../src/tree/documentdb/ClusterItemBase.ts)), following the
    "actions only" order in the tree-cluster-architecture skill: repairs first, Retry last.
- **`vscode.authentication.onDidChangeSessions`:** when the bound Entra account disappears, mark its
  clients `signInRequired`. Never sign the user out, and never remove sessions (#1059 "must NOT be
  touched"). The event identifies the provider, not the removed account. Silently recheck affected
  bindings and ignore results from stale generations; another account's change must not disconnect this one.
  - **Changed 2026-11-19 (decision [0012](../decisions.md)):** dropped. The next operation's silent lookup
    finds a signed-out account and fails with `signInRequired`, with no listener.
- **Unit tests:**
  - classifier table tests;
  - Retry after `clientClosed` produces a new generation;
  - Sign in again with the same account versus a different account;
  - no reprompt after a dismissal.

## WI-6: Bind surfaces to `{ clusterId, fingerprint, generation }` and add a disconnected state (decisions 0002, 0003)

The largest item. Host side first, then each view.

- **Host:**
  - `ClusterSession` stops holding a `ClustersClient`
    ([ClusterSession.ts:65-78, 688-725](../../../../../src/documentdb/ClusterSession.ts)). It records
    the binding and resolves the client for each operation.
  - Per-operation `getClient` callers that skip any check must check the fingerprint too:
    - Document View ([documentsViewRouter.ts:54,91](../../../../../src/webviews/documentdb/documentView/documentsViewRouter.ts));
    - the index router;
    - the Query Insights routers;
    - [QueryInsightsAIService.ts](../../../../../src/services/ai/QueryInsightsAIService.ts);
    - the Cluster Dashboard router.

    The full call-site list is in research §3; rerun
    `grep -rn "ClustersClient.getClient(\|\.getClient()" src`.

  - Outcomes:
    - same fingerprint and generation: proceed;
    - same fingerprint, new generation: re-run the applied query from page 1 with a notice that
      results are no longer current. Pages use separate offset queries, not a cursor held between
      pages. Discard old-generation responses on both host and UI; preserve unapplied editor text;
      - **Changed 2026-11-19 (decision 0010):** transparent: proceed on the current client, with no
        re-run and no notice. Any "out of date" indication is
        [#1106](https://github.com/microsoft/vscode-documentdb/issues/1106).
    - different fingerprint, or no client: **disconnected**, with a reason.
  - **The extension never resubmits a write with an unknown outcome.** Report the outcome as
    unknown, not as a definite failure. The driver can retry the same logical write or handle 391
    internally; test one application submission when the server accepts a write but its reply is lost.

- **Webviews:**
  - Return unavailable results from operations and use the existing webview message channel for
    teardown. Do not add a connection-state subscription (decision 0012).
  - Disconnected dims the entire webview, disables the underlying content, and shows the reason
    with **Close view** and **Retry** where safe. Credential repair stays in the tree; the tab
    never closes automatically (decisions 0016 and 0017).
  - It **keeps** the editor contents, filter, sort, projection, page position and unsaved document
    edits.
  - Views: Collection View (query, documents, indexes and Query Insights tabs), Document View
    (dirty editor) and the Cluster Dashboard.
  - Accessibility: announce the state change (accessibility skill; live region).
- **Transfer scope:** copy and export may keep their current client or stream. Do not redesign
  transfers to rebind per batch or resume after Disconnect. Protect active tasks from an explicit
  disconnect using the existing resource-conflict check in WI-7. An unexpected connection loss
  is not permission to restart a transfer under another identity.
- **Tests:**
  - router tests for the three binding outcomes;
  - a Collection View scenario: disconnected overlay with the query text kept;
  - a Document View scenario: dirty edit kept;
  - inject a disconnect after typing, then deliver a stale page or document read; neither applied
    results nor drafts may be overwritten, and disabled actions must issue no server calls;
  - scenarios run through the L2-dev runner (`/scenarios/`, see the copilot instructions).

## WI-7: Teardown service, Disconnect, Remove and Update Credentials (#1059, #566, decisions 0003, 0004)

- **One teardown**, keyed by stable `clusterId`, with provider-specific equality. Azure case aliases
  must match, but folding Kubernetes context IDs such as `Prod` and `prod` would target different
  resources together. Remove = teardown + delete + clear schema; Disconnect = teardown only.
  - **Changed 2026-11-19:** provider-specific equality and all Kubernetes tunnel work moved to
    [#1105](https://github.com/microsoft/vscode-documentdb/issues/1105), after 1.2.0 (decision
    [0009](../decisions.md)). The teardown keeps each store's current `clusterId` matching.
  - After the task-conflict preflight below, tear down the client, shells, playground, webviews, in-flight token
    requests (sovereign-clouds finding E4), `CredentialCache`, the Entra failure registry, and the
    `SchemaStore` decision.
  - Its "must NOT be touched" rules apply: VS Code auth sessions, the managed identity cache, the
    ARM cache.
- **Disconnect command** on connected clusters in the Connections, Azure Resources and Discovery
  views.
  - **Check for active tasks first.** Reuse
    [`checkCanProceedAndInformUser({ clusterId }, …)`](../../../../../src/services/taskService/resourceUsageHelper.ts)
    as [Remove Connection](../../../../../src/commands/removeConnection/removeConnection.ts) already
    does. If a copy or export uses this cluster, name the conflicting task and leave **both the task
    and connection running**. The user can retry Disconnect after the task finishes or they stop it.
    Do not offer force-disconnect or automatically cancel the task. Verify that export registers its
    source and copy registers both endpoints; fill registration gaps rather than changing transfer logic.
  - Use dashed context keys (manifest rule in the copilot instructions).
  - When surfaces are open, ask the user: **Close all** or **Keep open (disabled)** (decision 0004;
    default and remembering per Q2).
  - Document View is a plain webview panel: `dispose()` has no dirty-editor veto. For Close all,
    confirm unsaved edits **before** disposing any panel or changing the connection. Cancelling leaves
    every panel, draft and connection intact, including when Remove initiated teardown.
- **Update Credentials**
  ([updateCredentials.ts:142-185](../../../../../src/commands/updateCredentials/updateCredentials.ts))
  and Update Connection String compare the old and new fingerprints:
  - **same:** the client is replaced and tabs continue;
  - **different:** before saving, run the same task and dirty-panel checks as Disconnect. If approved,
    tear down with reason "credentials changed", offering the same Close/Keep choice.
  - Only replace the client after the credential save succeeds; test that a failed save leaves the
    old binding usable and a concurrent connect cannot publish the previous credentials after replacement.

  Today's D12 modal for open shells offers Disconnect as a button (#1059).

- **Telemetry:** one event with the activation source and teardown counts. No identifiers (#1059).
- **Tests:**
  - teardown per surface;
  - ~~Azure case aliases vs distinct Kubernetes context IDs;~~ moved to #1105 (decision 0009);
  - Disconnect blocked for copy source, copy destination and export source; an unrelated cluster
    is not blocked. After the task finishes or is stopped, retrying Disconnect succeeds;
  - a late token response after Disconnect is ignored;
  - reconnecting uses the current credentials and cloud settings;
  - Remove reuses the same teardown.

## WI-8: Cluster Dashboard health polling

Coordinate with #1091. The minimum for this plan:

- the poll uses the WI-6 binding;
- after a `signInRequired`, `credentialsRejected` or disconnected outcome, polling **stops** and the
  dashboard shows the WI-6 overlay instead of starting a connection every 5 s.

Visibility pause and backoff are the rest of #1091 and may ship separately.
Existing visibility and in-flight guards do not distinguish a missing ping sample from terminal
auth failure. With fake timers, verify no client lookups on ticks or reveal after Disconnect,
that a late successful ping cannot clear the overlay, and that reconnect starts only one poll loop.

## WI-9: Measure token renewal and recovery after release

The [existing correlation IDs](../../../telemetry-correlation-ids.md) identify a client or worker
startup and optionally link it to cluster metadata. They do **not** tell us when a token changed,
how long it was valid, or whether the database worked afterward. Reuse `startupCorrelationId`
for drill-down and `connectionCorrelationId` where already available; the headline metrics below
must be queryable without a join or a new persistent identifier.

- **When did a refresh happen?** Emit `connection.tokenRenewal` once per completed post-startup
  Entra database token lookup (host, shell or playground), not per query or dashboard tick.
  Use the event timestamp, `surface`, and one bounded `renewalOutcome`: `changed`, `unchanged`,
  `noSession`, `identityMismatch`, `failed`, or `unknown` when there is no prior observation.
  Compare only within the same binding. Exclude initial acquisition; count a valid unchanged
  token as successful reuse, **not** a refresh. `changed` means the extension received a
  different token, not that it observed an MSAL network request. Count successes as well as misses.
- **What was the lifetime?** On that same event record numeric measurements, not timestamps:
  `connectionAgeMs` (age of this client/worker at lookup), `previousTokenObservedAgeSeconds`
  (time since the previous token was first seen, not reset by unchanged lookups),
  `tokenLifetimeSeconds` (returned token's `exp - iat`) and `tokenRemainingSeconds` (`exp - now`
  at lookup). Omit unavailable or invalid measurements; never substitute a worker fallback TTL
  or zero for unknown. Do not retain tokens just for telemetry or send token values, hashes, raw
  claims, account/tenant IDs, cluster IDs, fingerprints or hostnames.
- **Did the connection actually recover?** Emit `connection.recovered` once on the first successful
  database operation after a pending recovery, with trigger (`silentRenewal`, `reconnect` or
  `signInAgain`) and `connectionAgeMs`. A callback returning a token is not that success. Keep
  WI-4's classified post-connect failures and WI-7's Disconnect event. Report ARM challenges
  separately from database renewal and verify the final ARM request, not just token acquisition.
  - **Changed 2026-11-19 (decision [0012](../decisions.md)):** no `connection.recovered` event and no
    changed-token or remaining-validity measures. `connection.tokenRenewal` keeps its outcome and the token
    lifetime; recovery shows as successful operations on a replaced client (`clientGeneration` above 1)
    and fewer late failures.
- **Release dashboard and acceptance:** check in runnable queries that show daily renewal outcomes
  and changed-token rate (`changed / all completed lookups`), plus p50/p90 token lifetime,
  remaining validity and connection age at refresh, split by version and surface. Show sample
  counts and missing timing data alongside percentiles. Trend confirmed recoveries by trigger and
  late auth/socket/closed-client failures against the pre-release baseline using the same exposure
  denominator. No lookups or no subsequent operation is **no evidence**, not success.
  Before rollout, use a fake clock and token sequence (unchanged → changed → silent miss) to
  verify counts and units; include an opaque token and a database rejection after lookup. Verify
  the dashboard can read the classified fields from pre-release ingestion before judging outcomes.

## WI-10: Documentation

- User manual:
  - Disconnect;
  - "Sign in again";
  - what a disconnected tab means and how to resume;
  - the Update Credentials note about open sessions.
- Release notes (writing-release-notes skill).
- Skills:
  - tree-cluster-architecture: the connection lifecycle rule ("resolve the client per operation;
    never hold a `ClustersClient`");
  - error-translation: the new categories.
- This feature's README, plus `docs/ai-and-plans/README.md`.

---

## Operator acceptance tests (run on the installed VSIX at the end)

These are the minimal checks that confirm the goal. The operator should finish them **without
restarting VS Code** and **without losing any typed text or unsaved edits**.

**Setup:**

- one Azure DocumentDB cluster with Entra ID enabled, and a native user on it;
- one RU account reached through Azure Discovery (account key);
- VS Code signed in to the Microsoft account that has access.

**Test matrix:** RU with Entra ID for the database is **not supported** by the extension (key-based
only), so it is not tested.

**Long wait:** "Wait ≥ 2 h" means leaving the window idle, for example over lunch or overnight. The
optional WI-4 test hook may shorten this during development. The release check uses a real wait at
least once.

| #    | Scenario                             | Steps                                                                                                                                                                                                                                                                                                | Pass when                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OT-1 | **Entra, long idle, work open**      | Connect with Entra. Open a Collection View with filter, sort and projection, on page 2. Open a Document View with an unsaved edit. Open the Cluster Dashboard and a shell. Wait ≥ 2 h. Then refresh the tree, run the query, go to the next page, save the document, and run a command in the shell. | Everything works. No sign-in prompt, and no error that needs a click. Text and edits are kept. (No re-run and no out-of-date notice: decision 0010.)                                                                                                              |
| OT-2 | **Entra, silent renewal impossible** | With the OT-1 surfaces open, sign out of the account in the Accounts menu (or revoke sessions in Entra). Run the query. Dismiss the prompt if one appears. Wait 5 min. Then click **Sign in again** and pick the same account.                                                                       | The action fails once and offers **Sign in again**. The tabs show "sign-in expired" with their content kept. No modal appears on its own, and nothing prompts again after a dismissal. After signing in, the tabs re-enable and the unsaved edit saves.           |
| OT-3 | **Identity change is never silent**  | (a) Native: with tabs open, use Update Credentials to switch to a different user. OP-4 tests the next operation in an open tab; OP-5 tests **Keep open (disabled)** and the pushed disable message. (b) Change only the password of the same user. (c) Entra: in OT-2, sign in again with a different account. | (a) and (c): old tabs stay disabled and no operation runs under the new identity. Close the old view and reopen from the tree as the new identity. (b): tabs continue. |
| OT-4 | **Native, idle and network drop**    | Native connection with tabs open. Turn the network off for 2 min, or put the machine to sleep for ≥ 30 min, then restore it. Run a query, refresh the tree, save a document. Also try an insert while offline.                                                                                       | The operations work after restoring, at most after one Retry. The offline insert is reported as failed or unknown and is **not** replayed.                                                                                                                        |
| OT-5 | **RU (key), idle and key rotation**  | Open the RU cluster through Discovery, with tabs open. Wait ≥ 2 h and run a query. Then regenerate the primary key in the portal and run a query again.                                                                                                                                              | After the wait: it works. After rotation: one clear failure with an action. The action reconnects with the new key. No endless retry.                                                                                                                             |
| OT-6 | **Azure discovery, long idle**       | Expand a subscription in vCore and RU Discovery. Wait ≥ 2 h. Expand a cluster, connect, and run **Diagnose connection**. Then sign out of Azure and run Diagnose again.                                                                                                                              | It works without refreshing the provider root. When signed out, the diagnosis says **"Azure sign-in needed"**, not "Azure details unavailable".                                                                                                                   |
| OT-7 | **Disconnect**                       | With a Collection View, a dirty Document View, a shell and a playground open: Disconnect and choose **Keep open (disabled)**. Reconnect in the tree, then click **Retry** in the tab. Repeat with **Close all**. Then use Remove Connection.                                                          | Keep open: disabled with the reason and content kept; Retry resumes only after tree reconnect with the same identity. Close all: the dirty editor asks before it closes. The shell prints "Disconnected". The refreshed node offers **Connect**. Remove behaves like Disconnect plus delete. |

**After release** (telemetry, operator with Kusto access): run the WI-9 queries on the pre-release
cohort.

**Evidence required for the matrix:** exercise both idle and dropped data-plane connections for
each supported backend/auth pair. For OT-1 record a new handshake or callback after the wait
(never log tokens): a successful read on an existing socket does not prove renewal. For OT-2
distinguish local sign-out from remote revocation; their timing is not established. For OT-5
force a new handshake after rotation. For OT-7 also try Disconnect during a tracked copy/export:
verify it is blocked before the Close/Keep prompt and the task continues.

For WI-9, `challengeSuccess=true` means a challenge token was obtained, not that ARM accepted the
retried request. Check the final operation too. Record the cohort query, time window and exposure
denominator; a cohort with no challenges is inconclusive, and timing alone does not establish cause.

---

## Open questions (to settle before or during WI-5 and WI-7)

- **Q1:** For a user-initiated action, should the interactive sign-in open **immediately**, or only
  through the **Sign in again** button? The proposal is the button everywhere (decision 0001). A
  first connect from the tree stays interactive, as it is today.
- ~~**Q2:** The default for the Disconnect choice, and whether to remember it. The proposal is Keep
  open (disabled), remembered in `globalState`.~~ **Resolved 2026-11-19:** a VS Code modal with nothing
  remembered, plus a setting for the default (decision [0007](../decisions.md)).
- ~~**Q3:** Should Disconnect drop the `CredentialCache` entry (#1059 proposes yes), so a password
  typed only for a discovery connection must be entered again?~~ **Resolved 2026-11-19:** no. Disconnect
  keeps the cached credentials and the verified identity; only Remove drops them (decision
  [0011](../decisions.md)). The WI-7 teardown bullet above still lists `CredentialCache`; read it as
  "Remove only".
- **Q4:** Ask the Azure DocumentDB service team whether the server closes connections when the
  token expires, and whether it ever sends code 391 `ReauthenticationRequired` (research §1).
- ~~**Q5:** Release slicing. Should WI-1 and WI-2 ship early as a patch (backport skill)? They are
  small, isolated and fix the largest group (≥60 machines in 28 days).~~ **Resolved 2026-11-19:**
  no. Everything ships at once from the feature branch (decision [0006](../decisions.md)).
