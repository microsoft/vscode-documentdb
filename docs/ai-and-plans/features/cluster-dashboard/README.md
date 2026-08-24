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

> A data-first map of what a cluster holds, what is running against it right now, and whether it
> is safe — opened from any cluster tree node.

The extension already has per-collection surfaces: Collection View, the Indexes tab, the shell,
playgrounds. What no surface shows is the **whole cluster at once**. That aggregation is this
page's entire reason to exist, so it ranks, summarizes, and routes into the leaf features rather
than duplicating them ([0006](./decisions.md#0006--the-page-is-a-data-inventory-not-a-performance-dashboard-reconstructed)).

It is **not** a monitoring dashboard. A developer inside VS Code is mid-task in their own code and
comes here to get oriented, not to keep vigil — so nothing above the fold moves
([0007](./decisions.md#0007--nothing-above-the-fold-moves-reconstructed)).

## Code map

- `src/commands/openClusterDashboard/**` — the command that opens the panel
- `src/documentdb/utils/getClusterHealth.ts` — host-side collectors (health, storage,
  `$currentOp`); sibling of `getClusterMetadata.ts` and shares its resilience model
- `src/webviews/documentdb/clusterDashboard/**` — the webview: tRPC router, controller, React root,
  tabs, operation history, Copilot prompt builder

The dashboard borrows shared presentation primitives (`metricsRow`, `summaryCard`, the feedback
components) from `src/webviews/documentdb/collectionView/queryInsightsTab/components/`.

## User docs

None yet. A user-manual page is due before this ships.

## Architecture (intent — code is authoritative for behavior)

- **The page is a place, not a feed.** Header, tiles and the landing Data tab are static and
  refresh on open or on demand. Polling is confined to the Operations tab, and only while it is
  the active tab ([0007](./decisions.md#0007--nothing-above-the-fold-moves-reconstructed)).
- **A tab exists only when the server can answer it.** On Azure DocumentDB (vCore) the Activity
  tab is absent entirely, because `serverStatus` is rejected there
  ([0008](./decisions.md#0008--a-tab-exists-only-when-the-server-can-answer-it-reconstructed)).
- **Every collector degrades per command.** A failed or unsupported command nulls its own fields
  and records the reason; the page never shows a broken panel. There is no capability probe,
  because a probe is a cache with an invalidation problem
  ([0002](./decisions.md#0002--per-command-trycatch-no-capability-probe-reconstructed)).
- **Partial results say so.** A privilege-limited operations list states that it is showing only
  the caller's own operations; the history states that anything between two refreshes never
  appears.
- **Kill is non-committal.** `killOp` acknowledges the request, not the outcome, and the wording
  says so. The opid is re-checked after the confirmation prompt, since ids recycle
  ([0003](./decisions.md#0003--confirmation-on-the-host-kill-reports-the-request-not-the-outcome-reconstructed)).
- **Credentials are redacted before they reach the webview.** `currentOp` reports commands
  verbatim, so an auth handshake or `createUser` caught in flight would otherwise carry a SCRAM
  payload or a cleartext password into a tooltip. Credential-bearing commands lose their body, and
  credential fields are redacted at any depth.
- **Panel de-duplication is keyed on `clusterId`, never `treeId`**
  ([0005](./decisions.md#0005--panel-de-duplication-keyed-on-clusterid-never-treeid-reconstructed)).

## Timeline

| Date       | What                                                                              | Where                                                                                        |
| ---------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 2026-07-26 | End-state design drafted from the vscode-pgsql Server Dashboard model             | [design.md](./design.md)                                                                     |
| 2026-07-27 | POC implemented and reviewed (round 1)                                            | [iterations/01-poc/](./iterations/01-poc/implementation-plan.md)                             |
| 2026-07-28 | Review feedback reframed the page as an inventory; data-first restructure applied | [iterations/01-poc/data-first-restructure.md](./iterations/01-poc/data-first-restructure.md) |
| 2026-07-29 | PR [#823](https://github.com/microsoft/vscode-documentdb/pull/823) opened         | —                                                                                            |
| 2026-08-04 | Marked ready for review; Copilot review round applied                             | [iterations/01-poc/summary.md](./iterations/01-poc/summary.md)                               |
| 2026-08-16 | Milestoned 0.11.0 by the maintainer                                               | —                                                                                            |
| 2026-08-24 | Merged current `main`; docs migrated into this layout                             | —                                                                                            |

## Decisions

See [decisions.md](./decisions.md). The two that constrain everything else:

- [0006](./decisions.md#0006--the-page-is-a-data-inventory-not-a-performance-dashboard-reconstructed) —
  the page is a **data inventory**, not a performance dashboard. This **reverses the model in
  [design.md](./design.md) §1.1**, which has not been rewritten. Read `design.md` with this entry
  in hand.
- [0009](./decisions.md#0009--converge-with-pr-753-on-a-shared-feature-branch) — how this
  converges with PR [#753](https://github.com/microsoft/vscode-documentdb/pull/753). **Still
  `Proposed`** and blocking: both PRs currently register colliding cluster-node context-menu
  commands.

## Open gaps

The [AI pre-review](./iterations/01-poc/ai-pre-review.md) is the authoritative list; the four
questions in its _Outstanding author decisions_ section are what stand between this and a
ready-for-review PR. The gaps below predate it.

- **`design.md` is stale in its framing.** It predates
  [0006](./decisions.md#0006--the-page-is-a-data-inventory-not-a-performance-dashboard-reconstructed)
  and still takes the vscode-pgsql Server Dashboard as its template. Its research, technical
  design and vCore corrections remain useful; its genre framing does not. It has not been
  re-verified against the code.
- **The #753 convergence is unagreed.** See
  [0009](./decisions.md#0009--converge-with-pr-753-on-a-shared-feature-branch).
- **Refresh interval is fixed at 5 s**, not user-configurable.
- **Command previews still carry query literals.** Redaction removes credentials, not application
  data; export warns rather than redacting
  ([0012](./decisions.md#0012--warn-at-the-sharing-boundary-rather-than-redact-the-preview)).
- **No collection-level drill-down** — that surface belongs to
  [#753](https://github.com/microsoft/vscode-documentdb/pull/753).
- **No used-vs-provisioned storage figure**, because there is no Azure Monitor integration.
- **`Uptime` is a placeholder on vCore**, where `serverStatus` is unavailable.
- **No user-manual page.**
