---
feature: deep-links
kind: review
status: active
prs: [1067]
created: 2026-11-05
code:
    - src/vscodeUriHandler.ts
    - src/deepLinks/**
    - src/tree/discovery-view/discoveryViewHelpers.ts
    - src/tree/TreeParentCache.ts
---

# PR #1067 Review - Azure resource links and target surfaces

**PR:** [microsoft/vscode-documentdb#1067](https://github.com/microsoft/vscode-documentdb/pull/1067)
**Reviewed head:** `d369c132b7facecf6a530dc350f608a7ad7ca443`
**Base:** `main`, `a4b8451359f91cc54a27dfaf2a8289506c4e98d7`
**Reviewers:** `rubber-duck` on `gpt-6.1-sol`; `code-review` on `claude-opus-5.5`.
**Author decisions:** pending. This review does not authorize or implement fixes.

## Scope and method

The two reviewers independently reviewed the same PR diff in parallel, including the new
`/connect/azure` flow, `open=dashboard|shell`, subscription visibility, Discovery navigation,
tests, and the relevant authentication, cache, dashboard, shell, and telemetry call chains.
Each reviewer was then given the other's findings for a cross-vendor validation gate.

This document follows [CONTRIBUTING sections 5 and 6](../../../../../CONTRIBUTING.md#6-ai-assisted-review-workflow):
one consolidated iteration review, deduplicated findings, severity reassessment, solution
options with pros and cons, and a place for the author's decision and rationale.

The reviewers treated the recorded design choices as intentional: confirmed permanent filter
changes, expanding the Azure cluster to connect, existing double decoding, automatic dashboard
behavior, sovereign-cloud exclusion, and deferred release notes. None is reported as a defect
merely because a different design is possible.

**Severity:** `high` means severe impact on a principal workflow; `med` means a meaningful
correctness or privacy defect under a concrete trigger; `low` means a bounded edge-case,
cancellation, or recovery defect. Severity is separate from confidence and merge disposition.

## GitHub Copilot comment reconciliation

At review time, the GitHub API returned no inline review comments, submitted reviews, or
Copilot-authored conversation comments for this draft PR. There were no Copilot findings or
comment links to merge.

## Findings overview

**Final result:** seven confirmed findings: **three `med`, four `low`, none `high`**.
One additional `low` candidate needs manual evidence and is not counted as a confirmed new
regression. Both reviewers reassessed all eight candidates against the code.

“Independent” means both found the issue before seeing the other's review. “After gate”
means one found it and the other subsequently validated it. Agreement on a defect does not
necessarily mean agreement on the safest fix.

| ID | Final severity, both reviewers | Finding | Origin | Agreement and disposition |
| --- | --- | --- | --- | --- |
| F1 | med | Repeated database/collection links lose warm-tree targets | RD1 / CR1 | **Both, independently; confirmed** |
| F2 | med | Sign-in/filter recovery retains a provider-root retry cache | RD2 / CR2 | **Both, independently; confirmed** |
| F3 | low | Discovery navigation drops the resolved Azure account identity | RD3 | **Both after gate: manual evidence needed**, not a confirmed new regression |
| F4 | med | Raw query-key logging can expose credential material | RD4 | **Both after gate; confirmed** |
| F5 | low | Connection-string links open a target after a failed/cancelled connection | CR3 | **Both after gate; confirmed**, impact narrowed |
| F6 | low | Cancellation during Discovery navigation does not prevent opening the target | CR4 | **Both after gate; confirmed** |
| F7 | low | A subscription display name is not explicitly masked in error telemetry | CR5 | **Both after gate; confirmed** |
| F8 | low | Visibility checks disagree with the SDK's case-sensitive subscription filter | RD5 | **Both after gate; confirmed**, rare settings edge case |

**Suggested priority:** F4 (credential logging), F1 and F2 (broken navigation/recovery),
then F5–F8. Investigate F3 separately before choosing an architectural fix. These are review
recommendations, not the author's acceptance or a claim that fixes have landed.

## F1 - med - Repeated links lose warm-tree database/collection targets

**Origin:** RD1 and CR1, independently reported by both reviewers.
**Final validation:** Both confirmed `med`. Rubber-duck reproduced the cold/warm difference
using production provider/cache source with mocked workbench boundaries.

**Evidence:** [root reads and cache-only navigation](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L74);
[Discovery root cache clearing](../../../../../src/tree/discovery-view/DiscoveryBranchDataProvider.ts#L103);
[database lookup](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L154);
[collection lookup](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L182).

**Trigger and impact:** Follow an Azure link to a database or collection in a cluster that is
already connected and expanded, including clicking a previously successful link again.
Readiness and root discovery clear the provider's parent cache. The helper repopulates the
provider/subscription levels, but not the database/collection levels. VS Code does not reload
children merely because an already-expanded node is revealed again. The cache-only lookup
then says an existing database or collection cannot be found. Database-scoped dashboard and
shell links share this path.

**Why introduced:** The new link helper combines destructive root reads with cache-only
descendant navigation. The intended contract is reliable navigation with expansion as the
connect mechanism, not reconnecting or requiring the user to collapse the tree first.

| Option | Pros | Cons |
| --- | --- | --- |
| Avoid destructive root reads; synchronize actual refreshes with workbench loading | Addresses cache lifetime and node-instance consistency; preserves unrelated expanded nodes | Requires explicit root/readiness ownership and refresh-ordering tests |
| Use a guarded scoped child fetch when the database/collection cache misses | Smaller targeted change; can reuse scoped lookup machinery | Adds a listing request; can re-enter connection handling; existing helper compares IDs case-insensitively |

**Recommendation:** Prefer non-destructive root/readiness access and synchronization with
the workbench's loading generation after genuine refreshes. A scoped fallback may supplement
this only after a verified successful connection/expansion, without additional authentication
or reconnection, and with exact database/collection-name validation.

**Solution disagreement retained:** Code-review recommends combining cache preservation
with a scoped fallback and considers the fallback alone the smallest acceptable fix.
Rubber-duck accepts that fallback only with the safeguards above:
[`findChildById`](../../../../../src/tree/TreeParentCache.ts#L245) always calls `getChildren`
and compares IDs case-insensitively, while `ClustersClient.exists()` alone does not establish
the current connection attempt's outcome. Do not equate agreement on F1 with an unconditional
endorsement of the smallest patch.

**Verification needed:** A harness using the real parent cache and a reveal implementation
that does not refetch expanded nodes. Cover repeated links, expanded clusters and databases,
collection targets, and database-scoped dashboard/shell links; verify authentication is not
repeated. Also click the same link twice in an installed workbench.

**Author decision and rationale:** Pending.

## F2 - med - Recovery leaves a provider-root retry cache in place

**Origin:** RD2 and CR2, independently reported by both reviewers.
**Final validation:** Both confirmed `med`; the gate confirmed both filtered and signed-out
recovery, including successful sign-in with no visibility changes.

**Evidence:** [visibility updates and refresh](../../../../../src/deepLinks/azureVisibility.ts#L60);
[cached provider-root failure](../../../../../src/tree/discovery-view/DiscoveryBranchDataProvider.ts#L205);
[refresh implementation](../../../../../src/tree/BaseExtendedTreeDataProvider.ts#L223).

**Trigger and impact:** Expand an Azure provider with all relevant tenants/subscriptions
hidden, so it caches a retry child. Follow a link and approve the visibility repair. The
settings change, but `refresh()` does not invalidate `failedChildrenCache`; subsequent reads
still return the retry child instead of subscriptions. The link fails after permanently
changing filters. The code-review validation also confirmed the signed-out entry into this
state: no accounts yield no subscriptions, the provider root caches a retry child, and
subsequent successful sign-in does not invalidate it.

**Why introduced:** The failure cache predates the PR, but the new recovery flow changes
the conditions that caused the failure without invalidating the affected provider root.

| Option | Pros | Cons |
| --- | --- | --- |
| Reset the affected provider-root error state before refreshing/navigating | Targeted; reuses existing recovery API; preserves unrelated cluster authentication failures | Must identify the correct root and order invalidation before child loading |
| Introduce a provider recovery operation that resets and refreshes together | Centralizes the required ordering for future callers | Larger API change for this PR |

**Recommendation:** After subscription resolution succeeds, reset the affected provider-root
error state and refresh that root before navigation. Coordinate the reload with the workbench:
clearing only the extension cache can leave the UI holding a stale retry child. Do not clear
every cluster's authentication failure state.

**Verification needed:** Populate the real root failure cache, repair visibility/sign-in,
and verify a fresh subscription listing and successful navigation. Assert unrelated cluster
failure caches survive.

**Author decision and rationale:** Pending.

## F3 - low - Account-identity handoff needs manual evidence

**Origin:** RD3; not independently reported by code-review.
**Final validation:** Both classify this as `low` and **needs manual evidence**, not a
confirmed new regression. Rubber-duck initially assigned `med` and downgraded it after the gate.

**Evidence:** [subscription resolution](../../../../../src/deepLinks/azureSubscription.ts#L77);
[handoff to Discovery](../../../../../src/deepLinks/handleAzureResourceLink.ts#L207);
[subscription selection](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L89);
[cached child registration](../../../../../src/tree/TreeParentCache.ts#L70).

**Candidate trigger and impact:** Two signed-in Azure accounts expose the same subscription.
Resolution selects account A, and the ARM read succeeds using A. Navigation passes only the
subscription/resource identity; a production-cache probe showed that colliding subscription
nodes retain the later account. A different principal could therefore be used downstream,
but an installed-workbench failure specifically caused by this PR was not demonstrated.

**New code versus pre-existing behavior:** The new handoff does discard the resolver's account
choice, but duplicate subscription tree IDs already existed. The workbench may reject those
duplicates before the hypothesized account switch matters. With tenant filtering, the
visible and selected accounts may already agree. Both reviewers therefore withdrew the
stronger characterization as a confirmed new regression.

| Option | Pros | Cons |
| --- | --- | --- |
| Reproduce with two accounts and track the identity problem as a follow-up | Avoids an unproven architectural fix in this PR; separates existing duplicate-ID behavior from a new regression | Leaves a possible multi-account link limitation unresolved until tested |
| Carry tenant/account identity into navigation and distinguish subscription ancestor nodes by principal | Preserves the resolved identity end to end; can retain stable resource-based cluster IDs | Changes tree paths; requires compatibility and multi-account tests |
| Deduplicate subscription nodes using the resolver's account-selection policy | Smaller hierarchy change; one consistent selection policy | Hides alternative principals; must also honor tenant hints and permission differences |

**Recommendation:** Obtain a live multi-account reproduction and track the underlying
duplicate-ID/account-selection problem as a follow-up before changing tree identity.
No follow-up issue has been created. If a distinct deep-link regression is established,
preserve the resolved principal end to end while retaining stable cluster cache IDs.

**Verification needed:** Duplicate subscriptions under accounts with different permissions,
reversed account ordering, tenant hints, both Azure providers, and real cache/reveal behavior.
A live multi-account Azure check remains necessary; no live reproduction is claimed here.

**Author decision and rationale:** Pending.

## F4 - med - Query-key diagnostics can log credential material

**Origin:** RD4; not independently reported by code-review.
**Final validation:** Both confirmed `med`; the synthetic logging probe reproduced exposure.

**Evidence:** [new information-level URI log](../../../../../src/vscodeUriHandler.ts#L170).

**Trigger and impact:** The log prints every caller-controlled query key before route/argument
validation. A malformed connection-string link, a missing `connectionString=`, or an unescaped
ampersand can put a password or private hostname into a query key rather than a value.
The direct output-channel log does not use telemetry's `valuesToMask`. Rejected links can
therefore leave credential material in the information log.

**Why introduced:** This raw-key logging is new. Logging parameter names is only safe when
those names come from a trusted vocabulary, not arbitrary external input.

| Option | Pros | Cons |
| --- | --- | --- |
| Log allow-listed parameter names plus an unknown-key count | Retains useful diagnostics; excludes attacker-controlled key text | Cannot show literal misspelled parameter names |
| Log parameter counts only | Simplest privacy boundary | Less useful for diagnosing which supported arguments were supplied |

**Recommendation:** Allow-listed names and an unknown-key count. Do not rely on masking
parameter values to sanitize output-channel messages.

**Verification needed:** Synthetic password/hostname sentinels in unknown keys, missing-`=`
queries, ampersand-split locators, rejected routes, and unknown connect sources. Assert
sentinels are absent from every captured log.

**Author decision and rationale:** Pending.

## F5 - low - A failed/cancelled connection still opens the requested surface

**Origin:** CR3; not independently reported by rubber-duck.
**Final validation:** Both confirmed `low`, with the shell impact narrowed: it may reject
missing credentials or start its worker connection if credentials remain; it need not repeat
the dashboard's authentication behavior.

**Evidence:** [connection-string target dispatch](../../../../../src/vscodeUriHandler.ts#L657);
[dashboard connection attempt](../../../../../src/commands/openClusterDashboard/openClusterDashboard.ts#L114);
[Azure-path connection check](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts#L144).

**Trigger and impact:** Open a `/connect` link with `open=dashboard` or `open=shell`, then
cancel authentication or fail to connect. The cluster node still exists, so the handler
dispatches the target regardless of the expansion's result. The dashboard can prompt or
connect again; the shell can report missing authentication or open a failing terminal.

**Why introduced:** `open=` on connection-string links is new. The Azure and connection-string
paths should not disagree about whether a failed connection permits target dispatch.

| Option | Pros | Cons |
| --- | --- | --- |
| Gate target dispatch on the established connection outcome | Avoids repeated prompts and failed target opens; aligns link variants | Must distinguish a client object from an actually successful connection |
| Make target commands consume an explicit prior connection/cancellation result | Makes retries intentional and reusable | Broader command/API change |

**Recommendation:** Prefer propagating an explicit expansion/connection outcome and dispatch
only after success, with recognized cancellation handling and existing failure UI/telemetry.
Code-review's smaller proposed guard is `ClustersClient.exists(storageId)`, matching the Azure
path. Both verified that clients are registered only after successful initialization, so
absence rejects failed/cancelled first connections. However, an older cached client survives
a failed reconnect; rubber-duck does not accept existence as a general substitute for the
current outcome. Do not turn a failure/cancellation into ordinary successful telemetry by
returning silently, and do not retry an already-failed attempt from the target command.

**Verification needed:** Failed and cancelled connections for both targets; no target command
after failure/cancellation, no duplicate prompt, and no success-shaped telemetry.

**Author decision and rationale:** Pending.

## F6 - low - Cancel during navigation does not stop target opening

**Origin:** CR4; not independently reported by rubber-duck.
**Final validation:** Both confirmed `low`. The finding does not assume that VS Code
immediately hides the progress notification when Cancel is clicked; that UX was not observed.

**Evidence:** [last progress cancellation check and reveal call](../../../../../src/deepLinks/handleAzureResourceLink.ts#L199);
[target opening after Azure handling](../../../../../src/vscodeUriHandler.ts#L205).

**Trigger and impact:** Press Cancel while the "Opening from Azure" progress reports
subscription/cluster loading or connecting. The cancellation token is not passed into the
navigation helper, and subsequent target dispatch does not check it. Work can continue and
open a collection, dashboard, or shell after cancellation.

**Why introduced:** The new progress notification is cancellable, but the latter stages of
the new flow do not observe cancellation.

| Option | Pros | Cons |
| --- | --- | --- |
| Pass the token through navigation; check between awaits and before opening a surface | Honors cancellation for subsequent steps; preserves useful progress | Cannot interrupt an already-running driver/auth operation without separate API support |
| Make the non-interruptible phase explicitly non-cancellable | Avoids a misleading Cancel action | Removes cancellation during the slowest part and requires a distinct progress phase |

**Recommendation:** Cooperative cancellation between navigation steps and immediately before
surface dispatch, using recognized cancellation handling and the existing telemetry convention.
Do not promise to undo completed visibility changes or interrupt an already-running expansion.

**Verification needed:** Cancel during each awaited navigation stage and before final
dispatch. Assert no later navigation/surface command runs and cancellation is recorded.

**Author decision and rationale:** Pending.

## F7 - low - Subscription display name is missing from error masking

**Origin:** CR5; not independently reported by rubber-duck.
**Final validation:** Both confirmed `low`; rubber-duck's error-parser/masking/reporter
probe retained a synthetic subscription name in both `errorMessage` and `errorMessageV2`.

**Evidence:** [ARM not-found error](../../../../../src/deepLinks/azureResource.ts#L52);
[initial mask values](../../../../../src/deepLinks/handleAzureResourceLink.ts#L32).

**Trigger and impact:** An ARM resource read returns not found. The user-facing error includes
the customer-defined subscription display name. Resource ID parts are added to
`context.valuesToMask`, but the display name is not, so generic error telemetry can retain it.
This is distinct from F4: a telemetry error message, not raw query-key output logging.

**Why introduced:** The error message and its subscription-name interpolation are new.

| Option | Pros | Cons |
| --- | --- | --- |
| Add the resolved subscription display name to the mask values before the ARM read | Narrow change; preserves the helpful user-facing message | Needs an end-to-end masking assertion, not only an array-membership test |
| Use an already-masked identifier or omit the display name from the error | Reduces customer-defined data in the message | Less friendly diagnostics |

**Recommendation:** Add the resolved display name to `context.valuesToMask` before the ARM
read and test the resulting telemetry error text without changing the user-facing explanation.
The code-review gate traced the message through the handler catch/rethrow into
`callWithTelemetryAndErrorHandling` and confirmed that neither the existing mask values nor
generic masking patterns cover an arbitrary subscription display name.

**Verification needed:** A synthetic, non-pattern-matching subscription-name sentinel in
the ARM error; assert it remains in the user-facing explanation but not captured telemetry.

**Author decision and rationale:** Pending.

## F8 - low - Visibility prediction differs from the SDK's casing rules

**Origin:** RD5. Code-review initially discarded this as limited to hand-edited settings,
then accepted it as a valid but rare `low` finding during cross-validation.
**Final validation:** Both accept `low`. The initial disagreement was about whether a rare
settings edge case warranted inclusion, not a difference in the SDK's actual filtering behavior.

**Evidence:** [subscription selection comparison](../../../../../src/deepLinks/azureVisibility.ts#L32).
The installed `@microsoft/vscode-azext-azureauth` subscription provider applies a
case-sensitive `includes()` when filtering subscription entries.

**Trigger and impact:** The selected-subscriptions setting contains an uppercase or
mixed-case GUID, while the Azure subscription has the equivalent lowercase identifier.
The new helper decides that the subscription is already selected, but the SDK filters it
out. No repair is proposed, and Discovery cannot find the target.

**Why introduced:** The SDK comparison predates the PR. The new recovery computation
predicts visibility with different semantics from the API it needs to repair.

| Option | Pros | Cons |
| --- | --- | --- |
| Ensure the SDK-accepted canonical selection entry exists, preserving existing entries | Narrow fix; approved repair makes the target visible | May retain equivalent entries with different casing |
| Normalize comparisons throughout the subscription provider | Consistent GUID semantics for all callers | Broader change outside the link flow |

**Recommendation:** Ensure the canonical entry is accepted by the actual filtering path,
rather than changing the SDK or claiming the existing mixed-case entry is effective.

**Verification needed:** Use the real filtering semantics with uppercase/mixed-case tenant
and subscription entries. After repair, `getSubscriptions(true)` must include the target.

**Author decision and rationale:** Pending.

## Validation and limitations

- Code-review ran the following against the reviewed head, before the report was added:

  ```bash
  timeout 300 npx vitest run src/deepLinks src/tree/discovery-view/discoveryViewHelpers.test.ts src/tree/TreeParentCache.test.ts src/vscodeUriHandler.test.ts
  ```

  **Result:** 8 test files passed; **209 tests passed**. Existing mocks do not reproduce
  the cache and already-expanded workbench behaviors described above. Passing these tests
  is not evidence that the reported defects cannot occur.
- Rubber-duck exercised production source in in-memory probes with mocked Azure/workbench
  boundaries for cache invalidation, retry-state persistence, account collisions, logging,
  and casing. These are review probes, not committed regression tests or live Azure checks.
- Neither reviewer performed installed-extension or live-Azure verification. Freshly created
  portal resources, resource-scoped RBAC, refresh/reveal races, and multi-account behavior
  still require the manual checks in the [iteration plan](./03-azure-resource-links.md#verification).
- No product source changed during this review. A build was not rerun for the review document,
  and no new regression tests were committed.
- This PR remains a **draft: Case 1**, not a ready-for-review handoff. The full Case 2 checks,
  including `prettier-fix`, are deferred until ready for review. This review does not claim
  those checks passed.

## Outcome

The parallel independent reviews, cross-vendor validation gate, and consolidation are complete.
Seven findings are confirmed; F3 remains a manual-evidence candidate. F1 and F2 were found
independently by both models. F4–F8 were agreed after cross-validation. Both downgraded F3
to `low`/unconfirmed. The remaining solution-level cautions for F1 and F5 are recorded rather
than presented as false consensus.

No product code or author decisions have been changed. Stage 2 is pending: the author must
decide each finding with a rationale inline above. Accepted fixes should then follow
[CONTRIBUTING section 6.3](../../../../../CONTRIBUTING.md#63-stage-3-coding-agent-implements-the-fixes):
individual fix commits, verification, commit links recorded against the finding, and PR
responses where applicable. This document is the consolidated review record, not a
ready-for-review certification.
