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

### Per-PR workflow

- **Branch:** create `dev/tnaum/<topic>` from `feature/connection-lifecycle`. Follow the approved plan's
  rules for keeping PRs off each other.
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
- **PR description:** name the WIs, the provisional answers (§1) the PR relies on, the checkpoint verdicts
  it implements, and which verification case ran.

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

The operator was not available on 2026-11-19 at first. They answered A2, A4, A5 and A6 later the same
day; A1 and A3 are still **provisional** under rule 4 above.

| #   | Question                                             | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Status                                                              | Where it lands         |
| --- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------- |
| A1  | Plan Q1: how does sign-in start after a silent miss? | **Only through the Sign in again button**, everywhere. The first connect from the tree stays interactive, as it is today. One rule, and no surface has to decide whether it is in the foreground. This matches 0001.                                                                                                                                                                                                                                              | Provisional                                                         | WI-1, WI-2, WI-5, WI-6 |
| A2  | Plan Q2: Disconnect choice, default and memory       | A **VS Code modal**, which has no pre-selected button and **remembers nothing**. A setting lets users choose a default: `ask` (the default) shows the modal; `closeAll` or `keepOpenDisabled` skips it. The unsaved-edits confirmation still appears when closing. See WI-7 step 3.                                                                                                                                                                               | **Operator, 2026-11-19** (decision 0007)                            | WI-7                   |
| A3  | Plan Q3: does Disconnect drop `CredentialCache`?     | **Yes** (#1059 proposal). Saved connections reload from storage on the next expand. A password typed only for a discovery connection must be typed again. Implement it as a teardown option, so flipping the answer is a one-line change.                                                                                                                                                                                                                         | Provisional                                                         | WI-7                   |
| A4  | #990: which azext versions?                          | **As high as viable without breaking our workflows**, using the Azure Resources extension (same team as azureauth, heavily used) as the reference. Ladder and findings are in WI-3 step 1: target L2, fall back to L1, then L0.                                                                                                                                                                                                                                   | **Operator policy, 2026-11-19** (decision 0008)                     | WI-3 (CP-W3)           |
| A5  | How does Disconnect see an in-flight Export?         | **Reuse the existing mechanism.** Delete Collection, Delete Database and Remove Connection already guard through `checkCanProceedAndInformUser` (`TaskService` resource tracking). Export is the gap: it is not a task and registers nothing, so even Delete Collection does not see a running export today. Close it with a small **resource lease** that feeds the same check. Every existing guard then sees exports too, and the export logic is not touched. | Operator pointed at the existing check; lease is the recommendation | WI-7                   |
| A6  | Where do the dev plan and its progress notes live?   | In this file. Progress is recorded inline per WI here. The approved plan gets a one-line pointer.                                                                                                                                                                                                                                                                                                                                                                 | **Operator, 2026-11-19**                                            | —                      |

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
  - **Export is not a task.** `exportDocuments.ts` calls `getClient` directly and registers nothing.
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
  - So the interaction policy and the disconnected latch must be enforced **centrally in `getClient`**
    (C-6), not per caller.
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
- **F-18. Cluster ID matching is inconsistent across stores.**
  - `CredentialCache.deleteCredentials` lowercases its key (`CaseInsensitiveMap`), so deleting Kubernetes
    context `prod` also deletes `Prod`.
  - Task conflict matching (`hasResourceConflict` in `taskServiceResourceTracking.ts`) compares IDs
    exactly, so it misses Azure case aliases.
  - Both problems exist today. They are **out of scope** for this iteration (decision 0009, #1105).
- **F-19. Credential saves can fail without the command knowing.** The Update Credentials `ExecuteStep`
  catches save failures and returns normally, so the command cannot tell whether the save happened.
- **F-14. VS Code has no API to collapse one tree node.**
  - The repository uses `reveal(..., { expand: false })`, which does not collapse a node.
  - Collapsing through a changed `TreeItem.id` would conflict with the `treeId`/`clusterId` rules.

---

## 3. Tensions between the approved plan and the code

| #   | Tension                                                                                                                                                                                                                                                                                                                                                                                                                           | Decided at | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-1 | WI-1 requires that a known-expired token is never offered on a new socket. Under F-2 that is only possible with a new `MongoClient` once the issued token expires, roughly once an hour. Decision 0002 says that a new generation re-runs reads from page 1 "because cursors are lost", but under F-6 no surface holds a cursor. Applying 0002 as written would show "results are no longer current" every hour (worse for OT-1). | CP-0       | Distinguish **token rotation** (same fingerprint, planned replacement) from **recovery**. Neither re-runs a query, because paging is offset-based. Show the "results are no longer current" notice only when a surface comes back from the **disconnected** state. This clarifies the intent of 0002, so the operator confirms it as a new decision entry. **Coverage caveat:** rotation at resolution time covers host operations only. Sockets opened by driver pool maintenance (`minPoolSize`), and the shell and playground workers' own driver token caches, still offer the cached token. CP-0 must show that every path is covered, or the operator must explicitly relax the guarantee for that path. A timer-based rotation would resemble the "proactive refresh timers" that 0001 rejected, so it also needs the operator. |
| T-2 | OT-7 expects the cluster node to "collapse" after Disconnect, but VS Code cannot collapse a single node (F-14).                                                                                                                                                                                                                                                                                                                   | CP-4       | Refresh the node. A disconnected cluster returns **one** child action, "Connect", following the actions-only rule. Its handler reconnects and refreshes. Do not change `TreeItem.id`. Update OT-7's wording at hand-over.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| T-3 | WI-7 asked for provider-specific cluster ID equality (Azure case aliases match; Kubernetes contexts such as `Prod` and `prod` stay distinct). Today's stores disagree on this (F-4, F-18).                                                                                                                                                                                                                                        | —          | **Withdrawn 2026-11-19:** moved out of this iteration (decision 0009, #1105). Each store keeps its current matching.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| T-4 | Under decision 0002, a classified failure evicts and replaces the client. A background caller such as the dashboard poll or tree count badges could therefore start a new connection every tick.                                                                                                                                                                                                                                  | CP-2       | Only a **foreground** operation, or the rotation in T-1, replaces a generation. Background callers read the state and stop (WI-8). Add a per-cluster backoff of one replacement per 30 s, as a guard against loops.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| T-5 | For Entra, code 18 after the driver's own fresh callback means the server rejected a _fresh_ token: the principal has no database user, or Conditional Access or CAE intervened. That is not the same as `signInRequired`.                                                                                                                                                                                                        | CP-2       | Classify it as `credentialsRejected` with an Entra-specific explanation ("Your account has no access…"). Offer **Sign in again** only when the token came from a session the user can replace. Decide this with the real driver error shapes collected for CP-0.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

---

## 3a. Out of scope for this iteration

Moved to [#1105](https://github.com/microsoft/vscode-documentdb/issues/1105) on 2026-11-19 (decision
0009), to be scheduled after 1.2.0:

- re-creating Kubernetes port-forward tunnels outside the tree (per-operation resolution, recovery);
- tunnel ownership on Disconnect and Remove, and running the teardown when a kubeconfig source is removed;
- provider-specific cluster ID matching (the withdrawn T-3; F-4, F-18);
- Kubernetes API credential expiry (AKS exec plugin);
- a wider network-resilience test matrix beyond OT-4, including a Kubernetes acceptance test.

Generic idle and network-drop recovery **stays in scope**: closed-client and transient classification,
the cancelled-reuse fix, closed-client replacement and OT-4. It is #1102's "recover on the next
operation without a restart". The no-regression rules in WI-5 and WI-6 keep tunneled connections
working as they do today.

---

## 4. Contracts that cross PRs

The approved plan lets PR 1–3 run in parallel "if PR 0 agrees how WI-1 passes the verified account,
provider and tenant to WI-4". These contracts are that agreement. The field names are illustrative; the
semantics are binding unless a checkpoint changes them.

- **C-1. Verified identity.**
  - WI-1 produces it on the first successful Entra acquisition:
    `{ kind: 'entra', providerId, accountId, accountLabel, tenantId? }`.
  - `providerId` is the provider that was **actually used**, never re-read later (F-3).
  - It is returned on `AuthHandlerResponse` as an optional field.
  - Native, managed identity and no-auth handlers return nothing; WI-4 derives their identity from the
    credentials used.
  - WI-2 builds the same shape at worker spawn.
  - Never logged, never sent to telemetry, never persisted.
- **C-2. Typed auth errors.**
  - One error class per outcome, each with a stable `name` and a bounded `reason`:
    - `EntraSignInRequiredError`, reason `noSession | providerChanged`;
    - `EntraIdentityMismatchError` (a different account came back);
    - `EntraTokenRefreshError` (any other failure of the lookup; the cause is kept, but it is never
      rendered raw).
  - Messages are localized. Classification uses the `name` (walking `cause`), never the message.
  - All three are "callback threw" for F-1.
  - Keep the existing `AuthInputUnavailableError` for the non-interactive startup path (diagnostics).
    Either make the new errors related to it or map between them explicitly, so the Entra failure registry
    still skips silent misses (comment in `MicrosoftEntraIDAuthHandler.configureAuth`).
- **C-3. Token lookup observation.**
  - Every **completed** post-startup token lookup notifies an optional host-only observer, whether it
    succeeded or failed:
    `{ outcome: 'returned' | 'noSession' | 'identityMismatch' | 'failed', issuedAtSec?, expiresAtSec?, changed: boolean | 'unknown' }`.
  - `changed` means "a different issuance": the JWT `iat` or `exp` differs from the previous token
    returned in the same binding. It is `'unknown'` when either token is opaque, or when there is no
    earlier observation.
  - Byte equality is **not** established. Nothing about a token is retained except the previous `iat` and
    `exp` numbers.
  - The observer never receives the token, a hash of it or any other claim.
  - WI-4 uses it for T-1 rotation; WI-9 uses it for `connection.tokenRenewal`, including the miss outcomes.
- **C-4. Binding.**
  - Its form is `{ clusterId, fingerprint, generation }`.
  - **`fingerprint`** is an opaque hash of the logical deployment plus the effective principal (WI-4). It
    never contains a password and is never sent to telemetry.
  - **`generation`** is a per-cluster number that only ever increases. It is **never reset**, not even
    after teardown. A binding from before Disconnect therefore never matches a client created after
    Reconnect.
- **C-5. Connection state, at two levels.**
  - **Cluster state** is owned by the host and keyed by `clusterId`, matched the same way as
    `ClustersClient._clients` today. It describes the cluster's
    current client: `connected { binding }`, `reconnecting`, `needsAction { reason }`, or
    `disconnected { reason }` (the latch, C-6).
  - **Surface state** is **derived for each registered binding**. It is what the tree, webviews, shells
    and the playground show:
    - `connected`;
    - `reconnecting`;
    - `disconnected { reason, action }`.
  - A surface whose fingerprint differs from the cluster's current binding is
    `disconnected(identityChanged | credentialsChanged)` **even while the cluster is `connected`**. This is
    what lets the tree and new panels run as identity B while panels opened as A stay disabled.
  - `reason` is one of: `signInRequired`, `credentialsRejected`, `credentialsChanged`,
    `identityChanged`, `userDisconnected`, `connectionRemoved`, `unreachable`.
  - `action` is one of: `reconnect`, `signInAgain`, `updateCredentials`, `close`.
  - Reasons are bounded enums. The webview gets the localized text from the host.
- **C-6. Central interaction and latch policy, enforced inside `ClustersClient.getClient`.**
  - **Interaction:**
    - every call states `interaction: 'allowed' | 'never'`, and the default is `'never'`;
    - `'allowed'` may prompt **only** when the cluster has no `lastVerifiedIdentity` (a first connect);
    - once an identity is verified, reconnects are silent and pinned whatever the caller asked for;
    - interactive sign-in after that happens only in the Sign in again command (A1).
  - **Latch:** while a cluster is `disconnected` (Disconnect, Remove, a credentials change), `getClient`
    rejects every caller with a typed `ClusterDisconnectedError`. Background callers are included. Only
    the explicit Connect and Reconnect actions clear the latch.
  - **Lifecycle epoch:** a per-cluster counter that increases on every latch, unlatch, eviction and
    teardown. Every recovery command (Retry, Sign in again, Reconnect) captures the epoch **before** its
    first `await`, and applies its result only if the epoch is unchanged (compare and swap).

---

## 5. Advisor checkpoints

Each checkpoint is a short written verdict recorded in the Progress block of the WI named. Until the
verdict exists, do not start the work it gates.

| CP    | When                                                            | Question                                                                                       | Evidence required                                                                                                                                                      |
| ----- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CP-0  | WI-1, after step 1, before the handler is changed               | Which strategy for expired tokens (T-1)? Confirm F-1 and F-2 with the driver contract test.    | Contract test output, plus, if available, an Azure DocumentDB handshake log after expiry (no tokens logged). If T-1 changes the intent of 0002: the operator's answer. |
| CP-W3 | WI-3, after the version probe                                   | Which azext versions (A4)?                                                                     | `npm ls @microsoft/vscode-azext-azureauth`, bundle scan for duplicate copies, size of the build-error list for each option.                                            |
| CP-1  | Before PR 3 opens                                               | Does C-1 work for every auth method, including the managed identity runtime shape and tunnels? | Fingerprint table tests (WI-4 step 1).                                                                                                                                 |
| CP-2  | WI-5, after the classifier is drafted, before recovery is wired | The classifier table, T-4 and T-5.                                                             | Classifier table tests run on **real** driver error shapes captured by the contract test and the tree paths.                                                           |
| CP-3  | Before WI-6 webview work                                        | Split PR 5 into 5a/5b? Is the binding-resolution API and state channel final?                  | Diff size of host-only work; one router converted end to end.                                                                                                          |
| CP-4  | Before WI-7 starts                                              | Teardown order, T-2, the export lease (A5).                                                    | Teardown sequence diagram in the PR description.                                                                                                                       |
| CP-5  | Before PR F                                                     | Is the hand-over complete?                                                                     | OT-1 to OT-7 results recorded in `# Outcome`, WI-9 queries run on pre-release ingestion.                                                                               |

---

## 6. PR 0: plan, research, decisions

1. Have the operator create `feature/connection-lifecycle` from `main`, or create it yourself if you
   have permission: `git push origin origin/main:refs/heads/feature/connection-lifecycle`. Deletion and
   force-push are blocked afterwards, so check the base commit first.
2. The PR contains:
   - `research-findings.md`, `decisions.md`, `README.md`;
   - `01-implementation-plan.md` with the pointer to this file;
   - **this file**;
   - the index row in `docs/ai-and-plans/README.md` (already present).
     The current branch `tnaum-ms/issue1102` can be the head branch; renaming it to `dev/tnaum/*` is
     optional for PR 0.
3. Its description states that §4 (C-1 to C-6) is the agreement that lets PR 1–3 run in parallel, and
   lists A1–A6 for the operator to confirm.
4. Verification: docs only, so none, beyond `npm run prettier` on the changed Markdown.

**Progress:**

---

## WI-1: Entra ID, silent renewal on every OIDC callback (PR 1)

**Outcome:**

- Each OIDC callback returns a token that is valid for the account the connection started with, looked up
  silently.
- A silent miss produces a typed error that every surface explains the same way.
- A known-expired token is never offered on a new socket (by the mechanism chosen at CP-0).

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
2. **CP-0.** Choose the strategy for expired tokens, using T-1. The options:
   - **A.** Rely on code 18. This only meets the approved plan's gate if the operator relaxes it.
   - **B (recommended).** Proactive rotation. `ClustersClient` keeps the latest `expiresAtSec` it learned
     through C-3. When a client is resolved, for any caller, and that time is in the past (minus a margin
     of 300 s), it builds a new generation with the same fingerprint before returning. Implement the
     client side of this in WI-4. WI-1 only provides C-3.
   - **C.** Clear the driver's internal `TokenCache`. Rejected: it depends on driver internals.

   **Coverage, which must be shown for the chosen option (T-1 caveat):**
   - (i) host operations that resolve a client;
   - (ii) sockets the pool opens by itself: check the effective `minPoolSize` and `maxIdleTimeMS`, and
     whether pool maintenance can open an authenticated socket with no operation pending;
   - (iii) the shell and playground workers. Their own driver caches the token too; does WI-2 need a
     worker-side rotation, for example recreating the worker's `MongoClient` when the relayed token
     expires?

   For each path, record "covered by …" or "operator relaxed the guarantee for this path on <date>".

   Record the verdict, and the operator's answer if T-1 changes intent.

3. **Session helper.**
   - Add `src/documentdb/auth/entraSession.ts`. It calls `vscode.authentication.getSession` with an
     **explicit** provider ID, normalizes the scopes (same rules as `getSessionFromVSCode`: `.default`
     suffix plus `VSCODE_TENANT:<id>`), and takes the `account` and mode (`interactive` = `createIfNone`,
     `silent`, `forceNew`) as parameters.
   - Replace the deep import in `MicrosoftEntraIDAuthHandler.ts` with it. This takes the handler off the
     azureauth internal path, so PR 1 and PR 2 do not collide.
   - Read the provider ID through the existing seam in `documentdbTokenResource.ts`, so that PR 2 migrates
     a single place.
4. **First acquisition.** Keep it as it is (interactive when the policy says so). Then record C-1 from
   `session.account` and the provider ID that was actually used, and return it on `AuthHandlerResponse`.
5. **The callback.** Replace the closure over `session` with:
   - a silent lookup pinned to the provider, scopes, tenant and `account`;
   - if the provider in use differs from the pinned one: `EntraSignInRequiredError('providerChanged')`;
   - no session: `EntraSignInRequiredError('noSession')`;
   - `session.account.id !== pinned.accountId`: `EntraIdentityMismatchError`;
   - any other thrown error: `EntraTokenRefreshError` (keep the cause);
   - a result of `{ accessToken, expiresInSeconds }`, where `expiresInSeconds` comes from the JWT `exp`;
   - a C-3 notification for every completed lookup, including misses and failures. `changed` compares
     only the previous `iat` and `exp` numbers; the previous token itself is never kept.

   Leave `buildOidcClientConfiguration` untouched; it still checks the destination policy around the call.

6. **Shared JWT helper.** Move the JWT `exp` and `iat` decoding into `tokenExpiry.ts` as
   `readJwtTimes(token)`, returning `{ iatSec?, expSec? }`. Use it in the handler and in
   `playgroundWorker.ts`. An unknown `exp` stays unknown (`undefined`). The worker keeps its own fallback
   TTL; WI-9 must not report that fallback as a measured value.
7. **Failure registry.** A silent miss and an identity mismatch are **not** recorded as token failures,
   as the existing comment requires. An `EntraTokenRefreshError` is recorded through
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
- the same token bytes while the token is still valid are accepted, and C-3 reports `changed: false`;
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
   - That first relay may be interactive only while the spawn is user-initiated: opening a shell, or
     running a playground on a cold worker. Track this with an explicit "initial acquisition pending" flag,
     not with timing.
   - Every later relay uses `entraSession.ts` in silent mode with the pinned account, and the same C-2
     errors as WI-1.
   - Optional optimization (the advisor decides): if the host already has a client for the cluster with a
     verified identity, seed the snapshot from it, so the initial relay is silent too.
   - **The shell or playground surface keeps its own binding** (C-4 fingerprint plus C-1), and that
     binding **outlives the worker** (F-15). Before an automatic respawn (`ShellSessionManager.evaluate`,
     `executePlaygroundCode.ts`), check the binding and the surface latch:
     - same fingerprint and not latched: respawn as today;
     - a different fingerprint, or latched: do not respawn. Print the disconnected reason and the action.
     - Only an explicit recovery (Sign in again, Reconnect) may respawn under a new binding.
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
4. **#1059 note.**
   - Call `PlaygroundEvaluator.buildInitMessage` only when a worker is spawned.
   - A warm run on the same cluster reuses the stored init.
   - A run against a different cluster, or a dead worker, spawns as it does today.
5. **E4.** A late token response or error from a disposed or replaced worker must change neither state nor
   diagnostics. Guard by a worker or session instance ID.

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
  - a latched (disconnected) shell or playground does not respawn on the next command.
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

**Read first:**

- `ClustersClient`: `getClient`, `initClient`, `initializeClient`, `connect` and `deleteClient`;
- `ClustersClient.test.ts`;
- `connectionAuthIdentity.ts`;
- the tree-cluster-architecture skill (dual ID);
- the Kubernetes and Atlas reachability providers (how a tunnel rewrites the host).

**Steps:**

1. **Fingerprint** (`src/documentdb/connectionFingerprint.ts`, pure).
   - Inputs are the **credentials snapshot actually used** in `initializeClient`, the C-1 identity
     (Entra), and the provider's logical target for tunnels.
   - The **deployment** is the normalized seed host list of the original connection string (before
     reachability rewrites it to `localhost`), or the provider's stable target ID.
   - The **principal**, per auth method:
     - Native: user + the **effective** authentication database, using the driver's rules (F-17):
       explicit `authSource`, else the URI's database path, else `admin`;
     - Entra: `providerId` + `accountId` + `tenantId`;
     - managed identity: the client ID, as the runtime credential carries it, or `system-assigned`;
     - no auth: `none`.
   - Hash it (SHA-256, hex, truncated) into an opaque string.
   - Table tests:
     - a password-only change keeps the fingerprint;
     - another user changes it;
     - the same user on another host changes it;
     - the same user with another explicit `authSource` changes it;
     - the same user with **no** `authSource` and a different URI database (`/sales` against `/admin`)
       changes it;
     - two managed identity client IDs differ;
     - a tunnel's local port change keeps it.
   - Use this table as the CP-1 evidence.
2. **Generation.**
   - Keep a static `Map<clusterId, number>` that only ever increases and is never cleared.
   - Each `ClustersClient` instance records `generation`, `fingerprint`, `createdAt` and its credentials
     snapshot.
   - Expose a read-only `binding` (C-4) and `ClustersClient.getBinding(clusterId)`.
3. **One startup at a time (single flight).**
   - A `_pendingStartups` map keyed by `clusterId` holds `{ promise, epoch }`.
   - Every caller awaits the same startup, and each caller's own `abortSignal` rejects only **that
     caller's** wait.
   - The startup itself is aborted only when **all** waiters have aborted. Otherwise it continues and
     publishes.
   - A per-cluster `epoch` is incremented **synchronously** by `invalidate(clusterId)`. A startup publishes
     only if the epoch is unchanged; otherwise it closes its own `MongoClient` and rejects with a typed
     `ClientInvalidatedError`.
   - `deleteClient` calls `invalidate` **before** its first `await`.
   - `invalidate` also increments the C-6 lifecycle epoch.
4. **Central policy (C-6).**
   - `getClient` takes `{ interaction, trigger, abortSignal }`, with `interaction` defaulting to `'never'`.
   - Add a per-cluster `lastVerifiedIdentity` record (C-1 for Entra; the principal for other methods),
     keyed by `clusterId` like `ClustersClient._clients`. It **survives eviction** and is cleared only by teardown (WI-7).
   - `initializeClient` stops hardcoding `{ interactive: true }`. It is interactive only when the caller
     allowed it **and** the cluster has no `lastVerifiedIdentity`. Otherwise it is silent and pinned to
     that identity.
   - Add the disconnected latch: a latched cluster throws `ClusterDisconnectedError` for every caller.
     WI-7 sets the latch; WI-4 adds the check, the error and the tests.
   - Audit every `getClient` call site (F-13), and pass `interaction: 'allowed'` only from explicit user
     connect paths: tree expand, Connect, and one-shot commands on a cluster that is not yet connected.
     List the audit in Progress.
5. **Cached reuse.**
   - Remove the abort handler that closes the shared client (the cached branch of `getClient`).
   - A cancelled waiter just rejects with `UserCancelledError`.
6. **Closed topology.**
   - Track closure with the public SDAM event `topologyClosed` on the `MongoClient`, plus our own `close()`
     calls.
   - `getClient` on a closed client publishes a **new generation**, using the **current** `CredentialCache`
     and requiring the **same fingerprint**.
   - If the fingerprint differs, do not publish. Return a typed `IdentityChangedError` for WI-5 and WI-6 to
     handle.
   - Today's `client._mongoClient.connect()` call on the cached path goes away.
7. **Rotation (CP-0 option B, if chosen).**
   - Subscribe to C-3 from the auth handler at startup, and store `tokenExpiresAtSec` on the instance.
   - Expose `needsRotation(now)`, and apply it inside `getClient` for **every** caller. Rotation is not a
     failure-driven replacement, so the T-4 background restriction does not apply to it.
   - Cover the other paths that CP-0 lists, or record their relaxation.
8. **Telemetry helper.**
   - Add `addEstablishedConnectionContext(context, clusterId | client)`. It sets `authMethod`,
     `connectionCorrelationId`, and the measurements `connectionAgeMs` and `clientGeneration`.
   - No property name may contain "error" (masking).
   - WI-5 and WI-6 call it; add the helper and its tests only here.
9. **Development test hook** (optional, recommended).
   - Add `vscode-documentdb.debug.connection.simulateExpiry`, following the survey debug commands:
     - declared in `package.json`;
     - registered only in development mode;
     - listed in `LAZY_COMMANDS` with its reason.
   - It (a) makes the next N Entra callbacks for a selected cluster behave like a silent miss, (b) marks
     the token as expired for rotation, and (c) force-closes the pool to simulate an idle drop.
   - Use a dashed context key if one is needed.

**Tests** (`ClustersClient.test.ts`, plus the new fingerprint test):

- two concurrent cold `getClient` calls create one `MongoClient`;
- cancelling one of two waiters leaves the other connected;
- a startup that finishes after `deleteClient` does not publish, and closes its client;
- a cancelled cached reuse does not close the shared client;
- `topologyClosed` followed by `getClient` gives a new generation with the same fingerprint;
- a changed principal followed by `getClient` gives `IdentityChangedError`;
- a background caller (`interaction: 'never'`) never prompts, even with no client and with credentials
  cached; a verified cluster reconnects silently even when the caller allowed interaction;
- a latched cluster rejects every caller, including background ones;
- generation numbers only ever increase across delete and reconnect;
- the telemetry helper sets the bounded properties and no forbidden names.

**Done when:**

- Case 1 is green;
- the CP-1 verdict is recorded;
- every existing `ClustersClient` test still passes unchanged, or each change is justified in Progress.

**Progress:**

---

## WI-5: Classify failures and recover: host and tree (PR 4)

**Outcome:**

- One classifier and one state owner.
- The tree's Retry actually reconnects.
- **Sign in again** exists and prompts once per click.
- Account removal marks the clusters bound to it.

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

     | Signal                                                                 | Auth       | Kind                         | Generation                                         | Offered action                                  |
     | ---------------------------------------------------------------------- | ---------- | ---------------------------- | -------------------------------------------------- | ----------------------------------------------- |
     | `EntraSignInRequiredError`                                             | Entra      | `signInRequired`             | replace on recovery (F-1)                          | Sign in again                                   |
     | `EntraIdentityMismatchError`, `IdentityChangedError`                   | any        | `identityChanged`            | evict; surfaces disconnected                       | Reconnect (rebind)                              |
     | `EntraTokenRefreshError`                                               | Entra      | `transient`, workflow broken | replace on the next **foreground** operation (T-4) | Retry                                           |
     | code 18                                                                | Native, RU | `credentialsRejected`        | evict; no automatic retry                          | Update credentials (RU: Retry re-reads the key) |
     | code 18 after a fresh callback                                         | Entra      | per T-5                      | evict                                              | per T-5                                         |
     | `MongoNotConnectedError`, `topologyClosed`, "Client must be connected" | any        | `clientClosed`               | new generation silently                            | none                                            |
     | network errors, timeouts, server selection with no auth cause          | any        | `transient`                  | keep                                               | Retry                                           |
     | anything else                                                          | any        | `other`                      | keep                                               | existing behavior                               |

   - **No regression for tunneled connections:** connection refused against a Kubernetes port-forward
     port is `transient`. The client is **kept**, never evicted, so the tree's existing tunnel restore
     (`beforeCachedClientConnect`) still recovers it. Tunnel recovery itself is #1105.

2. **State owner.**
   - Add `ClustersClient.reportFailure(binding, error)`, or a small `ConnectionStateService` that sits
     beside it (advisor's choice). It classifies the error and ignores it if `binding.generation` is
     stale. It evicts according to the table and updates the C-5 **cluster** state. Surface states are
     projected per binding (WI-6).
   - It fires `onDidChangeConnectionState(clusterId)`.
   - A foreground helper `withClusterClient(clusterId, op, { foreground })` resolves the client (including
     rotation under CP-0 option B), runs the operation, reports failures, and applies the T-4 backoff.
     WI-6 extends it with bindings.
3. **Tree.**
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
4. **Retry.**
   - `retryAuthentication` evicts the client (`deleteClient` without clearing credentials) when the last
     kind was `signInRequired`, `credentialsRejected` or `clientClosed`, and then refreshes.
   - It captures the C-6 lifecycle epoch and the current binding **before** its first `await`. If either
     changed in the meantime (a Disconnect, or another recovery replaced the client), it does nothing
     destructive: no eviction, and no latch cleared.
   - The `CredentialCache` entry is kept.
   - **RU key exception:** on Retry after `credentialsRejected` for an RU Discovery or Azure Resources
     item:
     - drop the cached key and re-read it from ARM once (`extractCredentialsFromRUAccount`);
     - an ARM sign-in failure there is reported as "Azure sign-in needed" (WI-3 classifier), not as a
       database rejection;
     - never open a password wizard.
5. **Sign in again** command (`vscode-documentdb.command.signInAgain`, args: a tree node or `{ clusterId }`).
   - Read the pinned C-1 from the cluster's `lastVerifiedIdentity` record (WI-4). Capture the C-6
     lifecycle epoch **before** prompting.
   - Call `entraSession.ts` interactively for that account and tenant.
   - **Rejected-but-present session:** if the failure that led here was a server rejection of a token that
     the silent lookup still returns, use `forceNewSession` for the pinned account instead of
     `createIfNone`. Prove both paths in tests.
   - **After the prompt, compare and swap.** If the epoch changed while the user was signing in (for
     example, a Disconnect), do not evict, do not reconnect and do not clear the latch. Report "The
     connection was closed while you were signing in."
   - Same account: evict, start a new generation, and set the cluster state to `connected`.
   - Different account: the identity changed. Surfaces bound to the old fingerprint project to
     `disconnected(identityChanged)` (C-5), and the tree continues with the new identity.
   - A dismissal is a `UserCancelledError`. No code path re-prompts. C-6 enforces this centrally; add a
     test that background paths cannot prompt.
6. **`onDidChangeSessions`.**
   - Register once, at activation.
   - For events of a provider ID that some live binding pins, silently re-check each affected binding,
     debounced to about 500 ms.
   - A missing session sets the state to `signInRequired`.
   - Results from a stale generation are ignored. Clusters bound to another account are not touched.
   - Never sign the user out, and never remove a session.

**Tests:**

- classifier table tests on real error shapes;
- Retry after `clientClosed` creates a new generation; after `credentialsRejected` it keeps the
  credentials and does not loop;
- the RU old/new key pair; an ARM sign-in failure compared with a database rejection;
- Sign in again with the same account and with a different account; the forced-new-session path;
- no re-prompt after a dismissal;
- an `onDidChangeSessions` event for another account does not affect this cluster;
- a stale-generation result is ignored;
- an old Retry that resolves after the client was replaced does not evict the new client;
- Sign in again that completes after a Disconnect does not reconnect or clear the latch;
- the T-4 backoff.

**Done when:**

- Case 1 is green;
- the CP-2 verdict is recorded;
- OT-2's tree part can be reproduced with the WI-4 hook.

**Progress:**

---

## WI-6: Bind surfaces and add the disconnected state (PR 5, or 5a and 5b)

**Outcome:**

- Collection View (all tabs), Document View and the Cluster Dashboard resolve their client per operation
  through a binding.
- They show C-5 state with a banner and one action.
- They keep all user state.
- They never apply stale results.
- They never run under another identity.

**Read first:**

- the webview-trpc-messaging and react-webview-architecture skills;
- `collectionViewRouter.ts`, `indexesTab/indexViewRouter.ts`, `queryInsights/queryInsightsRouter.ts`
  and `queryInsightsEventsRouter.ts` (it already has a tRPC subscription you can copy);
- `QueryInsightsAIService.ts` and `indexAdvisorCommands.ts`;
- `documentsViewRouter.ts` and `documentView.tsx` (the `isDirty` state);
- `clusterDashboardRouter.ts` and `ClusterDashboard.tsx`;
- `collectionViewContext.ts`;
- `openAppWebview.ts`;
- `build/verification/browser/scenarios.ts` and `fixtures.ts`.

**CP-3 first.**

- Convert **one** router end to end (Document View is the smallest) on the host side.
- Show the API, then decide with the advisor:
  - whether to split into 5a (host: registry, binding, routers, state channel) and 5b (webviews:
    banner, disabling, scenarios);
  - the recommendation is to split, because 5b needs the 5a contract to be stable.

### Host (5a)

1. **Surface registry** (`src/documentdb/connectionSurfaces.ts`).
   - `register({ clusterId, kind, binding, pushState, dispose, hasUnsavedChanges? })` returns a
     disposable.
   - Collection View, Document View and the Dashboard register when they open and unregister on
     `onDisposed`.
   - WI-7 enumerates this registry.
2. **Binding resolution.**
   - `resolveBoundClient(binding, { foreground })` has three outcomes:
     - (a) same fingerprint and generation: return the client;
     - (b) same fingerprint, the client was replaced or closed for **recovery or rotation**: return the
       current client, with no re-run (T-1, if confirmed). If T-1 is **not** confirmed, follow 0002 as
       written: re-run the applied query from page 1, and discard old-generation responses;
     - (c) a different fingerprint, the cluster is latched `disconnected` (C-6), or `identityChanged`:
       throw a typed `SurfaceDisconnectedError(reason)`.
   - Projection rule (C-5): the surface's state comes from comparing **its** binding with the cluster's
     current binding, never from the cluster state alone.
   - A surface **never** prompts. Under C-6 it calls `getClient` with `interaction: 'never'`. If no client
     exists and the cluster is not latched, the reconnect is silent and pinned to `lastVerifiedIdentity`,
     so Entra fails closed with a mismatch instead of prompting.
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
   - When the request may have reached the server and the reply was lost (network error or timeout after
     send), report **outcome unknown**: "The change may or may not have been applied. Refresh to check."
   - Never resubmit. Leave the driver's own `retryWrites` as it is.
   - Test that one application-level submission results in exactly one call to the driver.
6. **State channel and stale results.**
   - Each view router gets a `connectionState` subscription, fed by the registry (C-5 surface state). It
     replays the current state when a view subscribes.
   - It carries a **surface epoch** that increases on every transition into `disconnected` and on every
     rebind.
   - Every request records `{ epoch, generation }` when it starts.
   - **Before any host-side mutation**, check that the epoch is unchanged and that the generation is
     acceptable under T-1 (or under 0002 as written). That covers `ClusterSession`'s
     `_currentRawDocuments`, its query caches, Query Insights caches and `SchemaStore` updates. A stale
     result must not change host state at all, so dropping it only at delivery is not enough.
   - Check again at delivery. The UI applies the same check (5b).
7. Every router error path uses `addEstablishedConnectionContext` (WI-4).

### Webviews (5b)

1. **Shared UI.**
   - A `useConnectionState()` hook and a `DisconnectedBanner` component.
   - The banner is a Fluent `MessageBar` with intent `warning`, the host-provided reason text and **one**
     action button.
   - It uses `role="status"` and `aria-live="polite"`.
   - Put both in the shared webview components folder.
   - Run the detecting-accessibility-issues skill on them.
2. **Disabling.**
   - While disconnected, every action that talks to the server is disabled: run query, paging, refresh,
     save, delete, insert, index actions, Query Insights stages and AI calls.
   - Editors stay **editable**. The user can keep typing.
   - Responses whose epoch is older than the UI's current epoch are discarded on the UI side too.
3. **What each view keeps.**
   - **Collection View:** query text, filter, sort, projection, page number and size, the selected tab,
     and Query Insights results with a "stale" marker.
   - **Document View:** the dirty editor content and `isDirty`.
   - **Dashboard:** the last data, marked stale (WI-8 stops the polling).
4. **Actions.**
   - **Reconnect** (same fingerprint): resolve again. On success, show "Reconnected. Results may be out
     of date. Run the query again to refresh." The query is not run automatically.
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
   - a scenario that injects a disconnect after typing and then delivers a stale page response: the
     applied results are not overwritten.
   - Run them with the browser scenario config. Screenshots are artifacts, not baselines.

**Transfers:** do not touch copy, paste or export (approved plan).

**Tests:**

- router tests for the three binding outcomes on each converted router;
- `ClusterSession` no longer stores a client (a type-level or structural test);
- the epoch drop on host and UI;
- one submission for a write whose reply is lost;
- the scenarios above.

**Done when:**

- Case 1 is green;
- the scenarios pass;
- OT-1 and OT-3(a) can be reproduced with the WI-4 hook;
- if split, 5a merges before 5b opens.

**Progress:**

---

## WI-7: Teardown, Disconnect, Remove and Update Credentials (PR 6)

**Outcome:**

- One teardown serves Disconnect, Remove and identity-changing credential updates.
- It is guarded by task conflicts and dirty editors.
- It covers every per-cluster resource.

**Read first:**

- `removeConnection.ts`;
- `resourceUsageHelper.ts` and `taskService.ts` (`getConflictingTasks`);
- `CopyPasteCollectionTask.ts` and `CopyIndexesTask.ts` (`getUsedResources`);
- `exportDocuments.ts`;
- `updateCredentials.ts`, including the D12 modal;
- `updateConnectionString.ts`;
- `CredentialCache.ts`, `entraTokenFailures.ts` and `SchemaStore.clearCluster`;
- the WI-6 registry;
- `switchAtlasViewMode.ts` (the `globalState` pattern).

**CP-4 first:** the teardown order, T-2 and the export lease.

**Steps:**

1. **Export lease (A5).**
   - Add `TaskService.acquireResourceLease(resource, label)`, which returns a disposable.
     `getConflictingTasks` includes active leases.
   - `exportDocuments.ts` holds the lease for the whole export.
   - Test that export conflicts with Disconnect of its source, and that an unrelated cluster does not.
2. **Teardown service** (`src/documentdb/connectionTeardown.ts`).
   - Two phases: `prepare(clusterId, intent)` and `commit(reservation, options)`.
     - Disconnect and Remove call both, back to back.
     - Update Credentials puts the save between them (step 5).
   - **`prepare`**, which may prompt and may be cancelled:
     1. **Preflight:** task and lease conflicts through `checkCanProceedAndInformUser`. On a conflict,
        stop and change nothing; the conflicting task is named.
     2. **Choice:** Close all or Keep open (A2), only when surfaces are registered and the setting is
        `ask`. With the setting at `closeAll` or `keepOpenDisabled`, use that value without a modal.
     3. **Dirty check** (only for `close`): if any registered surface reports `hasUnsavedChanges`, ask for
        confirmation. Cancelling leaves every panel, draft and connection intact. That includes the case
        where Remove started the teardown.
     4. **Reserve, atomically:** **recheck** task and lease conflicts, because a copy or export may have
        started while a prompt was open. Then take a per-cluster teardown reservation in `TaskService`.
        While it is held, new tasks and leases on this cluster are refused with a clear message.
        If the recheck finds a conflict, release everything and stop.
   - **`commit`**, which has no prompts and cannot be cancelled:
     1. **Synchronous section, before any `await`:** set the latch and the cluster state to
        `disconnected(reason)` (C-6), call `ClustersClient.invalidate` (it increments the lifecycle
        epoch), increment the surface epochs, and mark in-flight token requests as abandoned (E4).
     2. **Surfaces:**
        - `keepDisabled`: push the state;
        - `close`: dispose the panels;
        - shells: latch the surface (F-15), print "Disconnected", then stop the worker;
        - playground: latch it, then stop the worker.
     3. Close the client (`deleteClient`).
     4. Clear the `CredentialCache` entry if `dropCredentials` is set (A3), the Entra failure registry,
        `SchemaStore.clearCluster`, and `lastVerifiedIdentity`.
     5. Release the reservation, and refresh the tree (T-2).
   - Releasing a reservation without committing must restore everything to the state before `prepare`.
   - **Never touched:** VS Code auth sessions, the managed identity cache, the ARM cache.
   - **Keys:** every store keeps its current `clusterId` matching. Provider-specific equality is out of
     scope (decision 0009, #1105). Do not add case folding or unfolding in this iteration.
   - **Kubernetes tunnels:** the teardown does not stop port-forward tunnels, and does not change how
     removing a kubeconfig source works (#1105).
3. **Disconnect command** (`vscode-documentdb.command.disconnect`).
   - Add a `connected` tag to the cluster item's `contextValue` while a client exists, and refresh it on
     state changes. Use `viewItem` regex menus in the Connections, Azure Resources and Discovery views.
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
   - Add a disconnected cluster node child action, "Connect" (T-2).
4. **Remove Connection.** Teardown with reason `connectionRemoved` and `dropCredentials: true`, then delete
   the stored connection and clear the schema, as today. Keep the existing confirmation.
5. **Update Credentials and Update Connection String.**
   - Compute the **new** fingerprint from the wizard context before saving.
   - **Make save success explicit** (F-19): the execute step must report whether the save succeeded, for
     example with a flag on the wizard context. Today it catches failures and returns normally.
   - **Same fingerprint:** save. Only after a confirmed success, call `invalidate` and replace the client
     with a new generation; surfaces continue.
   - **Different fingerprint:**
     1. `prepare` (preflight, choice, dirty check, reservation) **before** saving.
     2. Save.
     3. On a confirmed success: `commit` with reason `credentialsChanged` and `dropCredentials: false`,
        so the **new** credentials stay.
     4. On a failed save: release the reservation. The old binding stays usable, and nothing was latched.
   - The reservation and the `invalidate` call in `commit` make sure a concurrent connect cannot publish
     the old credentials after the change.
   - Add a **Disconnect** button to the D12 modal for open shells.
6. **Telemetry.**
   - One `connection.disconnect` event with `source` (`command`, `remove`, `credentialsChanged`),
     `surfacesChoice`, and counts of surfaces, shells and the playground, plus `blockedByTask`.
   - No identifiers.

**Tests:**

- teardown for each surface type;
- blocked for a copy source, a copy destination and an export source; an unrelated cluster is not
  blocked; Disconnect succeeds once the task is done or stopped;
- a token response that arrives after Disconnect is ignored;
- Reconnect uses the current credentials and cloud settings;
- Remove reuses the same teardown;
- cancelling the dirty prompt changes nothing;
- a copy or export that starts while the Disconnect prompt is open blocks the commit, and nothing changes;
- a task or lease cannot start while a teardown reservation is held;
- a shell or playground left open after Disconnect does not respawn on its next command;
- a failed save keeps the old binding;
- a concurrent connect during Update Credentials does not publish the old credentials.

**Done when:** Case 1 is green, and the OT-7 flows can be reproduced on a dev build.

**Progress:**

---

## WI-8: Cluster Dashboard health polling (PR 6)

**Outcome:** the poll stops on a terminal state, shows the banner, and resumes with exactly one loop.

**Steps:**

1. `measureRtt` resolves through the WI-6 binding with `foreground: false` (T-4). It returns a
   structured result, `{ ok, rttMs } | { terminal: reason }`, instead of throwing for terminal states.
2. The webview poll effect stops on `terminal` and on any `disconnected` state from the channel. It
   restarts only on `connected`, guarded by one loop token, so that two loops can never run at once.
3. A late successful ping that started before the disconnect epoch cannot clear the banner (epoch check).
4. Visibility pause and backoff are the rest of #1091. Do them here only if they are trivial; otherwise
   leave them to #1091.

**Tests** (fake timers):

- no client lookups on ticks or on reveal after Disconnect;
- a late success does not clear the banner;
- reconnecting starts exactly one loop;
- `signInRequired` and `credentialsRejected` stop the loop after one tick.

**Progress:**

---

## WI-9: Token renewal and recovery telemetry (PR 7)

**Outcome:** the release can be judged from events that need no joins and no persistent identifiers.

**Steps:**

1. **`connection.tokenRenewal`.**
   - Emitted from the C-3 observer (host client) and from the host side of the shell and playground relays.
   - Once per completed post-startup Entra **database** token lookup. The initial acquisition is excluded.
   - Properties:
     - `surface` (`extension`, `shell`, `playground`);
     - `renewalOutcome`: `changed`, `unchanged`, `noSession`, `identityMismatch`, `failed`, or `unknown`
       when there is no earlier observation in the same binding.
   - Measurements: `connectionAgeMs`, `previousTokenObservedAgeSeconds`, `tokenLifetimeSeconds` and
     `tokenRemainingSeconds`. Omit any value that is unknown; never send 0 or the worker's fallback TTL.
   - Never send a token, hash, claim, account, tenant, cluster ID, fingerprint or host name.
2. **`connection.recovered`.**
   - The state owner (WI-5) keeps a "pending recovery" flag per cluster, with the trigger: `silentRenewal`,
     `reconnect` or `signInAgain`.
   - The event is emitted on the **first successful database operation** after that flag was set, with
     `trigger` and `connectionAgeMs`.
   - A callback returning a token does not count as recovery.
3. **ARM.** Report challenge outcomes separately from database renewal. Confirm that the final ARM request
   succeeded, not just that a token was acquired.
4. **Volume.**
   - Both events are background events. If the dashboards keep an event-scope exclusion list for
     "active users" totals, add `connection.tokenRenewal` to it.
   - Check the expected volume (about one renewal per active Entra client per hour) against the
     telemetry budget.
5. **Queries.**
   - Commit runnable Kusto queries in a durable `../telemetry.md` at the feature root:
     - daily renewal outcomes and the changed-token rate;
     - p50/p90 of lifetime, remaining validity and connection age at refresh;
     - recoveries by trigger;
     - late auth, socket and closed-client failures against the pre-release baseline, using the same
       exposure denominator.
   - Show sample counts and missing timing data next to every percentile.
   - If the operator's telemetry dashboards worktree is available, port the queries there too.
6. **Fake-clock test** for the token sequence unchanged → changed → silent miss:
   - check counts and units;
   - include an opaque token and a database rejection after the lookup.

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
   result, and the evidence the approved plan requires, in `# Outcome`.
4. CP-5 verdict, then open PR F. Watch telemetry for about one week after the merge (WI-9 queries).

# Outcome

_To be written at hand-over._
