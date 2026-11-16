---
feature: deep-links
kind: research
status: active
created: 2026-11-05
code:
    - src/vscodeUriHandler.ts
---

# Iteration 3 research — how vscode-cosmosdb opens Azure resource links

> Input to [03-azure-resource-links.md](./03-azure-resource-links.md). Researched on
> `microsoft/vscode-cosmosdb` main at
> [`97d5c0f`](https://github.com/microsoft/vscode-cosmosdb/commit/97d5c0ffaefa2db54c3b2e02b8009b1e935cbfe9),
> 2026-11-05. Facts about another repository at one commit; re-check before relying on them.

## Why we looked

The Azure portal shows Azure DocumentDB and Azure Cosmos DB for MongoDB resources but often cannot
produce a connection string, which is the only locator our links accept. vscode-cosmosdb already
handles portal "Open in VS Code" links by Azure resource ID, so it is the obvious reference.

## What it does

**Registration.** `onUri` activation; `vscode.window.registerUriHandler({ handleUri:
globalUriHandler })` in `src/extension.ts`. The handler waits for the Azure Resources v2 API, then
reads `uri.query` only. The path is ignored.

**URL format** (documented in
[microsoft/vscode-cosmosdb#2635](https://github.com/microsoft/vscode-cosmosdb/pull/2635)):

```text
vscode://ms-azuretools.vscode-cosmosdb?resourceId=<ARM account id>&database=<db>&container=<container>
vscode://ms-azuretools.vscode-cosmosdb?subscriptionId=<sub>&resourceGroup=<rg>&cs=<connection string>&database=<db>&container=<container>
```

| Parameter                         | Behavior                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `resourceId`                      | ARM account ID. Wins over `cs` if both are present. Provider must be `Microsoft.DocumentDB/databaseAccounts`. |
| `cs`                              | Connection string. With `subscriptionId` + `resourceGroup` it is turned into a resource ID and not used.      |
| `subscriptionId`, `resourceGroup` | Only used with `cs` to build a resource ID.                                                                   |
| `tenantId`                        | Stored for Fabric attachments only; not passed to Azure resolution.                                           |
| `database`, `container`           | Both required to reveal a container and open the NoSQL query editor.                                          |

**Resolution.** Focus the Azure Resources view, call
`rgApiV2.resources.revealAzureResource(id, { select, focus, expand })`, then read the **current
selection** and map it to a Cosmos branch node. No direct ARM or Resource Graph lookup, no
subscription or tenant filter changes, no explicit sign-in handling; the Azure Resources tree shows
its own sign-in node.

**After resolution.** Reveal only, or open the NoSQL query editor when database and container both
resolve. No saved connection for Azure resources. A connection string without Azure coordinates is
attached as a workspace account, but only for Fabric hosts
([microsoft/vscode-cosmosdb#3455](https://github.com/microsoft/vscode-cosmosdb/pull/3455)).

**Confirmation.** None for a new URI-driven connection or attachment.

**Telemetry.** `handleExternalUri`, with connection string, database, container, tenant and
resource ID masked.

**Mongo.** `Microsoft.DocumentDB/mongoClusters` is commented out of the accepted providers. A Mongo
RU account passes the provider check but has no supported experience. No reference to
`vscode-documentdb` and no handoff.

## Known problems

- **Wrong account or tenant from the portal** gives "subscription not found":
  [microsoft/vscode-cosmosdb#2686](https://github.com/microsoft/vscode-cosmosdb/issues/2686), open.
  A maintainer noted it needs portal tenant hints and an Azure Resources unfiltering API.
- **Hidden subscriptions or tenants** make the reveal fail, and the legacy reveal can complete
  without revealing anything, leaving a stale selection to be read.
- **Fix in progress:** [microsoft/vscode-cosmosdb#3460](https://github.com/microsoft/vscode-cosmosdb/pull/3460),
  open. Forwards a GUID-validated `tenantId`, opts explicit links into **session-only** subscription
  visibility, and uses a new `revealAzureResourceWithResult` returning `{ id, resource }` instead of
  reading the selection. Full behavior needs
  [microsoft/vscode-azureresourcegroups#1991](https://github.com/microsoft/vscode-azureresourcegroups/pull/1991).

## Portal evidence

[microsoft/vscode-cosmosdb#2532](https://github.com/microsoft/vscode-cosmosdb/issues/2532) requested
"Open in VS Code" from the portal and Fabric. The URL the portal actually emits was **not found**;
the shapes above come from the PR description, not portal source.

## What we take, and what we do not

| From vscode-cosmosdb                                | Verdict                   | Where it lands  |
| --------------------------------------------------- | ------------------------- | --------------- |
| ARM resource ID as the locator                      | adopt                     | D0008           |
| Optional `tenantId` hint, validated as a GUID       | adopt                     | D0008, plan WI3 |
| Strict provider/resource-type check                 | adopt                     | D0010           |
| Never read the selection after a reveal             | adopt (lesson from #3460) | plan WI4        |
| Resolve through the Azure Resources view            | reject                    | D0009           |
| Session-only visibility                             | reject                    | D0011           |
| `resourceId` silently wins over a connection string | reject                    | D0008           |
| Route on the query only                             | reject                    | D0001           |
| No confirmation                                     | reject                    | D0012           |
