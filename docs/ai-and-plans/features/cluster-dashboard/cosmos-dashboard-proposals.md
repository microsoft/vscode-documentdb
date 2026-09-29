---
feature: cluster-dashboard
kind: notes
status: active
created: 2026-09-29
---

# Dashboard proposals from the vscode-cosmosdb prototypes

**Status: proposal 1 is adopted as a compact, informational scope line above the cards, with
the breadcrumb beside the inventory.** The elevated breadcrumb and feature-tab experiments
were rejected after visual inspection. The preview menu and alternate metric-label treatments
are removed; proposals 2-8 remain discussion only. The remaining candidates are not approved
work or a change to the [current architecture](./README.md#architecture-intent--code-is-authoritative-for-behavior).
The sibling extension's [account dashboard prototype at `af139005`](https://github.com/microsoft/vscode-cosmosdb/tree/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard)
tried three layouts using a shaded header, action toolbar, metric cards, tabs and inventory.
The source branch may disappear; the transferable mechanics are described here without depending
on those links. To preview the prototype while available, run `npm run vite-serve:views` in
vscode-cosmosdb and open `/src/webviews/static/accountOverviewPreview.html?variant=3`.

These ideas preserve the inventory-first landing view ([0006](./decisions.md#0006--the-page-is-a-data-inventory-not-a-performance-dashboard-reconstructed)),
static above-the-fold content ([0007](./decisions.md#0007--nothing-above-the-fold-moves-reconstructed)),
tabs only for answerable questions ([0008](./decisions.md#0008--a-tab-exists-only-when-the-server-can-answer-it-reconstructed)),
no `currentOp` ([0019](./decisions.md#0019--currentop-is-out-of-scope-for-this-iteration)),
and `N/A` cells rather than completeness badges ([0021](./decisions.md#0021--unavailable-table-values-are-enough-for-best-effort-summaries)).
Order below is suggested priority, not an implementation sequence or decision.

## Future design work: navigation divider

**Operator preference (2026-09-29):** Keep the thin horizontal line below the feature-tab
row as a reusable layout idea, independently of which breadcrumb arrangement is selected.
The operator explicitly liked this treatment and asked that it be retained for future work.

Use a one-pixel, theme-neutral rule across the content column to separate navigation from
the active panel. Keep it in place for every tab, including empty or unavailable panels.
The selected tab's accent underline remains distinct from this neutral structural line.
For combined breadcrumb-and-tab rows, the line spans the entire navigation row, not just
the tab labels. Avoid introducing a surrounding card or another shaded band solely to
establish this boundary. This records a preferred visual treatment, not approval of a
particular tab hierarchy or an instruction to restyle other views now.

## 1. Name the metric scope

**Selected design (2026-09-29):** The operator chose the compact scope-line style and approved
`Scope: All databases` at cluster level and `Scope: Database <name>` inside a database.
`Scope:` is muted, `Database` uses regular weight, and `All databases` or the database name
is emphasized. The line stays immediately above the metric cards; the breadcrumb remains
beside the inventory because the operator found elevated navigation too distant from the list.

The line is informational, not a link, selector or dismissible tag. It reserves the same
height at both levels; long names truncate without a tooltip or keyboard tab stop. The full
database name remains available through the inventory breadcrumb. The metric values,
inventory state and navigation behavior are unchanged. The preview menu and unused variants
have been removed.

The alternatives explored were no scope text, a larger summary heading, and captions below
every card. The chosen line provides context once, before the values. The consistent `Scope:`
prefix identifies its purpose at both levels; the database type precedes the name so it remains
visible during truncation. The proposed `(Cluster)` and `(Database)` suffixes were not retained.

**Earlier tag proposal (not adopted):**

`StatusStrip` switches from cluster to database cards when the inventory enters a database;
at the time of this proposal only tooltips identified that scope. Add one stable line directly above the cards:
`Showing  Whole cluster`, or `Showing  [Database orders x]` with a dismissible Fluent tag.
Dismiss returns to the database list, just like the breadcrumb root or Back to Databases.
Read the line from the same `inventoryViewState.currentDatabase` as the cards; use `null`
for the cluster scope in our implementation. The exit could report `inventoryNavigation`
with a new `scopeTag` control, letting telemetry distinguish this route from the existing
ones (the question left open by [0018](./decisions.md#0018--the-level-band-is-a-breadcrumb-back-stays-in-the-footer)).

The prototype's **earlier** version used `TagGroup` with `onDismiss`, a small `Tag` with
`dismissible` and an accessible dismiss-icon label. The pinned commit's
[`CombinedVariant.tsx`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard/CombinedVariant.tsx)
instead puts an inline single-choice scope menu in `.scopeLine`, offering the whole account
and each database. Its [`DashboardFrame.tsx`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard/DashboardFrame.tsx)
shares the selected database with the cards, tabs and inventory. The proposal here is the
closable label, not the later menu or its time-window picker.

## 2. Qualify card values

Show small, muted secondary text alongside a card's primary value, with no sparkline:
database Storage Used could show `12.4 GB · 38% of cluster`, and Documents
`1.2M · 21% of cluster`. Cluster Databases / Collections could show `5 / 37 · 2 empty`,
and Indexes / Size `84 / 3.1 GB · 0.4x data`. Use reported `ClusterStorageStats` only;
derive empty counts and sums from its per-database rows, not a new server command. Omit a
qualifier if its inputs are unavailable or its denominator is zero. A database share needs
a complete cluster denominator for the **same metric**; best-effort sums must not be
presented as exact shares of an incompletely inspected cluster.

The prototype's [`TileValue`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard/DashboardParts.tsx)
keeps primary and optional secondary spans on one value row, with a separate optional
sparkline below. Only the value-row pattern applies here.

## 3. Put useful tabs between cards and inventory

**Experiment rejected (2026-09-29):** The operator's visual inspection found the breadcrumb
too distant from the collection list, making navigation harder. The layouts described below
were removed, along with their tab placeholders. The original inventory-local breadcrumb is
restored; the metric-scope line was then selected and the preview menu removed. The independently preferred
divider treatment remains recorded in Future design work above. The experiment descriptions
below are historical context, not the current interface.

**Layout experiment (2026-09-29):** The operator requested a preview before committing to
the wider design. This alternative puts `Overview`, `Recommendations`, `Operations` and
`Metrics` below the shared scope breadcrumb and above feature content. Overview is the
default and contains the existing cards and inventory. The other tabs are explicitly
labelled layout placeholders, with no new collectors, fabricated results or `currentOp`
calls. Scope and inventory state survive tab switches. This differs from the original
proposal below: inventory is the default destination, not content repeated beneath every
feature. The recommendation is to keep storage cards within Overview so future activity
or time-series views can use summaries appropriate to their content. Names and placement
remain provisional; `Metrics` would require a supported history source, and `Operations`
would require revisiting the existing scope decision before implementation.

**Arrangement comparison (2026-09-29):** More actions contains a temporary `Layout preview`
radio group, so the operator can compare these options without editing or reloading:

- `Breadcrumb above tabs`: the first stacked preview.
- `Breadcrumb beside tabs`: the default experiment, with the breadcrumb at the left of the
  tab row. Breadcrumb navigation and tab selection remain separate accessible controls.
- `Breadcrumb in toolbar`: the breadcrumb occupies the left of the row below the identity
  band; Open Shell, Copy Connection String, Refresh and the remaining actions form one
  right-aligned group. Feature tabs get their own full-width row below it.

Both compact arrangements stack at narrow widths. The divider remains below the feature
navigation in all three. Operations, Recommendations and Metrics are provisionally
cluster-level destinations: a selected inventory database is retained for Overview but is
not shown as their parent or used as the shell target while those destinations are active.
`All databases` returns to the inventory root. Whether future capabilities also support
database-level scope remains open; these placeholders do not settle that API decision.

Show a Fluent `TabList` beneath `StatusStrip` only when at least one tab can be populated.
Keep `InventoryPanel` visible below it as the landing content, rather than making the
inventory itself a secondary tab. Counts belong in small badges on applicable tabs.
Open Insights automatically when warning-level or worse findings exist; otherwise leave
the tab area collapsed or select the least urgent populated tab. Preserve a reader's
explicit selection as data refreshes.

In the prototype, [`CombinedVariant.tsx`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard/CombinedVariant.tsx)
stores an optional `tabChoice`; while it is unset, severity (or loading state) chooses a
default, and `onTabSelect` makes the choice sticky. `TabList` and its panels precede the
always-rendered inventory. [`CountBadge`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard/DashboardParts.tsx)
uses a small tinted Fluent badge, with subtle coloring at zero. Its metrics, throughput
and partition tabs are **not** proposed for our server.

## 4. Derive inventory insights

Run fixed, explainable checks in the webview over the inventory snapshot; refresh them
only when inventory refreshes ([0015](./decisions.md#0015--storage-refresh-is-explicit-after-initial-load)).
Show finding cards with an icon, title, severity, evidence, suggested next step and a
jump action. Group by rule, rank worst first, summarize scopes as `db/coll + others`,
and allow session-only dismissal. All / Issues / Suggestions filters can follow the
index list's subtle toolbar-toggle pattern and show their respective counts. At database
scope, show only findings for that database. An empty state should mean no findings from
**available checks**, not claim that uninspected objects are healthy.

| Candidate check              | Signal and source                                                                                                              | Destination                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| Index-heavy collection       | `totalIndexSize > size`, from collection storage statistics                                                                    | Collection View, Indexes tab |
| Many indexes                 | `nindexes` above a configurable threshold, from `collStats`                                                                    | Indexes tab                  |
| Empty database or collection | `objects == 0` from `dbStats`, or `count == 0` from `collStats`                                                                | Relevant inventory row       |
| Large average document       | `avgObjSize` above a threshold, from `$collStats.storageStats` on vCore; requires adding a field to `ClusterCollectionStorage` | Collection View              |
| Read-only connection         | `hello.readOnly` in topology metadata                                                                                          | Server details disclosure    |
| High availability disabled   | `enableHa === false` from `AzureClusterModel`, Azure connections only                                                          | Azure portal                 |

The prototype's [`overviewFindingsModel.ts`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountOverviewV2/overviewFindingsModel.ts)
ranks by priority, then stable source/scope/ID keys, and groups rule findings after
filtering dismissed IDs. The worst member represents a group; a scope summary is
presentation only, not evidence or an exact count of affected objects when scans are
capped. [`FindingCard` and `FindingList`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard/DashboardParts.tsx)
use a severity badge, rationale/action text, Inspect and Dismiss actions, and a distinct
nothing-to-fix state. The prototype's `ChoiceGroup` is a single-choice Fluent toolbar
with subtle radio buttons. For our inventory, a jump should identify its actual database
and collection; it must not imply that a rule diagnoses index quality. PR #732 owns
index recommendations.

## 5. Rank largest collections across databases

Offer a cluster-wide Largest Collections tab ordered by storage, with a relative size bar,
documents, index size and index-to-data ratio. Rows open a Collection View or its Indexes
tab. Unlike the current database-at-a-time collection inventory, this needs collection
statistics from multiple databases. Fetch those on first opening the tab and on explicit
Refresh, reusing already loaded results where appropriate. Respect the existing
`DATABASE_STATS_LIMIT` / `COLLECTION_STATS_LIMIT` caps and say how many databases were
not inspected; distinguish unavailable values from zero. This answers the SSMS
"Disk Usage by Top Tables" question cited in the
[data-first restructure](./iterations/01-poc/data-first-restructure.md), without live metrics.
The prototype's [`TopConsumersPanel`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard/DashboardPanels.tsx)
is a reference for ranked rows and inspect actions, not for its RU data source.

## 6. Make index-to-data ratio sortable

Add `Index / Data` at both inventory levels, using existing reported sizes, such as
`0.4x` or `1.3x`. Sort numeric ratios; render `N/A` when size is unavailable or zero,
and use a warning-tone relative bar above 1.0x. The prototype's
[`RelativeBar`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard/DashboardParts.tsx)
prints the figure beside a track scaled to the largest visible row, with a minimum
nonzero width and `data-tone` for theme-colored warnings. A ratio bar would need its
own appropriate scale; do not interpret the prototype's Peak RU scale as an index threshold.

## 7. Mark rows with findings

Once Insights exists, a narrow last column can show an icon only on rows with findings;
leave other rows blank rather than adding green checks. Its tooltip names the findings,
and activating it opens Insights filtered to that row. The prototype's
[`HealthIndicator`](https://github.com/microsoft/vscode-cosmosdb/blob/af139005802d90ae360d1e24fa12053a6cf823e8/src/webviews/cosmosdb/AccountDashboard/DashboardParts.tsx)
uses a themed status icon, tooltip and screen-reader text, with keyboard focus for the
tooltip. Our indicator should be an actionable, accessible control when it opens a tab.
This is **not** the per-row collection-failure warning icon rejected by
[0021](./decisions.md#0021--unavailable-table-values-are-enough-for-best-effort-summaries).

## 8. Optionally inspect unused indexes

Only at database scope and on demand, run `$indexStats` over its collections, capped like
collection statistics, and show an `N unused indexes in M collections` insight with links
to each collection's Indexes tab. Reuse that tab's definition of unused. This costs extra
round trips and can wait for a cheaper summary from the Indexes tab.

## Not proposed

No live sparklines, time-window selector or auto-refresh indicator: vCore has no supported
time-series source here, and motion conflicts with 0007 and 0015. No RU, throttling,
partition-skew, latency or availability metrics, alerts/Advisor lists, or metrics explorer:
they require sources or integrations this dashboard does not have (`serverStatus`, `top`,
`$collStats` latency statistics and Azure Monitor are not available for this purpose).
No `currentOp` and no completeness badges. Used-versus-provisioned storage remains Phase 2
(WI-7). These omissions are deliberate, not prototype features awaiting a port.
