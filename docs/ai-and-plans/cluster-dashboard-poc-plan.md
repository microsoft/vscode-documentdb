# Cluster Dashboard — POC Implementation Plan

Goal: a working proof-of-concept of the Cluster Dashboard webview to demo to management.
This is **not** the full design (see `cluster-dashboard-design.md` — still pending PM review);
it is the smallest slice that demos well and proves the architecture.

Audience: an implementing agent. Every referenced API below was verified against the code
on 2026-07-27; follow existing patterns over inventing new ones. The reference
implementation to imitate throughout is **Collection View**
(`src/webviews/documentdb/collectionView/` + `src/commands/openCollectionView/`).

---

## 1. POC scope

### What the demo shows (demo script)

1. Right-click a cluster in the **Connections** view → **Show Cluster Dashboard (Preview)**.
2. A themed webview panel opens:
   - **Header card**: cluster name, green "Connected" dot, engine + version, uptime, host.
   - **Status strip**: 4 live metric tiles with sparklines — Latency (ms), Active
     Operations, Storage Used, Databases/Collections — refreshing every 5 s.
   - **Tabs**: *Overview* (latency + activity sparkline charts), *Operations* (live
     `currentOp` table with a working **Kill Operation** button), *Storage* (per-database
     size table + top collections by size).
3. Run a long query from the Interactive Shell / playground → it appears in the Operations
   tab → kill it from the dashboard.
