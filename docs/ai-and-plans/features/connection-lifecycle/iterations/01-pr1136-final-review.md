# Final review: Connection lifecycle (combined PR)

[PR #1136](https://github.com/microsoft/vscode-documentdb/pull/1136) · `feature/connection-lifecycle` → `main` ·
reviewed head `559c2f827` (draft)

This is a whole-feature review of the combined branch (PR0–PR7, about +9.7k/−2.8k production
lines excluding tests and docs). Each stage already had its own pre-review, so this pass does
not repeat them. It looks at four things:

- whether the feature meets its goal;
- whether failures are both recorded and explained to the user;
- edge cases that threaten the goal;
- over-engineering.

Claude Opus 5.5 led the review. Four read-only explorer passes covered commands and tasks,
webviews, Shell and Playground workers, and Azure discovery. A separate rubber-duck pass
challenged the draft findings and severities. Its changes are listed at the end. No code was
changed.

**The goal (operator):** a connection should not just time out or expire while someone is
actually using it.

**The error-handling rule (operator):** a failure may happen, but we must know it happened
(telemetry, or `meterSilentCatch` for swallowed errors), and the user must see at least some
helpful report.

## Verdict

**The goal is met for the main path, with one gap that should be fixed before merge.**

What works:

- The root cause from #1102 is fixed. The extension-host OIDC callback no longer returns the
  token captured at connect. It now looks up the pinned account silently on every call
  ([MicrosoftEntraIDAuthHandler.ts](../../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts),
  about lines 200–260). OP-1b verified renewal after idle without a prompt.
- Shell and Playground workers get the same behavior through the host relay.
- The main surfaces report failures, so a broken client is replaced on the next deliberate
  action. These surfaces are tree expansion, Collection View, Document View, Dashboard, Index
  view, Query Insights and import.

What is missing:

- A single failed token callback permanently breaks that `MongoClient` (driver behavior).
  Nothing retires the client centrally, so about 13 command paths that call `getClient`
  directly keep failing until a different surface happens to report the failure (F1).
- The first **write** after token expiry has not been verified (F2). OP-6 has to cover it.

Nothing here argues against the architecture. Most findings are small, local fixes.

## Summary

| #   | Severity | Finding                                                                                           | Fix size               | Decision                    |
| --- | -------- | ------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------- |
| F1  | High     | A failed token callback leaves a dead client cached for direct `getClient` paths                  | ~10 lines + test       | Accepted                    |
| F2  | Medium   | First write after token expiry is unverified (`retrywrites=false`)                                | Gate (OP-6)            | Accepted (OP-6 scenarios)   |
| F3  | Medium   | Webview operations blocked by the connection are recorded as RPC **success** with no reason       | ~5 lines               | Accepted (amends 0020)      |
| F4  | Medium   | A hung token lookup costs 60 s per operation, is classified `other`, and leaves no renewal record | Small                  | Accepted                    |
| F5  | Medium   | Partial Azure subscription listing is reported only in the output channel                         | Small                  | Accepted                    |
| F6  | Low      | Swallowed failures that hide real problems are not metered                                        | Small, mechanical      | Accepted                    |
| F7  | Low      | Explain-then-display chains have no fallback if the explain RPC fails                             | 1 line × 4             | Accepted                    |
| F8  | Low      | Collection View shows a generic error modal for a client marked for replacement                  | Small                  | Accepted                    |
| F9  | Low      | Ships the prerelease `@microsoft/vscode-azext-azureauth` `6.1.0-alpha.2`                          | Track (accepted, 0008) | Accepted (no code change)   |
| O1  | Medium   | Over-engineering: lifecycle plumbing copied into three React views                                | Medium                 | Accepted                    |
| O2  | Low      | Over-engineering: `retryAuthentication` decides policy by looking at view IDs in `contextValue`   | Small                  | Accepted                    |
| O3  | Low      | Over-engineering: `ClustersClient` keeps growing as the home for all lifecycle state              | None in this PR        | Accepted (no change)        |

There are no Critical findings.

## Operator decisions (2026-11-26)

The operator accepted every finding and proposal in this review as a set: F1–F9 and O1–O3.
Acceptance covers the recommended outcomes and constraints, including the validation-only,
tracking and no-change dispositions below; it does not mean implementation or verification is
complete. The lead and advisor prepare the work-item plan and model assignments, and resolve
implementation details within that accepted scope.

All code and documentation changes land in **one dedicated PR against
`feature/connection-lifecycle`**. The operator's branch-protection correction supersedes the
earlier instruction to commit this review to the feature branch: carry the review and plan on
the new PR branch instead. This review is its first commit. Do not commit or push directly to
the feature branch. Avoiding over-engineering remains a constraint for every item.

## Follow-up work plan

The operator accepted the dispositions above. The planning advisor (`claude-opus-5.5`)
checked these items against the current code and the installed MongoDB driver, tRPC and Azure
authentication libraries. No change in scope is implied by the plan. All test and build
executions go to `mai-code-2-flash`; use Case 1 (`npm run build` and focused Vitest) in coherent
batches, and defer the full Case 2 suite until all work items are complete.

| Item | Scope and dependencies | Acceptance and verification | Recommended → assigned model |
| --- | --- | --- | --- |
| WI-01 (F1) | `ClustersClient.connect()` and its tests; first in the shared client/auth sequence. | A rejected Entra or managed-identity callback rethrows unchanged and marks a bound client without evicting it or downgrading an existing state. A direct `getClient` gets a new generation. Retain all renewal telemetry assertions in a driver-realistic order. Run `ClustersClient` and connection failure tests. | `gpt-6.1-sol` → same; auth and generation lifecycle. |
| WI-02 (F4) | Classifier and host/worker renewal timeout instrumentation; after WI-01 (shared tests). | Match only the installed driver's callback timeout; record bounded `timedOut` without introducing a timer or double-counting. Test wrapped and unrelated errors, host abort/late settlement, and worker timeout/cancellation. | `gpt-6.1-sol` → same; host/worker abort timing. |
| WI-03 (F3) | DocumentDB tRPC telemetry adapter and its tests; independent. | Add only a bounded `unavailableReason` to validated responses. Leave SDK outcome, error and cancellation handling intact. Test typed unavailable, ordinary success, and invalid reason. | `mai-code-2` → same; self-contained middleware edit. |
| WI-04 (F5, tenant catches in F6) | Azure subscription provider, subscription picker, and three Azure discovery roots; independent. | Keep partial results and existing sanitized output warnings. Record skipped account/tenant totals and show one non-blocking hint with **Show Output** per partial listing. Meter the four tenant-lookup catches. Test partial/full listings and verify the warning in a workbench with a failing tenant. | `mai-code-2` → same; contained provider behavior. |
| WI-05 (rest of F6) | Only the named silent catches; after WI-02 (client and Entra overlap). | Preserve return values, control flow and UI; meter actual swallowed observer/telemetry errors, not rethrows. Run focused tree and client/auth tests in the next Case 1 batch. | `gpt-6-luna` → same; mechanical edits. |
| WI-06 (O1) | Extract a small recovery hook from the three lifecycle webviews, retaining per-view policy. Schedule in the final implementation batch. | Preserve stale-reply and disposal guards, Retry/Close behavior, draft data and announcements. Run focused hook, Document View and overlay tests. In a workbench exercise Disconnect/Keep open, dismiss/reappear, Reconnect/Retry, Close, the Dashboard auto-retry, and the dirty Document View prompt. | `gpt-6.1-sol` → same; cross-view lifecycle and race-sensitive state. |
| WI-07 (F7) | Shared Retry hook after WI-06, plus Document View Save. | An explanation RPC rejection does not prevent the existing fallback notification; preserve raw cause and existing telemetry. Test Retry and Save fallbacks. Other explanation chains are outside the accepted fix. | `gpt-6-luna` → same; two local fallbacks. |
| WI-08 (F8) | Collection View query path only; after WI-02 and sequential with WI-06 if a view file is shared. | Show truthful retry guidance only when marked for replacement; retain original explanation and error evidence, no overlay or `runWithClient` changes. Test replacement/non-replacement paths and the next query in a workbench. | `mai-code-2` → same; one targeted query path. |
| WI-09 (O2) | Retry command and node capability; final implementation batch. | A before/after characterization matrix preserves which nodes can clear rejection, ARM key-read precedence, and silent returns. Run command/tree tests and verify Quick Start, Azure discovery and stored connection recovery in a workbench. | `mai-code-2` → same; small policy move with explicit behavior parity. |
| WI-10 (F2) | OP-6 row and PR F step 3 in the development plan. | First write after at least two hours idle, continuous use through expiry, and sleep/wake plus Shell and Playground; operator validation pending. No replay, no pre-write probe, and no Save wording change unless the first-write scenario fails. | `gpt-6-luna` recommended; docs-only leader record. |
| WI-11 (affected documentation) | Decision 0020 and lifecycle telemetry/feature documentation; after the final WI-02–04 fields. | Record the operator's bounded F3 amendment without adding rationale; cross-release comparison stays deferred. Document renewal timeout and partial-listing data; add the new property to CP-5 verification. Check affected user documentation for drift. | `gpt-6-luna` recommended; docs-only leader record. |
| WI-12 (F9, O3) | Inline disposition only; independent. | Retain the pinned prerelease; re-run ARM renewal when upgrading to GA. No lifecycle registry extraction or external tracking issue in this PR. | Leader record; no coding model. |

OP-6, CP-5 ingestion and workbench results are recorded separately from the implementation
items. A Save wording follow-up is conditional on an observed OP-6 failure, not a queued
implementation item. The known out-of-scope cases are the additional explain-then-display
chains, a new timeout mechanism, write replay or probes, and automatic retry policy changes.

> **WI-11 done (2026-11-26), commit `b10fa6e84`, leader (docs only, no coding worker):**
> Recorded the operator's F3 amendment to 0020 without expanding it, documented the new
> fields, and updated the CP-5 gate and Azure Discovery documentation. Leader review (99%):
> the docs describe the committed telemetry semantics and do not claim successful ingestion.
> No automated tests added; CP-5 remains pending.

---

## F1. A failed token callback leaves a dead client cached (High)

**Why it matters for the goal.** This is the scenario the feature exists for: a long session,
a laptop waking up, a VPN switch. One silent renewal fails briefly because the network is not
up yet. That should cost one operation, not leave the connection stuck.

**Evidence**

- In mongodb 7.2.0, `CallbackWorkflow.withLock` runs `await lock` **before** it reassigns
  `lock`. After one rejected `OIDC_CALLBACK`, every later callback on that `MongoClient`
  rethrows the same rejection
  (`node_modules/mongodb/lib/cmap/auth/mongodb_oidc/callback_workflow.js:108-124`). Recovery
  needs a new `MongoClient`.
- A cached `ClustersClient` is retired in only two ways:
  - `ClustersClient.reportFailure`
    ([ClustersClient.ts:1163](../../../../../src/documentdb/ClustersClient.ts)) sets `_replacement`;
  - the `topologyClosed` event sets `_closed` (`canReuse()`, line 1143).

  A poisoned callback does neither, because the topology stays open.

- The OIDC wrapper in `connect()`
  ([ClustersClient.ts:765-778](../../../../../src/documentdb/ClustersClient.ts)) only records
  token expiry. It does not mark the client when the callback throws. It is also installed
  only for Microsoft Entra ID. Managed identity uses the same driver workflow
  ([ManagedIdentityAuthHandler.ts:104](../../../../../src/documentdb/auth/ManagedIdentityAuthHandler.ts)),
  so it is exposed in the same way.
- `reportFailure` is called from `runWithClient`, `boundViewOperations`, `ClusterItemBase`,
  `DatabaseItem`, `IndexesItem` and `importDocuments`. These callers get a client directly
  and never report:
  - `deleteDatabase.ts:78`, `deleteCollection.ts:72`;
  - `dropIndex.ts:46`, `hideIndex.ts:51`, `unhideIndex.ts:46`;
  - `pasteCollection/ExecuteStep.ts:70`, `pasteCollection.ts:106`;
  - `queryGenerationCommands.ts:187`, `scanCollectionSchema.ts:37`;
  - `CopyPasteCollectionTask.ts:120,169`, `DocumentDbDocumentReader.ts:62,92`;
  - `CollectionItem.ts:135`, `openClusterDashboard.ts:119`, `getIndexConfirmationStats`.

**Effect.** After one transient renewal failure:

- Delete, drop/hide/unhide index, paste, copy-and-paste, AI query generation and schema scan
  fail with driver or token text.
- **Running the same command again fails again.** It only recovers when something that
  reports happens to run, such as a tree Refresh or a Collection View query.
- The main surfaces heal on the next action, which keeps this at High rather than Critical.
- This is still better than `main`, which never retires a client, but it is the gap most
  directly against the goal.

**Recommendation**

- In `connect()`, wrap `OIDC_CALLBACK` for **every OIDC auth method** (Entra and managed
  identity).
- On a throw, set `this._replacement ??= 'replaceOnNextForeground'`, but only once
  `this._binding` exists. The binding is assigned only after the client is established, so
  startup failures stay with `establishClient`.
- **Do not** call the full `reportFailure` from inside the callback. The rubber-duck pass
  showed why: an identity-mismatch eviction there would remove the client before the
  operation reports. The operation's own `reportFailure` would then return `undefined`, so
  `runWithClient` would lose the typed `unavailable` result and `ClusterItemBase` (about
  line 449) would skip its recovery message.
- Setting only the lowest replacement state keeps the client cached. A later report can still
  upgrade it to `replaceOnRecovery`, or to evict plus latch.
- Add one test: reject one callback, call through a direct `getClient` path, and confirm the
  next foreground call gets a new generation.

**Operator decision (2026-11-26):** Accepted as recommended.

- Wrap `OIDC_CALLBACK` in `connect()` for Microsoft Entra ID and managed identity.
- On a throw, set only `replaceOnNextForeground`, and only once the client is bound.
- Never call `reportFailure` from inside the callback.
- Add one regression test through a direct `getClient` path.

> **Done (2026-11-26), commit `6eb089ac4`, `gpt-6.1-sol`:** Both OIDC modes
> mark a bound client for replacement if the callback rejects, without evicting it or
> changing the thrown error. The accepted operator decision governs the scope; advised
> (`claude-opus-5.5`, 85%) that startup, replacement precedence and recovery remain
> intact. Added two parameterized direct `getClient` cases. Renewal assertions for
> startup suppression, result/outcome and lifetime fields, cached identity, abort,
> stale epoch, retired and closed clients remain; the rejecting lookup now runs last
> on a fresh generation. Expiry and explicit recovery tests retain their original
> assertions. Focused Case 1 run: 127 tests passed across WI-01 and WI-03.

## F2. The first write after token expiry is unverified (Medium, gate)

**Evidence**

- OP-1a ([01-dev-plan.md](./01-dev-plan.md), about line 625): after two hours idle, the
  server **closed** fresh sockets that tried to authenticate with the expired token. It did
  not return code 18.
- OP-1b passed because `listDatabases` is a read, and the driver retried it on a second
  socket.
- Azure connection strings commonly set `retrywrites=false`, and decision 0009 defers pool
  and network hardening to #1105.
- The likely result: when the first operation after expiry is a **write** (Document View
  Save, insert, delete, index create), it fails once with `MongoNetworkError`. The user
  then retries and succeeds. That is a visible "the connection expired while I was using
  it" moment.

**Recommendation.** Do not replay writes automatically. Make the uncertainty explicit in
OP-6:

1. After at least 2 h idle, make a **write the first operation**: a Document View Save on a
   connection whose string has `retrywrites=false`, with no read beforehand.
2. Keep using the connection across a token expiry, for example a query every few minutes for
   90 minutes.
3. Test sleep and wake across an expiry, and Shell and Playground after expiry.

If step 1 fails, fix the user-facing message first. It should tell the user to try again
and must not claim the write was not applied (F-22). A cheap read before a foreground write,
once the recorded token expiry has passed, is an option to weigh. Leave the broader pool
tuning to #1105.

**Operator decision (2026-11-26):** Accepted.

- In this PR, add the three F2 scenarios to OP-6 in [01-dev-plan.md](./01-dev-plan.md): the
  OP-6 row at about line 93 and its PR F step 3.
- No automatic write replay.
- No pre-write read probe in this PR. It would need its own decision next to decision 0010.
- The message change is conditional: implement it only if OP-6 step 1 fails. Do not implement
  it speculatively.

> **WI-10 documentation done (2026-11-26), commit `10badbc0d`:** Added all three
> scenarios to the OP-6 row and PR F step 3. Operator decision: validation only (explicit
> acceptance); leader confirmed the plan includes the no-read/no-replay constraints.
> No automated tests added. **OP-6 pending:** run on the packaged VSIX and record actual
> outcomes. Do not change the Save message unless the first-write scenario fails.

## F3. Blocked webview operations look like successes in telemetry (Medium)

**Evidence**

- The tRPC telemetry middleware
  ([trpc.ts:147-173](../../../../../src/webviews/_integration/trpc.ts)) sets outcome
  properties only for abort, cancellation and thrown errors.
- A procedure that returns `{ unavailable: { reason } }` is recorded as SDK `succeeded` with
  no reason. The PR7 telemetry doc and decision 0020 acknowledge this. Renewal telemetry
  (`connection.tokenRenewal`) captures some of the root causes.
- Even so, we cannot count how many **user operations** were blocked, or on which surface,
  which is exactly what CP-5 and later regressions will need.

**Recommendation**

- In the middleware, when the result has `unavailable.reason`, set a bounded property, for
  example `unavailableReason`.
- Do not put "error" or "exception" in the property name. The azext whole-error masking
  redacts any property named that way.
- Add the property to [telemetry.md](../telemetry.md).

This does not need the deferred cross-release comparison.

**Operator decision (2026-11-26):** Accepted as recommended.

- This amends decision 0020 ("Do not add an instrumentation path … in this release") and the
  PR7 review F1 author decision ("do not add a telemetry field"), for this one bounded property
  only.
- The cross-release comparison stays deferred.
- Record the amendment as a factual note under decision 0020 in
  [decisions.md](../decisions.md), citing this decision.

> **Done (2026-11-26), commit `42dfc2332`, `mai-code-2`:** The RPC adapter records
> only the validated reason from an unavailable response; it leaves the SDK outcome
> and existing cancellation/error handling alone. Operator decision: bounded
> amendment to 0020; leader review (99%) reused the existing response guard rather
> than duplicating the allowlist. Added three regressions: valid reason, ordinary
> success, and unknown reason. Focused Case 1 run: 127 tests passed across WI-01 and
> WI-03. CP-5 ingestion has not been run; WI-11 records the decision and query.

## F4. A hung token lookup costs 60 s per operation and is classified `other` (Medium)

**Evidence**

- The driver races the callback against a 60 s timeout and throws `MongoOIDCError`
  (`node_modules/mongodb/lib/cmap/auth/mongodb_oidc/automated_callback_workflow.js:67-75`).
  The real callback, and with it the driver's lock, stays pending.
- `classifyConnectionFailure` has no case for `MongoOIDCError`, so it returns `OTHER` with
  `keep` ([connectionFailures.ts](../../../../../src/documentdb/connectionFailures.ts), about
  line 123). The client is never retired.
- As a result, every new socket on that client waits up to 60 s and then fails with
  "OIDC callback timed out after 60000ms."
- In workers, an aborted callback suppresses its `connection.tokenRenewal` event
  ([WorkerTokenRelay.ts:101-104, 248-250](../../../../../src/documentdb/auth/WorkerTokenRelay.ts)),
  so a hung VS Code auth provider leaves no renewal record.

The trigger is rare: VS Code's silent `getSession` has to hang. When it does happen, though,
the connection looks broken for the rest of the session.

**Recommendation**

- Classify the callback timeout as `transient` with `replaceOnNextForeground`.
- Emit a bounded `timedOut` renewal outcome instead of suppressing it.
- Do not add a parallel timeout mechanism.

**Operator decision (2026-11-26):** Accepted as recommended.

- Reclassify only the driver's callback timeout. Every other `MongoOIDCError` keeps its current
  classification.
- Add `timedOut` to the documented renewal outcomes in [telemetry.md](../telemetry.md).
- Add no timeout of our own.

> **Done (2026-11-26), commit `b324be7b4`, `gpt-6.1-sol`:** The exact driver's
> callback timeout requests replacement on the next foreground action. Other OIDC
> errors keep their existing classification. The existing Entra observation scopes
> now record `timedOut`: at abort in the host and at settlement after driver abort in a
> worker. Operator decision: no additional timer; advised (`claude-opus-5.5`, 85%)
> that abort, stale epoch and cancellation guards are preserved. Added nine focused
> cases and the `timedOut` expectation to the existing Shell/Playground test; retained
> all prior assertions. Six focused suites passed (319 tests, including WI-04).
> A hung real provider was not exercised; a never-settling worker lookup cannot emit
> the renewal row.

## F5. Partial Azure listings are reported only in the output channel (Medium)

**Evidence**

- `errorForAccount` and `errorForTenant` write only `ext.outputChannel.warn`
  ([AzureSubscriptionProviderWithFilters.ts:107-113](../../../../../src/plugins/api-shared/azure/AzureSubscriptionProviderWithFilters.ts)).
- `getUnfilteredAzureTenants(...).catch(() => undefined)` in
  [SelectSubscriptionStep.ts:58](../../../../../src/plugins/api-shared/azure/wizard/SelectSubscriptionStep.ts)
  and in the three discovery root items swallows the failure completely.
- The user sees fewer subscriptions or tenants than expected, with no hint, and we have no
  count of how often it happens.

**Recommendation**

- Add bounded counters, `skippedAccounts` and `skippedTenants`, to the listing event.
- Show one non-modal hint per listing, for example in the tree item description or a single
  warning with "Show output". No dialog per tenant.
- Meter the tenant-lookup catches.

**Operator decision (2026-11-26):** Accepted as recommended.

- **Hint:** one helpful non-modal report per partial listing, with no per-tenant dialogs.
  The lead and advisor select the simplest suitable presentation from the recommended
  alternatives; the operator has not selected a specific UI option or warning text.
- **Telemetry:** record bounded skipped-account and skipped-tenant counters using the existing
  telemetry mechanism.
- **Catches:** add `meterSilentCatch` to the tenant-lookup catches in `SelectSubscriptionStep.ts`
  and in the three discovery root items.
- Specify the presentation and any user-facing text in the work item.

> **Done (2026-11-26), commit `d676501c6`, `mai-code-2`:** Return the available
> subscriptions and show one warning with **Show Output** alongside numeric, identifier-free
> counters; meter the four tenant-lookup catches. Operator decision: one non-modal hint.
> Advised (`claude-opus-5.5`, 88% design, 90% review): scope counters to each SDK listing;
> callers coalesced by the SDK share one event and hint. Added an overlapping-listings case and
> extended the existing partial-listing test without removing assertions. Corrected two test
> types after the first build; the Case 1 build and 188 focused tests passed on retry.
> Workbench check with a failing Azure tenant remains pending.

## F6. Swallowed failures that hide real problems are not metered (Low)

The PR adds about 75 `catch` blocks in production code and 4 `meterSilentCatch` calls. Most
uncovered catches are legitimate: close-on-cleanup, abort, or rethrow after recording. Leave
those alone. The ones below either hide a meaningful failure or misreport it. Each should get
`meterSilentCatch('<location>')`, with no UI:

| Location                                                                                                        | What is lost                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [CollectionItem.ts:140](../../../../../src/tree/documentdb/CollectionItem.ts)                                   | The count becomes `null`. It can be the first sign of a poisoned client (F1), and nothing records it |
| [IndexesItem.ts:134](../../../../../src/tree/documentdb/IndexesItem.ts)                                         | A search-index lookup failure is shown as "not supported". An auth failure looks like a feature gap  |
| [getIndexConfirmationStats.ts:32,43](../../../../../src/commands/index.shared/getIndexConfirmationStats.ts)     | Size and usage stats silently disappear from the confirmation                                        |
| [ClustersClient.ts:924,1192](../../../../../src/documentdb/ClustersClient.ts)                                   | Failure to close an evicted or superseded client is logged at debug level only                       |
| [MicrosoftEntraIDAuthHandler.ts:259,299,322](../../../../../src/documentdb/auth/MicrosoftEntraIDAuthHandler.ts) | Failures in the observer and in telemetry eligibility. Correct to swallow, but invisible             |
| `SelectSubscriptionStep.ts:58` and the three discovery root items                                               | Tenant lookup failure (see F5)                                                                       |

These are fine as they are:

- the driver close-cleanup catches at `ClustersClient.ts:1111,1119,1135`;
- the relay serialization catch at `WorkerTokenRelay.ts:299` (promise-chain hygiene; the
  current request still propagates its error);
- the Shell and Playground catches at `ShellSessionManager.ts:289,366` and
  `WorkerSessionManager.ts:764`, which record and rethrow;
- `DisconnectedOverlay.tsx:65`, where the user sees a message and the RPC failure is already
  recorded by the middleware.

**Operator decision (2026-11-26):** Accepted as recommended.

- Add `meterSilentCatch` at the locations in the first table. Add no UI.
- Leave the "fine as they are" catches unchanged.

> **Done (2026-11-26), commits `5cfb3de05` (`gpt-6-luna`) and `d676501c6`
> (`mai-code-2`, Azure overlap):** Added stable silent-catch counters without changing
> UI or control flow. Operator decision: meter only the listed swallowed failures;
> advised (`claude-opus-5.5`) that the Entra telemetry eligibility and observer catches
> are the intended sites, rather than the nearby rethrows. Leader spot-check (99%) found
> only the approved calls and imports. No new tests for the mechanical meters; 188 focused
> tests passed across WI-04/WI-05 and the related client/auth suites.

## F7. Explain-then-display chains have no fallback (Low)

**Evidence.** Retry and Save failures call
`trpcClient.common.explainOperationFailure.query(...)` inside an async `.catch` and then
display the result. If the explain query itself rejects, the inner `await` throws. The
notification is skipped, and the rejection goes unhandled. The affected places:

- [documentView.tsx:397-410](../../../../../src/webviews/documentdb/documentView/documentView.tsx)
  (**Save**) and line 458 (Retry);
- [CollectionView.tsx:859](../../../../../src/webviews/documentdb/collectionView/CollectionView.tsx);
- [ClusterDashboard.tsx:753](../../../../../src/webviews/documentdb/clusterDashboard/ClusterDashboard.tsx).

`ErrorExplanationService.explain` catches provider errors internally, so only a transport
failure triggers this. That is why it is Low.

**Recommendation.** Add `.catch(() => null)` to the explain query so the fallback text
("Error saving the document", "Unable to recover the connection") always shows. With O1 this
becomes a single fix.

**Operator decision (2026-11-26):** Accepted as recommended.

- If O1 lands first, fix the Retry chains once, in the shared hook.
- Fix the Document View **Save** chain separately; it is not part of the Retry flow.

## F8. Collection View shows a generic error modal for a client marked for replacement (Low)

**Evidence**

- `runWithClient` turns only `signInRequired`, `credentialsRejected`, `credentialsMissing`
  and `identityChanged` into `unavailable`
  ([runWithClient.ts:22-32](../../../../../src/documentdb/runWithClient.ts)).
- `transient` and `clientClosed` are rethrown, so the query shows "Error while running the
  query" with driver text. The host has already marked the client for replacement, and the
  next query works.
- `boundViewOperations.ts:93-104` maps `clientClosed` to `unavailable` for the Dashboard and
  Document View, so the views behave differently.

The user does see a report, so this is acceptable. Optional: for `clientClosed`, say "The
connection was reopened. Run the query again." Do not add an overlay for transient errors.

**Operator decision (2026-11-26):** Accepted.

- Collection View query errors only: show text, no overlay, and no change to `runWithClient`
  semantics for other callers.
- Implementation note: the host attempts replacement on the next run, not before it, so
  "reopened" would be inaccurate. Use truthful retry guidance rather than claiming recovery
  already succeeded; the lead and advisor specify the wording during planning.

## F9. Prerelease `azureauth` dependency (Low, accepted)

`@microsoft/vscode-azext-azureauth` `6.1.0-alpha.2`
([package.json:171](../../../../../package.json)) was accepted in decision 0008 because Azure
Resources ships the same version. The pin is not a defect in itself. Track the GA release, and
re-run the ARM renewal check when upgrading.

**Operator decision (2026-11-26):** Accepted. No code change in this PR.

> **WI-12 disposition recorded (2026-11-26):** Operator decision: retain the
> prerelease pin (explicit acceptance, decision 0008). Track GA here; rerun the ARM
> renewal check on upgrade. No code, tests, or new GitHub issue.

---

## Over-engineering

The design mostly honors decision 0012:

- no manager or state machine;
- plain maps keyed by `clusterId`;
- one stateless operation wrapper (`runWithClient`).

Generation, epoch and fingerprint fencing is **justified** complexity. It is what makes
Disconnect, Update credentials and Sign in again safe against late results, and it is
unit-tested. `connectionFailures.ts` (164 lines) is proportionate.

### O1. Lifecycle plumbing copied into three React views (Medium)

- `ClusterDashboard.tsx` (+686), `CollectionView.tsx` (+609) and `documentView.tsx` (+289)
  each contain roughly 100–160 lines of the same pattern:
  - `unavailable` state plus a mirroring ref;
  - an operation-revision guard;
  - a Retry handler (recover, update unavailable, clear on success, explain, display);
  - overlay wiring.
- There is no shared hook. F7 shows the cost: one defect, written three times.

**Suggestion (follow-up):** a small `useBoundViewRecovery()` hook that owns the
unavailable/revision/Retry flow. Make it a hook, not a manager.

**Operator decision (2026-11-26):** Accepted, in this PR.

- One small hook used by the three views. Keep behavior the same.
- Keep the hook local to the lifecycle webviews (decision 0016). Make no change to the webview
  framework.

### O2. `retryAuthentication` decides policy by looking at view IDs (Low)

- The `credentialsRejected` branch
  ([retryAuthentication.ts:76-104](../../../../../src/commands/retryAuthentication/retryAuthentication.ts))
  works out the view from `contextValue` with regexes and tree-ID prefixes.
- It then combines quick-start, native-discovery and `readReplacementKey` rules to decide
  whether Retry may clear the latch. Some branches return without telling the user anything.
- It is correct today but hard to reason about.

**Suggestion (follow-up):** give the node a typed capability, for example
`canRetryRejectedCredentials()`, so the command stops encoding presentation details.

**Operator decision (2026-11-26):** Accepted, in this PR.

- Keep behavior the same: the same nodes may clear the latch.
- Add no new messages, and do not change the existing silent returns.

### O3. `ClustersClient` is the home for all lifecycle state (Low)

`ClustersClient.ts` grew by 727/−120 lines to 2,084 lines. It now has 5 static maps and 24
public statics. It mixes the driver wrapper, the client cache, lifecycle policy, the identity
pin and startup telemetry. Each piece is reasonable, and no abstraction layer was added.
Leave it for this PR. Later, consider moving the static lifecycle registry (epochs, latches,
generations, pending startups) into its own module, so the class is easier to read.

**Operator decision (2026-11-26):** Accepted as written. No change in this PR. The extraction
stays a possible later follow-up and is not scheduled.

> **WI-12 disposition recorded (2026-11-26):** Operator decision: no extraction in
> this PR (explicit acceptance). No code or tests.

### Considered and not raised

- **`WorkerTokenRelay` (302 lines)** runs logic parallel to the host callback: identity pin,
  destination check, JWT times, renewal telemetry. The worker's IPC, epoch fencing and
  worker-facing errors justify a separate orchestrator. Share pure checks where that is easy;
  do not merge the two lifecycles.
- **Three near-identical Azure discovery root items** (+24–26 lines each): the duplication was
  already there. Leave it.
- **`TreeElementWithExplicitReload.ts`** (17 lines, one user): trivial.

## Edge cases deliberately not raised

- **Native `credentialsRejected` recovery.** Update credentials clears the latch, even when the
  password is unchanged (`saveConnectionEdit.ts`). Retry handles discovery, quick-start and
  key-reading nodes. The silent return on Retry for a native Connections View node is not
  reachable from the tree, which offers Update credentials instead.
- **Latch leaks on update or removal.** Both `saveConnectionEdit` and the removal teardown
  restore or clear the latch in `finally`. No path leaves a connection locked without a
  message.
- **Mixed-server topology classification and teardown races.** These were covered in the
  stage reviews.
- **Transfers across a network drop.** The streaming writer's `RetryOrchestrator` already
  retries network errors. The remaining risk is F1, a poisoned client, not the network.

## Done well

- Silent renewal on every callback invocation for the pinned account, with no prompts and
  typed errors (`EntraSignInRequiredError`, `EntraIdentityMismatchError`,
  `TokenCallbackError`).
- Single-flight startup, generation and epoch guards, and background callers that never
  start a client.
- The tree shows failures as a modal plus recovery actions only, never error rows.
- Bound views keep drafts and data while the connection is unavailable, and recover in place.
- Shell and Playground discard a worker after a callback failure and respawn it on the next
  command without the user doing anything. They show "Sign in again" only when a sign-in is
  actually needed.
- Disconnect, Update credentials and Remove run through one teardown path with task-conflict
  checks, and folder deletion uses it too.
- The ARM credential renews on every `getToken` (azureauth v6).
- Teardown telemetry handles cancellation correctly, despite the azext wrapper swallowing
  `UserCancelledError` (`connectionTeardown.ts:263-304`).

## Recommended gates before ready-for-review

1. Fix F1 (central retirement for Entra and managed identity, plus a test through a direct
   `getClient` path) and F4 (timeout classification).
2. Add `unavailableReason` (F3) and document it in [telemetry.md](../telemetry.md).
3. OP-6 on the packaged VSIX, with the F2 scenarios: first operation a write after at least
   2 h idle; continuous use across an expiry; sleep and wake; Shell and Playground after
   expiry.
4. CP-5 ingestion check, including the new property.
5. Case 2 checks and the remaining CONTRIBUTING §6.1 standard-context verification.

F1–F8, O1 and O2 land in the dedicated PR described under
[Operator decisions](#operator-decisions-2026-11-26). F9 and O3 need no code change.

## Rubber-duck adjustments

The rubber-duck pass made these changes to the draft:

- **F1** went from Medium-High to **High**, and its scope grew to include managed identity.
- **F1's fix** was narrowed: mark `replaceOnNextForeground` only, never call `reportFailure`
  from inside the callback.
- **F4** was added as a separate finding (the driver timeout path on host clients).
- **F9**, the alpha dependency, went from High to **Low**: it was explicitly accepted, and
  OP-6 and CP-5 are the real release risks.
- A native Retry finding was dropped because the path cannot be reached from the tree.
- **F7** stayed at **Low**, even though the rubber-duck rated it Medium, because the explain
  service already catches provider errors.
