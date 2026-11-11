---
feature: deep-links
kind: review
status: historical
prs: [1067]
created: 2026-11-10
---

# PR #1067 Copilot feedback

Eight Copilot threads retrieved on 2026-11-10. The text below is the original feedback;
the [verification and accepted recommendations](./03-copilot-review-verification.md)
record the operator's disposition. IDs use `CP-F` to distinguish them from the earlier
[cross-vendor review](./03-azure-resource-links-review.md).

## CP-F1 - Dashboard suppression ownership

[Thread](https://github.com/microsoft/vscode-documentdb/pull/1067#discussion_r4493981950)
on [autoOpenDashboardSuppression.ts](../../../../../src/tree/documentdb/autoOpenDashboardSuppression.ts).

> Please retain suppression until every acquisition for this cluster has been released. URI handlers can overlap, so two dashboard links for the same cluster can both acquire suppression. The first release currently deletes the shared flag while the other link still owns it, allowing an automatic dashboard to open during that link's expansion. Use a per-cluster reference count or ownership tokens, with an idempotent release callback.

## CP-F2 - Tenant sign-in cancellation

[Thread](https://github.com/microsoft/vscode-documentdb/pull/1067#discussion_r4493982171)
on [azureSubscription.ts](../../../../../src/deepLinks/azureSubscription.ts).

> Please handle a false tenant sign-in result as cancellation, as the initial sign-in branch already does. If the user chooses "Sign in to tenant" and then cancels Azure sign-in, `signIn(tenantId)` can return false. Ignoring that result runs another subscription lookup and ultimately shows `subscriptionNotFound`, recording a failed link instead of a cancellation. Return immediately after calling `cancelDeepLink` when sign-in returns false.

## CP-F3 - Effective subscription filter

[Thread](https://github.com/microsoft/vscode-documentdb/pull/1067#discussion_r4493982237)
on [azureVisibility.ts](../../../../../src/deepLinks/azureVisibility.ts).

> Resolving `setSelectedSubscriptionIds()` does not establish that the effective filter changed: that helper catches primary configuration-write errors and resolves after writing fallback storage. If `azureResourceGroups.selectedSubscriptions` already exists, both subscription readers continue using the unchanged primary value and overwrite the fallback. This path consequently reports the subscription change as applied and proceeds to reveal a still-hidden subscription. Verify the effective selection after the write, or have the setter return its effective outcome, before marking success and continuing.

## CP-F4 - Resource names in trace

[Thread](https://github.com/microsoft/vscode-documentdb/pull/1067#discussion_r4493982301)
on [handleAzureResourceLink.ts](../../../../../src/deepLinks/handleAzureResourceLink.ts).

> This logs the resource name, which comes from the `resourceId` parameter, to the output channel. `azureResource.ts:26` does the same, and its test asserts the name is logged. That contradicts the PR description: "Parameter values, connection strings and Azure IDs are never logged." Either drop the name here, or update the description to say resource, database and collection names are logged at trace level.

## CP-F5 - Descendant reveals after cancellation

[Thread](https://github.com/microsoft/vscode-documentdb/pull/1067#discussion_r4493982369)
on [connectionsViewHelpers.ts](../../../../../src/tree/connections-view/connectionsViewHelpers.ts).

> Please stop descendant navigation once this records a canceled connection. For a database/collection link, canceling a cached-client connection makes `ClusterItemBase.getChildren()` return an empty array without caching an error. The subsequent database reveal uses recursive lookup, which calls the cluster's `getChildren()` again and retries the connection despite cancellation. The URI handler checks the canceled outcome only after this helper returns, which is too late to prevent that retry. A source-extracted check confirms both descendant reveals still run with `deepLinkOutcome='canceled'`.

## CP-F6 - Database and collection names in trace

[Thread](https://github.com/microsoft/vscode-documentdb/pull/1067#discussion_r4493982435)
on [discoveryViewHelpers.ts](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts).

> The PR description says "Parameter values, connection strings and Azure IDs are never logged", but this trace line writes the `database` parameter value to the output channel. Lines 219, 229 and 252 do the same with `request.database` and `request.collection`. Either drop the values from these trace lines, or correct the description (and the logging contract it promises).

## CP-F7 - Case-sensitive collection fallback

[Thread](https://github.com/microsoft/vscode-documentdb/pull/1067#discussion_r4493982483)
on [discoveryViewHelpers.ts](../../../../../src/tree/discovery-view/discoveryViewHelpers.ts).

> The fallback can reject an existing collection when two collections differ only by case. `TreeParentCache.findChildById()` returns the first case-insensitive ID match, so on a warm-tree cache miss it can return `products` for a link to `Products`; the exact-name check below then throws even though `Products` is also present. Search the database's direct children using an exact ID/name match rather than accepting the first case-insensitive result.

## CP-F8 - Stale connection outcome

[Thread](https://github.com/microsoft/vscode-documentdb/pull/1067#discussion_r4493982082)
on [openClusterDashboard.ts](../../../../../src/commands/openClusterDashboard/openClusterDashboard.ts).

> `lastConnectionOutcome` is only reset at the start of `ClusterItemBase.getChildren()`. `connect()` does not reset it, and several `authenticateAndConnect()` paths return `null` without setting it. Examples are a failed ARM read in `DocumentDBResourceItem.getClusterInformation`, a wizard cancel in the VM, Kubernetes or Atlas items, and a missing stored connection.
>
> Because of that, this check can read a value left over from an earlier expansion. For example, a user expands a cluster and cancels the auth wizard, so the value becomes `canceled`. Later they open the dashboard from the inline button and the ARM read fails. This code then reports `result=Canceled` and returns `canceled: true` for what was really a failure. The reverse can also happen.
>
> Clear the field before calling `connect()`, so the value describes only this attempt.
