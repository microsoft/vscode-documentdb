---
feature: deep-links
kind: review
status: active
prs: [1067]
created: 2026-11-10
---

# PR #1067 Copilot review: verification and recommendations

- Source: operator-supplied `copilot-review-verification.md` (257-line read-only
  snapshot), based on [eight Copilot threads](./03-copilot-review-feedback.md)
  retrieved 2026-11-10T10:24Z. This repository copy retains its evidence, options,
  recommendations and rationale with portable links and namespaced finding IDs.
- Verified against: `a3cca123` (the PR head; the worktree was clean).
- Original method: code reading of every cited path. Nothing was run in a workbench.
- Severity: **high** = broad, severe failure; **med** = meaningful incorrect behavior in
  a supported workflow; **low** = narrow, cosmetic, telemetry-only or fails safe.
- **Author decision, 2026-11-10:** the operator instructed implementation of the
  recommended solutions and committing the review files. Six threads are fixes;
  CP-F3 and CP-F7 are explicitly won't fix in this PR.

## Summary

| ID | Finding | Copilot | Verified | Accepted recommendation |
| --- | --- | --- | --- | --- |
| CP-F5 | Canceled connect still reveals descendants | med | med | Stop after a canceled connect |
| CP-F2 | Canceled tenant sign-in reported as not found | med | med | Treat `false` as cancellation |
| CP-F1 | Suppression flag not reference-counted | high | low | Per-cluster count, idempotent release |
| CP-F8 | Stale `lastConnectionOutcome` in `connect()` | med | low; valid despite outdated location | Reset at the start of `connect()` |
| CP-F4+6 | Names logged despite "never logged" promise | med | low | Drop values from trace lines |
| CP-F3 | Subscription filter write may silently fail | med | low; pre-existing | Won't fix in #1067 |
| CP-F7 | Case-insensitive collection fallback | med | low; pre-existing | Won't fix in #1067 |

The original review recommends five small code changes covering six threads. CP-F5
and CP-F2 are the most user-visible. None was judged a merge blocker by that review.

## CP-F1 - Reference-count overlapping suppression acquisitions

**Verified: valid, low.**
[autoOpenDashboardSuppression.ts](../../../../../src/tree/documentdb/autoOpenDashboardSuppression.ts)
uses a plain `Set`; the first release deletes the flag for every owner.
Discovery and URI-handler callers share the same key space (`clusterId === storageId`
for saved connections).

The automatic-open check runs inside the cluster's `getChildren()`, gated by
`!wasConnected`. Two links expanding the same node share that expansion, and the first
releases only after it returns. The race needs two confirmed dashboard links to the
same cluster, a failed/canceled first connect, then a successful second expansion
after release. The worst result is one extra cluster-wide dashboard panel.

| Option | Pros | Cons |
| --- | --- | --- |
| Won't fix | No churn | Module remains subtly wrong; Copilot's high headline remains |
| **`Map<string, number>` with a release closure guarded by `released`** | Isolated, self-evidently correct, trivial test | None identified |
| Ownership tokens (`Set<symbol>` per cluster) | Same correctness | More code without benefit |

**Accepted:** counter and idempotent release. Test overlapping owners, duplicate
release, final cleanup, reacquisition and independent clusters.

## CP-F2 - Treat canceled tenant sign-in as cancellation

**Verified: valid, med.**
[azureSubscription.ts](../../../../../src/deepLinks/azureSubscription.ts) ignores
the result of `signIn(tenantId)`. On `false`, the second lookup runs and eventually
throws `subscriptionNotFound` with a Manage Azure accounts button. Initial sign-in
already handles `false` as cancellation.

The user dismisses sign-in but sees an error saying the subscription is missing.
Telemetry records failure instead of cancellation.

**Accepted:** store the measured sign-in result; on `false`, trace
`Tenant sign-in stopped`, call `cancelDeepLink(context, 'AzureTenantSignIn')`, and
return `undefined`. Test canceled outcome, one subscription lookup and no error button.

## CP-F3 - Verify the effective subscription filter

**Verified: technically valid, low, pre-existing root cause.**
[subscriptionFilteringHelpers.ts](../../../../../src/plugins/api-shared/azure/subscriptionFiltering/subscriptionFilteringHelpers.ts)
swallows a failed primary write. Readers prefer a stale primary array and re-sync
it over fallback storage.

This needs `config.update('azureResourceGroups.selectedSubscriptions')` to throw
while `config.get` still returns an array. A practical trigger is an absent/disabled
Azure Resources extension with an old filter left in settings; it is not an
extension dependency.

The link ultimately stops with the accurate, actionable error "Could not find ...
in the Discovery view ... a filter may still hide it." Nothing wrong is opened.
Only `visibilitySubscriptionApplied=true` is inaccurate in this corner case.

| Option | Pros | Cons |
| --- | --- | --- |
| Return effective outcome from setter and abort | Correct at source | Changes shared Filter Entries behavior; scope creep |
| Re-read locally after the write | Local | Only improves telemetry; user result unchanged |
| **Won't fix in #1067** | No churn; actionable existing failure | Applied flag can be wrong |

