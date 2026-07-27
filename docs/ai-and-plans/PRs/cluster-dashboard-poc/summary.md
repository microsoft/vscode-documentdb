# PR Summary — Cluster Dashboard (Preview) proof of concept

> PR: _not yet opened_ — when it is, rename this folder to `<number>-cluster-dashboard-poc`
> and add the PR link here, matching the other entries in `docs/ai-and-plans/PRs/`.
>
> **Branch:** `feature/cluster-dashboard-poc` → `main`
> **Base:** `c745a327`
> **Date:** 2026-07-27
> **Status:** POC — demo-ready, not production-ready (see [Not production-ready](#not-production-ready))
>
> Source plan: `docs/ai-and-plans/cluster-dashboard-poc-plan.md` (untracked local doc).
> Target end-state design: `docs/ai-and-plans/cluster-dashboard-design.md` (untracked, pending PM review).
> Reviewer start-here guide: [`reviewer-handoff.md`](./reviewer-handoff.md).

## Goal

Prove out the **Cluster Dashboard** — a webview panel opened from a cluster node showing
health, live activity, and storage at a glance — with the smallest slice that both demos
well and validates the architecture. This is explicitly **not** the full design; it is the
POC that decides whether the full design is worth building.

## Why this shape

Three constraints drove nearly every decision:

1. **Azure DocumentDB (vCore) does not support `serverStatus` or `top`.** That kills the
   Compass-style opcounter / memory / queue charts on the exact platform we care most
   about. So the dashboard cannot assume any command works — it must **feature-degrade
   per sample**, not probe once and branch.
2. **The demo has to be convincing on a laptop.** Everything had to work against the local
   emulator (which _does_ support `serverStatus`) while staying honest on vCore, hence the
   "show `—`, never break" rule for every tile.
3. **The reference implementation already exists.** Collection View
   (`src/webviews/documentdb/collectionView/` + `src/commands/openCollectionView/`) has
   solved panel opening, tRPC wiring, theming, and telemetry. Imitating it was faster and
   lower-risk than inventing anything, and it keeps the eventual production version on a
   path the team already knows.

## Design decisions

### Polling from the webview, not tRPC subscriptions

Query Insights already streams via tRPC subscriptions with a host-side ring buffer, and
the full design calls for that. The POC deliberately uses a plain `setInterval` →
`query()` from the webview instead.

**Why:** the subscription path is only worth its complexity together with the ring buffer,
pause/scrub, and crosshair sync — that is the bulk of the full design. A 5 s poll proves
the data pipeline and the UI without any of it, and the sample history lives in webview
state (last 60 samples ≈ 5 minutes) where the sparklines need it anyway. Closing the panel
tears the interval down with the component, so there is no host-side lifetime to manage.

**Cost:** two independent pollers exist (the health sample and the Operations tab each
query `currentOp`). Consolidating them is the first thing to do post-POC.

### Per-command try/catch, no capability probe

`getClusterHealth.ts` mirrors the resilience model of its sibling `getClusterMetadata.ts`:
each server command runs in its own `try`/`catch`, a failure writes `null` and pushes the
command name into `errors`, and the collector never throws.

**Why not a capability probe RPC:** a probe is a cache with an invalidation problem
(permissions change, failover changes the answer). Degrading per sample costs one failed
command per 5 s on vCore and is always correct. The full design can add caching later
without changing the collector's contract.

The webview reads this directly: `undefined` renders a loading skeleton, `null` renders
"Not available on this server", a number renders the value.

### Confirmation lives on the host

`killOperation` raises `getConfirmationAsInSettings` in the router, not a dialog in the
webview.

**Why:** it inherits the user's configured confirmation style (word / challenge / click)
for free, consistent with `collectionViewRouter.deleteDocumentsById`. A webview-side dialog
would be a second, divergent confirmation UX for a destructive action.

### Custom SVG sparkline instead of a charting dependency

`Sparkline.tsx` is ~85 lines of `<polyline>` normalized to min/max, stroked with
`var(--vscode-charts-*)`.

**Why:** adding a charting library to a POC is a decision that is hard to reverse and
would dominate review. The chart is decorative — the accessible representation is the
numeric value in the tile next to it — so the SVG is `aria-hidden` and needs no axis,
legend, or interaction. If the full design needs crosshairs and scrubbing, that is the
right moment to evaluate a real library.

### Panel de-duplication keyed on `clusterId`

A module-level `Map<string, AppWebviewController<…>>` in the controller; a second
invocation reveals the existing panel.

**Why `clusterId` and not `treeId`:** per the repo's dual-ID rule, `treeId` changes when a
connection is moved into a folder — keying on it would open a duplicate, double-polling
panel for the same cluster after a drag-and-drop.

## What changed (by area)

| Area | Change | Why |
|------|--------|-----|
| Collectors (`src/documentdb/utils/getClusterHealth.ts`) | New. `sampleClusterHealth` (timed `ping`, best-effort `serverStatus`, active-op count), `getStorageStats` (`listDatabases` + parallel `dbStats`, system DBs skipped, 20-DB cap), `listCurrentOperations` (`$currentOp` → legacy `currentOp` fallback), `killOperation`. | One file owns all server interaction, so the degradation rules live in one place and are unit-testable without VS Code. |
| Router (`webviews/documentdb/clusterDashboard/clusterDashboardRouter.ts`) | New. Five procedures; the two polled ones set `actionContext.telemetry.suppressAll`. | A 5 s poll would otherwise emit ~720 telemetry events/hour per open panel. |
| Root router (`webviews/_integration/appRouter.ts`) | Registered `clusterDashboard` as a **top-level** key. | The `mongoClusters` namespace is legacy; new views should not inherit it. |
| Controller (`…/clusterDashboardController.ts`) | New. Factory + `clusterId`-keyed open-panel map, cleared in `onDisposed`. | Re-invoking the menu item reveals rather than duplicates. |
| Registry (`webviews/_integration/WebviewRegistry.ts`) | Added `clusterDashboard: ClusterDashboard`. | Compile-time link between `webviewName` and the root component. |
| Command (`src/commands/openClusterDashboard/openClusterDashboard.ts`) | New. Mirrors `openCollectionView` minus the session (the dashboard is stateless). | No `ClusterSession` needed — nothing is paged or cached per view. |
| Registration (`src/documentdb/ClustersExtension.ts`) | `vscode-documentdb.command.clusterDashboard.open` via `registerCommandWithTreeNodeUnwrapping` + `withTreeNodeCommandCorrelation`, next to the Interactive Shell. | Journey correlation telemetry, consistent with sibling tree commands. |
| Manifest (`package.json`) | Command (`$(pulse)`, "Show Cluster Dashboard (Preview)"), `view/item/context` at `5@2` on cluster nodes in all four tree views, `commandPalette` `when: never`. | Sits directly under Open Interactive Shell; hidden from the palette because it needs a tree node. |
| Webview UI (`…/clusterDashboard/*`) | Root + SCSS + `HeaderCard`, `StatusStrip`, `Sparkline`, `OverviewTab`, `OperationsTab`, `StorageTab`, `formatUtils`. | Plain `useState` in the root with prop drilling — no context at this size. |
| l10n | Regenerated bundle, +57 keys. | All user-facing strings go through `l10n.t(...)`. |

### Notable UI details

- **`metricsRow` is imported across view folders** from Query Insights, with a
  `TODO(dashboard)` marker. Promoting it to `src/webviews/components/` is deferred so the
  POC diff does not touch Collection View.
- **Sparklines appear on 2 of the 4 tiles.** Latency and Active Operations have a time
  series; Storage Used and Databases/Collections are point-in-time (storage is fetched on
  mount and manual refresh, not polled), so a sparkline there would be fabricated. The
  `Sparkline` is therefore optional per tile.
- **Stale indicator:** two consecutive failed polls dim the whole status strip and flip the
  header badge to "Disconnected", rather than blanking the charts — a transient error
  should not erase five minutes of history.

## Bug found by live testing

Two separate things were inflating the Active Operations tile on an idle cluster:

1. `$currentOp` reports the server's own background threads (`Checkpointer`,
   `JournalFlusher`) as `op: "none"` against an empty namespace.
2. `$currentOp` also reports **the very aggregation issuing it**, so the dashboard was
   watching itself — the tile floored at 1, the sparkline was a flat line at 1, and the
   Operations tab carried a permanent phantom row whose Kill button would have terminated
   the dashboard's own poll.

Both are now filtered (`EXCLUDE_BACKGROUND_THREADS` as a `$match` **before** `$limit`, so
background threads cannot consume the result budget and hide real user operations on a
busy server; `isSelfInspectionQuery` for the self-op). Verified live: an idle cluster now
reports `activeOperations = 0`, and a long-running `$where` scan is still listed and
killable.

`mapCurrentOp` also falls back to the connection description (`desc`, e.g. `conn4`) for
the client column when `client`/`appName` are absent.

## Corrections to the source plan

The plan's code skeletons were verified against source before use; two were wrong:

| Plan said | Actual | Source |
|-----------|--------|--------|
| `controller.isDisposed()` | `isDisposed` is a **getter**, not a method | `packages/vscode-ext-webview/src/host/WebviewController.ts:384` |
| `ctx.telemetry.suppressAll` | `ctx.actionContext.telemetry.suppressAll` on a `WithTelemetry<RouterContext>` | `webviews/_integration/trpc.ts`, call site `collectionViewRouter.ts:684` |

## Verification

All PR-checklist steps pass: `npm run l10n` (idempotent), `npm run prettier`,
`npm run lint`, `npm run jesttest` (2684 tests / 160 suites), `npm run build`, plus both
webpack bundles.

The interactive F5 walkthrough could not be run in the authoring environment, so the risky
half was verified against a live `mongo:7` container instead:

- Collectors returned latency, uptime, connections, opcounters, and storage with zero errors.
- **Kill Operation proven end to end:** a long-running `$where` scan appeared in the
  operations list, `killOperation` terminated it (`Interrupted`), and it was gone on the
  next poll.
- **No host code in the webview bundle** — the type-only imports of `ClusterHealthSample`
  et al. from `src/documentdb/` are fully elided by the bundler, so the plan's stated risk
  about cross-boundary imports did not materialize and no shared `types.ts` was needed.

Unit tests (`getClusterHealth.test.ts`, 10 cases) cover the resilience contract
specifically: a rejecting `serverStatus` still yields a latency reading with
`'serverStatus'` in `errors`; both `currentOp` forms failing yields an empty list plus both
command names; a failing per-database `dbStats` does not lose the other databases.

## Not production-ready

Known gaps a reviewer should weigh before this is more than a demo:

- **Visual layout is unverified.** Every component type-checks and the SCSS compiles, but
  nothing has been seen rendered. Two panels side by side, reveal-on-reinvoke, and
  light↔dark re-theming are implemented but unobserved.
- **vCore is untested.** No vCore cluster was available. `serverStatus` is expected to fail
  there; the `$currentOp` → `currentOp` → permissions-empty-state chain is implemented and
  unit-tested but never exercised against real vCore. This is the single most important
  thing to try before showing the dashboard to anyone on Azure.
- **Duplicate `currentOp` polling** between the health sample and the Operations tab, and
  neither loop pauses while the panel is hidden.
- **Refresh interval is a constant** (`DASHBOARD_REFRESH_INTERVAL_MS = 5000`), not a setting.
- **Connection lifecycle is not wired up.** Deleting or re-authenticating a connection does
  not close or invalidate an open dashboard (`removeConnection` clears credentials but does
  not call `deleteClient`), and the dedup path returns the existing panel without refreshing
  its title, so a renamed connection keeps a stale tab title.
- **The router calls `ClustersClient.getClient` directly**, bypassing
  `ClusterItemBase.beforeCachedClientConnect()`. Kubernetes port-forward setup therefore
  never runs for a dashboard, so a k8s cluster (whose node does carry the context value the
  menu item keys on) will fail to connect even though the tree works.

## Out of scope (deferred to post-POC)

Per the plan's §5, and unchanged here: tRPC subscription streaming + host-side ring buffer,
pause/scrub with a shared time cursor, Azure Monitor / ARM metrics and `AzureClusterModel`
header enrichment (SKU, node count, HA), capability-probe caching,
`documentDB.clusterDashboard.*` settings, the Logs tab, the index-efficiency card, Copilot
integration, promoting `metricsRow` to shared components, and test coverage beyond the
sampler's resilience contract.

See `cluster-dashboard-design.md` for the target end-state.
