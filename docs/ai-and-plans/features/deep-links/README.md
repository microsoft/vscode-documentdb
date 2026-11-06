---
feature: deep-links
kind: notes
status: active
prs: [898, 1067]
created: 2026-08-24
code:
    - src/vscodeUriHandler.ts
    - src/deepLinks/**
    - src/tree/discovery-view/discoveryViewHelpers.ts
---

# Deep Links

**Status:** in progress — the action switch is new; `local` is its first non-`connect` action.
Iteration 3 ([plan](./iterations/03-azure-resource-links.md)) added `/connect/azure` for Azure
portal links and an `open=` argument; implemented, not yet manually verified or released.

> How a URL from outside VS Code reaches this extension, and why the vocabulary looks the way it
> does.

A deep link names **what it wants** in the path and supplies **arguments for it** in the query:

```
vscode://ms-azuretools.vscode-documentdb/connect?connectionString=…&database=…&collection=…
vscode://ms-azuretools.vscode-documentdb/local
vscode://ms-azuretools.vscode-documentdb/local/documentdb
vscode://ms-azuretools.vscode-documentdb?connectionString=…            ← legacy, means /connect
vscode://ms-azuretools.vscode-documentdb/connect/azure?resourceId=…&tenantId=…&open=shell
```

## Why this exists

Local Quick Start shipped in 0.10.0: a user can go from nothing to a running local DocumentDB in
one click — **if they already have the extension and know where the button is**. The website is
where the people who do not have it land.

A link that opens the setup wizard closes that gap, and the handler could not express it: `connect`
was the only action, and it rejects any link without a connection string. A "set up DocumentDB
Local" link has no connection string by definition, because the container does not exist yet.

## Code map

- `src/vscodeUriHandler.ts` — route parsing, the action and source allow-lists, argument
  validation, the `connect` implementation, and opening the `open=` surface for both variants
- `src/deepLinks/` — the `/connect/azure` flow: resource ID parsing, sign-in and subscription
  resolution, the ARM read, visibility changes, and `handleAzureResourceLink.ts` tying them together
- `src/tree/discovery-view/discoveryViewHelpers.ts` — `revealInDiscoveryView`, which finds the
  cluster by `azureResourceId` and expands it, which connects it once (D0015)
- `src/extension.ts` — registers it via `vscode.window.registerUriHandler`

## User docs

- [docs/user-manual/how-to-construct-url.md](../../../user-manual/how-to-construct-url.md) — **the
  public contract.** Any change to the vocabulary belongs there in the same PR.

## UX review

- [Iteration 3 review pack](./iterations/03-azure-resource-links-ux-review.md) maps the Azure
  resource and connection-string journeys, shows full dialog details and bundled SRV/sovereign-cloud
  message variants, and places language/consistency suggestions beside each presentation.
  It is source-backed preparation, not evidence of live cloud or workbench verification.

## Architecture (intent — code is authoritative for behavior)

- **The path is the verb; the query is its arguments.** Putting the action in the query would mean
  every reader has to know which keys are the verb and which are its parameters, and would leave
  nowhere to namespace the discovery plugins
  ([0001](./decisions.md#0001--the-action-goes-in-the-path-not-the-query)).
- **An empty path means `connect`, permanently.** Every link published before actions existed has
  an empty path, and a link in a blog post cannot be recalled
  ([0002](./decisions.md#0002--an-empty-path-means-connect-forever)).
- **The action list is a security boundary, not a routing convenience.** It is hand-written and
  never derived from the command registry
  ([0003](./decisions.md#0003--the-action-list-is-hand-written-never-the-command-registry)).
- **An unrecognized action is refused, not defaulted.** Falling back to `connect` would make every
  typo a silent connection attempt against a connection string the user did not mean to use here.
- **Local resource types are explicit and bounded.** `/local` defaults to `documentdb`, while
  `/local/documentdb` names it explicitly. Unknown types and additional qualifiers are rejected
  rather than silently opening the DocumentDB Local wizard
  ([0006](./decisions.md#0006--local-links-model-the-resource-type)).
- **External local links require one lightweight confirmation by default.** The existing URL
  confirmation setting gates it; the wizard itself remains responsible for all provisioning
  decisions
  ([0007](./decisions.md#0007--local-links-show-one-lightweight-confirmation)).
- **Telemetry keeps the `failureStage` / `errorName` shape.** It exists because of issue #655
  ("URL handler error rate at 100%"), and every new branch fills it in.

### Added in iteration 3

- **`/connect/<source>` names how the cluster is located.** `/connect` is a connection string;
  `/connect/azure` is an ARM resource ID, for portal links that cannot carry a connection string.
  Each variant refuses the other's locator
  ([0008](./decisions.md#0008--azure-resource-links-use-connectazure)).
- **Azure links go through our Discovery tree**, not the Azure Resources view, and save nothing to
  the Connections View ([0009](./decisions.md#0009--azure-links-resolve-through-our-discovery-tree)).
- **The resource type picks vCore or RU**; RU must be a MongoDB account
  ([0010](./decisions.md#0010--the-resource-id-selects-vcore-or-ru-we-handle-both)).
- **Hidden resources are made visible permanently**, including the subscription filter shared with
  the Azure Resources extension
  ([0011](./decisions.md#0011--azure-links-change-visibility-filters-permanently)).
- **A quick confirmation first, gated by the setting**, with what the link names, before any
  sign-in or lookup; a second one only when filters must change
  ([0012](./decisions.md#0012--azure-links-confirm-like-local),
  [0016](./decisions.md#0016--the-azure-confirmation-comes-before-the-lookup)).
- **`open=dashboard|shell` on every `/connect` variant**; `dashboard` opens even when the automatic
  dashboard is turned off, and replaces the automatic one for that link ([0013](./decisions.md#0013--open-names-the-surface-dashboard-always-opens),
  [0014](./decisions.md#0014--open-applies-to-connect-as-well)).
- **The cluster node is always expanded**; the expansion is the connect, so authentication runs
  once and the node shows the outcome
  ([0015](./decisions.md#0015--an-azure-link-always-expands-the-cluster-node)).

## Telemetry contract

The optional `source` query parameter identifies where a publisher placed a link, independently of
`deepLinkConnectSource` (how its connection is located). It accepts a single 1-64 character ASCII
label, starting with a letter or digit and containing only letters, digits, hyphens, and underscores.
It is normalized to lowercase and recorded as `deepLinkSource`. `deepLinkSourceStatus` is `valid`,
`absent`, or `invalid`; invalid or repeated tags are ignored and warned about without echoing their
values. Publishers must not put personal information, credentials, resource IDs, or URLs in tags.

- `globalUriHandler.received` records arrival, including malformed routes, before any confirmation
  or network work. `globalUriHandler` records the terminal outcome. Both share a freshly generated
  `deepLinkCorrelationId`; a received event without its terminal event is unfinished, not success.
- `deepLinkOutcome` is `completed`, `canceled`, `connectionFailed`, `destinationFailed`, or `failed`.
  Non-throwing cancellations set framework `result=Canceled`; non-throwing failures set `Failed`.
  Thrown failures retain the framework's own error classification. `lastStage`, `failureStage`,
  `errorReason`, `userCancelledAtStep`, and `openTargetResult` explain where the flow stopped.
- `deepLinkTarget` classifies cluster/database/collection/dashboard/shell/localSetup intent.
  `confirmationsEnabled`, `connectionDisposition` (new/reused saved entry), `connectionReused`
  (cached client), and `connectionSaved` distinguish important variants.
- A connection's `connectionCorrelationId` joins the link to `connect.startup` and its metadata,
  including failed attempts whose clients were evicted. Cluster nodes retain the latest attempt
  ID and cancellation outcome without changing stable cluster IDs or tree identities.
- Dashboard and shell commands return whether a destination actually opened, rather than relying
  on a command resolving without throwing. The terminal link event captures `dashboardSessionId`,
  `shellSessionId`, `collectionSessionId`, or `quickStartSessionId` as applicable. Destination
  host RPC and webview events carry the originating link ID and source; shell startup/evaluation/
  end and wizard step/close events do too. Dashboard reuse keeps the existing panel's original
  attribution and session ID; the new link event records the join and `panelReused`.
- **Completed means navigation/opening completed, not that every destination is fully initialized.**
  Use the correlated `shell.sessionStart` result for worker readiness and the destination's RPC/
  webview results for loading failures. Opening Local setup does not mean provisioning succeeded.
- URI lengths, qualifier/parameter counts, and matching subscription-account count are numeric
  **measurements**, not their former string properties. Existing tree-activation timing and retry
  measurements remain. Phase measurements end in `TimeMs` and accumulate across retries:
  confirmation, Azure sign-in/check, subscription lookup/resolution, ARM resource read, visibility
  computation/application, connection save, tree reveal, and destination opening. Total duration
  remains framework-owned; resolution/reveal phases may include their nested work.
- The existing `visibilityProviderShown`, `visibilityTenantUnfiltered`, and
  `visibilitySubscriptionAdded` flags describe changes **needed**, not completed. Separate
  `visibilityProviderApplied`, `visibilityTenantApplied`, and `visibilitySubscriptionApplied`
  flags record each successful write, even if a later write fails. `visibilityChangesApplied`
  becomes true after the application finishes with changes.

Unit tests cover source validation, explicit outcomes, phase measurements and correlation. They
do not establish backend ingestion or GDPR classification; new fields/events still need those
checks in the telemetry pipeline before dashboard use.

## Timeline

| Date       | What                                                                          |
| ---------- | ----------------------------------------------------------------------------- |
| —          | `connect` shipped as the only mode; dispatch read `uri.query` only            |
| 2026-08-24 | Action switch added in the path; `local` opens the DocumentDB Local wizard    |
| 2026-09-01 | `local` gained a validated resource type and one setting-gated confirmation   |
| 2026-11-05 | Iteration 3 planned: `/connect/azure` for portal links, `open=` (D0008–D0014) |
| 2026-11-05 | Iteration 3 implemented (WI1–WI11); manual verification and release pending   |

## Open gaps

- **Discovery plugin actions are unimplemented.** The handler's original JSDoc anticipated that
  "other modes … will be handled by our discoverability plugins", and five discovery plugins exist
  (`service-atlas-mongodb`, `service-azure-mongo-ru`, `service-azure-mongo-vcore`,
  `service-azure-vm`, `service-kubernetes`). The `/discovery/<provider>` shape once reserved for
  them was dropped: sources are qualifiers of `/connect` instead (D0008). `/connect/azure` covers
  the two Azure Mongo plugins; the other plugins have no link yet.
- **`/connect/azure` is not manually verified.** The manual table in the
  [iteration 3 plan](./iterations/03-azure-resource-links.md#verification) needs a real
  subscription with a vCore cluster and an RU account. The portal button (WI12) is not agreed yet.
- **`connect` still depends on the legacy emulator branch.** `isLegacyEmulatorMigrationComplete()`
  and `ConnectionType.Emulators` are removed by issue
  [#870](https://github.com/microsoft/vscode-documentdb/issues/870), milestone 0.11.0. That work and
  this share a file.
- **No installed-workbench end-to-end test of the `connect` path.** The unit suite now exercises
  storage, duplicate detection, confirmations, and TLS handling with mocks. Real activation,
  tree navigation, focus, and dialog rendering still need the
  [UX walkthrough](./iterations/03-azure-resource-links-ux-review.md).