**Accepted: won't fix.** The shared helper is unchanged by this PR. Fixing regular
filter UI and setter semantics belongs in a separate change. Document the telemetry
caveat rather than imply an effective filter readback.

## CP-F4 and CP-F6 - Remove names from traces

**Verified: valid, low.** One issue reported in two threads.
The PR promises "Parameter values, connection strings and Azure IDs are never logged."
Azure paths nevertheless trace:

- [handleAzureResourceLink.ts](../../../../../src/deepLinks/handleAzureResourceLink.ts):
  parsed resource name and ARM display name during reveal.
- [azureResource.ts](../../../../../src/deepLinks/azureResource.ts): requested resource name.
- [discoveryViewHelpers.ts](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts):
  database and collection names during lookup/reveal.

The Connections path does not trace names. These are names rather than secrets and
only local trace output, but logs get pasted into public issues and can identify
customers.

| Option | Pros | Cons |
| --- | --- | --- |
| Weaken the PR description | No code | Weakens contract; inconsistent paths |
| **Drop values while retaining step/category traces** | Preserves promise and useful diagnostics | Update existing assertions |

**Accepted:** keep kind and step information, not names. Assert resource, ARM
display, resource-group, database and collection values never appear in traces.

## CP-F5 - Stop descendant reveals after a canceled connection

**Verified: valid, med.**
[connectionsViewHelpers.ts](../../../../../src/tree/connections-view/connectionsViewHelpers.ts)
records the canceled attempt, then continues with database/collection reveals.
Their recursive `findNodeById(id, true)` can call the cluster's `getChildren()`
again. Cancellation returned `[]` without a cached error, so it reconnects or
re-runs credential prompts despite the user's Cancel. The URI handler's later
check is too late. Discovery already stops at this boundary.

If the second connect succeeds, automatic dashboard opening can also run even
though the explicit target is skipped.

**Accepted:** immediately after `recordDeepLinkConnectionAttempt`, return when
`deepLinkOutcome === 'canceled'`. Test a canceled node with descendant requests:
only the cluster reveal runs and the canceled outcome/correlation is retained.
Failed expansions already cache retry children and need no extra guard.

## CP-F7 - Exact matching for collection names

**Verified: technically valid, low, pre-existing and fails safe.**
[TreeParentCache.findChildById](../../../../../src/tree/TreeParentCache.ts)
returns the first case-insensitive ID match. Discovery uses it only after an exact
cache miss. A wrong result needs case-only-different collections, a cache miss after
expansion, and the wrong sibling first in fallback traversal.

An exact-name guard rejects the wrong node, causing a "not found" error instead of
opening the wrong collection. Database names cannot differ only by case. Connections
already uses the same lookup on main.

| Option | Pros | Cons |
| --- | --- | --- |
| Exact direct-child lookup in Discovery | Local | Fixes only one path |
| Exact-first match in shared `TreeParentCache.findChildById` | Fixes both paths | Shared tree change needs its own tests |
| **Won't fix in #1067** | No churn; fails closed | Rare incorrect "not found" remains |

**Accepted: won't fix.** Prefer an exact-first shared lookup when that cache is
changed separately; do not broaden this deep-link fix.

## CP-F8 - Reset outcome before every connect attempt

**Verified: valid, low, despite an outdated thread location.**
[ClusterItemBase.connect](../../../../../src/tree/documentdb/ClusterItemBase.ts)
does not clear outcome/correlation; only `getChildren()` does. The dashboard reads
the outcome after `connect()` returns `null`, including authentication paths that
never set a new outcome.

This misclassifies dashboard/link telemetry as canceled versus failed. It changes
no surface or dialog: connection handling already explained the reason.

**Accepted:** clear `lastConnectionOutcome` and `lastConnectionCorrelationId` at
entry to `connect()`, before cached and authentication paths. Test stale state
followed by null authentication and fresh cached-attempt state.
A wizard cancel that returns null without classifying itself may still read as
Failed; eliminating stale state does not claim to fix that separate limitation.

## Execution plan and advisor

GPT Astra (`gpt-6-astra`) advised on 2026-11-10: preserve evidence first; implement
CP-F5, CP-F2, CP-F1, CP-F8 and CP-F4+6; run Case 1 and then the operator-requested
Case 2; record fix hashes and reply to all eight threads.
The original report suggested one fix commit; repository contribution rules require
one commit per work item, so use five fix commits instead.

Model suggestions: GPT Astra for planning/escalation, Claude Sonnet 5 for fixes,
review documents/commits/GitHub responses, Claude Haiku 5.5 for targeted/full check
execution and final usage reporting. Suggestions do not override configured agent
defaults; implementation remains in the lead context.

No localized user-facing string changes are expected; trace text does not require
`npm run l10n`. Case 2 still includes `l10n:check`, formatting, lint, build,
`typecheck:tests`, full runtime tests and packaging.

## Implementation and verification log

Pending implementation. Record each work item, commit and check result here.
Live cloud/workbench verification remains separate from automated checks.
