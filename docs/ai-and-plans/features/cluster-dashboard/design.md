---
feature: cluster-dashboard
kind: design
status: active
prs: [823]
created: 2026-07-28
code:
    - src/commands/openClusterDashboard/**
    - src/documentdb/utils/getClusterHealth.ts
    - src/webviews/documentdb/clusterDashboard/**
---

# Cluster Dashboard — Design

Feature: a webview page showing cluster health, performance, resource utilization, and status
indicators for at-a-glance operational insight, opened from a cluster node in any tree view.

Status: **design proposal** (no implementation yet).

---

## 1. Research summary — what we learned before designing

### 1.1 The product-family precedent: vscode-pgsql "Server Dashboard"

The Microsoft PostgreSQL extension (ms-ossdata.vscode-pgsql, same extension family, same
React + Fluent UI v9 webview stack as this repo) shipped a preview Server Dashboard that is the
proven VS Code-native pattern:

- Page skeleton: **server details card → action toolbar → tabbed investigation area**.
- **Dual data-source model**: every chart is badged either "System" (live, computed from
  queryable system state — works on _any_ server) or "Azure" (historical, Azure Monitor —
  only for Azure resources with fetched metadata). Time-window selector (1h…30d) applies to
  Azure metrics only; live charts are fixed rolling windows.
- **Graceful degradation is a first-class feature**: groups with no data are hidden; explicit
  states exist for disconnected, "Azure server detected → Fetch Metadata", and insufficient
  RBAC permissions.
- Tabs: Overview (metric chart groups + side navigator), Queries (top-SQL table with detail
  panel), Waits, Sessions (summary cards + table + blocking tree + kill).
- "Ask Copilot" buttons preload dashboard context into agent mode.

Docs: https://learn.microsoft.com/en-us/azure/postgresql/development/vs-code-extension/server-dashboard

### 1.2 MongoDB Compass / Atlas — the content model for wire-protocol dashboards

- Compass Real-Time Performance: four stacked live strip charts (Operations/sec,
  Read & Write queues, Network, Memory — all polled `serverStatus` deltas at ~1 s) above two
  live tables (Hottest Collections via `top`, Slowest Operations via `currentOp` with a
  Kill Op action).
- The standout interaction: **Pause freezes the display only** (sampling continues into a
  ring buffer); while paused, hovering a chart scrubs a shared time cursor and the tables
  re-render to show state _at that instant_.
- Atlas RTPP adds a top strip of stat tiles (Connections, Network, CPU, Disk IOPS, Memory)
  and the **Query Targeting** ratio (scanned : returned) — the single best "are my indexes
  working" signal — plus a table-view fallback (accessibility / low bandwidth).

### 1.3 Azure Data Studio (retired) — the anti-pattern

ADS's user-composable JSON widget grid was powerful but fiddly and poorly discoverable;
Microsoft's replacement direction (pgsql/mssql) is a **curated, zero-config dashboard**.
We should not build a widget-composition system.

### 1.4 The hard constraint: what Azure DocumentDB (vCore) actually supports

From the compatibility matrix (learn.microsoft.com/en-us/azure/cosmos-db/mongodb/vcore/compatibility):

| Command                                              | vCore status                                                                      | Consequence                                                                                                            |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `serverStatus`                                       | ❌ **Not supported**                                                              | Compass-style opcounter/memory/queue charts are impossible on vCore via the driver                                     |
| `top`                                                | ❌ Not supported                                                                  | No "hottest collections by op time"                                                                                    |
| `replSetGetStatus`                                   | ❌ Unreliable (platform-managed topology)                                         | HA state must come from ARM                                                                                            |
| profiler                                             | ❌ Platform-managed                                                               | No profiler tab                                                                                                        |
| `ping`, `hello`, `buildInfo`, `connectionStatus`     | ✅                                                                                | Liveness, latency, version, topology, privileges                                                                       |
| `hostInfo`                                           | ⚠️ **Answers, but empty**                                                         | `{system: {memSizeMB: 0}, os: {name: '', type: ''}}` — no hostname. The header's Host row can never populate on vCore  |
| `dbStats`, `collStats` / `$collStats {storageStats}` | ✅ (size fields approximate for docs < 2 KB)                                      | Storage breakdown, top-N collections                                                                                   |
| `$collStats {latencyStats}`                          | ❌ **Not supported** (`code 115 — collStats with latencyStats not supported yet`) | No per-collection ops/sec or latency histogram; removes the obvious fallback for the Activity group                    |
| `currentOp` / `$currentOp`, `killOp`                 | ✅                                                                                | Active/slowest operations table + kill action                                                                          |
| `getLog`                                             | ⚠️ **Answers, but empty**                                                         | Returns `{totalLinesWritten: 0, log: []}`. A Logs tab would render an empty panel on vCore                             |
| `explain`, `$indexStats`                             | ✅                                                                                | Index-usage / query-efficiency signals — **already consumed by PR #732's Index Management tab**, not by this dashboard |

> **Verified against a live vCore cluster** (M10, server 8.0, July 2026), not only the
> published matrix. Two rows above were previously marked ✅ purely on documentation.
>
> Also observed: `buildInfo` carries no `platform`, but `hello.internal` reports
> `{kind: 'azuredocumentdb', documentdb_versions: [...]}`, which is what the header card now
> shows in place of the two rows vCore leaves empty. And privileges are **not** a proxy for
> capability — the vCore admin role grants the `serverStatus` action while the server
> rejects the command.

The gap is filled the pgsql way: **Azure Monitor metrics** (CPU %, Memory %, Storage %,
IOPS per node) exist for vCore clusters via ARM. Meanwhile genuine MongoDB servers (local
emulator, VMs, FerretDB, RU) may support `serverStatus` — so the design must
**feature-detect, not assume**.

---

## 2. What exists in this repo to build on

- **Webview framework**: `packages/vscode-ext-webview` + `src/webviews/_integration/`
  (tRPC-over-postMessage, `openAppWebview`, `WebviewRegistry`, telemetry middleware).
  Only two panels exist today (`collectionView`, `documentView`); Collection View is the
  reference implementation for state, toolbar-with-overflow, tabs, and error patterns.
- **tRPC subscriptions** (async-generator streaming, `ctx.signal` cancellation) already power
  Query Insights — the natural transport for a live-polling dashboard.
- **`getClusterMetadata`** (`src/documentdb/utils/getClusterMetadata.ts`) already runs
  `buildInfo` / `serverStatus(uptime)` / `hello` / `hostInfo` with per-command try/catch and
  per-client caching — the resilience model and the starting point for a richer health collector.
- **Azure enrichment for free**: `AzureClusterModel` (SKU, node count, disk size, HA, region,
  server version, created-at) is already populated by the discovery/Azure views via ARM —
  no new API calls needed to show it. There is **no Azure Monitor usage yet** (no
  `@azure/arm-monitor` dependency) — that is a Phase-2 addition.
- **Themed metric tiles already exist**: `collectionView/components/queryInsightsTab/components/metricsRow/`
  (`MetricBase`, `CountMetric`, `TimeMetric`, `RatioMetric`, `formatUtils`) — promote to shared
  components rather than rebuilding.
- **Theming**: `DynamicThemeProvider` + `useThemeState()` derive Fluent (and Monaco) themes
  from live VS Code tokens — chart colors must come from here, never hard-coded palettes.

---

## 3. UX design

### 3.1 Principles

1. **Answer "is my cluster healthy?" in one glance, above the fold** — status strip first,
   drill-down below.
2. **Data-plane first, Azure-enriched** — the page must be fully useful for a local emulator,
   a VM, FerretDB, or any MongoDB connection string; Azure ARM data enriches but is never
   required.
3. **Feature-detect and degrade gracefully** — a capability probe on open decides which
   sections render; unsupported sections are hidden (with a subtle "why" affordance), never
   shown broken. Per-tile errors degrade that tile only (the `getClusterMetadata` model).
4. **Curated, not composable** — no widget grid. Settings limited to refresh interval and
   a feature flag.
5. **Actionable, not just observable** — kill op, open playground/shell, open Azure Portal,
   refresh credentials; every table row leads somewhere.
6. **Accessible** — every chart has a table fallback; `Announcer` for async updates; full
   keyboard navigation; theme-token colors pass contrast in light/dark/high-contrast.

### 3.2 Page layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ⚡ contoso-cluster            ● Connected · 12 ms          [PREVIEW badge]  │
│  DocumentDB (vCore) 8.0 · Azure East US · M40 (2 nodes, HA) · up 14 d        │
│──────────────────────────────────────────────────────────────────────────────│
│  [⟳ Refresh] [Auto: 5 s ▾] [⏸ Pause]  |  [New Playground] [Open Shell]      │
│                                       |  [Azure Portal ↗]      [⋯ overflow]  │
│──────────────────────────────────────────────────────────────────────────────│
│  ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────────┐ │
│  │ Latency │ │ Active  │ │ Storage  │ │ Databases│ │ Longest │ │ CPU %    │ │
│  │ 12 ms ▁▂│ │ ops: 3  │ │ 41.2 GB  │ │ 12 / 87  │ │ op 4.2s │ │ (Azure)  │ │
│  │ LIVE    │ │ LIVE    │ │ LIVE     │ │ colls    │ │ LIVE    │ │ 37 % ▂▃▂ │ │
│  └─────────┘ └─────────┘ └──────────┘ └──────────┘ └─────────┘ └──────────┘ │
│──────────────────────────────────────────────────────────────────────────────│
│  [ Overview ]  [ Operations ]  [ Storage ]  [ Logs ]                         │
│  ────────────                                                                │
│  (tab content: chart groups / tables, see below)                             │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Header card** (all data already available at zero marginal cost):
cluster display name, connection state dot, round-trip latency, product + version
(`buildInfo` / `internal.documentdb_versions`), API badge (vCore / RU / Local / Generic),
uptime, user; when the node is Azure-backed: region, SKU, node count, disk, HA badge,
"Open in Azure Portal" deep link.

**Toolbar** (Fluent `Toolbar` with the Collection View overflow pattern):
Refresh · auto-refresh interval menu (Off / 5 s / 15 s / 60 s) · Pause/Resume ·
New Playground · Open Interactive Shell · Copy connection string · Azure Portal (Azure only).

**Status strip**: 4–6 stat tiles reusing the promoted `metricsRow` components, each with a
20–30-sample sparkline and a source badge (`LIVE` / `AZURE`). Tiles: Latency, Active
operations, Storage used, Databases/Collections, Longest-running op; plus CPU % / Memory %
when Azure Monitor is wired (Phase 2). A tile whose probe failed renders an "n/a" state with
a tooltip explaining why — it never disappears mid-session.

### 3.3 Tabs

**Overview** (default) — collapsible chart groups, rendered only if the capability probe
found data:

- _Activity_ — live strip chart of operation counts. On servers with `serverStatus`
  (local/generic MongoDB): true opcounters/sec split by insert/query/update/delete/command
  (Compass model). On vCore: sampled `currentOp` counts by op type + queue depth
  (approximation, labeled as such).
  > **Weaker on vCore than this assumed.** `$collStats {latencyStats}` is unsupported, so
  > there is no per-collection fallback, and sampled `currentOp` at a 5 s cadence
  > systematically misses every operation shorter than the interval — which is most real
  > traffic. Measured on a loaded cluster: 288 reads and 146 writes over 45 s produced at
  > most 4 concurrently visible ops per sample. Either pair it with an observed-operation
  > ring buffer, label the approximation far more explicitly, or lean on Azure Monitor for
  > this group.
- _Connections & Network_ — `serverStatus.connections` where available; otherwise hidden.
- _Resources (Azure)_ — CPU % / Memory % / Storage % / IOPS per node from Azure Monitor,
  with time-window selector (1h/6h/24h/7d) — Phase 2; until then this group shows a
  "Connect Azure metrics" teaser only for Azure clusters.
- _Storage growth_ — total data + index size sampled per refresh (delta over session).

**Operations** — the actionability tab (all vCore-supported):

- Summary tiles: total / active / waiting operations, longest-running.
- Table from `$currentOp`: opid, type, namespace, running time, client, plan summary,
  waiting state. Sortable; filter by namespace/type; slow ops (> threshold) highlighted.
- Row click → right-hand detail panel (command document pretty-printed, Monaco read-only)
  with **Kill Operation** (confirmation via `getConfirmationAsInSettings`, requires
  `killOp` privilege — button disabled with tooltip when missing).
- Guard: cap/paginate `currentOp` payload handling (Atlas documents breakage > 4 MB/sample).

**Storage** — capacity insight (`dbStats` + `$collStats`):

- Horizontal bar breakdown: data size vs index size per database.
- Top-N collections table: documents, avg doc size, data size, index size, index count;
  row action "Open Collection". Footnote for the vCore < 2 KB size-accuracy caveat.
- This tab refreshes on demand / slow cadence (60 s), not the live loop — stats commands
  are heavier.

**Logs** (P2) — recent server log lines, filterable, monospace. ⚠️ **Gate to non-vCore or
cut.** `getLog('global')` succeeds on vCore but returns `{totalLinesWritten: 0, log: []}`,
so the tab would render empty for the primary target platform.

**Explicit non-goals**: no profiler tab (unsupported), no replica-topology visualization on
vCore (ARM `enableHa` badge instead), no user-composable widgets, no historical persistence
beyond the in-session ring buffer (Azure Monitor covers history for Azure clusters).

### 3.4 Refresh & interaction model

- One **tRPC subscription** per open dashboard drives the live loop: host-side async
  generator polls (default 5 s; only cheap commands — `ping`, `hello`, sampled `currentOp`),
  computes deltas against the previous sample, and yields a compact `DashboardSample`.
  Honors `ctx.signal`; stops when the panel disposes.
- **Ring buffer** (last ~5 min of samples) kept host-side in the session object so the
  webview can re-render scrub states cheaply and a re-opened tab back-fills instantly.
- **Pause freezes display only** (Compass model): sampling continues; while paused, hovering
  any chart moves a **synchronized crosshair** across all charts in the tab and the
  Operations summary re-renders for the hovered instant.
- Panel is opened with `retainContextWhenHidden`; the subscription throttles to 30 s when
  the panel reports hidden, resumes on visible.
- **Panel de-duplication**: cache controllers per `clusterId` (note: no dedup exists in the
  framework today — implement in the dashboard factory); re-invoking the command reveals the
  existing panel.

### 3.5 Degradation matrix

| Scenario                               | Behavior                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| vCore (no `serverStatus`)              | Activity group shows currentOp-derived approximation, labeled; Connections group hidden         |
| Local emulator / generic MongoDB       | Full Compass-style Activity + Connections; Azure groups absent                                  |
| RU cluster                             | Probe decides per command; Storage tab and header always work                                   |
| Azure node but no ARM metadata fetched | Header shows data-plane facts; "Fetch Azure details" affordance (pgsql model)                   |
| Insufficient Azure RBAC (Phase 2)      | Resources group shows "View required permissions" state                                         |
| Single command fails mid-session       | That tile/group shows stale-badge + last good sample; error logged once, not toasted repeatedly |
| Disconnected / auth expired            | Full-page state with Retry (reuses tree retry/auth-recovery flow)                               |

---

## 4. Technical design

### 4.1 New files

```
src/webviews/documentdb/clusterDashboard/
  ClusterDashboard.tsx              root component (header, toolbar, tiles, TabList)
  clusterDashboard.scss
  clusterDashboardContext.ts        React context; discriminated-union load states
  clusterDashboardController.ts     openClusterDashboardWebview() → openAppWebview(...)
                                    + per-clusterId panel cache
  clusterDashboardRouter.ts         queries/mutations: getCapabilities, getHeaderInfo,
                                    getStorageStats, getCurrentOps, killOperation
  clusterDashboardEventsRouter.ts   subscription: liveSamples (async generator, ring buffer)
  components/
    HeaderCard.tsx  StatusStrip.tsx  toolbar/DashboardToolbar.tsx
    tabs/{OverviewTab,OperationsTab,StorageTab}.tsx
    charts/{StripChart,Sparkline,BarBreakdown}.tsx   (custom SVG, theme-token colors)
src/commands/openClusterDashboard/openClusterDashboard.ts
src/documentdb/utils/getClusterHealth.ts             sibling of getClusterMetadata:
                                                     capability probe + samplers, per-command
                                                     try/catch, exposed via ClustersClient
src/webviews/components/metricsRow/                  ← promoted from collectionView/queryInsightsTab
```

Registration touch-points: `WebviewRegistry.ts`, `appRouter.ts`
(`clusterDashboard: clusterDashboardRouter`), `ClustersExtension.activateClustersSupport()`
(`registerCommandWithTreeNodeUnwrapping('vscode-documentdb.command.clusterDashboard.open', …)`),
`package.json` (`contributes.commands` with `"icon": "$(pulse)"`, `view/item/context` menu
group `5@2` next to _Open Interactive Shell_, gated on
`viewItem =~ /\btreeitem_documentdbcluster\b/i && !listMultiSelection`), and
`ext.settingsKeys` + `contributes.configuration` for
`documentDB.clusterDashboard.refreshInterval` (+ `documentDB.experimental.clusterDashboard`
flag while in preview).

### 4.2 Router context & identity

`RouterContext = BaseRouterContext & { clusterId, clusterDisplayName, viewId }` — key
everything on **`clusterId`** (stable), never `treeId`. Host side uses
`ClustersClient.getClient(ctx.clusterId)`; `ClusterSession` is not needed (no paging), a
lighter `DashboardSession` holds the ring buffer + poll loop.

### 4.3 Capability probe

On open, `getClusterHealth.probeCapabilities()` attempts each optional command once
(`serverStatus`, `currentOp`, `dbStats`, `getLog`, `top`) with short timeouts, returning
`{ command: 'ok' | 'unsupported' | 'unauthorized' }`. The webview receives this in initial
config and renders only supported sections. Probe result cached per client; re-probed on
manual Refresh-all.

### 4.4 Charts

No charting dependency (bundle is a single chunk; echarts/recharts would add ~300 KB+ and
fight VS Code theming). Build three small SVG components — `Sparkline`, `StripChart`
(stacked/multi-series line with crosshair sync via shared context), `BarBreakdown` — colored
exclusively from `useThemeState()` tokens. This matches the scale of data (≤ 60 points per
series) and guarantees light/dark/high-contrast correctness.

### 4.5 Telemetry, l10n, errors — follow house patterns

`publicProcedureWithTelemetry` for all procedures; dedicated completion event for the
subscription (auto RPC event has ~0 duration — Query Insights precedent);
`accumulateTelemetry` for per-sample counters; all strings `l10n.t(...)`;
webview errors via `trpcClient.common.displayErrorMessage` only for user-initiated actions
(kill op), silent tile degradation otherwise; kill op uses
`registerCommand`-level confirmation via `getConfirmationAsInSettings`.

---

## 5. Phasing

**Phase 1 — MVP (data-plane only, works for every connection)**
Header card + toolbar + status strip; Overview (Activity via feature-detected
serverStatus-or-currentOp, Storage growth); Operations tab with kill op; Storage tab;
capability probe + degradation states; live subscription with pause; panel dedup;
preview flag + telemetry.

**Phase 2 — Azure enrichment**
`@azure/arm-monitor` integration for CPU/Memory/Storage %/IOPS with time-window selector
and RBAC-degradation states; Logs tab (`getLog`); pause-scrub synchronized crosshair.

**Phase 3 — differentiators**
"Ask Copilot" with dashboard context preloaded (pgsql's differentiator; extension already
has Copilot integration); management actions for Azure clusters (scale/restart) if product
approves.

> **Index efficiency is no longer ours to build.** PR #732 (`dev/khelanmodi/index-management-ui`,
> Tomasz Naumowicz) adds an Index Management tab to CollectionView that already reads
> `$indexStats` for per-index usage (`accesses.ops`) and `collStats` for size, with
> per-tier degradation — and `ClustersClient.getIndexStats()` / `getCollectionStats()` are
> already on `main`. There is also an LLM Index Advisor that reasons over
> `executionStats`/`indexStats` to recommend create/drop/hide. Any cluster-scope index view
> here should call the existing APIs and link into that tab, never reimplement it. Coordinate
> with Tomasz before starting.

---

## 6. Open questions

1. **Preview gating** — ship behind `documentDB.experimental.clusterDashboard` (pgsql used
   `pgsql.enableServerDashboard`, default on)? Recommend: flag on by default + PREVIEW badge.
2. **RU clusters** — currentOp/dbStats support on RU differs from vCore; probe handles it,
   but confirm whether RU should get the dashboard at all in Phase 1.
3. ~~**Kill-op RBAC on vCore**~~ — **answered.** `connectionStatus {showPrivileges: true}`
   reports the grants directly: the vCore admin role carries `killop` under
   `resource: {cluster: true}`. The dashboard reads this and disables Kill with an
   explanation only when the privilege is positively absent; an unanswered probe leaves the
   button enabled so the server decides. Note `inprog` is not a named action on vCore at
   all, yet `$currentOp {allUsers: true}` still works there.
4. **Default refresh interval** — 5 s (Compass is ~1 s; 5 s is gentler for cloud clusters);
   confirm with product.
