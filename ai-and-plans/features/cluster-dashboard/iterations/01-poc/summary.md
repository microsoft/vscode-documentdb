---
feature: cluster-dashboard
kind: iteration
status: historical
prs: [823]
created: 2026-07-27
---

# PR Summary — Cluster Dashboard (Preview) proof of concept

> **PR:** [#823](https://github.com/microsoft/vscode-documentdb/pull/823)
> **Branch:** `feature/cluster-dashboard-poc` → `main`
> **Base:** `c745a327` · **Diff:** 21 files, +2871 / −0 · 9 commits
> **Date:** 2026-07-27
> **Status:** POC — demo-ready, not production-ready (see [Not production-ready](#not-production-ready))
> **Review:** one full round applied — see [Review round 1](#review-round-1-applied)
>
> Source plan: [`implementation-plan.md`](./implementation-plan.md).
> Target end-state design: [`../../design.md`](../../design.md) (pending PM review).
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

### Confirmation lives on the host, and the result is reported honestly

`killOperation` raises `getConfirmationAsInSettings` in the router, not a dialog in the
webview.

**Why:** it inherits the user's configured confirmation style (word / challenge / click)
for free, consistent with `collectionViewRouter.deleteDocumentsById`. A webview-side dialog
would be a second, divergent confirmation UX for a destructive action.

Two consequences shaped the final shape of the procedure:

- **`killOp` acknowledges the request, not a match.** The server replies `{ok: 1}` whether
  or not an operation was found, so the UI cannot claim an operation "has been killed". The
  procedure returns a four-way `outcome` (`requested` / `cancelled` / `gone` / `failed`) and
  the toast says "Kill request sent".
- **The prompt blocks indefinitely** (`ignoreFocusOut: true`) while the table keeps
  refreshing underneath it, so an opid captured at click time can be recycled onto a
  different operation before the user confirms. The operation is re-checked immediately
  before the kill. The word-confirmation style also _throws_ `UserCancelledError` on Escape
  rather than returning `false`, which is caught and mapped to `cancelled`.

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

| Area                                                                      | Change                                                                                                                                                                                                                                                                  | Why                                                                                                                     |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Collectors (`src/documentdb/utils/getClusterHealth.ts`)                   | New. `sampleClusterHealth` (timed `ping`, best-effort `serverStatus`, active-op count), `getStorageStats` (`listDatabases` + parallel `dbStats`, system DBs skipped, 20-DB cap), `listCurrentOperations` (`$currentOp` → legacy `currentOp` fallback), `killOperation`. | One file owns all server interaction, so the degradation rules live in one place and are unit-testable without VS Code. |
| Router (`webviews/documentdb/clusterDashboard/clusterDashboardRouter.ts`) | New. Five procedures; the two polled ones set `actionContext.telemetry.suppressAll`.                                                                                                                                                                                    | A 5 s poll would otherwise emit ~720 telemetry events/hour per open panel.                                              |
| Root router (`webviews/_integration/appRouter.ts`)                        | Registered `clusterDashboard` as a **top-level** key.                                                                                                                                                                                                                   | The `mongoClusters` namespace is legacy; new views should not inherit it.                                               |
| Controller (`…/clusterDashboardController.ts`)                            | New. Factory + `clusterId`-keyed open-panel map, cleared in `onDisposed`.                                                                                                                                                                                               | Re-invoking the menu item reveals rather than duplicates.                                                               |
| Registry (`webviews/_integration/WebviewRegistry.ts`)                     | Added `clusterDashboard: ClusterDashboard`.                                                                                                                                                                                                                             | Compile-time link between `webviewName` and the root component.                                                         |
| Command (`src/commands/openClusterDashboard/openClusterDashboard.ts`)     | New. Mirrors `openCollectionView` minus the session (the dashboard is stateless).                                                                                                                                                                                       | No `ClusterSession` needed — nothing is paged or cached per view.                                                       |
| Registration (`src/documentdb/ClustersExtension.ts`)                      | `vscode-documentdb.command.clusterDashboard.open` via `registerCommandWithTreeNodeUnwrapping` + `withTreeNodeCommandCorrelation`, next to the Interactive Shell.                                                                                                        | Journey correlation telemetry, consistent with sibling tree commands.                                                   |
| Manifest (`package.json`)                                                 | Command (`$(pulse)`, "Show Cluster Dashboard (Preview)"), `view/item/context` at `5@2` on cluster nodes in all four tree views, `commandPalette` `when: never`.                                                                                                         | Sits directly under Open Interactive Shell; hidden from the palette because it needs a tree node.                       |
| Webview UI (`…/clusterDashboard/*`)                                       | Root + SCSS + `HeaderCard`, `StatusStrip`, `Sparkline`, `OverviewTab`, `OperationsTab`, `StorageTab`, `formatUtils`.                                                                                                                                                    | Plain `useState` in the root with prop drilling — no context at this size.                                              |
| l10n                                                                      | Regenerated bundle, +68 keys.                                                                                                                                                                                                                                           | All user-facing strings go through `l10n.t(...)`.                                                                       |

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

## Review round 1 (applied)

A full review of the 14 new files produced 21 findings. All were re-verified against
source before acting; 19 were fixed in `3396eaa6`, 2 were deferred as architectural, and
2 review claims were themselves corrected. Test count went 2684 → 2692.

### The finding that mattered

`$currentOp` reports **the very aggregation issuing it**. `isUserOperation` accepted it, so
the dashboard was watching itself: Active Operations floored at 1 on an idle cluster, the
sparkline was a flat line at 1, and the Operations tab carried a permanent phantom row
whose Kill button would have terminated the dashboard's own poll.

This had been _visible in the original live-test output_ — the smoke run printed
`first op: {"namespace":"admin.$cmd.aggregate", ...}` next to `activeOperations: 1` — and
was misread as a background thread. The earlier claim in this document that an idle cluster
showed "3 background threads" was wrong: it was 2 threads **+ the self-op**. Corrected in
[Bug found by live testing](#bug-found-by-live-testing) above.

### Fixed

| #   | Finding                                                                                                                                                                  | Fix                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1   | Dashboard counts and lists its own poll                                                                                                                                  | `isSelfInspectionQuery` drops it on both the aggregation and legacy paths    |
| 2   | `Number(opid)` corrupts int64 ids and breaks vCore string opids (`'0x1A'`→26, `'1e3'`→1000, `'9007199254740993'`→…992 — a _different_ operation)                         | Carry `opidIsNumeric` from the server's reported type instead of re-deriving |
| 3   | Every kill reported success; cancelling showed "Failed to kill"                                                                                                          | Four-way `outcome`; `UserCancelledError` caught                              |
| 4   | `$limit` ran before the user-op filter, so background threads could starve real ops out of the budget on a busy server                                                   | Filter moved into a `$match` **before** `$limit`                             |
| 5   | Opid goes stale across the blocking prompt; `key={opid}` collides when opid is `''`                                                                                      | Re-check before killing; composite React key                                 |
| 6   | No `CredentialCache` precondition — a never-expanded connection error-looped every 5 s                                                                                   | Guard copied from `openInteractiveShell`                                     |
| 9   | Neither poller had an in-flight guard; a 30 s `serverSelectionTimeoutMS` against a 5 s interval stacked requests                                                         | `inFlightRef` on both loops                                                  |
| 10  | "vCore does not support serverStatus" rendered during the first ~5 s on _every_ server                                                                                   | Distinguish "Collecting…" from unsupported                                   |
| 11  | Total used `listDatabases.totalSize` (counts `admin`/`local`/`config` and capped-out DBs) but was rendered as the total of the user-DB table                             | Sum the rendered rows; report `omittedDatabaseCount`                         |
| 12  | "Topology" read `hello.msg`, a mongos-only marker → every standalone/emulator/replica-set primary rendered the literal word "unknown"                                    | Derive from `topology_numberOfServers`                                       |
| 13  | `StorageTab` never read `storageStats.errors` — a permission failure rendered as "No user databases"                                                                     | Surface errors and the omission notice                                       |
| 14  | A hard RPC failure left the spinner forever with Refresh unreachable inside the non-null branch                                                                          | Toolbar hoisted out; failure surfaced in a `MessageBar`                      |
| 15  | Sparkline filtered `null` instead of drawing gaps, so an outage rendered as a healthy line and earlier points shifted each poll; a flat series drew at the _bottom_ edge | Segment into contiguous runs; centre flat series                             |
| 16  | Storage tiles were frozen for the panel's lifetime while sitting in the "live" strip                                                                                     | Storage refreshes on a slow cadence (12× the health tick)                    |
| P3  | Bare `catch {}` discarded every error object, so with telemetry suppressed the PR's own #1 risk (vCore) was undiagnosable                                                | `describeCommandFailure` records `name: reason`                              |
| P3  | `sizeOnDisk ?? …` never fell back when the server reported `0`                                                                                                           | `??=` with a comment on why `\|\|` would be wrong                            |
| P3  | `'{count} operations are running.'` unpluralized                                                                                                                         | Repo's `{countOne}` / `{countMany}` convention                               |

### Corrections to the review

- **"`if (!confirmed)` is dead code" is overstated.** It is unreachable only for the _word_
  confirmation style; the number-quiz and click styles return `false` normally. The UX bug
  was real and is fixed, but the branch was kept.
- The "3 entries on an idle cluster" miscount originated in this document, not in the
  reviewer's reading of it.

### Deferred (architectural — see [Not production-ready](#not-production-ready))

- **`beforeCachedClientConnect()` on the polling path** — _open path since fixed._ Opening the
  dashboard now goes through `ClusterItemBase.connect()`, which runs the hook before reusing a
  cached client, so a Kubernetes ClusterIP tunnel is established when the panel opens even if
  the node was never expanded. What remains is the **refresh path**: the router resolves its
  client through `ClustersClient.getClient(clusterId)`, a static map lookup that holds no tree
  node and therefore cannot re-run the hook. If the tunnel dies while the panel is open — pod
  restart, host sleep/resume, a network blip — every subsequent poll fails against a dead local
  port and nothing re-establishes it; the user's only recovery is to close and reopen the panel.
  Fixing it properly needs transport liveness to be owned by something the router can reach
  rather than by a tree node (see [#739](https://github.com/microsoft/vscode-documentdb/issues/739),
  which raises the same seam from the plugin-API side).
- **No connection-lifecycle invalidation**: `removeConnection` clears credentials but never
  calls `deleteClient`, so a deleted connection keeps polling; `updateCredentials` _does_
  call it, so the next poll silently re-runs the full handshake. Confirmed real, and
  **pre-existing on `main`** rather than introduced here — `removeConnection` is the only
  lifecycle site that omits the call, which nothing could observe until a surface started
  polling. The one-line fix belongs next to the existing `deleteCredentials` call in
  `removeConnection.ts`, not in this PR.

Both are deliberately documented rather than fixed badly.

### Tests that asserted the buggy behaviour

Three were inverted rather than preserved (self-op kept, opid coercion, `totalSize` 303 vs
the 300 the rows sum to). New coverage was added for what had none: a failing ping (the
value the whole connection-state machine keys on), `$match`-before-`$limit` ordering, opid
type preservation, and the zero-size fallback.

## Review round 2 — layout feedback (applied)

Feedback from Tomasz, in chat, after using the POC. Each item and what was done:

| Feedback                                                                                                                                                                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "how about trying this layout from query insights, like 2/3 – 1/3 … the top row full width, an icon/logo and the cluster name as title, and the subtitle the real address" | The panel is now a full-width identity band (icon · name / address · connection state), a full-width action bar, then Query Insights' own two-column `contentArea`: the tiles and the tabbed lists at 66%, the cluster facts and topology at 33%. Below 1000px the columns stack, matching Query Insights' breakpoint exactly.                                                                                                                                                        |
| "the filter databases input box changes size when selected — should be on the left, look at index filtering"                                                               | The Data tab's toolbar is now the index list's row verbatim: the box is first and fills the width (`flex: 1 1 auto`, `max-width: none`), Refresh is pinned right. That flex basis is also the fix for the jump — a SearchBox sized by its own content grows the moment focus adds its dismiss button.                                                                                                                                                                                 |
| "then we can integrate that feedback vehicle as well in there"                                                                                                             | The Query Insights feedback pair now sits at the foot of the right column, asking about the dashboard. `FeedbackCard`/`FeedbackDialog` gained optional copy props (defaulting to today's exact strings, so Query Insights' own keys are untouched) rather than being forked — a second copy of the consent flow and privacy notice is the last thing this should grow. Gated on `feedbackSignalsEnabled`, computed in `openClusterDashboard` exactly as `openCollectionView` does it. |
| "the open shell, export diagnostics can be in the top row, look at the new collection view"                                                                                | Moved into a `primaryActionBar actionBarToolbar` Fluent `Toolbar` at the top, the same chrome the Indexes tab uses for Create Index / Refresh. Room for the tools that come next.                                                                                                                                                                                                                                                                                                     |
| "for the size bars please copy the ones from the index list … I'm not going for the 'gray' background because that feels like once it's fully blue, the space is used up"  | New `RelativeSize`: right-aligned figure, 32px bar, `--vscode-focusBorder`, 20% floor for a non-zero value — the index list's geometry, and **no track**. A track reads as capacity, and nothing here knows the provisioned disk.                                                                                                                                                                                                                                                     |
| "things like this can't happen \[screenshot of a name printing over the size column] — always check with resizing and make them clip, ellipsis etc."                       | Both tables are `table-layout: fixed` with a `<colgroup>`; only the name column absorbs slack and it truncates with a tooltip. Below the table's minimum the region scrolls sideways instead of clipping. Verified at 520 / 760 / 1080 / 1400px.                                                                                                                                                                                                                                      |
| "how can we learn more about collections? … if we had collections available, we could have an option of opening the collection view from there"                            | Database rows expand into a per-collection breakdown (size, documents, indexes/size) with an Open button per row wired to the existing `openNamespace` procedure. Loaded on expand — `collStats` is one round trip per collection.                                                                                                                                                                                                                                                    |
| "let's unify here, if 'databases / collections', then 'Indexes count / size' or similar"                                                                                   | The tile is now **Indexes / Size → `37 / 62.51 MB`**, the same label-names-both-figures shape as Databases / Collections.                                                                                                                                                                                                                                                                                                                                                             |
| "explore whether we can say something about the topology, like list some servers that are behind the scenes, what machines these are — just a dirty draft"                 | New `getClusterTopology` + a right-column card, marked **Draft** on its face. `hello` gives the address list everywhere; `replSetGetStatus` adds role / health / uptime where it is allowed; `listShards` covers mongos; `hostInfo` gives the machine line. Nothing is invented — a platform that hides its topology gets one row, which is the honest answer.                                                                                                                        |

One item is **not** done, deliberately: "we'll unify the style like the logo/icon size and
title/subtitle across tabs." There is nothing to unify against yet — the Collection View's
header band is its tab strip, with no icon/title/subtitle. This header establishes the
pattern (36px icon tile, 18px title, `fontSizeBase200` muted subtitle) and uses a Fluent
glyph as the placeholder for the product mark; unifying the other tabs to it is a separate
change, and the icon asset should be settled first.

Two things the feedback did not ask for but the layout forced:

- **`MetricsRow` sizes itself from viewport media queries**, which is wrong once the tiles
  live in a two-thirds column: at a ~1080px panel the viewport says "four columns" while
  the column fits two, and the last tile clipped mid-value. The dashboard re-states the
  same 1 → 2 → 4 progression as a **container query** on the left column, with the 4-column
  step at 860px rather than 800 — the widest value here is a pair (`37 / 62.53 MB`) and
  needs ~205px of tile.
- **Facts in the narrow column wrap rather than truncate.** A clipped host name is
  unusable and, unlike a table cell, `GenericCell` has nowhere to hang a tooltip.

### How the layout was checked

The webview was bundled against fixtures (long database names, a `dbStats` failure, a view,
an unhealthy replica-set member) and rendered in Chromium inside a width-controlled iframe
at 520 / 760 / 1080 / 1400px. Exercised there: sort, filter (including the focus-resize the
feedback reported), expand-to-collections, the tab switch, and the feedback dialog. The
harness was scratch tooling and is not part of the diff. This is a layout check only — it
does not replace an F5 run against a live cluster.

## Corrections to the source plan

The plan's code skeletons were verified against source before use; two were wrong:

| Plan said                   | Actual                                                                        | Source                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `controller.isDisposed()`   | `isDisposed` is a **getter**, not a method                                    | `packages/vscode-ext-webview/src/host/WebviewController.ts:384`          |
| `ctx.telemetry.suppressAll` | `ctx.actionContext.telemetry.suppressAll` on a `WithTelemetry<RouterContext>` | `webviews/_integration/trpc.ts`, call site `collectionViewRouter.ts:684` |

## Verification

All PR-checklist steps pass: `npm run l10n` (idempotent), `npm run prettier`,
`npm run lint`, `npm run jesttest` (**2692 tests / 160 suites**), `npm run build`, plus both
webpack bundles.

The interactive F5 walkthrough could not be run in the authoring environment, so the risky
half was verified against a live `mongo:7` container instead — once when the POC landed,
and again after the review fixes:

```
IDLE activeOperations = 0        (was 1: the dashboard's own poll)
BUSY ops = … 1106/query/smokedb.items
kill acknowledged = true | opidIsNumeric = true
slow query outcome = killed: Interrupted
STORAGE total = 8192 | rowSum = 8192 | reconciles = true
```

- **The self-op fix is confirmed empirically**, not just by unit test: an idle cluster now
  reports zero active operations.
- **Kill Operation proven end to end:** a long-running `$where` scan appears in the list,
  is terminated (`Interrupted`), and is gone on the next poll — with the opid type
  correctly detected as numeric.
- **The storage total reconciles** with the sum of the rendered rows.
- **No host code in the webview bundle** — the type-only imports of `ClusterHealthSample`
  et al. from `src/documentdb/` are fully elided by the bundler, so the plan's stated risk
  about cross-boundary imports did not materialize and no shared `types.ts` was needed.

Unit tests (`getClusterHealth.test.ts`, 18 cases) cover the resilience contract
specifically: a rejecting `serverStatus` still yields a latency reading with the _reason_
preserved; a failing ping yields the `null` latency the connection-state machine keys on;
both `currentOp` forms failing yields an empty list plus both command names; the `$match`
provably precedes the `$limit`; a numeric-looking string opid is not coerced; a failing
per-database `dbStats` does not lose the other databases.

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

See [`../../design.md`](../../design.md) for the target end-state.
