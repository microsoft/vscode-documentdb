---
feature: deep-links
kind: plan
status: active
created: 2026-11-05
code:
    - src/vscodeUriHandler.ts
    - src/vscodeUriHandler.test.ts
    - src/plugins/service-azure-mongo-vcore/**
    - src/plugins/service-azure-mongo-ru/**
    - src/plugins/api-shared/azure/subscriptionFiltering/**
    - src/tree/discovery-view/**
    - src/services/discoveryProviderVisibility.ts
---

# Iteration 3 — Azure resource links (`/connect/azure`) and `open=`

> **Status:** planned, not started. Decisions D0008–D0014 in [decisions.md](../decisions.md).
> Research on vscode-cosmosdb: [03-azure-resource-links-research.md](./03-azure-resource-links-research.md).

## Goal

A user looking at an Azure DocumentDB or Azure Cosmos DB for MongoDB (RU) resource in the Azure
portal clicks **Open in VS Code** and lands on that cluster in the DocumentDB extension, optionally
on a database, collection, Cluster Dashboard or shell. The portal often cannot hand over a
connection string, so the link carries the ARM resource ID and we reach the cluster through Azure
service discovery, fixing sign-in and filters on the way.

Second goal: links can ask for the Cluster Dashboard or the shell, on both `/connect` and
`/connect/azure`.

## The contract

```text
vscode://ms-azuretools.vscode-documentdb/connect/azure?resourceId=<ARM id>[&tenantId=<guid>][&database=<db>][&collection=<coll>][&open=dashboard|shell]
vscode://ms-azuretools.vscode-documentdb/connect?connectionString=<cs>[&database=<db>][&collection=<coll>][&open=dashboard|shell]
vscode://ms-azuretools.vscode-documentdb?connectionString=<cs>…          (legacy, unchanged: means /connect)
```

| Argument           | `/connect`   | `/connect/azure` | Rules                                                                                                                                                                            |
| ------------------ | ------------ | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connectionString` | **required** | refused          | Unchanged (double-encoded).                                                                                                                                                      |
| `resourceId`       | refused      | **required**     | `/subscriptions/<guid>/resourceGroups/<rg>/providers/Microsoft.DocumentDB/{mongoClusters\|databaseAccounts}/<name>`. Nothing after the name. Provider and type case-insensitive. |
| `tenantId`         | refused      | optional         | GUID. Used to pick the account and tenant, and to offer sign-in to that tenant.                                                                                                  |
| `database`         | optional     | optional         | Unchanged.                                                                                                                                                                       |
| `collection`       | optional     | optional         | Needs a database. On `/connect/azure` it must be the `database` argument (no connection-string path).                                                                            |
| `open`             | optional     | optional         | Allow-list `dashboard`, `shell`, case-insensitive. Refused together with `collection` (D0013).                                                                                   |

Other unknown query keys stay tolerated and counted (`uriUnknownParamCount`), as today. Only the
**locator** keys of the other variant are refused, so a mistaken link fails loudly instead of
silently using one locator.

`resourceId` contains only characters that survive one or two decodes unchanged, so it may be sent
raw, encoded once, or encoded twice. The docs recommend encoding once.

## Flow for `/connect/azure`

Order matters: the confirmation must show verified facts and every filter change, and nothing is
changed before it.

| Step | What                                                                                         | Side effects                 | `failureStage`                                   |
| ---- | -------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------ |
| 1    | Route and validate arguments (WI1, WI2, WI3)                                                 | none                         | `parseRoute`, `extractParams`, `parseResourceId` |
| 2    | Get the plugin's subscription provider; ensure Azure sign-in (WI4)                           | sign-in prompt if needed     | `azureSignIn`                                    |
| 3    | Find the subscription among **unfiltered** subscriptions, matching `tenantId` if given (WI4) | sign-in to tenant if needed  | `resolveSubscription`                            |
| 4    | Read the resource from ARM; for RU check `kind === 'MongoDB'` (WI5)                          | read only                    | `readAzureResource`                              |
| 5    | Compute visibility changes (WI6)                                                             | none                         | `computeVisibility`                              |
| 6    | Confirmation, gated by `showUrlHandlingConfirmations` (WI7)                                  | none                         | `confirm`                                        |
| 7    | Apply visibility changes (WI6)                                                               | **persistent filter writes** | `applyVisibility`                                |
| 8    | Reveal the cluster in the Discovery view and expand it, which connects (WI8)                 | connection, auto dashboard   | `revealCluster`                                  |
| 9    | Reveal database / collection if given, verify they exist (WI8)                               | none                         | `revealTarget`                                   |
| 10   | Open the Collection View, or the `open=` surface (WI9)                                       | opens UI                     | `openTarget`                                     |

Reading ARM before the confirmation (step 4) is deliberate: it is a read with the user's own
identity, and it lets the dialog name a resource that exists and is the right kind instead of
asking the user to approve something that will fail.

Cancelling at step 2, 3 or 6 records `userCancelledAtStep` and changes nothing.

---

## WI1 — Route `/connect/<source>`

Today `/connect` refuses any qualifier. Replace that with a hand-written allow-list of sources:

- `CONNECT_SOURCES = ['azure'] as const`, matched case-insensitively, like `LOCAL_RESOURCE_TYPES`.
- `/connect` → connection-string flow, unchanged. Legacy empty path → the same.
- `/connect/azure` → Azure flow.
- `/connect/<unknown>` and `/connect/azure/<anything>` → refused with a message naming the
  supported forms. No fallback to the connection-string flow (same reasoning as unknown verbs).
- Telemetry: `deepLinkConnectSource` = `connectionString` | `azure` | `unrecognized`.

**Tests** (`vscodeUriHandler.test.ts`): `/connect/azure`, `/CONNECT/Azure`, `/connect/aws`,
`/connect/azure/x`, `/connect/../local`, legacy empty path still reaches the connection-string
flow.

## WI2 — Arguments per variant, and `open`

- Split `UriParams` into a connection-string shape and an Azure shape sharing `database`,
  `collection`, `open`.
- One `parseOpenTarget()` with an allow-list `['dashboard', 'shell']`; anything else is refused.
- Refuse: the other variant's locator; `open` with `collection`; `collection` without a database.
- Add the new keys to `knownKeys`.
- **Masking:** add `resourceId`, subscription ID, resource group, cluster name and `tenantId` to
  `context.valuesToMask`, alongside database and collection.
- Telemetry: `hasParamResourceId`, `hasParamTenantId`, `openTarget` (`none` | `dashboard` |
  `shell`), `mixedLocatorRefused`.

**Tests:** every refusal above, `open` casing, masking contents.

## WI3 — Parse and classify the resource ID

A pure function, `parseAzureResourceLink(resourceId, tenantId?)`, returning
`{ subscriptionId, resourceGroup, name, kind: 'vcore' | 'ru', providerId, tenantId? }`.

- Exact segment structure, subscription ID and `tenantId` are GUIDs, nothing after the name.
- `Microsoft.DocumentDB/mongoClusters` → `azure-mongo-vcore-discovery`.
  `Microsoft.DocumentDB/databaseAccounts` → `azure-mongo-ru-discovery` (kind checked in WI5).
- Everything else, including child resources (`/databases/…`), refused with
  "This link points to an Azure resource type the DocumentDB extension cannot open."
- Telemetry: `azureResourceKind`.

Can reuse `parseAzureResourceId` from `@microsoft/vscode-azext-azureutils` for splitting, but the
strict checks stay ours.

**Tests:** valid vCore and RU, mixed casing, trailing slash, child resource, wrong provider,
non-GUID subscription and tenant, empty name.

## WI4 — Azure sign-in and subscription resolution

- Get the provider with `DiscoveryService.getProvider(providerId)`. Both Azure providers expose
  `azureSubscriptionProvider: AzureSubscriptionProviderWithFilters`; add a small shared interface
  rather than casting to two classes. The providers register in `activateClustersSupport`, which
  completes before the URI handler is registered (`src/extension.ts`), so there is no activation
  race like vscode-cosmosdb's
  [microsoft/vscode-cosmosdb#3288](https://github.com/microsoft/vscode-cosmosdb/pull/3288).
- Not signed in (`isSignedIn()` false): modal "Sign in to Azure to open <name>" → `signIn()`.
  Declined → cancel.
- `getSubscriptions(false)` (unfiltered). Pick the subscription with that ID, and with that
  `tenantId` when given.
  - The same subscription can appear under several accounts (`getDuplicateSubscriptions`). Prefer
    one whose tenant is not filtered out; otherwise the first.
  - Not found and `tenantId` given: offer "Sign in to tenant <tenantId>" → `signIn(tenantId)`, then
    retry once. This is the case vscode-cosmosdb still fails
    ([microsoft/vscode-cosmosdb#2686](https://github.com/microsoft/vscode-cosmosdb/issues/2686)).
  - Not found otherwise: error "None of your signed-in Azure accounts can access subscription
    <id>." with an action that runs `vscode-documentdb.command.discoveryView.manageCredentials`.
- Telemetry: `azureSignInRequired`, `tenantSignInRequired`, `subscriptionAccountCount`.

**Tests:** with a fake subscription provider: signed out → sign-in → found; tenant hint selects
between duplicates; not found with and without hint.

## WI5 — Read the resource from ARM

- vCore: `getClusterInformationFromAzure(context, subscription, resourceGroup, name)`.
- RU: `createCosmosDBManagementClient(context, subscription).databaseAccounts.get(rg, name)`;
  refuse unless `kind === 'MongoDB'` ("This Azure Cosmos DB account does not use the MongoDB API.").
- Map ARM `ResourceNotFound` / `ResourceGroupNotFound` to "not found in subscription <name>", and
  `AuthorizationFailed` to "your account cannot read this resource". Other errors keep the ARM
  message. Check whether `ConnectionDiagnosticsService` should own this mapping (error-translation
  skill) before writing it inline.
- Keep the returned name casing for display; it is what the tree shows.

## WI6 — Visibility changes (D0011)

A pure `computeVisibilityChanges(providerId, subscription)` returning which of these apply, and an
`applyVisibilityChanges()` that performs them:

| Hidden by                 | Check                                                     | Change                                                     |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Discovery provider hidden | `getHiddenDiscoveryProviderIds()` includes `providerId`   | `showDiscoveryProvider(providerId)`                        |
| Tenant filtered           | `isTenantFilteredOut(tenantId, accountId)`                | `removeUnselectedTenant(tenantId, accountId)`              |
| Subscription not selected | `getSelectedSubscriptionIds()` non-empty and lacks the ID | `setSelectedSubscriptionIds([...current, tenantId/subId])` |

- Empty subscription selection means "all"; never write the setting in that case.
- `setSelectedSubscriptionIds` needs the full `tenantId/subscriptionId` list. Read the raw setting
  (`azureResourceGroups.selectedSubscriptions`, with the existing globalState fallback), not
  `getSelectedSubscriptionIds()`, which drops the tenant part.
- After applying, `ext.discoveryBranchDataProvider.refresh()`.
- Telemetry: `visibilityProviderShown`, `visibilityTenantUnfiltered`,
  `visibilitySubscriptionAdded`.

**Tests:** each change alone and combined; empty selection untouched; existing entries preserved;
nothing applied when the confirmation is cancelled.

## WI7 — Confirmation (D0012)

When `showUrlHandlingConfirmations` is on, one modal:

- Title: "You clicked a link that wants to open an Azure resource in VS Code."
- Detail: resource name and type, resource group, subscription name, database, collection, what
  opens (`Cluster Dashboard`, `shell`, `Collection View`, or nothing).
- When filters change, a block listing them, including: "Subscription <name> will be added to your
  Azure subscription filter. This also shows it in the Azure Resources view."
- Button "Open". Dismiss cancels (`userCancelledAtStep = 'AzureConfirmation'`).

When the setting is off: no dialog; filter changes still apply (recorded in D0012 "Revisit if").

No second or third confirmation as in `/connect`; those exist for the stored secret.

## WI8 — Reveal in the Discovery view

A `revealInDiscoveryView()` helper, modelled on `revealInConnectionsView`:

1. Focus the Discovery view and wait until it is ready (add a `waitForDiscoveryViewReady`
   counterpart if none exists).
2. Walk down through the branch data provider so every node lands in the parent cache:
   root `discoveryView/<providerId>` → subscription `…/<subscriptionId>` → its children.
3. **Find the cluster node by `cluster.azureResourceId`, compared case-insensitively.** Do not
   build the tree ID as a string: tree IDs use the casing ARM returned when listing, which can
   differ from the link (resource group casing especially). Never read the tree selection
   (lesson from [microsoft/vscode-cosmosdb#3460](https://github.com/microsoft/vscode-cosmosdb/pull/3460)).
4. Reveal it with `{ select: true, focus: !database, expand: true }`. Expanding connects through
   the node's normal flow (Entra ID or native credentials prompt, error modal and recovery
   actions on failure) and opens the dashboard when `showDashboardOnConnect` is on.
5. If the cluster did not connect (no client for its `clusterId` after the reveal), stop. The node
   has already explained why; do not add a second error.
6. Reveal `${clusterNode.id}/${database}` and `/${collection}` progressively, then verify they
   exist with `findNodeById`, as `/connect` does, and fail with the same message if not.

Wrap steps 2–6 in a notification progress "Opening <name>…" plus the view's progress indicator.

**Tests:** node match by resource ID with different casing; missing node after a refresh gives a
clear error; database/collection missing.

## WI9 — Open the target, on both variants (D0013, D0014)

After the reveal, on both `/connect` and `/connect/azure`:

| Arguments                 | Opens                                                                                                                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `database` + `collection` | Collection View, as today. Azure: `openCollectionViewInternal` with the prefixed `clusterId`, `Views.DiscoveryView`, and the cluster's display name.                                                                                                                              |
| `open=dashboard`          | `vscode-documentdb.command.clusterDashboard.open` on the cluster node, or on the database node when `database` is given, with `{ activationSource: 'deepLink' }`. **Ignores `showDashboardOnConnect`.** If the automatic open already fired, the panel is reused (`panelReused`). |
| `open=shell`              | `vscode-documentdb.command.shell.open` on the cluster node, or the database node when given.                                                                                                                                                                                      |
| nothing                   | Reveal only (plus the automatic dashboard, if enabled).                                                                                                                                                                                                                           |

- `/connect`: the existing "open connection" confirmation detail gains a line naming the surface.
  The Collection View confirmation stays as is.
- `deepLink` is a new `activationSource` value; tell whoever maintains the telemetry dashboards so
  it is counted as a deliberate open and not lumped into an "other" bucket.
- Nothing from the link is ever passed to the shell as input.

**Tests:** dashboard opens with the setting off; dashboard with database targets the database node;
shell receives only the node; `/connect` with `open=shell`.

## WI10 — Telemetry summary

Event stays `globalUriHandler` with the `failureStage` / `errorName` shape (issue #655). New
properties: `deepLinkConnectSource`, `azureResourceKind`, `hasParamResourceId`, `hasParamTenantId`,
`openTarget`, `azureSignInRequired`, `tenantSignInRequired`, `subscriptionAccountCount`,
`visibilityProviderShown`, `visibilityTenantUnfiltered`, `visibilitySubscriptionAdded`,
`mixedLocatorRefused`. All values are enums or counts; identifiers are masked.

New properties are hidden until GDPR-classified; check them in `RawEventsVSCodeExtUnclassified`
after the first build ships, not in the dashboards.

## WI11 — Documentation

- [how-to-construct-url.md](../../../../user-manual/how-to-construct-url.md): add `connect/azure`
  to the actions table; split parameters per variant; add `open`; examples for vCore, RU, with
  `tenantId`, with `open=shell` and `open=dashboard`; an "Azure resources" section under
  _How It Works_ covering sign-in, tenant, and the permanent filter changes including the shared
  Azure Resources setting.
- [README.md](../README.md): mark this iteration done, move items out of _Open gaps_.
- Release notes for the version that ships it.
- `npm run l10n` for the new strings.

## WI12 — Azure portal coordination (outside this repository)

- Share the contract with the portal team: they send `resourceId` and `tenantId` (the portal knows
  the directory the user is in, which is what fixes the wrong-tenant case).
- Agree whether the portal also offers `open=shell` / `open=dashboard` buttons.
- Not a blocker for merging; the link works for anyone who builds it.

---

## Verification

Automated: the unit tests listed per work item (`npx vitest run src/vscodeUriHandler.test.ts` plus
any new helper test files).

Manual, against a real subscription, for both a vCore cluster and an RU account:

| Case                                               | Expected                                             |
| -------------------------------------------------- | ---------------------------------------------------- |
| Signed out of Azure                                | Sign-in prompt, then opens                           |
| Signed in, wrong tenant, `tenantId` given          | Tenant sign-in offered, then opens                   |
| Signed in, wrong tenant, no `tenantId`             | Clear error with "Manage Azure accounts"             |
| Subscription not in a non-empty selection          | Listed in confirmation; added; appears in both views |
| Tenant filtered out                                | Listed; unfiltered                                   |
| Provider hidden in Discovery view                  | Listed; shown                                        |
| Confirmations off                                  | No dialog; same changes applied                      |
| Confirmation dismissed                             | Nothing changed                                      |
| Resource does not exist / no access                | Specific error, no filter changes                    |
| RU account that is not MongoDB                     | Refused before confirmation                          |
| Entra ID cluster / native-auth cluster             | Connects / asks for credentials                      |
| `database` + `collection`                          | Collection View opens                                |
| `open=dashboard` with `showDashboardOnConnect` off | Dashboard opens                                      |
| `open=dashboard` with it on                        | One dashboard panel                                  |
| `open=shell` with and without `database`           | Shell opens in the right scope                       |
| `/connect?connectionString=…&open=shell`           | Existing flow, then shell                            |
| Legacy link without a path                         | Unchanged                                            |

## Out of scope

- Resolving through the Azure Resources view (D0009).
- Other sources (`/connect/kubernetes`, `/connect/atlas`, Azure VM); the routing leaves room.
- Suppressing the automatic dashboard when a link asks for something else (D0013).
- Collection-scoped shell or dashboard.
- Sovereign clouds: a link has no cloud hint, so it works only when the user is signed in to the
  cloud that owns the resource. Revisit with the portal team if Government or China portals adopt
  the button.

## Open questions

1. Should the Azure error mapping (WI5) live in `ConnectionDiagnosticsService` as a provider, or
   stay local to the handler?
2. Does the Discovery view need a readiness wait like `waitForConnectionsViewReady`, or is
   awaiting `getChildren` through the provider enough?
3. Where should `revealInDiscoveryView` live: next to `connectionsViewHelpers.ts` in
   `src/tree/discovery-view/`, or in the Azure plugin shared folder?

---

# Outcome

_Not started._