4. Works against both the local emulator and an Azure DocumentDB (vCore) cluster
   (tiles that a server can't answer show "—" instead of breaking).

### In scope

- New webview panel `clusterDashboard` + tRPC router + open command (context menu on
  cluster items in all tree views).
- Health sampler on the host with **per-command try/catch** (`ping`, `hello`, `buildInfo`,
  `serverStatus` best-effort, `currentOp`, `dbStats`, `listDatabases`).
- Simple webview-side polling (`setInterval` → tRPC query). Samples accumulate in webview
  state (last 60).
- Kill op with confirmation dialog.
- Panel de-duplication per cluster (re-invoking reveals the existing panel).
- Theme-token SVG sparklines (no charting dependency).

### Out of scope (POC — deliberately)

- tRPC subscription streaming, host-side ring buffer, pause/scrub, crosshair sync.
- Azure Monitor / ARM metrics, Azure header enrichment (SKU/nodes/HA).
- Logs tab, index-efficiency card, Copilot integration.
- New user settings (refresh interval hardcoded to 5000 ms constant).
- Capability probe RPC (POC degrades per-sample instead).
- Unit tests beyond one test for the sampler's error resilience.

---

## 2. Architecture recap (how a webview works in this repo)

- One webpack bundle (`src/webviews/index.tsx` → `dist/views.js`) serves all panels; the
  panel's `viewType` selects the root component via
  `src/webviews/_integration/WebviewRegistry.ts`. **No lazy chunks** —
  `LimitChunkCountPlugin({maxChunks:1})`.
- Host ↔ webview communication is tRPC v11 over postMessage. The single root router is
  `src/webviews/_integration/appRouter.ts`; per-view routers live **next to the view**.
- Panels are opened with `openAppWebview(...)` from
  `src/webviews/_integration/openAppWebview.ts` (returns a `WebviewController` handle with
  `panel`, `onDisposed`, `revealToForeground`, `dispose`, `isDisposed`).
- Webview side: `useConfiguration<T>()` gives the initial config,
  `useTrpcClient()` gives the typed client. UI is React 18 + Fluent UI v9
  (`@fluentui/react-components`); theming via the existing `DynamicThemeProvider` wrapper
  (automatic — root components don't wrap themselves).

**Hard rules**

- `src/webviews/_integration/trpc.ts` is a leaf module — per-view routers import
  `publicProcedure(WithTelemetry)/router` from `./trpc` (or the re-exports in
  `appRouter.ts`), and must never create an import cycle back into `appRouter.ts`.
- Cache keys are always `clusterId` (stable), never `treeId`.
- All user-visible strings go through `l10n.t(...)` (`import * as l10n from '@vscode/l10n'`).
- Chart/tile colors come from Fluent theme tokens (`tokens` from
  `@fluentui/react-components`) or `var(--vscode-*)` CSS variables — never hardcoded hex.
- New TS files start with the standard Microsoft copyright header (copy from any file).

---

## 3. Work items

Build in this order; each item compiles independently.

### WI-1: Health sampler (host)

**New file** `src/documentdb/utils/getClusterHealth.ts`

Model it on the sibling `getClusterMetadata.ts` (same per-command try/catch resilience:
a failed command writes `null`/an `…Error` field, never throws).

```ts
import { type MongoClient } from 'mongodb';

export interface ClusterHealthSample {
    timestampMs: number;          // Date.now() at sample start
    pingLatencyMs: number | null; // timed admin {ping: 1}
    uptimeSeconds: number | null; // serverStatus.uptime, best-effort
    connectionsCurrent: number | null;   // serverStatus.connections.current, best-effort
    opcounters: Record<string, number> | null; // serverStatus.opcounters, best-effort (null on vCore)
    activeOperations: number | null;     // count from currentOp
    errors: string[];             // command names that failed this sample
}

export interface ClusterStorageStats {
    databases: Array<{
        name: string;
        sizeOnDiskBytes: number | null;   // from listDatabases
        dataSizeBytes: number | null;     // dbStats.dataSize
        indexSizeBytes: number | null;    // dbStats.indexSize
        collections: number | null;       // dbStats.collections
        objects: number | null;           // dbStats.objects
    }>;
    totalSizeBytes: number | null;
}

export interface CurrentOpEntry {
    opid: string;                 // stringified — vCore opids are strings, MongoDB's are numbers
    type: string;                 // op field: query/insert/update/remove/command/getmore/none
    namespace: string;
    secsRunning: number | null;
    active: boolean;
    clientDescription: string | null;  // client / appName if present
    commandPreview: string;       // JSON.stringify(op.command).slice(0, 2000)
}

export async function sampleClusterHealth(client: MongoClient): Promise<ClusterHealthSample>;
export async function getStorageStats(client: MongoClient): Promise<ClusterStorageStats>;
export async function listCurrentOperations(client: MongoClient): Promise<CurrentOpEntry[]>;
export async function killOperation(client: MongoClient, opid: string): Promise<void>;
```

Implementation notes:

- `const adminDb = client.db().admin();` then `adminDb.command({ ping: 1 })` timed with
  `performance.now()`; `adminDb.command({ serverStatus: 1 })` in its own try/catch —
  **expected to fail on vCore**, that's fine (fields stay null, push `'serverStatus'` into
  `errors`).
- `currentOp`: use `client.db('admin').aggregate([{ $currentOp: { allUsers: true, idleConnections: false } }])`
  with a `.toArray()` capped via `$limit: 100`; fall back to
  `adminDb.command({ currentOp: 1 })` if the aggregation fails. Coerce `opid` with
  `String(op.opid)`. Never serialize the raw result to the webview — map to
  `CurrentOpEntry` (this also keeps payloads far below the 4 MB failure mode Atlas
  documents for currentOp).
- `dbStats`: enumerate via `adminDb.listDatabases()`, skip `admin`/`local`/`config`, then
  `client.db(name).command({ dbStats: 1 })` per db, each in try/catch. Cap at 20 databases
  for the POC.
- `killOp`: `adminDb.command({ killOp: 1, op: /* number if numeric, else string */ })` —
  try `Number(opid)` first, pass the string as-is if `Number.isNaN`.
- No caching in this module; callers decide cadence.
- **Unit test** `src/documentdb/utils/getClusterHealth.test.ts` (co-located, Jest): mock a
  MongoClient whose `serverStatus` command rejects — assert the sample still resolves with
  `pingLatencyMs` set and `'serverStatus'` in `errors`.

### WI-2: tRPC router (host)

**New file** `src/webviews/documentdb/clusterDashboard/clusterDashboardRouter.ts`

Copy the structure/ctx-cast idiom from `collectionViewRouter.ts` (see its `RouterContext`
doc comments for the clusterId/viewId semantics):

```ts
import { z } from 'zod';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import {
    sampleClusterHealth, getStorageStats, listCurrentOperations, killOperation,
} from '../../../documentdb/utils/getClusterHealth';
import { getConfirmationAsInSettings } from '../../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../../utils/dialogs/showConfirmation';
import { publicProcedureWithTelemetry, router, type WithTelemetry } from '../../_integration/trpc';
import { type BaseRouterContext } from '../../_integration/appRouter';

export type RouterContext = BaseRouterContext & {
    clusterId: string;
    clusterDisplayName: string;
    viewId: string;
};

export const clusterDashboardRouter = router({
    getClusterInfo: publicProcedureWithTelemetry.query(async ({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        const client = await ClustersClient.getClient(myCtx.clusterId);
        const metadata = await client.getClusterMetadata(); // cached; buildInfo/hello/hostInfo fields
        return { clusterDisplayName: myCtx.clusterDisplayName, metadata };
    }),
    getHealthSample: publicProcedureWithTelemetry.query(async ({ ctx }) => {
        const myCtx = ctx as WithTelemetry<RouterContext>;
        myCtx.telemetry.suppressAll = true; // fires every 5 s — do not spam telemetry
        const client = await ClustersClient.getClient(myCtx.clusterId);
        return sampleClusterHealth(client.getMongoClient());
    }),
    getStorageStats: publicProcedureWithTelemetry.query(/* same shape */),
    getCurrentOperations: publicProcedureWithTelemetry.query(/* same shape, suppressAll */),
    killOperation: publicProcedureWithTelemetry
        .input(z.object({ opid: z.string(), namespace: z.string() }))
        .mutation(async ({ input, ctx }) => {
            const myCtx = ctx as WithTelemetry<RouterContext>;
            const confirmed = await getConfirmationAsInSettings(
                l10n.t('Kill operation?'),
                l10n.t('This terminates operation "{opid}" on "{ns}". This cannot be undone.',
                    { opid: input.opid, ns: input.namespace }),
                input.opid, // confirmation "type the word" value where that style is configured
            );
            if (!confirmed) return { killed: false };
            const client = await ClustersClient.getClient(myCtx.clusterId);
            await killOperation(client.getMongoClient(), input.opid);
            showConfirmationAsInSettings(l10n.t('Operation "{opid}" was killed.', { opid: input.opid }));
            return { killed: true };
        }),
});
```

Check `getConfirmationAsInSettings`'s actual signature in
`src/utils/dialogs/getConfirmation.ts` before use and match an existing call site (e.g.
`collectionViewRouter.deleteDocumentsById`).

**Register in `appRouter.ts`** — add alongside the existing routers (top level, not under
the legacy `mongoClusters` namespace):

```ts
import { clusterDashboardRouter } from '../documentdb/clusterDashboard/clusterDashboardRouter';
export const appRouter = router({
    common: commonRouter,
    clusterDashboard: clusterDashboardRouter,
    mongoClusters: { documentView: documentViewRouter, collectionView: collectionViewRouter },
});
```

### WI-3: Controller + panel dedup (host)

**New file** `src/webviews/documentdb/clusterDashboard/clusterDashboardController.ts`

Copy `collectionViewController.ts` and simplify. Config type:

```ts
export type ClusterDashboardWebviewConfigurationType = {
    clusterId: string;
    clusterDisplayName: string;
    viewId: string;
    refreshIntervalMs: number; // pass 5000 from the factory; webview never hardcodes it
};
```

Factory `openClusterDashboardWebview(initialData)`:

- Module-level `const openPanels = new Map<string, AppWebviewController<...>>()` keyed on
  `clusterId`. If present and `!isDisposed()`, call `revealToForeground()` and return the
  existing controller; otherwise create via `openAppWebview({...})`, store it, and delete
  the map entry in `onDisposed`.
- `title: l10n.t('Dashboard: {name}', { name: initialData.clusterDisplayName })`,
  `webviewName: 'clusterDashboard'`, `viewColumn: vscode.ViewColumn.One`.
- `trpcContext: RouterContext = { dbExperience: API.DocumentDB, webviewName: 'clusterDashboard', clusterId, clusterDisplayName, viewId }`.
- Icon: optional — reuse the collection-view SVGs for the POC or omit the `icon` field.

### WI-4: Command + manifest wiring

**New file** `src/commands/openClusterDashboard/openClusterDashboard.ts` — copy the shape
of `openCollectionView.ts` exactly (it is short); no session needed:

```ts
export async function openClusterDashboard(context: IActionContext, node: ClusterItemBase): Promise<void> {
    trackJourneyCorrelationId(context, node);
    if (!node) { throw new Error(l10n.t('No node selected.')); }
    context.telemetry.properties.experience = node?.experience.api;
    const viewId = node.cluster.viewId ?? inferViewIdFromTreeId(node.cluster.treeId);
    const view = openClusterDashboardWebview({
        clusterId: node.cluster.clusterId,
        clusterDisplayName: node.cluster.name,
        viewId,
        refreshIntervalMs: 5000,
    });
    view.revealToForeground();
}
```

`ClusterItemBase` is imported from `src/tree/documentdb/ClusterItemBase.ts`.

**Register** in `src/documentdb/ClustersExtension.ts`, next to the Interactive Shell
registration (search for `ShellCommandIds.open`, around line 867):

```ts
registerCommandWithTreeNodeUnwrapping(
    'vscode-documentdb.command.clusterDashboard.open',
    withTreeNodeCommandCorrelation(openClusterDashboard),
);
```

(`src/commands/registerCommands.ts` is a no-op stub — do not touch it.)

**`package.json`** — three additions, each copying the comment-key/format conventions of
the *Open Interactive Shell* entries verbatim:

1. `contributes.commands` (near the shell entry, ~line 605):
   `command: "vscode-documentdb.command.clusterDashboard.open"`,
   `title: "Show Cluster Dashboard (Preview)"`, `category: "DocumentDB"`, `icon: "$(pulse)"`.
2. `contributes.menus["view/item/context"]` (next to the `[Account] Open Interactive Shell`
   entry at ~line 923): same `when` clause
   (`view =~ /connectionsView|discoveryView|azure(ResourceGroups|FocusView)/ && viewItem =~ /\btreeitem_documentdbcluster\b/i && !listMultiSelection`),
   `group: "5@2"`.
3. `contributes.menus.commandPalette`: add `{ "command": "...clusterDashboard.open", "when": "never" }`
   (tree-node commands are hidden from the palette — see the shell entry at ~line 1239).
4. Add the title string to `package.nls.json` only if other command titles are externalized
   there — inspect first; the `commands` section currently uses inline titles.

### WI-5: Webview UI

**Register the component** in `WebviewRegistry.ts`: `clusterDashboard: ClusterDashboard`.

**New files** under `src/webviews/documentdb/clusterDashboard/`:

```
ClusterDashboard.tsx        root: header + tiles + TabList, owns all state
clusterDashboard.scss       flex/grid layout; import in ClusterDashboard.tsx
components/HeaderCard.tsx
components/StatusStrip.tsx
components/Sparkline.tsx
components/OperationsTab.tsx
components/StorageTab.tsx
```

**`ClusterDashboard.tsx`** — keep state simple for the POC (plain `useState` in the root,
prop-drill; no context needed at this size):

```tsx
const configuration = useConfiguration<ClusterDashboardWebviewConfigurationType>();
const trpcClient = useTrpcClient();
const [clusterInfo, setClusterInfo] = useState<ClusterInfo | null>(null);
const [samples, setSamples] = useState<ClusterHealthSample[]>([]);   // capped at 60
const [selectedTab, setSelectedTab] = useState<'overview' | 'operations' | 'storage'>('overview');

useEffect(() => {   // one-time header load
    void trpcClient.clusterDashboard.getClusterInfo.query().then(setClusterInfo).catch(...);
}, []);

useEffect(() => {   // polling loop
    let disposed = false;
    const tick = () => {
        trpcClient.clusterDashboard.getHealthSample.query()
            .then((s) => { if (!disposed) setSamples((prev) => [...prev.slice(-59), s]); })
            .catch(() => {/* keep last samples; render stale badge */});
    };
    tick();
    const id = setInterval(tick, configuration.refreshIntervalMs);
    return () => { disposed = true; clearInterval(id); };
}, []);
```

Type-only imports of `ClusterHealthSample` etc. from
`../../../documentdb/utils/getClusterHealth` are fine (types are erased; Collection View
imports host types the same way — e.g. `TableDataEntry` from `ClusterSession`).

- **HeaderCard**: Fluent `Card`-like div styled in SCSS. Shows `clusterDisplayName`, a
  `PresenceBadge`/colored dot (green when the last sample's ping succeeded, red after 2
  consecutive failures), server version + platform from `getClusterInfo.metadata`
  (inspect the actual `ClusterMetadata` keys produced by `getClusterMetadata.ts` —
  they are flat strings like the buildInfo/hello fetchers write; pick version + platform
  and render "—" for anything absent), uptime formatted d/h/m from the latest sample.
- **StatusStrip**: four tiles. **Reuse the metric components** from
  `../collectionView/components/queryInsightsTab/components/metricsRow` (exported:
  `MetricsRow`, `CountMetric`, `TimeMetric`, `GenericMetric`, `formatCount`, `formatTime`).
  Importing across view folders is acceptable for the POC — add a `// TODO(dashboard):
  promote metricsRow to src/webviews/components/` note. Each tile pairs a metric with a
  `<Sparkline data={...}/>`. Null values render "—" with a tooltip
  `l10n.t('Not available on this server')`.
- **Sparkline.tsx**: pure SVG, ~40 lines: props `{ data: (number|null)[]; width?; height? }`,
  polyline normalized to min/max, stroke
  `var(--vscode-charts-blue, currentColor)`, no axes, `aria-hidden` (the numeric value is
  the accessible element). No dependency.
- **Overview tab**: two larger sparkline charts (Latency over time; Active ops over time —
  plus opcounter deltas/sec split by type when `opcounters` is non-null, i.e. non-vCore).
  Compute opcounter rates in the webview: `(curr[k] - prev[k]) / (dtMs/1000)`.
- **OperationsTab**: own `useEffect` polling `getCurrentOperations` every 5 s **only while
  mounted** (tab unmount clears the interval). Fluent `Table` (`DataGrid` is fine too —
  match whatever Fluent table primitive is already used in the repo; check
  `DataViewPanelTable.tsx` first and prefer a plain Fluent `Table` over slickgrid for this
  small dataset). Columns: opid, type, namespace, secs running, active, client. Row button
  **Kill** → `killOperation.mutate({opid, namespace})` → refresh list on `{killed:true}`.
  Confirmation happens host-side (WI-2) — no webview dialog.
- **StorageTab**: on-mount (and manual Refresh button) `getStorageStats` query; table of
  databases with formatted sizes (reuse `formatCount`/add a tiny `formatBytes` helper),
  plus a total row. A per-db horizontal bar (plain div with theme-token background,
  width % of max) gives the visual.
- Errors: user-initiated failures (kill, manual refresh) →
  `trpcClient.common.displayErrorMessage.mutate({ message: l10n.t(...), modal: false, cause: String(error) })`;
  polling failures degrade silently (stale badge on the strip after 2 misses).
- Accessibility: wrap async updates announcements with the existing `Announcer`
  (`src/webviews/components/accessibility`) for tab loads; all interactive elements get
  labels/tooltips via `l10n.t`.

### WI-6: Verification

1. `npm run build` — tsc must pass (this also builds the `packages/*` workspaces first).
2. `npm run lint` and `npm run prettier` — both clean (prettier config is enforced).
3. `npm run jesttest` — existing suites + the new sampler test pass.
4. Manual: F5 (extension dev host) with `npm run webpack-dev` per CONTRIBUTING.md; connect
   to the local emulator (Connections view → Local Emulators) and, if available, a vCore
   cluster; walk the demo script in §1, including: two dashboards for two different
   clusters open side by side; re-invoking the menu item reveals the existing panel;
   closing the panel stops polling (verify no console errors from the extension host);
   theme switch light↔dark re-themes the page live.

---

## 4. Riskiest assumptions (check these first if something misbehaves)

| Assumption | If wrong |
|---|---|
| `$currentOp` aggregation works on vCore with the connected user's role | Fall back to `command({currentOp:1})`; if both fail, Operations tab shows an empty-state explaining the permission need |
| `killOp` accepts the vCore opid format | Demo kill against the local emulator instead; keep the button but disable with tooltip when the opid isn't parseable |
| `dbStats` is fast enough to run per-database serially | Parallelize with `Promise.allSettled`, keep the 20-db cap |
| Type-only cross-boundary imports don't drag host code into the webview bundle | Move shared types into a `types.ts` inside the clusterDashboard folder |

## 5. Explicitly deferred to post-POC

Subscription-based streaming + ring buffer, pause/scrub, Azure Monitor metrics + header
enrichment (`AzureClusterModel`), capability probe caching, settings
(`documentDB.clusterDashboard.*`), Logs tab, metricsRow promotion to shared components,
localization bundle regeneration, full test coverage. See `cluster-dashboard-design.md`
for the target end-state.
