---
feature: connection-lifecycle
kind: plan
status: active
created: 2026-11-19
code:
    - src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts
    - src/documentdb/auth/oidcClientOptions.ts
    - src/documentdb/auth/connectionAuthIdentity.ts
    - src/documentdb/auth/tokenExpiry.ts
    - src/documentdb/ClustersClient.ts
    - src/documentdb/ClusterSession.ts
    - src/documentdb/CredentialCache.ts
    - src/documentdb/shell/ShellSessionManager.ts
    - src/documentdb/playground/PlaygroundEvaluator.ts
    - src/documentdb/playground/playgroundWorker.ts
    - src/documentdb/playground/workerTypes.ts
    - src/tree/documentdb/ClusterItemBase.ts
    - src/commands/retryAuthentication/retryAuthentication.ts
    - src/commands/updateCredentials/updateCredentials.ts
    - src/commands/removeConnection/removeConnection.ts
    - src/services/taskService/resourceUsageHelper.ts
    - src/webviews/documentdb/collectionView/collectionViewRouter.ts
    - src/webviews/documentdb/documentView/documentsViewRouter.ts
    - src/webviews/documentdb/clusterDashboard/clusterDashboardRouter.ts
    - src/plugins/api-shared/azure/AzureSubscriptionProviderWithFilters.ts
    - src/connectionDiagnostics/checks/resolveTarget.ts
---

# Iteration 1, dev plan: how to execute the connection lifecycle work

> This is the execution guide for the approved [01-implementation-plan.md](./01-implementation-plan.md).
> That plan says **what** to build and in which PRs. This file says **how** for each work item: what to read
> first, ordered steps, the contracts that cross PRs, tests, the done criteria, and the points where the
> advisor must decide. Work-item numbers (WI-n), PR numbers and OT-n acceptance tests are the same as in
> the approved plan. Decisions are in [../decisions.md](../decisions.md), evidence in
> [../research-findings.md](../research-findings.md). Neither is repeated here.

Written at `4fe5a72c9` (branch `tnaum-ms/issue1102`). Line numbers will drift; function names are the
stable pointers.

## 0. How to use this document

### Authority and deviation

1. **Accepted decisions 0001–0008 bind you.** You cannot change them on your own. If the code shows one of
   them is wrong or cannot be met, stop and raise it with the operator, giving evidence and alternatives.
   The advisor cannot overrule an accepted decision.
2. **The approved plan's content binds you**, except where §3 (Tensions) names a conflict. There the advisor
   decides at the named checkpoint. If that changes the intent of an accepted decision, the operator
   confirms, as rule 1 requires.
3. **Everything in this dev plan is guidance.** That includes steps, file names, helper names and contract
   field names. You may deviate when the advisor agrees. Record each deviation **inline, under the work
   item's Progress block**, naming the alternatives you considered and why each was rejected
   (knowledge-base rules, [docs/ai-and-plans/README.md](../../../README.md)). Never rewrite the plan text
   to match what happened.
4. **The provisional answers in §1 are not decisions.** Implement them as written, keep them easy to change
   (one constant, one setting, one branch of code), and list them in every PR description until the
   operator confirms them. Once confirmed, append a decision entry to `decisions.md`.

### Progress recording

Each work item ends with a **Progress** block. When you commit a step, add a line there that names the
commit SHA, what landed, and anything that differed from the plan. Each checkpoint (§5) also writes its
verdict there. At the hand-over, add an `# Outcome` chapter to the end of this file: what was verified,
and just as plainly, what was not.

### Operator tests: announce them clearly

Some checks need the operator: a real cluster, a long wait, a real account, or the packaged VSIX. When
the work reaches one, **stop** and post a message whose first line is:

> **⏸ OPERATOR TEST NEEDED: OP-n, <name>**

followed by:

- **why** it is needed now, and what it blocks;
- **setup:** the build to install, the cluster and account, and the settings;
- **steps**, numbered;
- **what to send back:** output-channel lines, screenshots, pass or fail per step. Never include tokens;
- **an estimated duration**, including waits.

Do not continue past the blocked step until the operator replies. Work that does not depend on the
result may continue, but say so in the message. Record the result in the Progress block of the WI.

| OP   | When               | Test                                                                                                                                               |
| ---- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| OP-1 | WI-1, CP-0         | **Two parts.** (a) Before the handler change: does an expired token on a new socket get code 18 or a socket close? (b) After it: renewal succeeds. |
| OP-2 | WI-3, CP-W3        | The azext workflow checks on the packaged VSIX: Azure sign-in, discovery, filters, deep links, wizards, Azure Resources view.                      |
| OP-3 | WI-5 done          | OT-2's tree part with a real sign-out: Sign in again, a dismissal, no reprompt.                                                                    |
| OP-4 | WI-6 done          | OT-1 (short form, with the WI-4 hook) and OT-3(a) and (b) on a dev build.                                                                          |
| OP-5 | WI-7 done          | OT-7 on a dev build: Disconnect during a copy, export or import, during an in-flight query or save, and a folder delete with a connected child.    |
| OP-6 | Before PR F (CP-5) | OT-1 to OT-7 on the packaged VSIX, with at least one real wait of two hours or more (PR F step 3).                                                 |

### Per-PR workflow

- **Branch:** create `dev/tnaum/<topic>` from the preceding PR's head and target that branch while
  the preceding PR is open. If it is already merged, branch from and target
  `feature/connection-lifecycle`. Do not wait for intermediate approvals or merges; the operator
  handles those. The advisor checkpoints and explicit operator decisions and tests still apply.
