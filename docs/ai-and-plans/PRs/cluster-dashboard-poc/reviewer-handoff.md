# Reviewer handoff — Cluster Dashboard POC

> Companion to [`summary.md`](./summary.md), which records _what_ was built and _why_.
> This document is the practical start-here guide: how to run it, what to look at, in
> what order, and what to be suspicious of.

**Branch:** `feature/cluster-dashboard-poc` (local only — not pushed)
**Base:** `main` @ `c745a327` · **Diff:** 21 files, +2871 / −0 · 9 commits
**Review status:** one round applied (19 findings fixed, 2 deferred) — details in
[`summary.md`](./summary.md#review-round-1-applied)

---

## 1. Run it

```bash
npm install          # only if node_modules is stale
npm run build
```

Then in VS Code: **Run and Debug → `Launch Extension (webpack)` → F5**
(per `CONTRIBUTING.md` §3.2).

You need a reachable server. If no emulator is handy, this is what was used for
verification:

```bash
docker run -d --rm --name ddb-review -p 27017:27017 mongo:7
```

Then in the Extension Development Host: **Connections view → New Connection →**
`mongodb://127.0.0.1:27017`.

> A plain `mongo:7` server **does** support `serverStatus`, so it exercises the
> opcounters path that vCore cannot. That is useful for the demo but means it does
> **not** exercise the degradation path — see §4.

## 2. Demo / review script

1. Right-click a cluster → **Show Cluster Dashboard (Preview)**.
2. Header card: name, connection badge, server version, platform, topology, host, uptime.
   Four tiles below refresh every 5 s.
   - **Expected on an idle cluster: Active Operations = 0.** If it reads 1 with a phantom
     `admin.$cmd.aggregate` row in the Operations tab, the self-op filter has regressed.
3. **Overview** tab — latency and active-ops charts, plus an ops/sec breakdown when the
   server supports `serverStatus`. Before the second sample arrives this reads
   "Collecting…", *not* the vCore message.
4. **Operations** tab — start a long-running query (below), watch it appear, click
   **Kill** → confirmation prompt appears in the VS Code UI (host-side, honoring the
   configured confirmation style) → the row disappears on the next poll.
   - Press **Escape** at the prompt: this must be a silent no-op, not "Failed to kill".
   - Let the prompt sit for ~30 s before confirming: the operation is re-checked, so a
     finished op reports "no longer running" instead of killing whatever now holds the id.
5. **Storage** tab — per-database sizes with relative bars, plus a total row and a manual
   Refresh. The Total must equal the sum of the visible rows.
6. Re-invoke the context-menu item → the existing panel is **revealed**, not duplicated.
   Close the panel → polling stops (no extension-host console errors).
7. Right-click a connection you have **never expanded** → expect a single "Not signed in"
   error, not a panel that error-loops every 5 s.

To generate a long-running operation for step 4, run this in the Interactive Shell or a
playground:

```js
db.getCollection('items').find({ $where: 'var t=Date.now(); while(Date.now()-t<20000){} return true;' });
```

## 3. Review order

Each commit compiles on its own, so they can be reviewed in sequence.

| # | Commit | Focus |
|---|--------|-------|
| 1 | `78f1de27` | `src/documentdb/utils/getClusterHealth.ts` — **start here.** All server interaction is in this one file; everything else is plumbing. |
| 2 | `96f5bae1` | tRPC router + `appRouter` registration |
| 3 | `66ddd46e` | Controller / panel de-duplication |
| 4 | `8f4cbb18` | Command + `package.json` wiring |
| 5 | `90fecb02` | Webview UI |
| 6 | `9e5a32c0` | l10n bundle (generated — skim only) |
| 7 | `9015de8d` | `currentOp` background-thread fix |
| 8 | `ede37fc0` | This PR record (docs only) |
| 9 | `3396eaa6` | **Review-round fixes** — the largest behavioural commit; read it against `summary.md`'s findings table |

If you are re-reviewing rather than reading cold, start at `3396eaa6` — it is where the
kill path, the pollers, and every "the UI says something untrue" defect were fixed.

## 4. What to scrutinize

Ordered by how likely it is to matter.

1. **vCore behaviour is unverified.** No vCore cluster was available. `serverStatus` is
   expected to fail there (tiles fall back to `—`), and the
   `$currentOp` → `currentOp` → permissions-empty-state chain is implemented and
   unit-tested but never run against real vCore. **Try this before demoing to anyone on
   Azure.** Two vCore-specific behaviours now hinge on this: the `opidIsNumeric` flag
   (vCore reports *string* opids, and killing with the wrong type silently no-ops), and
   the `$match`-inside-`$currentOp` stage. Failures now carry their reason in
   `sample.errors`, so a vCore run is diagnosable from the Operations/Storage messages.
2. **Two known-broken paths were deferred, not fixed** (details in `summary.md`):
   - **Kubernetes clusters will not connect.** The router calls `ClustersClient.getClient`
     directly, bypassing `ClusterItemBase.beforeCachedClientConnect()`, so port-forward
     setup never runs — while the tree connects fine. The menu item *is* shown for k8s
     nodes.
   - **Deleting a connection does not stop its dashboard.** `removeConnection` clears
     credentials but never calls `deleteClient`, so the cached client survives and the
     panel keeps polling — and can still kill operations on — a removed connection.
     Renaming leaves a stale tab title.
3. **Visual layout has never been seen rendered.** Types and SCSS compile; appearance,
   spacing, two-panels-side-by-side, and light↔dark re-theming are unobserved. Expect to
   want CSS tweaks on the first run. The `Sparkline` gap/segment rendering is new in the
   review round and has *only* been reasoned about, never looked at.
4. **The background-thread and self-op filters** (`isUserOperation` /
   `isSelfInspectionQuery`) — are they too aggressive for other server types? Without
   them the Active Operations tile read non-zero on an idle cluster and the Kill button
   could terminate the dashboard's own poll.
5. **Polling cost.** Each 5 s health sample runs `ping` + `serverStatus` + `$currentOp`,
   and the Operations tab polls `$currentOp` again independently while mounted. Both
   loops now have in-flight guards so they cannot stack, but they are still two separate
   pollers — the obvious consolidation target before shipping. Telemetry is suppressed on
   both polled procedures. Neither loop pauses when the panel is hidden
   (`retainContextWhenHidden`), which is a known remaining gap.
6. **Two plan corrections worth confirming** — `isDisposed` is a getter not a method
   (`WebviewController.ts:384`), and telemetry suppression goes through
   `ctx.actionContext.telemetry` (matching `collectionViewRouter.ts:684`). Details in
   `summary.md`.

## 5. Scope reminders

Deliberately **not** built (per the POC plan's §5): subscription streaming, ring buffer,
pause/scrub, Azure Monitor metrics, settings, Logs tab. The refresh interval is a constant
in `openClusterDashboard.ts`. `metricsRow` is imported across view folders with a
`TODO(dashboard)` note rather than promoted to shared components.

Nothing here should be read as production-ready — the goal was a demoable slice that
proves the architecture.
