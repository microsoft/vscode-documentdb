---
feature: cluster-dashboard
kind: notes
status: active
prs: [823]
created: 2026-08-24
code:
    - src/commands/openClusterDashboard/**
    - src/documentdb/utils/getClusterHealth.ts
    - src/webviews/documentdb/clusterDashboard/**
---

# Cluster Dashboard

**Status:** proof of concept, unmerged ([#823](https://github.com/microsoft/vscode-documentdb/pull/823), milestone 0.11.0)

> A data-first map of what a cluster holds and whether it is healthy — opened from any cluster
> tree node.

The extension already has per-collection surfaces: Collection View, the Indexes tab, the shell,
playgrounds. What no surface shows is the **whole cluster at once**. That aggregation is this
page's entire reason to exist, so it ranks, summarizes, and routes into the leaf features rather
than duplicating them ([0006](./decisions.md#0006--the-page-is-a-data-inventory-not-a-performance-dashboard-reconstructed)).

It is **not** a monitoring dashboard. A developer inside VS Code is mid-task in their own code and
comes here to get oriented, not to keep vigil — so nothing above the fold moves
([0007](./decisions.md#0007--nothing-above-the-fold-moves-reconstructed)).

## Code map

- `src/commands/openClusterDashboard/**` — the command that opens the panel
- `src/documentdb/utils/getClusterHealth.ts` — host-side collectors (health, storage); sibling of
  `getClusterMetadata.ts` and shares its resilience model
- `src/webviews/documentdb/clusterDashboard/**` — the webview: tRPC router, controller, React root,
  health strip and storage inventory

The dashboard borrows shared presentation primitives (`metricsRow`, `summaryCard`, the feedback
components) from `src/webviews/documentdb/collectionView/queryInsightsTab/components/`.

## User docs

None yet. A user-manual page is due before this ships.

## Architecture (intent — code is authoritative for behavior)

- **The page is a place, not a feed.** The storage inventory refreshes when the dashboard opens
  and on demand; lightweight health polling pauses while the panel is hidden. There is no
  Operations tab and no observed-operation history.
- **One responsive header replaces the layout experiments.** The cluster identity and trailing
  status block share a row when they fit; the status block wraps as a unit otherwise. Connection
  state and a stable-width RTT slot lead the facts. Lower-priority facts disappear as space
  contracts. Host addresses live in the disclosed Server details, alongside an optional Azure
  resource group of facts and the raw diagnostics action. The disclosure retains both label
  widths, and its mounted Fluent `Collapse` handles opening and closing without a layout toggle.
- **The cluster toolbar groups connection tools separately from page utilities.** Open Shell and
  Copy Connection String sit together on the left; Refresh, More actions and feedback sit on the
  right. Fluent overflow moves Copy, then Shell, into More actions as space contracts. Refresh
  stays visible and re-reads cluster storage and the current inventory; its label remains Refresh.
  The inventory toolbar keeps its existing layout.
- **Nothing here reads what anyone is running.** `currentOp` is out of scope for this iteration,
  so no command document, query filter or client address enters the feature at all
  ([0019](./decisions.md#0019--currentop-is-out-of-scope-for-this-iteration)).
- **Every collector degrades per command.** A failed or unsupported command nulls its own fields
  and records the reason; the page never shows a broken panel. There is no capability probe,
  because a probe is a cache with an invalidation problem
  ([0002](./decisions.md#0002--per-command-trycatch-no-capability-probe-reconstructed)).
- **Unavailable table statistics read `N/A`.** Rows remain listed when their statistics fail,
  with the existing list-level warning. Summary sums remain best-effort sums of available values;
  per-metric completeness badges and row warning icons are not required for this iteration
  ([0021](./decisions.md#0021--unavailable-table-values-are-enough-for-best-effort-summaries)).
- **Diagnostics are point-in-time and unmodified.** Export re-reads everything on the host and
  reports each command beside exactly what the server answered, or why it did not
  ([0017](./decisions.md#0017--diagnostics-carry-raw-replies-not-a-second-reading-of-them)). It
  carries no application data, but it does name every database and collection and the addresses of
  the servers behind them, so it is confirmed before it is produced.
- **A row's context-menu entry runs on the host**, against the tree node the row names, rather than
  being relayed through the webview
  ([0016](./decisions.md#0016--row-context-menu-entries-run-on-the-host)).
- **Panel de-duplication is keyed on `clusterId`, never `treeId`**
  ([0005](./decisions.md#0005--panel-de-duplication-keyed-on-clusterid-never-treeid-reconstructed)).
- **Showing on connection is the default.** The dashboard footer mirrors the
  `documentDB.userInterface.showDashboardOnConnect` setting. Successfully connecting by expanding
  a cluster in a tree shows the dashboard unless the user opts out. Refreshes that reuse a cached
  client do not reopen or reveal it; removing the client allows the next tree connection to open it again. Direct command-based
  connections are unchanged ([0020](./decisions.md#0020--show-the-dashboard-on-tree-connect-by-default)).

## Timeline

| Date       | What                                                                               | Where                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-26 | End-state design drafted from the vscode-pgsql Server Dashboard model              | [design.md](./design.md)                                                                                                                                            |
| 2026-07-27 | POC implemented and reviewed (round 1)                                             | [iterations/01-poc/](./iterations/01-poc/implementation-plan.md)                                                                                                    |
| 2026-07-28 | Review feedback reframed the page as an inventory; data-first restructure applied  | [iterations/01-poc/data-first-restructure.md](./iterations/01-poc/data-first-restructure.md)                                                                        |
| 2026-07-29 | PR [#823](https://github.com/microsoft/vscode-documentdb/pull/823) opened          | —                                                                                                                                                                   |
| 2026-08-04 | Marked ready for review; Copilot review round applied                              | [iterations/01-poc/summary.md](./iterations/01-poc/summary.md)                                                                                                      |
| 2026-08-16 | Milestoned 0.11.0 by the maintainer                                                | —                                                                                                                                                                   |
| 2026-08-24 | Merged current `main`; docs migrated into this layout                              | —                                                                                                                                                                   |
| 2026-09-07 | Feature set reduced to the inventory; the leftovers of the removed panels swept up | [0015](./decisions.md#0015--storage-refresh-is-explicit-after-initial-load)–[0017](./decisions.md#0017--diagnostics-carry-raw-replies-not-a-second-reading-of-them) |
| 2026-09-08 | `currentOp` dropped from the iteration, taking the last application data with it   | [0019](./decisions.md#0019--currentop-is-out-of-scope-for-this-iteration)                                                                                           |

## Decisions

See [decisions.md](./decisions.md). The two that constrain everything else:

- [0006](./decisions.md#0006--the-page-is-a-data-inventory-not-a-performance-dashboard-reconstructed) —
  the page is a **data inventory**, not a performance dashboard. This **reverses the model in
  [design.md](./design.md) §1.1**, which has not been rewritten. Read `design.md` with this entry
  in hand.
- [0019](./decisions.md#0019--currentop-is-out-of-scope-for-this-iteration) — `currentOp` is out of
  scope. Nothing in the feature reads what anyone is running, which is what keeps application data
  out of it. Entries 0003, 0010 and 0012 are all about `currentOp` and no longer describe the code.

## Open gaps

The [AI pre-review](./iterations/01-poc/ai-pre-review.md) is the authoritative list, and its
[author decisions](./iterations/01-poc/ai-pre-review.md#author-decisions-62) record what was fixed
and what was deliberately left. Issue
[#897](https://github.com/microsoft/vscode-documentdb/issues/897) tracks the deferred work. The
gaps below remain.

- **`design.md` is stale in its framing.** It predates
  [0006](./decisions.md#0006--the-page-is-a-data-inventory-not-a-performance-dashboard-reconstructed)
  and still takes the vscode-pgsql Server Dashboard as its template. Its research, technical
  design and vCore corrections remain useful; its genre framing does not. It has not been
  re-verified against the code.
- **Refresh interval is fixed at 5 s**, not user-configurable.
- **No live operations.** `currentOp` is out of scope for this iteration
  ([0019](./decisions.md#0019--currentop-is-out-of-scope-for-this-iteration)). Bringing it back
  means designing a surface for it, and answering the redaction question that
  [0012](./decisions.md#0012--warn-at-the-sharing-boundary-rather-than-redact-the-preview) left
  open, rather than restoring the collector.
- **No search or create flows below the collection level.** The Data tab drills from the database
  list into one database's collections and hands off to the Collection View from there, but there
  is no navigation below that. PR #753 would have covered it and was abandoned
  ([0013](./decisions.md#0013--753-is-abandoned-this-is-the-only-cluster-dashboard)), so the
  surface now has no owner and is the largest functional gap in the feature.
- **No used-vs-provisioned storage figure**, because there is no Azure Monitor integration.
- **`Uptime` is a placeholder on vCore**, where `serverStatus` is unavailable.
- **No user-manual page.**