- **Commits:** one or more commits per WI, never one commit that mixes two WIs. Each commit ends with the
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` trailer.
- **While working, and for draft PRs:** Case 1 only: `npm run build` plus `npx vitest run <touched paths>`.
  If you edit `packages/*/src`, run `npm run build` in that package before the root tests; root tests
  import the package's `dist`.
- **Ready for review:** Case 2 in full (copilot instructions). Run `npm run l10n` before `l10n:check`
  whenever a `vscode.l10n.t()` string changed.
- **AI pre-review:** run the review (CONTRIBUTING §6) and commit it as
  `iterations/01-pr<N>-<topic>-review.md`, for example `01-pr1-entra-renewal-review.md`. When this folder
  reaches three or more iteration-1 documents, ask the operator before promoting it to an
  `iterations/01-…/` folder. Moving the files breaks links in the issues.
- **PR description:** name the WIs, the issues (next section), the provisional answers (§1) the PR relies
  on, the checkpoint verdicts it implements, and which verification case ran.

### Issues: link them, and comment on partial fixes

Every PR names the issues it may resolve, using the table below, and says for each one whether it
**resolves** it or is a **partial fix**.

- **Closing keywords only in PR F.** GitHub closes an issue through `Fixes #n` only when the PR merges into
  the default branch. Sub-PRs merge into `feature/connection-lifecycle`, so they write
  `Resolves #n (closes with PR F)` or `Part of #n`. PR F carries `Fixes #n` for every issue that the
  iteration resolves in full.
- **Partial fix → a comment on the issue.** When a PR merges with only part of an issue done, post a
  dedicated comment on that issue (`gh issue comment <n> --body-file <file>`). It contains:
  - the PR link and the WIs it implemented;
  - what now works, in user terms;
  - what is still open, and where it is planned (a later PR, or a follow-up issue);
  - decisions taken on the way that change the issue's scope, linked to `decisions.md`;
  - the tests or operator tests that cover it.

  Keep it factual and short. Never include tokens, account names, cluster names or connection strings.
  Record the comment's link in the WI's Progress block.

- **Work moved to a follow-up issue** (#1105, #1106): when a PR hands work over, comment on the
  follow-up in the same way, so it can be planned from that comment alone.

| Issue | Title (short)                                     | PRs           | Expected                                                       |
| ----- | ------------------------------------------------- | ------------- | -------------------------------------------------------------- |
| #1102 | Keep connections usable across expiry and idle    | 1, 3, 4, 5, 7 | Partial in each sub-PR; resolved by PR F                       |
| #990  | Upgrade azureauth to v6                           | 2             | Resolved by PR 2 (closes with PR F)                            |
| #626  | Upgrade azext-utils v3 → v4                       | 2             | Check after CP-W3: likely superseded by the utils v5 upgrade   |
| #1059 | Disconnect action that ends live sessions         | 6             | Resolved by PR 6 (closes with PR F)                            |
| #566  | Unified disconnect/remove experience              | 6             | Resolved or partial; decide against the issue text in PR 6     |
| #1091 | Dashboard health check: pause, back off, stop     | 6 (WI-8)      | Partial unless WI-8 also does the visibility pause and backoff |
| #1105 | Follow-up: Kubernetes tunnels, network resilience | —             | Not resolved; comment when a PR moves work there               |
| #1106 | Follow-up: indicate possibly out-of-date results  | —             | Not resolved; comment when a PR moves work there               |

### Skills to load per work item

| WI    | Load before starting                                                                         |
| ----- | -------------------------------------------------------------------------------------------- |
| WI-1  | error-translation, telemetry-instrumentation                                                 |
| WI-2  | error-translation                                                                            |
| WI-3  | flagging-fresh-dependencies (lockfile audit), error-translation                              |
| WI-4  | tree-cluster-architecture, telemetry-instrumentation                                         |
| WI-5  | tree-cluster-architecture, error-translation, telemetry-instrumentation                      |
| WI-6  | webview-trpc-messaging, react-webview-architecture, fluentui, detecting-accessibility-issues |
| WI-7  | tree-cluster-architecture, webview-trpc-messaging, telemetry-instrumentation                 |
| WI-8  | webview-trpc-messaging, react-webview-architecture                                           |
| WI-9  | telemetry-instrumentation                                                                    |
| WI-10 | writing-release-notes, documentation-screenshots, previewing-docs-site, skill-creator        |

---

## 1. Answers to the open questions

The operator was not available on 2026-11-19 at first. They answered A2 to A6 later the same day; A1 is
still **provisional** under rule 4 above.

| #   | Question                                             | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status                                                                                                  | Where it lands         |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------- |
| A1  | Plan Q1: how does sign-in start after a silent miss? | **Only through the Sign in again button**, everywhere. The first connect from the tree stays interactive, as it is today. One rule, and no surface has to decide whether it is in the foreground. This matches 0001.                                                                                                                                                                                                                                                                                                                                                                            | Provisional                                                                                             | WI-1, WI-2, WI-5, WI-6 |
| A2  | Plan Q2: Disconnect choice, default and memory       | A **VS Code modal**, which has no pre-selected button and **remembers nothing**. A setting lets users choose a default: `ask` (the default) shows the modal; `closeAll` or `keepOpenDisabled` skips it. The unsaved-edits confirmation still appears when closing. See WI-7 step 3.                                                                                                                                                                                                                                                                                                             | **Operator, 2026-11-19** (decision 0007)                                                                | WI-7                   |
| A3  | Plan Q3: does Disconnect drop `CredentialCache`?     | **No** (reverses the #1059 proposal). Disconnect keeps the `CredentialCache` entry **and** `lastVerifiedIdentity`, so Connect and a tab's Reconnect work without the tree and without retyping a discovery password. Only Remove Connection drops them; an identity-changing credential update replaces them. Keep `dropCredentials` as a teardown option.                                                                                                                                                                                                                                      | **Operator, 2026-11-19** (decision 0011)                                                                | WI-7                   |
| A4  | #990: which azext versions?                          | **As high as viable without breaking our workflows**, using the Azure Resources extension (same team as azureauth, heavily used) as the reference. Ladder and findings are in WI-3 step 1: target L2, fall back to L1, then L0.                                                                                                                                                                                                                                                                                                                                                                 | **Operator policy, 2026-11-19** (decision 0008)                                                         | WI-3 (CP-W3)           |
| A5  | How does Disconnect see an in-flight Export?         | **Reuse the existing mechanism.** Delete Collection, Delete Database and Remove Connection already guard through `checkCanProceedAndInformUser` (`TaskService` resource tracking). Export **and Import** are the gap: neither is a task and neither registers anything, so even Delete Collection does not see a running export or import today. Close it with a small **resource lease** that feeds the same check. Every existing guard then sees them too, and the export and import logic is not touched. Copy/paste and copy-indexes are already tasks that register both endpoints (F-9). | Operator pointed at the existing check; lease is the recommendation; operator added Import (2026-11-19) | WI-7                   |
| A6  | Where do the dev plan and its progress notes live?   | In this file. Progress is recorded inline per WI here. The approved plan gets a one-line pointer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | **Operator, 2026-11-19**                                                                                | —                      |

---

## 2. Facts established while writing this plan

These were verified at `4fe5a72c9` with mongodb driver 7.2.0. They shape the steps below. If a dependency
upgrade changes any of them, stop and re-plan the affected WI.

- **F-1. One failed OIDC callback breaks that `MongoClient`'s Entra authentication for good.**
  - Where: `node_modules/mongodb/lib/cmap/auth/mongodb_oidc/callback_workflow.js`, `withLock`. It runs
    `await lock` _before_ it reassigns `lock`, so after one rejection every later callback call throws the
    same rejection again.
  - This is the "same workflow reused the rejection" result of the earlier probe.
  - Consequence: the only way to recover after the callback throws is a **new `MongoClient`**, that is, a
    new generation. It applies to every throw, including transient Entra errors.
- **F-2. The driver ignores `expiresInSeconds` in the automated workflow.**
  - `token_cache.js` stores the value, but `AutomatedCallbackWorkflow.execute` never reads it.
  - `CallbackWorkflow.speculativeAuth` sends the cached token on **every new socket**.
  - Code 18 drops the cached token and calls the callback again. A transport failure does not.
  - Code 391 goes through `reauthenticate`.
  - So no `OIDCResponse` value alone can stop an expired token from being offered.
- **F-3. `getSessionFromVSCode` reads the auth provider ID that is configured _at call time_.**
  - Where: azureauth 4.1.1 `getSessionFromVSCode.js` calls `getConfiguredAuthProviderId()`.
  - If the user changes their sovereign-cloud setting after connecting, a callback would ask a different
    provider. That breaks the identity pin.
  - The deep import path `@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode` does not exist
    in v6; it moved to `dist/esm/src/utils/`.
  - `vscode.authentication.getSession` supports `account` (engine `^1.109.0`).
- **F-4. Cluster ID equality differs by store.**
  - `CredentialCache` and the Entra failure registry use case-insensitive maps.
  - `ClustersClient._clients`, `ClusterSession._sessions` and `SchemaStore` (prefix `${clusterId}::`) match
    exactly.
  - Kubernetes IDs keep the context's case (`kubernetes_${source}_${context}__…`), so `Prod` and `prod`
    already collide in `CredentialCache` today.
  - **Out of scope for this iteration** (decision 0009, #1105). Every store keeps its current matching;
    this iteration adds no case handling.
- **F-5. There is no per-cluster registry of open webview panels.**
  - Only the Cluster Dashboard keeps its own `openPanels` map (`clusterDashboardController.ts`).
  - Collection View and Document View open through `openAppWebview`, whose handle exposes `onDisposed`.
- **F-6. Collection View sessions.**
  - `ClusterSession` sessions are keyed by a random session ID and **hold** a `ClustersClient`.
  - `openCollectionView.ts` calls `closeSession` when the panel is disposed.
  - Paging uses **offset queries**: `skip = querySkip + (page - 1) * pageSize`. No cursor is held between
    pages.
- **F-7. The Cluster Dashboard health poll runs in the webview, not the host.**
  - Where: `ClusterDashboard.tsx`, the interval effect around `refreshIntervalMs`.
  - The host procedure `measureRtt` resolves the client for every tick, with trigger `clusterDashboardPoll`.
- **F-8. Worker IPC loses error types.**
  - `tokenError` carries only a message, plus `errorName` for one value: destination rejection.
  - `initResult` and `evalError` carry strings only.
  - The playground rebuilds its init message from `CredentialCache` on **every run**
    (`PlaygroundEvaluator.evaluate` → `buildInitMessage`), even when the worker is warm.
- **F-9. Task coverage.**
  - Copy/paste and copy-indexes register both endpoints through `getUsedResources()`.
  - **Export and Import are not tasks.** `exportDocuments.ts` and `importDocuments.ts` call `getClient`
    directly and register nothing. Import calls `getClient` again for every insert batch, so a latch
    during an import leaves a partial import, and running it again inserts duplicates.
- **F-10. Remove Connection does not close the client, shells, the playground or webviews.** It deletes
  storage, `CredentialCache` and `SchemaStore` data only.
- **F-11. Credential updates.**
  - Update Credentials saves first, then calls `deleteClient`, then shuts down the playground. It only warns
    about shells (the D12 modal).
  - Update Connection String deletes the client only when recovering a rejected destination.
- **F-12. Errors lose their identity at the tRPC boundary.**
  - Errors arrive rebuilt as `{ code, name, message, stack, cause }`.
  - Webview RPC telemetry records the tRPC code as `error` (`src/webviews/_integration/trpc.ts`).
  - So a disconnected reason must reach a webview as **structured data**, never as an error that the
    webview has to recognize.
- **F-13. About 35 other `getClient` call sites are not open surfaces, but some of them are background
  work.**
  - One-shot user commands: create/delete database and collection, import, index commands, LLM commands,
    paste. They act on the current client, so WI-6 does not bind them.
  - **Background callers:** playground completions (`CollectionNameCache.ts`, an explicit background
    lookup), tree count badges and prefetches.
  - Today **every** startup is interactive: `initializeClient` hardcodes `{ interactive: true }`. A
    background caller can therefore reconnect, or even prompt, after an eviction or a Disconnect.
  - So `getClient` must **never prompt**, and the latch must be enforced **inside `getClient`** (C-6),
    not per caller.
- **F-15. A stopped worker respawns by itself.**
  - `ShellSessionManager.evaluate` re-initializes a dead or stopped worker from the current
    `CredentialCache`. `executePlaygroundCode.ts` recreates the evaluator in the same way.
  - "Stop the worker" alone therefore keeps neither a shell nor a playground disconnected. Without a
    latch, it silently adopts new credentials on the next command.
- **F-16. The host rebuilds worker errors as generic errors.**
  - `WorkerSessionManager` turns `initResult` and `evalError` into a plain `Error`. Only
    `EntraDestinationRejectedError` keeps its name.
  - New IPC fields are lost unless this layer is changed too.
- **F-17. The native authentication database follows the driver's rules.**
  - With no explicit `authSource`, the driver uses the URI's database path (`connection_string.js`, around
    line 307). Only when there is none does it use `admin`.
  - The same user on `/sales` and on `/admin` is therefore two different principals.
  - The fingerprint hashes the stored connection string, which carries the database path and any
    `authSource`, so this needs no special handling (WI-4 step 1).
- **F-18. Cluster ID matching is inconsistent across stores.**
  - `CredentialCache.deleteCredentials` lowercases its key (`CaseInsensitiveMap`), so deleting Kubernetes
    context `prod` also deletes `Prod`.
  - Task conflict matching (`hasResourceConflict` in `taskServiceResourceTracking.ts`) compares IDs
    exactly, so it misses Azure case aliases.
  - Both problems exist today. They are **out of scope** for this iteration (decision 0009, #1105).
- **F-19. Credential saves can fail without the command knowing.** The Update Credentials `ExecuteStep`
  catches save failures and returns normally, so the command cannot tell whether the save happened.
- **F-20. Only the tree fills `CredentialCache`, and the tree empties it on any connect failure.**
  - `ClustersClient.initializeClient` starts only from a `CredentialCache` entry. Without one it throws
    "No credentials found for id {clusterId}" and sets `startup.credentialsMissing`.
  - Only the tree items' provider-specific `authenticateAndConnect` methods (and Update Credentials,
    which reloads the entry from storage) fill the cache.
  - Every `authenticateAndConnect` failure path calls `deleteClient` **and**
    `CredentialCache.deleteCredentials`, whatever the cause: `DocumentDBClusterItem`, the Azure
    Resources vCore and RU items, and the Atlas, Kubernetes, VM, vCore and RU discovery items.
  - So a tree expand during a network outage leaves open surfaces with nothing to reconnect from.
- **F-21. Storage saves are not atomic.** `StorageService.push` writes the secrets to `SecretStorage`
  first, then the metadata to `globalState`. A failure after the secret write leaves the new secrets beside
  the old metadata, so "the save failed" does not mean "nothing changed".
- **F-22. `MongoClient.close(force)` does not cancel anything.** In the installed driver the `force`
  argument is "currently an unused flag that has no effect". An operation already sent may still
  complete, and a write the server accepted cannot be undone.
- **F-23. Handoffs that drop the binding.**
  - Playground evaluators are shared per `clusterId` and deleted on shutdown
    (`executePlaygroundCode.ts`). The per-document connection lives in `PlaygroundService`
    (`getConnection(uri)`), and it has no fingerprint today.
  - Collection View starts import and export by passing a tree node to a command
    (`collectionViewRouter.ts`), so the work runs under whatever credentials the cluster has when it starts.
  - Folder deletion (`deleteFolder/ExecuteStep.ts`) deletes descendant connections straight from storage.
    It never touches their clients, credentials, shells or tabs.
- **F-24. The dashboard sampler turns errors into strings.** `getClusterHealth.ts` catches every command
  separately and records `name: message` in `errors`. An authentication failure during a ping therefore
  reaches the router as a partial sample, not as an error.
- **F-14. VS Code has no API to collapse one tree node.**
  - The repository uses `reveal(..., { expand: false })`, which does not collapse a node.
  - Collapsing through a changed `TreeItem.id` would conflict with the `treeId`/`clusterId` rules.

---

## 3. Tensions between the approved plan and the code

| #   | Tension                                                                                                                                                                                                                                                                                               | Decided at | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T-1 | WI-1 required that a known-expired token is never offered on a new socket. Under F-2 that is only possible with a new `MongoClient` once the issued token expires. Decision 0002 says a new generation re-runs reads from page 1 "because cursors are lost", but under F-6 no surface holds a cursor. | CP-0       | **Resolved by the operator on 2026-11-19 (decision 0010).** (1) No proactive rotation and no local expiry checks: "the server will tell us, then we can act". An expired token is rejected by the server; the driver then calls the callback, which renews silently. If the server closes the socket instead, the classifier acts on that (WI-5). (2) Replacing a client for the same identity is **transparent**: no re-run and no "out of date" notice, including on return from the disconnected state. Stale-data indication is #1106. |
| T-2 | OT-7 expects the cluster node to "collapse" after Disconnect, but VS Code cannot collapse a single node (F-14).                                                                                                                                                                                       | CP-4       | Refresh the node. A disconnected cluster returns **one** child action, "Connect", following the actions-only rule. Its handler reconnects and refreshes. Do not change `TreeItem.id`. Update OT-7's wording at hand-over.                                                                                                                                                                                                                                                                                                                  |
| T-3 | WI-7 asked for provider-specific cluster ID equality (Azure case aliases match; Kubernetes contexts such as `Prod` and `prod` stay distinct). Today's stores disagree on this (F-4, F-18).                                                                                                            | —          | **Withdrawn 2026-11-19:** moved out of this iteration (decision 0009, #1105). Each store keeps its current matching.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| T-4 | Under decision 0002, a classified failure evicts and replaces the client. A background caller such as the dashboard poll or tree count badges could therefore start a new connection every tick.                                                                                                      | CP-2       | Only a **foreground** operation replaces a generation. Background callers pass `background: true` and just fail (C-6, WI-8). No backoff: with no background replacement there is no loop to guard against (decision 0012).                                                                                                                                                                                                                                                                                                                 |
| T-5 | For Entra, code 18 after the driver's own fresh callback means the server rejected a _fresh_ token: the principal has no database user, or Conditional Access or CAE intervened. That is not the same as `signInRequired`.                                                                            | CP-2       | Classify it as `credentialsRejected` with an Entra-specific explanation ("Your account has no access…"). Offer **Sign in again** only when the token came from a session the user can replace. Decide this with the real driver error shapes collected for CP-0.                                                                                                                                                                                                                                                                           |

---

## 3a. Out of scope for this iteration

Moved to [#1105](https://github.com/microsoft/vscode-documentdb/issues/1105) on 2026-11-19 (decision
0009), to be scheduled after 1.2.0:

- re-creating Kubernetes port-forward tunnels outside the tree (per-operation resolution, recovery);
- tunnel ownership on Disconnect and Remove, and running the teardown when a kubeconfig source is removed;
- provider-specific cluster ID matching (the withdrawn T-3; F-4, F-18);
- Kubernetes API credential expiry (AKS exec plugin);
- a wider network-resilience test matrix beyond OT-4, including a Kubernetes acceptance test.

Moved to [#1106](https://github.com/microsoft/vscode-documentdb/issues/1106) (decision 0010): any
"results may be out of date" indication. That covers the return from the disconnected state, long idle,
and writes made from another view or another client.

Generic idle and network-drop recovery **stays in scope**: closed-client and transient classification,
the cancelled-reuse fix, closed-client replacement and OT-4. It is #1102's "recover on the next
operation without a restart". The no-regression rules in WI-5 and WI-6 keep tunneled connections
working as they do today.

---

## 4. Contracts that cross PRs

These contracts define how PRs 1–3 share the verified account, provider and tenant while the
implementation PRs are stacked. The field names are illustrative; the semantics are binding unless
a checkpoint changes them.

- **C-1. Verified identity.**
  - WI-1 produces it on the first successful Entra acquisition:
    `{ kind: 'entra', providerId, accountId, accountLabel, tenantId? }`.
  - `providerId` is the provider that was **actually used**, never re-read later (F-3).
  - It is returned on `AuthHandlerResponse` as an optional field.
  - Native, managed identity and no-auth handlers return nothing; WI-4 derives their identity from the
    credentials used.
  - WI-2 builds the same shape at worker spawn.
  - Never logged, never sent to telemetry, never persisted.
- **C-2. Typed errors: four classes in total.**
  - `EntraSignInRequiredError`, reason `noSession | providerChanged`.
  - `EntraIdentityMismatchError`: a different account came back.
  - `TokenCallbackError`: wraps **any other** error thrown from an OIDC callback, for every auth method
    (Entra and managed identity), with a bounded `authMethod`. The original is kept as `cause` and is
    never rendered raw.
  - `ConnectionUnavailableError { reason }`: the one error for a client the caller cannot use (the latch,
    an identity change, missing credentials). `reason` is the C-5 enum.
  - Messages are localized. Classification uses the `name` (walking `cause`), never the message. Existing
    name checks that walk `cause`, such as destination rejection, keep working.
  - The first three are "callback threw" for F-1.
  - Keep the existing `AuthInputUnavailableError` for the non-interactive startup path (diagnostics).
    Either make the new errors related to it or map between them explicitly, so the Entra failure registry
    still skips silent misses (comment in `MicrosoftEntraIDAuthHandler.configureAuth`).
- **C-3. Token lookup observation.**
  - Every **completed** post-startup token lookup notifies an optional host-only observer, whether it
    succeeded or failed: `{ outcome: 'returned' | 'noSession' | 'identityMismatch' | 'failed', lifetimeSeconds? }`.
  - `lifetimeSeconds` is the JWT `exp` minus `iat`, and is omitted when the token is opaque.
  - Nothing about a token is retained between lookups. The observer never receives the token, a hash of it
    or any other claim.
  - WI-9 uses it for `connection.tokenRenewal`.
- **C-4. Binding.**
  - Its form is `{ clusterId, fingerprint, generation }`.
  - **`fingerprint`** is an opaque hash of the stored connection string without its password, plus the
    principal (WI-4 step 1). It never contains a password and is never sent to telemetry.
  - **`generation`** is a per-cluster number that only ever increases. It is **never reset**, not even
    after teardown. A binding from before Disconnect therefore never matches a client created after
    Reconnect.
- **C-5. Unavailable reasons, derived on demand.**
  - There is **no stored connection state** and no state machine. A surface learns where it stands when it
    resolves its binding (WI-6): it gets a client, or a `ConnectionUnavailableError { reason }`. A router
    returns that to the webview as structured data (F-12).
  - A surface whose fingerprint differs from the client the cluster would use now is unavailable with
    `identityChanged` or `credentialsChanged`, **even while the tree works**. This is what lets the tree and
    new panels run as identity B while panels opened as A stay disabled.
  - `reason` is one of: `signInRequired`, `credentialsRejected`, `credentialsMissing`, `credentialsChanged`,
    `identityChanged`, `userDisconnected`, `connectionRemoved`, `unreachable`.
  - `action` is one of: `reconnect`, `signInAgain`, `updateCredentials`, `close`.
  - Reasons are bounded enums. The webview gets the localized text and the action from the host.
  - The only push is teardown: Disconnect with Keep open calls each registered surface's `disable(reason)`
    (WI-6 host step 1).
- **C-6. `getClient` rules.**
  - **It never prompts.** `getClient` is always silent. Only the tree's first connect
    (`authenticateAndConnect`, through `ClustersClient.connectInteractive`) and the Sign in again command
    may prompt (A1). Once an identity is verified (`lastVerifiedIdentity`, WI-4), a reconnect is silent and
    pinned to it.
  - **Background callers** (the dashboard poll, tree count badges, playground completions) pass
    `background: true`. They never replace a client; they just fail (T-4).
  - **Latch:** while a cluster is disconnected (Disconnect, Remove, an identity-changing credentials
    update), `getClient` throws `ConnectionUnavailableError` with the latch's reason, for every caller.
    Only the explicit Connect and Reconnect actions clear the latch, plus one internal case: an
    identity-changing credential update whose save reached nothing clears the latch it set (WI-7 step 5).
    New tasks and resource leases are refused while the latch is set.
  - **One epoch:** a per-cluster counter that `invalidate` increases **synchronously** on every latch,
    unlatch, eviction and teardown. A startup publishes only if the epoch is unchanged. Every recovery
    command (Retry, Sign in again, Reconnect) captures the epoch **before** its first `await`, and applies
    its result only if it is unchanged. With the per-client generation, it is the only staleness guard.

---

## 5. Advisor checkpoints

Each checkpoint is a short written verdict recorded in the Progress block of the WI named. Until the
verdict exists, do not start the work it gates. The fingerprint table (formerly CP-1) and the PR 5 split
(formerly CP-3) are ordinary PR review (decision 0012).

| CP    | When                                                            | Question                                                                                                                                                                                                    | Evidence required                                                                                                                                                |
| ----- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-0  | WI-1, after step 1, before the handler is changed               | What does the server do when an expired token reaches a new socket: does it answer code 18, or close the socket? The strategy itself is decided (0010); this only tells the WI-5 classifier what to act on. | Contract test output, and **OP-1a** (§0): one real waited session, never logging tokens. OP-1b, after step 5, proves renewal.                                    |
| CP-W3 | WI-3, after the version probe                                   | Which azext versions (A4)?                                                                                                                                                                                  | `npm ls` for each package, bundle scan for duplicate copies, build-error list per level, and the **packaged VSIX** loading and passing the WI-3 workflow checks. |
| CP-2  | WI-5, after the classifier is drafted, before recovery is wired | The classifier table and T-5.                                                                                                                                                                               | Classifier table tests run on **real** driver error shapes captured by the contract test and the tree paths.                                                     |
| CP-4  | Before WI-7 starts                                              | Teardown order, T-2, the export and import lease (A5).                                                                                                                                                      | Teardown sequence diagram in the PR description.                                                                                                                 |
| CP-5  | Before PR F                                                     | Is the hand-over complete?                                                                                                                                                                                  | OT-1 to OT-7 results recorded in `# Outcome`, WI-9 queries run on pre-release ingestion.                                                                         |

---

## 6. PR 0: plan, research, decisions

1. **Carry over the planning commits first.** The plan, research and decisions were written as commits on
   the local branch `tnaum-ms/issue1102` (from `e22a39b8d` "wip: initial plan" onward). PR 0 is made of
   **those commits**. Do not re-create the files in a fresh commit, and do not squash or rebase them: the
   repository merges with merge commits only, so the history stays intact.
   - Check that the branch holds only docs: `git --no-pager diff --stat origin/main...tnaum-ms/issue1102`.
   - Push it as the PR 0 head branch, either under its current name or as `dev/tnaum/connection-lifecycle-plan`
     (`git push origin tnaum-ms/issue1102:refs/heads/dev/tnaum/connection-lifecycle-plan`).
2. Have the operator create `feature/connection-lifecycle` from `main`, or create it yourself if you
   have permission: `git push origin origin/main:refs/heads/feature/connection-lifecycle`. Deletion and
   force-push are blocked afterwards, so check the base commit first. It must contain the planning
   branch's base commit (`git merge-base --is-ancestor $(git merge-base origin/main tnaum-ms/issue1102) origin/main`).
3. Open PR 0 from that head branch into `feature/connection-lifecycle`. It contains:
   - `research-findings.md`, `decisions.md`, `README.md`;
   - `01-implementation-plan.md` with the pointer to this file;
   - **this file**;
   - the index row in `docs/ai-and-plans/README.md` (already present).
4. Its description:
   - states that §4 (C-1 to C-6) is the agreement that lets PRs 1–3 share the connection contracts;
   - lists A1 as the one provisional answer for the operator to confirm;
   - links the issues as `Part of #1102`, plus #1059, #566 and #990 (references only; PR 0 resolves
     nothing, so it posts no issue comments).
5. Verification: docs only, so none, beyond `npm run prettier` on the changed Markdown.

**Progress:**

- **Published (2026-11-19):** [Draft PR 0 (#1107)](https://github.com/microsoft/vscode-documentdb/pull/1107)
  targets `feature/connection-lifecycle` from `dev/tnaum/connection-lifecycle-plan`. The operator
  removed the intermediate merge gate: PR 1 can build on PR 0 now. The operator will handle reviews
  and merges; CP-0 and OP-1a still apply before any OIDC handler change.
- **Coding model assignments (2026-11-19), advised (`claude-opus-5.5`):** `gpt-6.1-sol` for WI-1
  (including the pre-OP-1a work), WI-2, the WI-3 version probe, WI-4, WI-5, the WI-6 host, and WI-7,
  where auth, lifecycle or cross-module contracts dominate. `mai-code-2` for the WI-6 webviews and
  WI-8, which consume those contracts; `gpt-6.1-terra` is the fallback. `gpt-6.1-terra` for WI-3
  follow-through after the version verdict, WI-9 and WI-10 prose; `gpt-6-luna` for WI-10 cross-links
  and preview. If a webview design decision is needed, consult the advisor in a fresh session before
  dispatch. These assignments do not move any operator gate. No coding workers have been started.
- **Model override (operator, 2026-11-19):** Use `gpt-6.2-sol` for the Sol assignments above.
  Keep `gpt-6.1-terra` until a GPT-6.2 Terra model is available. The MAI Code 2, Luna, and advisor
  assignments are unchanged.

---

## WI-1: Entra ID, silent renewal on every OIDC callback (PR 1)

**Outcome:**

- Each OIDC callback returns a token that is valid for the account the connection started with, looked up
  silently.
- A silent miss produces a typed error that every surface explains the same way.
- An expired token that the server rejects is renewed silently. The extension relies on the server's
  answer, not on local expiry checks (decision 0010).

**Read first:**

- `MicrosoftEntraIDAuthHandler.configureAuth`, and `MicrosoftEntraIDAuthHandler.test.ts`;
- `buildOidcClientConfiguration` in `oidcClientOptions.ts`;
- `documentdbTokenResource.ts`: `resolveInteractiveTokenResource` and the provider and env helpers;
- the JWT decoding in `playgroundWorker.ts` (the OIDC callback, around `tokenRequest`);
- `tokenExpiry.ts`;
- `entraErrors/entraTokenFailures.ts`;
- the error-translation skill.

**Steps:**

1. **Driver contract test (CP-0 evidence).**
   - Add `src/documentdb/auth/driverOidcContract.test.ts`. It imports the driver's internal OIDC workflow
     modules (use an ESLint disable comment, like the existing deep import) and drives them with a fake
     `connection.command`.
   - It asserts:
     - (a) after the callback throws once, the next `fetchAccessToken` rethrows the same error (F-1);
     - (b) `speculativeAuth` sends the cached token, whatever `expiresInSeconds` was (F-2);
     - (c) code 18 calls the callback again and uses the new token;
     - (d) a network error does not.
   - Name the suite so it reads as a contract: `driver contract: mongodb OIDC workflow (7.2.0)`. If a
     driver upgrade breaks it, the strategy has to be reviewed again.
2. **CP-0.** The strategy is **decided** (T-1, decision 0010): rely on the server. No proactive
   rotation and no local expiry checks. An expired token is rejected with code 18, and the driver calls
   our callback, which renews silently (step 5).
   - Add **tracing** that makes this visible without logging tokens: each callback call with its
     outcome (C-3), and the server error code or socket error that preceded it.
   - Then **stop and hand OP-1a to the operator** (§0, operator tests). Today's callback returns the token
     captured at connect, so OP-1a can only tell code 18 apart from a socket close; it **cannot** show
     renewal.
     - **A new socket on the same client** is what is under test. A new client would discard the token
       cache. Add `maxIdleTimeMS=60000` to the test connection string, so the idle pool drops its sockets
       and the next operation authenticates a fresh socket on the same `MongoClient`.
     - The evidence is the trace line (server code or socket error, then whether the callback ran), not
       "the query worked": a query on a socket that is already authenticated proves nothing.
   - Act on the result:
     - **code 18, then a second callback, then success:** nothing more to do;
     - **socket closed or reset, with no callback:** the driver keeps its stale cached token, so retrying
       on the same client cannot recover. Add a WI-5 classifier rule: on an Entra client, a closed
       connection during authentication is `clientClosed`, so the next **foreground** operation creates a
       new generation with a fresh token cache. No local expiry check (decision 0010).
   - Record the result and the rule, if one was added, in Progress.
   - **After step 5, hand OP-1b to the operator:** the same setup on the changed handler. Pass when the trace
     shows the expiry signal, a callback with outcome `returned`, and a successful operation, with no
     prompt.

3. **Session helper.**
   - Add `src/documentdb/auth/entraSession.ts`. It calls `vscode.authentication.getSession` with an
     **explicit** provider ID, normalizes the scopes (same rules as `getSessionFromVSCode`: `.default`
     suffix plus `VSCODE_TENANT:<id>`), and takes the `account` and mode (`interactive` = `createIfNone`,
     `silent`, `forceNew`) as parameters.
   - Replace the deep import in `MicrosoftEntraIDAuthHandler.ts` with it. This takes the handler off the
     azureauth internal path, so PR 1 and PR 2 do not collide.
   - Read the provider ID through the existing seam in `documentdbTokenResource.ts`, so that PR 2 migrates
     a single place.
4. **First acquisition.** Keep it as it is: interactive, reached only through the tree's first connect
   (C-6). Then record C-1 from
   `session.account` and the provider ID that was actually used, and return it on `AuthHandlerResponse`.
5. **The callback.** Replace the closure over `session` with:
   - a silent lookup pinned to the provider, scopes, tenant and `account`;
   - if the provider in use differs from the pinned one: `EntraSignInRequiredError('providerChanged')`;
   - no session: `EntraSignInRequiredError('noSession')`;
   - `session.account.id !== pinned.accountId`: `EntraIdentityMismatchError`;
   - any other thrown error: `TokenCallbackError` (keep the cause);
   - a result of `{ accessToken, expiresInSeconds }`, where `expiresInSeconds` comes from the JWT `exp`;
   - a C-3 notification for every completed lookup, including misses and failures.

   Leave `buildOidcClientConfiguration` untouched; it still checks the destination policy around the call.

6. **Shared JWT helper.** Move the JWT `exp` and `iat` decoding into `tokenExpiry.ts` as
   `readJwtTimes(token)`, returning `{ iatSec?, expSec? }`. Use it in the handler and in
   `playgroundWorker.ts`. An unknown `exp` stays unknown (`undefined`). The worker keeps its own fallback
   TTL; WI-9 must not report that fallback as a measured value.
7. **Failure registry.** A silent miss and an identity mismatch are **not** recorded as token failures,
   as the existing comment requires. A `TokenCallbackError` is recorded through
   `recordEntraTokenFailure`, with its `classifyEntraError` rule.
8. **Explanation.**
   - Register an `ErrorExplanationService` provider (id `entraSignInRequired`) that walks the
     `cause` chain, and the server-selection `reason` if the driver wraps the error, looking for C-2
     names.
   - It returns:
     - "Your Microsoft sign-in for '{cluster}' expired. Sign in again to continue.";
     - for a mismatch: "VS Code returned a different Microsoft account for '{cluster}'…".
   - Text only, no UI (skill rules).
   - The cluster name comes from the request's `clusterId`. Find out how existing providers resolve a
     display name; if none do, use a generic "this connection" rather than adding a lookup.
9. **Telemetry trace.** Extend the existing `traceAuthFlow` usage to the callback, with bounded values
   only. WI-9 adds the counted event; do not emit it here.

**Tests** (extend `MicrosoftEntraIDAuthHandler.test.ts`):

- a second callback asks the provider again, pinned, with `silent: true` and **never** `createIfNone`;
- the same token bytes while the token is still valid are accepted;
- no session gives `EntraSignInRequiredError`;
- a different account gives `EntraIdentityMismatchError`;
- a changed configured provider gives `providerChanged`, and `getSession` is never called with the new
  provider;
- the destination policy is still enforced before and after;
- `expiresInSeconds` comes from the JWT, and an opaque token leads to an unknown value, not 0;
- the registry is not touched for silent misses;
- the explanation provider recognizes a C-2 error wrapped two levels deep.

**Done when:**

- Case 1 is green;
- the contract test is committed;
- the CP-0 verdict is recorded;
- no `createIfNone` is reachable from the callback (a grep test or an assertion on the mock).

**Progress:**

- **Done (2026-11-19), commit `df0c22ade` (WI-1a, `gpt-6.2-sol`):** Added four MongoDB driver
  contract tests for the pinned 7.2.0 workflow: callback rejection, cached-token speculation,
  auth code 18 retry, and network error propagation without a retry. The accepted operator strategy
  (decision 0010) is unchanged; the tests confirm the mocked driver behavior, not the live server's
  response. All four focused tests and `npx tsc --noEmit -p .` passed.
- **Done (2026-11-19), commit `01c0d4846` (WI-1b, `gpt-6.2-sol`):** Added local callback, socket,
  and final-error traces without changing token handling. The implementation and review were advised
  (`claude-opus-5.5`, high confidence): the driver does not emit the initial code 18 it handles,
  so infer that path from the callback and final numeric code. Four trace tests added; Case 1 build
  and 92 focused tests passed.
- **OP-1a / CP-0 (2026-11-19), advised (`claude-opus-5.5`, 80%):** After about two hours idle,
  the cached client opened two fresh sockets. Both called back with the original captured token
  and closed before they became ready. The final error was `MongoNetworkError`, with no numeric
  code exposed. A contemporaneous diagnostics run authenticated with its own client and separate
  non-interactive session lookup; it did not measure token freshness. The pinned driver's
  cached-token path calls back after code 18, but the live trace does not show that code directly.
  Proceed with the accepted silent renewal plan. Keep WI-5 unchanged for now; carry the possible
  network-error shape to CP-2. OP-1b must verify a post-idle callback and successful operation
  without prompting, including if the driver has to retry the read on a second socket.
- **Done (2026-11-19), commit `d05b66909` (WI-1c, `gpt-6.2-sol`):** Added silent token lookup
  for the originally verified provider and account, shared JWT time parsing, typed callback
  failures, and bounded lookup observations. Kept the destination policy and Playground TTL
  fallback. Added 15 focused tests and updated dependent test mocks for the new session API.
  The advisor approved the OP-1b candidate (`claude-opus-5.5`, 85% confidence). `npm run build`
  and all 254 targeted tests passed.
- **OP-1b evidence (2026-11-19):** After about 43 minutes idle, Refresh reused the same client.
  A fresh socket triggered callback invocation 2 (`returned`) and then closed. The next socket
  became ready without another callback; later sockets and a second Refresh also succeeded at
  socket authentication on the same client. No `listDatabases.failed` was logged. This verifies
  the post-idle renewal and retry path; no longer wait is needed for OP-1b. The trace cannot alone
  confirm whether the database list was visible or whether a sign-in prompt appeared.
- **OP-1b passed (2026-11-19), operator verification:** The database list loaded and no sign-in
  prompt appeared. Resume the remaining PR 1 work. The separate long-wait requirement for OP-6
  still applies.
- **Done (2026-11-19), commit `5ee98385c` (WI-1d, `gpt-6.2-sol`):** Added a localized, text-only
  explanation for typed sign-in and identity mismatch errors, including errors wrapped by the
  driver. Used “this connection” rather than introducing a display-name lookup, as allowed by
  step 8. Four new tests; 51 focused tests and `npx tsc --noEmit -p .` passed. Localization
  generation and the remaining PR checks are deferred to handoff.

---

## WI-2: Shell and Playground token relays (PR 1)

**Outcome:**

- Worker token relays follow WI-1's policy, pinned to a snapshot taken at spawn.
- A miss reaches the host as a bounded reason, and the shell or playground shows one "sign in again" line
  with an action.
- A healthy warm worker never reads `CredentialCache`.

**Read first:**

- `ShellSessionManager`: `initialize`, `buildInitMessage`, the token relay and the shutdown paths;
- `PlaygroundEvaluator`: `evaluate`, `buildInitMessage`, the token relay and the worker lifecycle;
- `playgroundWorker.ts`: the OIDC callback and the `tokenError` handling;
- `workerTypes.ts`;
- the sovereign-clouds `decisions.md` D12 and finding E4
  (`sovereign-clouds/iterations/02-copilot-feedback-and-edge-case-review.md`);
- `ShellSessionManager.test.ts` and `PlaygroundEvaluator.test.ts`.

**Steps:**

1. **Snapshot and surface binding.**
   - Extend the D12 session snapshot with C-1: `providerId`, `accountId` and `tenantId`. Capture them on
     the **first** token relay of a newly spawned worker.
   - The first relay is silent and pinned when the host has a verified identity for the cluster
     (`lastVerifiedIdentity`, WI-4). Only when the snapshot has no pinned account yet may it be
     interactive, because opening a shell or running a playground is user-initiated. No separate
     "initial acquisition pending" flag.
   - Every later relay uses `entraSession.ts` in silent mode with the pinned account, and the same C-2
     errors as WI-1.
   - **Where the fingerprint lives (F-23).** A shell stores its fingerprint string (C-4) on its terminal
     session, which lives as long as the terminal. A playground stores it on the **document's**
     `PlaygroundConnection` in `PlaygroundService` when the document is bound to a cluster, never on the
     evaluator, which is shared per cluster and deleted on shutdown. Every Run compares the document's
     fingerprint, whether or not a worker is warm. Neither joins the surface registry; teardown finds
     shells through `getRegisteredShellTerminals` and playgrounds through `PlaygroundService` (WI-7). Before an automatic respawn
     (`ShellSessionManager.evaluate`, `executePlaygroundCode.ts`), compare the fingerprint of the current
     credentials with the stored one, and check the cluster latch (C-6):
     - same fingerprint and not latched: respawn as today;
     - a different fingerprint, or latched: do not respawn. Print the reason and the action.
     - Only an explicit recovery (Sign in again, Reconnect) may respawn under a new fingerprint.
2. **IPC.**
   - Extend `tokenError` with an optional bounded `reason`. Its values are `signInRequired`,
     `identityMismatch`, `destinationRejected` and `refreshFailed`. Keep the existing allow-list pattern
     of `errorName`.
   - The worker rebuilds an error with the matching C-2 `name`.
   - Add an optional bounded `authReason` to `initResult` and `evalError`, so that the reason survives both
     **init** and a **warm evaluation**.
   - **Update `WorkerSessionManager`'s error reconstruction** for init and eval (F-16). Today it builds a
     plain `Error` and keeps only `EntraDestinationRejectedError`. Test the whole path: worker → manager
     → surface.
   - Never send token values over IPC except the existing `tokenResponse`.
3. **Host behavior when the reason arrives.**
   - **Shell:** print one localized line, "Microsoft sign-in expired for this shell. Run 'Sign in again' to
     continue.", plus a terminal link or a non-modal notification with **Sign in again**. Never a modal
     (A1).
   - **Playground:** show the same as the run's error output, with an action.
   - **Sign in again for a worker:** under F-1 the worker's own driver workflow is broken. After a
     successful interactive acquisition **for the pinned account**, restart the worker session. The shell
     keeps its terminal and prints "Reconnected". The playground respawns on the next run.
   - A different account is an identity change (0003): the shell prints "Signed in as a different account;
     open a new shell to use it". Do not rebind.
   - **Any other token failure (F-1).** A `refreshFailed` reason, or any other error thrown from the
     worker's OIDC callback, whatever the auth method (Entra or managed identity), leaves the worker's
     `MongoClient` broken while the worker process stays alive, so the automatic respawn (F-15) never
     runs. Mark the worker session as broken when such a reason arrives. The next command, or the next
     playground run, stops the worker and respawns it under the **same fingerprint**, using the respawn
     rule in step 1. Print one line, without a modal.
4. **#1059 note.**
   - Call `PlaygroundEvaluator.buildInitMessage` only when a worker is spawned.
   - A warm run on the same cluster reuses the stored init.
   - A run against a different cluster, or a dead worker, spawns as it does today.
5. **E4.** A late token response or error from a disposed or replaced worker must change neither state nor
   diagnostics. Ignore messages from a worker that is no longer the session's current worker (compare the
   worker object); no extra ID.

**Tests:**

- Extend the two existing suites:
  - the second relay is silent and pinned; `createIfNone` is never used after the initial acquisition;
  - a changed provider fails closed;
  - a mismatched account fails closed;
  - the reason reaches the host during init **and** during a warm `evaluate`;
  - a warm evaluation does not read `CredentialCache` (spy);
  - a late relay result from a replaced worker is ignored;
  - after the cluster's credentials change to another user, the next shell command does **not** respawn
    silently; it prints `credentialsChanged`. A password-only change does respawn;
  - a latched (disconnected) shell or playground does not respawn on its next command;
  - a playground document bound as identity A, left open while the cluster moves to B (and its evaluator is
    shut down and recreated for another document), does not run as B; it prints `credentialsChanged`
    until the user rebinds it;
  - after a `refreshFailed` token error (Entra and managed identity), the next command respawns the
    worker once under the same fingerprint, and the command after that runs on the new worker.
- Add a test of the worker message round trip for `reason` and `authReason`.

**Done when:** Case 1 is green, and the PR 1 pre-review is committed.

**Progress:**

---

## WI-3: Azure discovery on azureauth v6 (#990) (PR 2)

**Outcome:**

- Discovery works after the ARM token expires, with no provider refresh.
- The ARM challenge works.
- Diagnostics reports "Azure sign-in needed" for ARM sign-in failures.

**Read first:**

- issue #990: `gh issue view 990 --comments`. It is the checklist.
- `AzureSubscriptionProviderWithFilters.ts` and `subscriptionFiltering/*`;
- `azureClients.ts`;
- `classifyResolutionFailure` in `resolveTarget.ts`, and its tests;
- the azureauth import list in #990.

**Steps:**

1. **Version selection (CP-W3), under the A4 policy: as high as viable without breaking our workflows.**
   - Findings on 2026-11-19:
     - The **Azure Resources extension** (`vscode-azureresourcegroups` `main`, 0.13.x) uses azureauth
       `^6.1.0-alpha.2`, azureutils `^4.3.0` and utils `^4.1.0`.
     - azureutils `4.3.0`, `5.0.0` and `5.1.0` all require azureauth `^6.1.0-alpha.2`.
     - Our azureutils `4.2.0` requires `^6.0.0-alpha.6`, which **does not** accept `6.1.0-alpha.x`.
     - utils `4.1.1` and later, including `5.x`, require `@microsoft/vscode-azureresources-api`
       **`^3.1.1`**. We are on `~2.5.0`; version 3 moved the package to CJS+ESM and finalized the auth
       challenge API. We use it in about 30 files, mostly for `AzureSubscription` types, plus the Azure
       Resources branch and workspace providers, `getAzureResourcesExtensionApi` and `unwrapArgs`.
     - **utils 5.0.0's only breaking change** removes the experimentation (TAS) API, which we do not use.
       The other public typings from 4.1.0 to 5.1.0 are additive (workflow telemetry,
       `openReadOnlyFile`, `authentication` on subscription context). Whole-error masking in
       `callWithTelemetryAndErrorHandling` is unchanged.
     - azureutils `5.0.0` only bumps it to utils v5; `5.1.0` loosens the Azure client type generics.
     - In our lockfile, only azureutils depends on the other azext packages, so the root manifest
       controls all versions.
   - The ladder (try from the top, stop at the first that passes):

     | Level           | azureauth       | azureutils | utils    | azureresources-api | Note                                                       |
     | --------------- | --------------- | ---------- | -------- | ------------------ | ---------------------------------------------------------- |
     | **L2 (target)** | `6.1.0-alpha.2` | `~5.1.0`   | `~5.1.0` | `~3.1.1`           | Highest available; ahead of Azure Resources on utils       |
     | L1              | `6.1.0-alpha.2` | `~4.3.0`   | `~4.3.0` | `~3.1.1`           | Parity with Azure Resources                                |
     | L0              | `6.0.0-alpha.8` | `~4.2.0`   | `~4.1.0` | `~2.5.0`           | Minimal; only if L1 breaks a workflow that cannot be fixed |

   - Before choosing, check the lockfile of the Azure Resources release that is published for the utils
     and azureauth versions it actually resolved.
   - For each level tried, record:
     - `npm ls` for all four packages: exactly **one** copy each;
     - the number of `npm run build` errors and what kind they are;
     - the bundle scan from #990 for duplicate copies and the broken ESM init pattern;
     - `flagging-fresh-dependencies` on the resulting lockfile.
   - **"Not breaking our workflows" means all of these pass:**
     - Azure Resources view: vCore and RU nodes, and the workspace resource provider;
     - Discovery: vCore, RU and VMs, with subscription and tenant filters;
     - sign-in, account changes, MFA and cloud switches;
     - deep links (`/connect/azure`, with and without a tenant ID);
     - every `AzureWizard` flow;
     - the **packaged VSIX** (`npm run package`) loads and activates, and the checks above pass on it,
       not only on a dev build;
     - the masking test in the telemetry-masking memory: a property containing "error" is still redacted.
   - Choose with the advisor. If L2 needs more than mechanical changes in the `azureresources-api` 3
     consumers, step down to L1 and record why.

2. **Migrate the APIs** at every call site that #990 lists:
   - `getSubscriptions` → `getAvailableSubscriptions`;
   - accounts and tenants;
   - `signIn`;
   - `onRefreshSuggested`;
   - the provider class paths;
   - the type-only imports.

   Keep the subscription-filter override effective, and keep the tenant filter as **one** mechanism
   (#990 asks you to choose; recommended: keep the extension's `globalState` tenant filter as it is).

3. **Shared seam.** Migrate `documentdbTokenResource.ts` (`getConfiguredAuthProviderId`,
   `getConfiguredAzureEnv`). That is the single seam WI-1 reads. If PR 1 merged first, re-run the WI-1
   tests.
4. **Stored subscriptions.** Confirm that v6 `credential.getToken` and `authentication.getSession` acquire
   a token on **every** call.
   - Add a unit test: a stored `AzureSubscription` whose first session "expires" still lists clusters on
     the second call. Use a mocked session sequence, and go through `createSubscriptionContext` the way
     `azureClients.ts` does.
5. **Diagnostics.**
   - In `classifyResolutionFailure`, classify these as `signInRequired`:
     - the package's `isNotSignedInError` guard;
     - a failed challenge;
     - `interaction_required` or an AADSTS sign-in error, matched by name or code, never by free text where
       a typed signal exists.
   - The report stays bounded: error name and status only.
   - Replace the test that manufactures `name: 'NotSignedInError'` with the **real** v6 exception shape
     (`name: 'Error'`, no status) recognized by the guard.
   - Do not assume ARM never prompts: a challenge can ask for step-up.
6. **l10n.** Refresh `l10n/@microsoft/vscode-azext-azureauth/bundle.l10n.json` as #990 describes, then
   run `npm run l10n` and `npm run l10n:check`.

**Done when:**

- Case 1 is green;
- exactly one copy of azureauth is installed;
- the #990 manual checklist is recorded in Progress, with OT-6 still pending;
- the PR 2 pre-review is committed.

**Fallback:** if PR 2 is not merged when WI-6 is ready, tell the operator (approved plan). Do not add a
shim (0005).

**Progress:**

---

## WI-4: Client identity, generation and the two cache fixes (PR 3)

**Outcome:**

- Every cached client carries C-4.
- Concurrent cold starts share one startup.
- Teardown and late startups cannot publish stale clients.
- Cancelling a cached reuse never closes the shared client.
- A closed topology is replaced, never reconnected with old options.
- `getClient` never prompts (C-6).

**Read first:**

- `ClustersClient`: `getClient`, `initClient`, `initializeClient`, `connect` and `deleteClient`;
- `ClustersClient.test.ts`;
- `connectionAuthIdentity.ts`;
- the tree-cluster-architecture skill (dual ID);
- the Kubernetes and Atlas reachability providers (how a tunnel rewrites the host).

**Steps:**

1. **Fingerprint** (`src/documentdb/connectionFingerprint.ts`, pure).
   - It hashes two inputs (SHA-256, hex, truncated) into an opaque string:
     - the **stored connection string without its password**, as it was before reachability rewrote the
       host to `localhost`. It carries the hosts, the database path and any `authSource`, so F-17 needs no
       special handling;
     - the **principal**: the native user name; Entra `providerId` + `accountId` + `tenantId` (C-1); the
       managed identity client ID, or `system-assigned`; or `none`.
   - **No normalization.** Any edit to the connection string counts as an identity change. That fails
     closed: the user sees "credentials changed" once and reconnects.
   - The Entra `providerId` is part of it, so a provider or cloud change is an identity change too.
   - **Known limitation:** if an admin replaces a resource's system-assigned identity, the principal
     changes but the fingerprint does not. That is not the user-driven identity switch that 0003 guards
     against; document it.
   - Table tests, reviewed as part of the PR:
     - a password-only change keeps the fingerprint, including an RU key rotation;
     - another user changes it;
     - an edited connection string changes it;
     - two managed identity client IDs differ;
     - a tunnel's local port change keeps it.
2. **Generation.**
   - Keep a static `Map<clusterId, number>` that only ever increases and is never cleared.
   - Each `ClustersClient` instance records `generation`, `fingerprint`, `createdAt` and its credentials
     snapshot.
   - Expose a read-only `binding` (C-4) and `ClustersClient.getBinding(clusterId)`.
3. **One startup at a time (single flight).**
   - A `_pendingStartups` map keyed by `clusterId` holds the startup promise. Every caller awaits it.
   - A caller's own `abortSignal` rejects only **that caller's** wait. It never aborts the startup, which
     has its own timeout.
   - The startup captures the C-6 epoch and publishes only if it is unchanged. Otherwise it closes its own
     `MongoClient`. Its waiters then get the latch's `ConnectionUnavailableError` if the cluster is
     latched, or retry once with the current credentials if it is not.
   - `deleteClient` calls `invalidate` **before** its first `await`.
4. **`getClient` rules (C-6).**
   - `initializeClient` stops hardcoding `{ interactive: true }`; `getClient` is always silent. Its options
     are `{ trigger, abortSignal, background? }`.
   - The interactive first connect moves to `ClustersClient.connectInteractive(clusterId)`, called only by
     the tree items' `authenticateAndConnect` and by Sign in again. No per-call-site audit is needed: every
     other caller acts on a cluster that the tree has already connected.
   - Add a per-cluster `lastVerifiedIdentity` record (C-1 for Entra; the principal for other methods),
     keyed by `clusterId` like `ClustersClient._clients`. It **survives eviction and Disconnect**, and only
     Remove Connection clears it (WI-7, decision 0011). A silent reconnect is pinned to it.
   - Add the latch check: a latched cluster throws `ConnectionUnavailableError(reason)` for every caller.
     WI-7 sets the latch.
   - Missing credentials throw `ConnectionUnavailableError('credentialsMissing')` instead of today's plain
     `Error`, whose message shows the raw `clusterId` (F-20).
   - Pass `background: true` from the dashboard poll, tree count badges and `CollectionNameCache`.
5. **Cached reuse.**
   - Remove the abort handler that closes the shared client (the cached branch of `getClient`).
   - A cancelled waiter just rejects with `UserCancelledError`.
6. **Closed topology.**
   - Track closure with the public SDAM event `topologyClosed` on the `MongoClient`, plus our own `close()`
     calls.
   - A foreground `getClient` on a closed client publishes a **new generation**, using the **current**
     `CredentialCache` and requiring the **same fingerprint**. A background caller fails instead.
   - If the fingerprint differs, do not publish; throw `ConnectionUnavailableError('identityChanged')`.
   - Today's `client._mongoClient.connect()` call on the cached path goes away.
7. **Telemetry helper.**
   - Add `addEstablishedConnectionContext(context, clusterId | client)`. It sets `authMethod`,
     `connectionCorrelationId`, and the measurements `connectionAgeMs` and `clientGeneration`.
   - No property name may contain "error" (masking).
   - WI-5 and WI-6 call it; add the helper and its tests only here.
8. **Development test hook** (optional, recommended).
   - Add `vscode-documentdb.debug.connection.simulateExpiry`, following the survey debug commands:
     - declared in `package.json`;
     - registered only in development mode;
     - listed in `LAZY_COMMANDS` with its reason.
   - It (a) makes the next N Entra callbacks for a selected cluster behave like a silent miss, and (b)
     force-closes the pool to simulate an idle drop.
   - Use a dashed context key if one is needed.

**Tests** (`ClustersClient.test.ts`, plus the new fingerprint test):

- two concurrent cold `getClient` calls create one `MongoClient`;
- cancelling one of two waiters leaves the other connected; cancelling both does not abort the startup;
- a startup that finishes after `deleteClient` does not publish, and closes its client;
- a cancelled cached reuse does not close the shared client;
- `topologyClosed` followed by a foreground `getClient` gives a new generation with the same fingerprint;
  a background `getClient` does not replace it;
- a changed principal followed by `getClient` gives `ConnectionUnavailableError('identityChanged')`;
- `getClient` never prompts, even with no client and with credentials cached; only `connectInteractive`
  may, and only when the cluster has no `lastVerifiedIdentity`;
- a latched cluster rejects every caller, including background ones;
- missing credentials give `credentialsMissing`, with no `clusterId` in the message;
- generation numbers only ever increase across delete and reconnect;
- the telemetry helper sets the bounded properties and no forbidden names.

**Done when:**

- Case 1 is green;
- every existing `ClustersClient` test still passes unchanged, or each change is justified in Progress.

**Progress:**

---

## WI-5: Classify failures and recover: host and tree (PR 4)

**Outcome:**

- One pure classifier.
- The tree's Retry actually reconnects.
- **Sign in again** exists and prompts once per click.
- A token callback failure never leaves a broken client cached, for any auth method.

**Read first:**

- `ClusterItemBase.getChildren` and `createErrorRecoveryChildren`;
- `retryAuthentication.ts` and its test;
- the RU items: `MongoRUResourceItem.ts`, `RUCoreResourceItem.ts`, `ruClusterHelpers.ts`;
- the tree-cluster-architecture skill, "Failure Presentation: Actions Only";
- the contract-test fixtures from WI-1.

**Steps:**

1. **Classifier** (`src/documentdb/connectionFailures.ts`, pure). Draft the table, then hold CP-2.
   - It walks `cause`, plus `MongoServerSelectionError.reason.servers[*].error` where present.
   - Initial table:

     | Signal                                                                        | Auth       | Kind                         | Generation                                   | Offered action                                  |
     | ----------------------------------------------------------------------------- | ---------- | ---------------------------- | -------------------------------------------- | ----------------------------------------------- |
     | `EntraSignInRequiredError`                                                    | Entra      | `signInRequired`             | replace on recovery (F-1)                    | Sign in again                                   |
     | `EntraIdentityMismatchError`, `ConnectionUnavailableError('identityChanged')` | any        | `identityChanged`            | evict; surfaces unavailable                  | Reconnect (rebind)                              |
     | `TokenCallbackError` (step 2)                                                 | Entra, MI  | `transient`, workflow broken | replace on the next **foreground** operation | Retry                                           |
     | `ConnectionUnavailableError('credentialsMissing')` (F-20)                     | any        | `credentialsMissing`         | none to keep                                 | Update credentials                              |
     | code 18                                                                       | Native, RU | `credentialsRejected`        | evict; no automatic retry                    | Update credentials (RU: Retry re-reads the key) |
     | code 18 after a fresh callback                                                | Entra      | per T-5                      | evict                                        | per T-5                                         |
     | `MongoNotConnectedError`, `topologyClosed`, "Client must be connected"        | any        | `clientClosed`               | new generation on the next foreground call   | none                                            |
     | network errors, timeouts, server selection with no auth cause                 | any        | `transient`                  | keep                                         | Retry                                           |
     | anything else                                                                 | any        | `other`                      | keep                                         | existing behavior                               |

   - **No regression for tunneled connections:** connection refused against a Kubernetes port-forward
     port is `transient`. The client is **kept**, never evicted, so the tree's existing tunnel restore
     (`beforeCachedClientConnect`) still recovers it. Tunnel recovery itself is #1105.

2. **Callback failures for every auth method (F-1).**
   - F-1 applies to **every** throw from the OIDC callback. The managed identity callback
     (`ManagedIdentityAuthHandler.configureAuth`) rethrows token-service (IMDS) failures and throttling as
     they are, so today they fall to `other → keep`, and the broken client stays cached until VS Code
     restarts.
   - Both handlers wrap such errors in `TokenCallbackError` (C-2). Destination rejection keeps its current
     handling.
   - The classifier treats it as `transient`, workflow broken: `reportFailure` marks the client, and the
     next **foreground** `getClient` replaces it with a new generation and the same fingerprint.
3. **Report failures.**
   - Add `ClustersClient.reportFailure(binding, error)`: a function, not a service. It classifies the
     error and ignores it when `binding.generation` is stale. It evicts or marks the client according to
     the table, and returns the kind so the caller can choose its UI.
   - It keeps no connection state and fires no events (C-5).
   - **Every operation reports its own failure.** A client can resolve and then fail authentication
     **during** a read, save or ping. Add one thin function, `runWithClient(binding, op, { background? })`:
     it resolves the client (WI-6), runs `op`, and on a throw calls `reportFailure`. For a terminal kind
     (`signInRequired`, `credentialsRejected`, `credentialsMissing`, `identityChanged`) it returns the
     structured unavailable result (C-5); otherwise it rethrows. Every WI-6 router operation and WI-8
     ping goes through it. It keeps no state (decision 0013).
4. **Tree.**
   - Route both catch paths in `getChildren` (cached-client reuse and `listDatabases`) through
     `reportFailure`. Keep the modal-plus-actions presentation.
   - Change `createErrorRecoveryChildren` to:
     - **Sign in again** (when the kind is `signInRequired`), or **Update credentials** (the
       provider-owned action that exists today);
     - then Diagnose;
     - then Open shell;
     - then **Retry last**.
   - Check that order against the skill text, and update the skill in WI-10 if it differs.
   - Call `addEstablishedConnectionContext` on the failure events of `connect`, `getchildren` and the tree.
   - **Keep credentials on recoverable failures (F-20).** In every provider item's `authenticateAndConnect`
     failure path, still call `deleteClient`, but call `CredentialCache.deleteCredentials` only when the
     kind is `credentialsRejected`, or `other` as today. For `transient`, `clientClosed` and
     `signInRequired`, keep the entry: a network outage during a tree expand must not leave open surfaces
     with nothing to reconnect from, nor make the user retype a discovery password. Put the decision in
     one shared helper, not in ten copies.
5. **Retry.**
   - `retryAuthentication` evicts the client (`deleteClient` without clearing credentials) when the last
     kind was `signInRequired`, `credentialsRejected` or `clientClosed`, and then refreshes.
   - It captures the C-6 epoch **before** its first `await`. If the epoch changed in the meantime (a
     Disconnect, or another recovery replaced the client), it does nothing destructive: no eviction, and
     no latch cleared.
   - The `CredentialCache` entry is kept.
   - **RU key exception:** on Retry after `credentialsRejected` for an RU Discovery or Azure Resources
     item:
     - drop the cached key and re-read it from ARM once (`extractCredentialsFromRUAccount`);
     - an ARM sign-in failure there is reported as "Azure sign-in needed" (WI-3 classifier), not as a
       database rejection;
     - never open a password wizard.
6. **Sign in again** command (`vscode-documentdb.command.signInAgain`, args: a tree node or `{ clusterId }`).
   - Read the pinned C-1 from the cluster's `lastVerifiedIdentity` record (WI-4). Capture the C-6 epoch
     **before** prompting.
   - Call `entraSession.ts` with `forceNewSession` for that account and tenant, every time. The user
     clicked, so one prompt is expected, and it also covers a session that the silent lookup still
     returns but the server rejects.
   - **After the prompt, check the epoch.** If it changed while the user was signing in (for example, a
     Disconnect), do not evict, do not reconnect and do not clear the latch. Report "The connection was
     closed while you were signing in."
   - Same account: evict and start a new generation.
   - Different account: the identity changed. Surfaces bound to the old fingerprint become unavailable
     with `identityChanged` (C-5), and the tree continues with the new identity.
   - A dismissal is a `UserCancelledError`. Nothing re-prompts, because `getClient` never prompts (C-6).
   - There is no `onDidChangeSessions` listener (decision 0012). A signed-out account is found by the next
     operation's silent lookup, which fails with `signInRequired`.

**Tests:**

- classifier table tests on real error shapes;
- a managed identity callback that throws once: the next foreground operation works on a new
  generation, and a background tick does not replace the client;
- Retry after `clientClosed` creates a new generation; after `credentialsRejected` it keeps the
  credentials and does not loop;
- the RU old/new key pair; an ARM sign-in failure compared with a database rejection;
- Sign in again with the same account and with a different account, always with `forceNewSession`;
- no re-prompt after a dismissal;
- a stale-generation result is ignored;
- an old Retry that resolves after the client was replaced does not evict the new client;
- Sign in again that completes after a Disconnect does not reconnect or clear the latch;
- with the tree untouched, an OIDC callback failure during a Document View read offers the recovery
  action (through `runWithClient`), and the next foreground read gets a new generation;
- a tree expand that fails with a network error keeps the `CredentialCache` entry, and an open surface
  then reconnects silently once the network is back; a code 18 failure still evicts it.

**Done when:**

- Case 1 is green;
- the CP-2 verdict is recorded;
- OT-2's tree part can be reproduced with the WI-4 hook.

**Progress:**

---

## WI-6: Bind surfaces and add the unavailable state (PR 5)

**Outcome:**

- Collection View (all tabs), Document View and the Cluster Dashboard resolve their client per operation
  through a binding.
- They show an unavailable state (C-5) with a banner and one action.
- They keep all user state.
- They never apply stale results.
- They never run under another identity.

**Read first:**

- the webview-trpc-messaging and react-webview-architecture skills;
- `collectionViewRouter.ts`, `indexesTab/indexViewRouter.ts`, `queryInsights/queryInsightsRouter.ts`
  and `queryInsightsEventsRouter.ts`;
- `QueryInsightsAIService.ts` and `indexAdvisorCommands.ts`;
- `documentsViewRouter.ts` and `documentView.tsx` (the `isDirty` state);
- `clusterDashboardRouter.ts` and `ClusterDashboard.tsx`;
- `collectionViewContext.ts`;
- `openAppWebview.ts`;
- `build/verification/browser/scenarios.ts` and `fixtures.ts`.

PR 5 is one PR. Split it into host and webviews only if the diff becomes too large to review well, as the
approved plan allows; the webview half then stacks on the host half without waiting for it to merge.

### Host

1. **Surface registry** (`src/documentdb/connectionSurfaces.ts`).
   - A plain list per `clusterId`: `register({ clusterId, kind, disable(reason), dispose, isDirty? })`
     returns a disposable.
   - Collection View, Document View and the Dashboard register when they open and unregister on
     `onDisposed`.
   - Only teardown reads it (WI-7). Shells and the playground do not register (WI-2).
2. **Binding resolution.**
   - `resolveBoundClient(binding, { background? })` has two outcomes:
     - **the same fingerprint:** return the cluster's current client, whatever its generation. Replacing a
       client for the same identity is transparent: no re-run and no notice (decision 0010). If there is
       no client and the cluster is not latched, `getClient` reconnects silently, pinned to
       `lastVerifiedIdentity`;
     - **a different fingerprint, or a latched cluster:** throw `ConnectionUnavailableError(reason)`.
   - A surface **never** prompts (C-6).
   - Router procedures run their operations through `runWithClient` (WI-5 step 3), so failures **during**
     the operation are classified too, and return a structured `{ unavailable: { reason, text, action } }`
     result instead of an error (F-12).
   - **No regression for tunneled connections** (Kubernetes `ClusterIP` through port-forward). Creating a
     new generation from this path may not do less than today's tree path, and it does not re-create
     tunnels. A tab whose tunnel died behaves as it does today: it fails transiently until a tree expand
     restores the tunnel. Re-creating the tunnel outside the tree is #1105.
3. **`ClusterSession`.**
   - It stops holding a `ClustersClient`, and stores the binding instead.
   - `getClient()` becomes an `async` resolve.
   - Update its callers:
     - the Collection View router;
     - the Query Insights routers;
     - `QueryInsightsAIService`;
     - `indexAdvisorCommands`.
4. **Routers without a session.**
   - Document View, the index router and the Dashboard capture the binding when the panel opens (in the
     controller's config and tRPC context), and resolve it for every operation.
   - Re-run the grep from the approved plan, and list every converted call site in Progress.
5. **Writes.**
   - Save document, inserts and deletes, and index create, drop, hide and unhide.
   - The extension **never resubmits** a write; that is OT-4's "not replayed". A failed write is reported
     as it is today, and never with text that claims the write was not applied: when the reply was lost,
     the server may have applied it (F-22). The driver's own retryable writes (`retryWrites`) stay as they are: the server
     deduplicates them by design, and RU connection strings disable them.
   - Test that one application-level submission results in exactly one call to the driver.
6. **Stale results.**
   - Every request records the C-6 **epoch** when it starts.
   - **Before any host-side mutation**, check once that the epoch is unchanged, that the binding still
     resolves to the same fingerprint, and that the cluster is not latched. Otherwise drop the result.
     Disconnect, Reconnect and every eviction bump the epoch, so a reply that started before a Disconnect
     is dropped even after a Reconnect as the same user. That covers `ClusterSession`'s
     `_currentRawDocuments`, its query caches, the Query Insights caches and `SchemaStore` updates. A stale
     result must not change host state at all.
7. Every router error path uses `addEstablishedConnectionContext` (WI-4).

### Webviews

1. **Shared UI.**
   - A `DisconnectedBanner` component: a Fluent `MessageBar` with intent `warning`, the host-provided
     reason text and **one** action button. It uses `role="status"` and `aria-live="polite"`.
   - It shows when a procedure returns `unavailable`, or when the host's `disable(reason)` sends its one
     message to the panel over the existing webview channel.
   - Put it in the shared webview components folder, and run the detecting-accessibility-issues skill on
     it.
2. **Disabling.**
   - While the banner shows, every action that talks to the server is disabled: run query, paging,
     refresh, save, delete, insert, index actions, Query Insights stages and AI calls.
   - Editors stay **editable**. The user can keep typing.
   - A response that arrives while the banner shows is ignored.
   - **A reply never overwrites a newer edit.** The Document View applies a save or load reply to the editor
     only if the editor content has not changed since the request was sent; otherwise it keeps the edit and
     stays dirty. Today's save handler (`documentView.tsx`) replaces the content and clears `isDirty`
     unconditionally. The Collection View applies a page only for the latest query request it sent.
3. **What each view keeps.**
   - **Collection View:** query text, filter, sort, projection, page number and size, the selected tab,
     and the Query Insights results as they were.
   - **Document View:** the dirty editor content and `isDirty`.
   - **Dashboard:** the last data (WI-8 stops the polling).
4. **Actions.**
   - **Reconnect** (same fingerprint): clear the latch if one is set, and resolve again. On success,
     remove the banner and re-enable the actions; the live region announces "Reconnected". The query is
     not run automatically, and there is **no** "out of date" notice (decision 0010; see #1106). After a
     Disconnect the credentials are still cached (0011), so this is silent.
   - **Reconnect after an identity change:** an explicit rebind to the new fingerprint, then show "Now
     connected as {label}" (OT-3).
   - **Sign in again:** the WI-5 command.
   - **Update credentials:** the existing command.
   - **Close:** dispose the panel.
5. **L2-dev scenarios** (`scenarios.ts` and `fixtures.ts`):
   - `collectionView/disconnected-signInRequired`: query text kept, Run disabled, no host calls when
     Run is clicked;
   - `documentView/disconnected-dirty`: edit kept, Save disabled;
   - `clusterDashboard/disconnected`;
   - a scenario that injects a disconnect after typing and then delivers a page response: the applied
     results are not overwritten;
   - `documentView/stale-save-after-reconnect`: send Save, Disconnect, Reconnect, edit again, then deliver
     the old save reply: the new edit stays and the view stays dirty.
   - Run them with the browser scenario config. Screenshots are artifacts, not baselines.

**Transfers:** do not change how copy, paste or export work (approved plan). One addition: when Collection
View starts an import or export, it passes its binding's fingerprint in the command arguments (F-23). The
command checks it once, where it takes the WI-7 lease and before its first `getClient`. A mismatch stops
with `credentialsChanged` and nothing is written. Commands started from the tree carry no fingerprint and
behave as today.

**Tests:**

- router tests for both resolution outcomes on each converted router;
- `ClusterSession` no longer stores a client (a type-level or structural test);
- a stale result is dropped before any host-side mutation, including a reply that started before a
  Disconnect and arrives after a Reconnect as the same user;
- the webview ignores a response that arrives while the banner shows;
- one submission for a write whose reply is lost;
- an import started from Collection View as identity A, with its file picker left open while the cluster
  moves to B, writes nothing until the user starts it again;
- the scenarios above.

**Done when:**

- Case 1 is green;
- the scenarios pass;
- OT-1 and OT-3(a) can be reproduced with the WI-4 hook.

**Progress:**

---

## WI-7: Teardown, Disconnect, Remove and Update Credentials (PR 6)

**Outcome:**

- One teardown serves Disconnect, Remove and identity-changing credential updates.
- It is guarded by task conflicts and dirty editors.
- It covers every per-cluster resource.
- **What it guarantees** (F-22: closing a client cancels nothing already sent):
  - no **new** submission under the old binding after the latch is set;
  - no automatic replay of anything;
  - no stale reply changes host state or the UI (WI-6 step 6 and the webview rule);
  - no message claims that an unacknowledged write was not applied.

  Operations already in flight may complete or fail; whatever happens is reported normally. Shell and
  playground workers are stopped. Tasks, exports and imports are protected by the conflict check.

  This is the right level for an interactive tool; do not build per-operation admission control.

**Read first:**

- `removeConnection.ts`;
- `resourceUsageHelper.ts` and `taskService.ts` (`getConflictingTasks`);
- `CopyPasteCollectionTask.ts` and `CopyIndexesTask.ts` (`getUsedResources`);
- `exportDocuments.ts` and `importDocuments.ts`;
- `deleteFolder/` (`ExecuteStep.ts`, `VerifyNoConflictsStep.ts`);
- `storageService.ts` `push` (F-21);
- `updateCredentials.ts`, including the D12 modal;
- `updateConnectionString.ts`;
- `CredentialCache.ts`, `entraTokenFailures.ts` and `SchemaStore.clearCluster`;
- the WI-6 registry;
- `switchAtlasViewMode.ts` (the `globalState` pattern).

**CP-4 first:** the teardown order, T-2 and the export and import lease.

**Steps:**

1. **Export and import lease (A5).**
   - Add `TaskService.acquireResourceLease(resource, label)`, which returns a disposable.
     `getConflictingTasks` includes active leases.
   - `exportDocuments.ts` holds the lease for the whole export, and `importDocuments.ts` for the whole
     import (from the first `getClient` to the last flushed batch), on the target collection.
   - Copy/paste and copy-indexes are tasks already and need no lease (F-9).
   - `acquireResourceLease`, and starting a task, are refused while the cluster is latched (C-6), with the
     latch's reason. The latch is what keeps new work out during a credential save (step 5).
   - Test that export and import each conflict with Disconnect of their cluster and with Delete
     Collection of their collection, and that an unrelated cluster does not.
2. **Teardown** (`src/documentdb/connectionTeardown.ts`): plain functions, with no reservation. The latch
   is the only thing that can be undone, and only Update Credentials ever undoes it (step 5). Disconnect
   and Remove call `confirmTeardown` and `commitTeardown` back to back.
   - **`confirmTeardown(clusterId, intent)`**, which may prompt and may be cancelled. It changes nothing:
     1. **Conflicts:** task and lease conflicts through `checkCanProceedAndInformUser`. On a conflict,
        stop; the conflicting task is named.
     2. **Choice:** Close all or Keep open (A2), only when surfaces are registered and the setting is
        `ask`. With the setting at `closeAll` or `keepOpenDisabled`, use that value without a modal.
     3. **Dirty check** (only for `close`): if any registered surface reports `isDirty`, ask for
        confirmation. Cancelling leaves every panel, draft and connection intact, also when Remove started
        the teardown.
   - **`latchForTeardown(clusterId, reason)`**, synchronous: recheck conflicts with `getConflictingTasks`,
     because a copy, export or import may have started while a prompt was open; on a conflict return
     `false` and change nothing. Otherwise set the latch (C-6) and call `ClustersClient.invalidate`, which
     increases the epoch, with no `await` in between, and return `true`. From here on no new task, lease or
     client can start.
   - **`commitTeardown(clusterId, { reason, choice, dropCredentials })`**, which has no prompts:
     1. Call `latchForTeardown` unless the caller already did (step 5). On a conflict, stop and inform the
        user; nothing has changed.
     2. **Surfaces:** for Keep open, call each registered surface's `disable(reason)`; for Close all,
        dispose them.
     3. **Shells** (found through `getRegisteredShellTerminals`): print "Disconnected", then stop the
        worker. **Playground:** stop the worker. The latch keeps both from respawning (F-15).
     4. Close the client (`deleteClient`). Clear the Entra failure registry and `SchemaStore.clearCluster`.
        Clear the `CredentialCache` entry and `lastVerifiedIdentity` **only** when `dropCredentials` is
        set (Remove). Disconnect keeps both (A3, decision 0011), so Connect and a tab's Reconnect are
        silent and pinned to the same identity.
     5. Refresh the tree (T-2).
   - **Never touched:** VS Code auth sessions, the managed identity cache, the ARM cache.
   - **Keys:** every store keeps its current `clusterId` matching. Provider-specific equality is out of
     scope (decision 0009, #1105). Do not add case folding or unfolding in this iteration.
   - **Kubernetes tunnels:** the teardown does not stop port-forward tunnels, and does not change how
     removing a kubeconfig source works (#1105).
3. **Disconnect command** (`vscode-documentdb.command.disconnect`).
   - Add a `connected` tag to the cluster item's `contextValue` while a client exists, and refresh it when
     the item refreshes. Use `viewItem` regex menus in the Connections, Azure Resources and Discovery
     views.
   - **The choice (A2):**
     - Use a modal warning: `showWarningMessage` with `{ modal: true, detail }` and the two buttons Close
       all and Keep open (disabled). The built-in Cancel cancels the whole operation.
     - The modal cannot pre-select a button, and nothing is remembered.
     - Add a setting, proposed as `documentDB.connections.openTabsOnDisconnect`, with the enum `ask`
       (default), `closeAll` and `keepOpenDisabled`. `documentDB.shell.multiLinePasteBehavior` is the
       precedent for an enum with an `ask` default and `enumDescriptions`.
     - Follow [settings/README.md](../../settings/README.md) for the group, `order` and the ID naming
       rules. If an existing group fits better than `connections`, use it and record the final ID in
       Progress.
     - The same choice applies to Remove Connection and to identity-changing credential updates.
     - The setting never skips the unsaved-edits confirmation: when Close all is chosen and an editor is
       dirty, that confirmation still appears.
     - Skip the modal when no surfaces are registered.
   - Add a disconnected cluster node child action, "Connect" (T-2). It clears the latch and connects.
4. **Remove Connection and folder deletion.**
   - Remove Connection: teardown with reason `connectionRemoved` and `dropCredentials: true`, then delete
     the stored connection and clear the schema, as today. Keep the existing confirmation.
   - **Deleting a folder** (F-23) runs the same teardown for **every connected descendant**, with **one**
     combined `confirmTeardown` for all of them (conflicts, choice, dirty check), not one modal per
     connection. It runs before `deleteFolder/ExecuteStep.ts` deletes anything. Cancelling leaves the
     folder, its connections, panels, drafts and shells intact. Descendants without a client or open
     surface still get their `CredentialCache` entry and schema cleared, as Remove does.
5. **Update Credentials and Update Connection String.**
   - Compute the **new** fingerprint from the wizard context before saving.
   - **Make save success explicit** (F-19): the execute step must report whether the save succeeded, for
     example with a flag on the wizard context. Today it catches failures and returns normally.
   - **Same fingerprint:** save. Only after a confirmed success, call `invalidate` and replace the client
     with a new generation; surfaces continue.
   - **Different fingerprint:**
     1. `confirmTeardown` **before** saving.
     2. `latchForTeardown` **before** saving. On a conflict, stop: nothing is saved. Now no import, task or
        connect can start while the save runs.
     3. Save.
     4. **Storage decides, not the success flag** (F-21). Re-read the stored connection and compute its
        fingerprint:
        - it differs from the live binding (a full save, **or** a partial one where the secrets were
          written): `commitTeardown` with reason `credentialsChanged` and `dropCredentials: false`, so what
          is stored is what the next connect uses. `lastVerifiedIdentity` is replaced on the next successful
          connect. If the save reported a failure, also tell the user the change may be incomplete and offer
          Update Credentials;
        - it equals the live binding (nothing reached storage): clear the latch. The old binding stays
          usable, and the user is told the save failed.
   - The latch and the `invalidate` call make sure a concurrent connect cannot publish the old credentials
     after the change.
   - Add a **Disconnect** button to the D12 modal for open shells.
6. **Telemetry.**
   - One `connection.disconnect` event with `source` (`command`, `remove`, `credentialsChanged`),
     `surfacesChoice`, and counts of surfaces, shells and the playground, plus `blockedByTask`.
   - No identifiers.

**Tests:**

- teardown for each surface type;
- blocked for a copy source, a copy destination, an export source and an import target; an unrelated
  cluster is not blocked; Disconnect succeeds once the task is done or stopped;
- a token response that arrives after Disconnect is ignored;
- Reconnect uses the current credentials and cloud settings;
- after Disconnect, a tab's Reconnect and the tree's Connect succeed without the tree reloading
  credentials and without a prompt (native, Entra and discovery with a typed password); after Remove,
  the `CredentialCache` entry and `lastVerifiedIdentity` are gone;
- Remove reuses the same teardown;
- cancelling the dirty prompt changes nothing;
- a copy, export or import that starts while the Disconnect prompt is open stops the commit, and nothing
  changes;
- a shell or playground left open after Disconnect does not respawn on its next command;
- Disconnect while a query or save is in flight: whatever the operation's outcome, it is reported, its
  reply changes no state, and nothing new is submitted under the old binding;
- an import attempted while Update Credentials is saving is refused with the latch's reason, and nothing
  is half-applied;
- a save that fails before any write keeps the old binding and clears the latch;
- a save whose metadata write fails after the secret write ends in teardown under `credentialsChanged`,
  never in a split state (old client, new stored secrets);
- deleting a folder with a connected child that has a dirty Document View and a live shell: cancelling
  leaves everything intact; confirming leaves no usable client, cached credentials, shell or tab for the
  child;
- a concurrent connect during Update Credentials does not publish the old credentials.

**Done when:** Case 1 is green, and the OT-7 flows can be reproduced on a dev build.

**Progress:**

---

## WI-8: Cluster Dashboard health polling (PR 6)

**Outcome:** the poll stops when the cluster is unavailable, shows the banner, and resumes with exactly
one loop.

**Steps:**

1. `measureRtt` runs through `runWithClient` with `background: true`, so it never replaces a client
   (T-4). It returns a structured result, `{ ok, rttMs } | { unavailable }`, instead of throwing.
   - **Classify before the sampler stringifies (F-24).** `sampleClusterHealth` keeps the error object
     of a failed command long enough to classify it. A terminal kind (auth, closed client) is rethrown so
     that `runWithClient` returns `unavailable`. An unsupported command, such as `serverStatus` on some
     servers, stays an ordinary partial sample with its entry in `errors`.
2. The webview poll effect depends on the banner state: it stops on `unavailable` or on a `disable`
   message, and starts again after Reconnect. React's effect cleanup keeps it to one loop; no extra loop
   token.
3. A ping that resolves while the banner shows is ignored (the WI-6 webview rule), so it cannot clear the
   banner.
4. Visibility pause and backoff are the rest of #1091. Do them here only if they are trivial; otherwise
   leave them to #1091.

**Tests** (fake timers):

- no client lookups on ticks or on reveal after Disconnect;
- a late success does not clear the banner;
- reconnecting starts exactly one loop;
- `signInRequired` and `credentialsRejected` stop the loop after one tick, including when they happen
  **inside** the sampler's ping with the tree untouched;
- an unsupported `serverStatus` still yields a partial sample and keeps polling.

**Progress:**

---

## WI-9: Token renewal telemetry (PR 7)

**Outcome:** the release can be judged from events that need no joins and no persistent identifiers.

**Steps:**

1. **`connection.tokenRenewal`.**
   - Emitted from the C-3 observer (host client) and from the host side of the shell and playground
     relays.
   - Once per completed post-startup Entra **database** token lookup. The initial acquisition is excluded.
   - Properties: `surface` (`extension`, `shell`, `playground`) and `renewalOutcome` (`returned`,
     `noSession`, `identityMismatch`, `failed`).
   - One measurement: `tokenLifetimeSeconds`. Omit it when unknown; never send 0 or the worker's fallback
     TTL.
   - Never send a token, hash, claim, account, tenant, cluster ID, fingerprint or host name.
2. **Recovery, without a new event.** Existing `connect`, `rpc` and `getchildren` events carry
   `connectionAgeMs` and `clientGeneration` (WI-4 `addEstablishedConnectionContext`). A successful
   operation on a generation above 1 shows that a replacement worked, and late auth, socket and
   closed-client failures should drop against the baseline.
3. **ARM.** Report challenge outcomes separately from database renewal. Confirm that the final ARM request
   succeeded, not just that a token was acquired.
4. **Volume.**
   - `connection.tokenRenewal` is a background event. If the dashboards keep an event-scope exclusion list
     for "active users" totals, add it there.
   - Check the expected volume (about one renewal per active Entra client per hour) against the
     telemetry budget.
5. **Queries.**
   - Commit runnable Kusto queries in a durable `../telemetry.md` at the feature root:
     - daily renewal outcomes;
     - p50/p90 of the token lifetime;
     - successful operations on a replaced client (generation above 1);
     - late auth, socket and closed-client failures against the pre-release baseline, using the same
       exposure denominator.
   - Show sample counts and missing timing data next to every percentile.
   - If the operator's telemetry dashboards worktree is available, port the queries there too.
6. **Fake-clock test** for the sequence returned → returned → noSession:
   - check counts and units;
   - include an opaque token (no lifetime) and a database rejection after the lookup.

**Done when:**

- the tests are green;
- the queries have run once against pre-release ingestion (or they are marked "pending ingestion" in
  `# Outcome`).

**Progress:**

---

## WI-10: Documentation (PR 7)

1. **User manual:**
   - add `docs/user-manual/connection-lifecycle.md`, or extend `connecting-to-databases.md` (choose one and
     record the choice). It covers Disconnect, Sign in again, what a disconnected tab means and how to
     resume, and what Update Credentials does to open sessions;
   - link it from `interactive-shell.md`, `query-playground.md` and `managing-azure-discovery.md`;
   - user-manual pages and release notes use **separate copies** of their images.
2. **Release notes** for 1.2.0 (writing-release-notes skill). Screenshots go through the
   documentation-screenshots skill.
3. **Skills:**
   - tree-cluster-architecture: "resolve the client per operation through a binding; never hold a
     `ClustersClient`", the recovery-children order, and the `connected` context tag;
   - error-translation: the C-2 errors and the `entraSignInRequired` provider.
4. **Feature docs:**
   - feature `README.md`: status, code map and timeline;
   - `decisions.md`: entries for A1–A6 once confirmed, T-1 and anything else the checkpoints decided;
   - add `design.md` if the binding, state and teardown design outgrew the README.
5. **Preview** the docs site locally (previewing-docs-site skill).

**Progress:**

---

## PR F: `feature/connection-lifecycle` → `main`

1. Sync `main` into the feature branch through a pure merge PR (approved plan rule 5).
2. Run Case 2 on the feature branch head.
3. Run OT-1 to OT-7 on the packaged VSIX, with at least one real wait of two hours or more. Record each
   result, and the evidence the approved plan requires, in `# Outcome`. In addition:
   - **OT-1:** check the shell separately. After the wait, its worker's own connection must renew without
     a prompt; record the token relay in the output channel, never the token.
   - **OT-7:** also Disconnect while a query or save is in flight. Whatever its outcome, it is reported;
     its reply does not change the open view; nothing new is submitted under the old connection; and no
     message claims that an unacknowledged save was not applied (F-22).
   - **OT-1 and OT-2 evidence:** a callback trace line after the wait or the sign-out, on a fresh socket
     (`maxIdleTimeMS`), not only a successful query. Also Disconnect during an **import**: it must be
     blocked before the Close/Keep prompt, and the import continues.
4. CP-5 verdict, then open PR F. Its description carries `Fixes #n` for every issue the iteration
   resolves in full (see the §0 issue table), and `Part of #n` for the rest.
5. After the merge: for every linked issue that stays open, post the partial-fix comment (§0), summarizing
   the whole iteration and what is left. Do the same on #1105 and #1106 for the work handed to them.
6. Watch telemetry for about one week after the merge (WI-9 queries).

# Outcome

_To be written at hand-over._
