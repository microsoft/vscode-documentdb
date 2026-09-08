---
feature: cluster-dashboard
kind: decisions
status: active
prs: [823]
created: 2026-08-24
---

# Cluster Dashboard — Decisions

> The decisions that shaped the Cluster Dashboard, and what was rejected on the way.

| #    | Decision                                                    | Status              | Changed from the proposal?                             | Date       | PR   |
| ---- | ----------------------------------------------------------- | ------------------- | ------------------------------------------------------ | ---------- | ---- |
| 0001 | Poll from the webview, not tRPC subscriptions               | Accepted            | Accepted as proposed, scoped down for the POC          | 2026-07-27 | #823 |
| 0002 | Per-command try/catch, no capability probe                  | Accepted            | Accepted as proposed                                   | 2026-07-27 | #823 |
| 0003 | Confirmation on the host; kill reports the request          | Superseded by 0019  | Outcome vocabulary added after live testing            | 2026-07-28 | #823 |
| 0004 | Custom SVG sparkline instead of a charting dependency       | Accepted            | Accepted as proposed                                   | 2026-07-27 | #823 |
| 0005 | Panel de-duplication keyed on `clusterId`, never `treeId`   | Accepted            | Accepted as proposed                                   | 2026-07-27 | #823 |
| 0006 | The page is a data inventory, not a performance dashboard   | Accepted            | **Reverses the genre-A model in `design.md` §1.1**     | 2026-07-28 | #823 |
| 0007 | Nothing above the fold moves                                | Accepted            | Raised from a review note to a standing rule           | 2026-07-28 | #823 |
| 0008 | A tab exists only when the server can answer it             | Accepted            | Emerged from live vCore testing, not the plan          | 2026-07-28 | #823 |
| 0009 | Converge with PR #753 on a shared `feature/` branch         | Proposed            | Needs sign-off from #753's author and a maintainer     | 2026-08-24 | #823 |
| 0014 | Step into a database, do not expand it                      | Accepted (modified) | Its back-button-only exit was reversed by 0018         | 2026-09-02 | #823 |
| 0015 | Storage refresh is explicit after initial load              | Accepted            | Removes a timer left behind by the data-first redesign | 2026-09-07 | #823 |
| 0016 | Row context-menu entries run on the host                    | Accepted            | Removes a host → webview → host relay                  | 2026-09-07 | #823 |
| 0017 | Diagnostics carry raw replies, not a second reading of them | Accepted            | Retires the topology summary with its card             | 2026-09-07 | #823 |
| 0018 | The level band is a breadcrumb; Back stays in the footer    | Accepted            | Reverses 0014's rejection of the breadcrumb            | 2026-09-07 | #823 |
| 0019 | `currentOp` is out of scope for this iteration              | Accepted            | Supersedes 0003 and 0010; makes 0012 moot              | 2026-09-08 | #823 |

> Entries below are **semantically** immutable: append new entries rather than
> rewriting old ones, and record reversals as a new entry plus a status change
> above. Editing for typos, broken links, or added verification metadata is fine.
> Heading text is frozen once written — a retitle means a new decision.
>
> Entries marked **(reconstructed)** were written during the 2026-08 migration
> from earlier plan and summary documents. They record what was decided at the
> time, not the original wording; each links to its source evidence.

**Status vocabulary** (closed set of seven):

`Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

---

## 0001 — Poll from the webview, not tRPC subscriptions (reconstructed)

**Status:** Accepted · **Date:** 2026-07-27 · **Raised by:** implementation of the POC
**Evidence:** [iterations/01-poc/summary.md](./iterations/01-poc/summary.md#polling-from-the-webview-not-trpc-subscriptions)

### Question

Query Insights already streams through tRPC subscriptions with a host-side ring buffer, and
[`design.md`](./design.md) §4 calls for the same. Should the dashboard adopt that pipeline?

### Decision

No. A plain `setInterval` → `query()` from the webview, with the sample history held in
webview state (last 60 samples, roughly five minutes).

### Reasoning

The subscription path only earns its complexity **together with** the ring buffer, pause/scrub
and crosshair sync — which is the bulk of the full design. A 5 s poll proves the data pipeline
and the UI without any of it, and the sparklines need the history in webview state anyway.
Closing the panel tears the interval down with the component, so there is no host-side
lifetime to manage.

### Rejected alternatives

- **tRPC subscription with a host-side ring buffer** — the end-state design; deferred because
  it cannot be evaluated apart from the interaction model it exists to serve.

### Known cost

Two independent pollers exist: the health sample and the Operations tab each query
`currentOp`. Consolidating them is the first thing to do post-POC.

---

## 0002 — Per-command try/catch, no capability probe (reconstructed)

**Status:** Accepted · **Date:** 2026-07-27 · **Raised by:** implementation of the POC
**Evidence:** [iterations/01-poc/summary.md](./iterations/01-poc/summary.md#per-command-trycatch-no-capability-probe)

### Question

Servers differ in what they will answer. Should the dashboard probe capabilities once and
cache the answer, or degrade per command on every sample?

### Decision

Degrade per command. `getClusterHealth.ts` mirrors its sibling `getClusterMetadata.ts`: each
server command runs in its own `try`/`catch`, a failure writes `null` and pushes the command
name into `errors`, and the collector never throws.

### Reasoning

A capability probe is a cache with an invalidation problem — permissions change and failover
changes the answer. Degrading per sample costs one failed command per 5 s on vCore and is
**always correct**. The full design can add caching later without changing the collector's
contract.

This also gives the webview a three-state contract it can render honestly: `undefined` is a
loading skeleton, `null` is "Not available on this server", a number is the value.

### Rejected alternatives

- **A `getCapabilities` RPC cached per cluster** — cheaper per sample, but wrong after any
  permission or topology change, and the failure mode is a silently stale page.

---

## 0003 — Confirmation on the host; kill reports the request, not the outcome (reconstructed)

**Status:** Superseded by [0019](#0019--currentop-is-out-of-scope-for-this-iteration) · **Date:** 2026-07-28 · **Raised by:** implementation, then live testing
**Evidence:** [iterations/01-poc/summary.md](./iterations/01-poc/summary.md#confirmation-lives-on-the-host-and-the-result-is-reported-honestly)

### Question

Killing an operation is destructive. Where does the confirmation live, and what may the UI
claim afterwards?

### Decision

`killOperation` raises `getConfirmationAsInSettings` in the router, not a dialog in the
webview. The procedure returns a four-way `outcome` (`requested` / `cancelled` / `gone` /
`failed`) and the toast says **"Kill request sent"**.

### Reasoning

Host-side confirmation inherits the user's configured style (word / challenge / click) for
free and stays consistent with `collectionViewRouter.deleteDocumentsById`. A webview-side
dialog would be a second, divergent confirmation UX for a destructive action.

The **modification** came from live testing: `killOp` replies `{ok: 1}` whether or not an
operation was found, so the UI cannot truthfully claim an operation "has been killed". Two
consequences followed:

- The four-way `outcome` replaced a boolean, and the wording was changed to describe the
  request rather than the result.
- The prompt blocks indefinitely (`ignoreFocusOut: true`) while the table keeps refreshing
  underneath it, so an opid captured at click time can be recycled onto a different operation
  before the user confirms. The operation is therefore **re-checked immediately before the
  kill**. The word-confirmation style also _throws_ `UserCancelledError` on Escape rather than
  returning `false`, which is caught and mapped to `cancelled`.

---

## 0004 — Custom SVG sparkline instead of a charting dependency (reconstructed)

**Status:** Accepted · **Date:** 2026-07-27 · **Raised by:** implementation of the POC
**Evidence:** [iterations/01-poc/summary.md](./iterations/01-poc/summary.md#custom-svg-sparkline-instead-of-a-charting-dependency)

### Question

The tiles show trend. Does that justify a charting library?

### Decision

No. `Sparkline.tsx` is roughly 85 lines of `<polyline>` normalized to min/max and stroked with
`var(--vscode-charts-*)`.

### Reasoning

Adding a charting library to a POC is a hard-to-reverse decision that would dominate review.
The chart is decorative — the accessible representation is the numeric value in the tile next
to it — so the SVG is `aria-hidden` and needs no axis, legend, or interaction. If the full
design later needs crosshairs and scrubbing, **that** is the moment to evaluate a real library,
with a concrete requirement to evaluate it against.

---

## 0005 — Panel de-duplication keyed on `clusterId`, never `treeId` (reconstructed)

**Status:** Accepted · **Date:** 2026-07-27 · **Raised by:** the repo's dual-ID rule
**Evidence:** [iterations/01-poc/summary.md](./iterations/01-poc/summary.md#panel-de-duplication-keyed-on-clusterid)

### Question

Re-invoking the command for a cluster that already has a panel should reveal it, not open a
second one. What is the key?

### Decision

A module-level `Map<string, AppWebviewController<…>>` in the controller, keyed on `clusterId`.

### Reasoning

Per the repo's dual-ID rule, `treeId` changes when a connection is moved into a folder. Keying
on it would open a duplicate, double-polling panel for the same cluster after a drag-and-drop —
a silent bug that only appears once a user organizes their connections.

---

## 0006 — The page is a data inventory, not a performance dashboard (reconstructed)

**Status:** Accepted · **Date:** 2026-07-28 · **Raised by:** review feedback on the POC
**Evidence:** [iterations/01-poc/data-first-restructure.md](./iterations/01-poc/data-first-restructure.md) §0, §1.1

### Question

Review feedback said the page had too many dynamic components, should focus on the database
itself, and should lead with storage. Is that a request to reorder the tabs, or something
structural?

### Decision

Structural. The POC built the wrong **kind** of page. Comparable products fall into two
non-interchangeable genres — **A**, the performance dashboard (pgAdmin, vscode-pgsql,
Atlas RTPP) and **B**, the data inventory (Compass, Studio 3T, SSMS reports, Supabase). The
POC built genre A; the audience is genre B. The Data tab becomes the landing view.

### Reasoning

A monitoring dashboard treats the server as a patient — vitals, waveforms, watched during an
incident. An inventory treats the database as a place — a map of what exists, visited between
edits for orientation. A developer inside VS Code is mid-task in their own code; they come here
to ask "what's in this cluster, how big, did my import land", not to keep vigil.

Two consequences worth naming:

- **Family coherence.** This is not "vscode-pgsql minus the eight metric groups vCore cannot
  answer". A document database's center of gravity is its collections, so a collection-ranked
  inventory is the DocumentDB-native counterpart of pgsql's performance dashboard, not a
  diminished copy.
- **Agent-readiness.** A ranked, static, table-shaped inventory is the artifact an AI agent can
  consume and cite, which aligns the restructure with the Ask-Copilot direction.

**This reverses the model in [`design.md`](./design.md) §1.1**, which took the vscode-pgsql
Server Dashboard as its template. `design.md` has not been rewritten; read it with this entry
in hand.

---

## 0007 — Nothing above the fold moves (reconstructed)

**Status:** Accepted · **Date:** 2026-07-28 · **Raised by:** review feedback on the POC
**Evidence:** [iterations/01-poc/data-first-restructure.md](./iterations/01-poc/data-first-restructure.md) §0 commitment 2

### Question

Which parts of the page are allowed to auto-refresh?

### Decision

The header, tiles and landing tab are static — they refresh on open and on demand. Polling and
animation are confined to the **Operations tab, and only while it is the active tab**.

### Reasoning

Motion is a claim on the user's attention, so it must be earned by change the user cares about.
The inventory changes on the timescale of deployments; operations change on the timescale of
seconds. Recording this as a **rule rather than a pruning exercise** is the point: it decides
every future "should this auto-refresh?" question in advance, instead of relitigating each one.

---

## 0008 — A tab exists only when the server can answer it (reconstructed)

**Status:** Accepted · **Date:** 2026-07-28 · **Raised by:** live testing against an Azure DocumentDB (vCore) M10 cluster
**Evidence:** [iterations/01-poc/summary.md](./iterations/01-poc/summary.md#bug-found-by-live-testing)

### Question

vCore rejects `serverStatus` (code 115) and `$collStats {latencyStats}`, and answers `getLog`
with an empty log. What should the Activity tab do there?

### Decision

Not exist. The dashboard's shape is grown from what the platform can actually answer, rather
than rendering broken or approximated panels. On Azure DocumentDB (vCore) the Activity tab is
absent entirely.

### Reasoning

The alternative — a tab that renders dashes, zeros, or a permanent error — teaches users that
the page is unreliable, and it is indistinguishable from a genuine outage. Absence is
unambiguous.

This decision was **only reachable by live testing**; the published compatibility matrix says
otherwise, and several corrections are recorded in
[`design.md`](./design.md). A related instance of the same lesson: `listDatabases` reports
`sizeOnDisk: 0` with `empty: false` for every database on vCore, so the Data tab falls back to
`dbStats.storageSize` — without that fallback the whole tab read `0 B`.

---

## 0009 — Converge with PR #753 on a shared `feature/` branch

**Status:** Proposed · **Date:** 2026-08-24 · **Raised by:** Guanzhou Song (guanzhousongmicrosoft)
**Evidence:** [#823](https://github.com/microsoft/vscode-documentdb/pull/823), [#753](https://github.com/microsoft/vscode-documentdb/pull/753), [CONTRIBUTING.md §1.4](../../../../CONTRIBUTING.md#14-large-features)

### Question

Two open PRs build a cluster dashboard. [#753](https://github.com/microsoft/vscode-documentdb/pull/753)
(khelanmodi) covers the database → collection inventory with drill-in, search and create flows.
[#823](https://github.com/microsoft/vscode-documentdb/pull/823) covers live operations with kill,
observed-operation history, privilege awareness, credential redaction, Copilot hand-off and
diagnostics export. They register **colliding context-menu commands** on the cluster tree node:

| PR   | Command id                                        | Menu title                       |
| ---- | ------------------------------------------------- | -------------------------------- |
| #753 | `vscode-documentdb.command.clusterView.open`      | Open Cluster Overview            |
| #823 | `vscode-documentdb.command.clusterDashboard.open` | Show Cluster Dashboard (Preview) |

Shipping both would put two near-identical entries in the same menu.

### Decision

Neither PR supersedes the other. Both retarget a shared `feature/cluster-dashboard` branch,
are reviewed into it individually, and reach `main` as a single PR once the combined surface is
coherent — the pattern CONTRIBUTING §1.4 describes.

### Reasoning

The two PRs are complementary rather than competing: #753 owns the **hierarchy** (cluster →
database → collection, with create flows), #823 owns the **operational surface** (live
operations, health, capability degradation, diagnostics). Choosing a winner would discard real,
independently validated work on the losing side — in #823's case the vCore capability findings
in [0008](#0008--a-tab-exists-only-when-the-server-can-answer-it-reconstructed), which were only
reachable by live testing.

The feature-branch route also resolves the command collision **before** either surface reaches
users, rather than shipping one and retrofitting the other around it, and it gives each PR the
full review sweep on its own scope.

### Rejected alternatives

- **#753 lands on `main` first, #823 rebases on top** — sequences the work but leaves the
  command collision to be settled inside a rebase, under time pressure, by whoever goes second.
- **#823 supersedes #753** — discards a contribution that has had no maintainer reply since
  2026-07-06, and #823 has no collection drill-in or create flows.
- **Split by scope and ship both to `main` separately** — still ships two menu entries; defers
  the naming problem rather than answering it.

### Open

Requires agreement from [@khelanmodi](https://github.com/khelanmodi) (author of #753) and a
maintainer. Until then this entry stays `Proposed`. The follow-on question, once convergence is
agreed, is the **single** public command id and menu title the merged surface exposes.

---

## 0010 — An opid is not an identity; occurrences are

**Status:** Superseded by [0019](#0019--currentop-is-out-of-scope-for-this-iteration) · **Date:** 2026-08-24 · **Raised by:** the two-vendor AI pre-review (S4, S10, F2)
**Evidence:** [iterations/01-poc/ai-pre-review.md](./iterations/01-poc/ai-pre-review.md#d2--occurrence-identity), commit `73a43d68`

### Question

Servers reissue `opid` as soon as an operation finishes. Three separate defects followed: a table
row keyed on `opid` kept an open Actions menu across a reissue and repointed its kill at a different
operation; the pre-kill re-check compared only `opid` and namespace, which a recycled id on the same
collection also matches; and history folded a reissued id into the previous run. Is a real identity
worth building for a POC, or does Kill stay best-effort?

### Decision

Build it. The history module assigns each continuous run an `occurrenceId`, because it is the only
place that knows whether an id is continuing or has just been handed over. Rows key on it, Kill
carries it and refuses when that occurrence is gone.

An occurrence ends when a poll stops reporting it and — the case nothing else catches — when its
elapsed clock runs backwards, which only happens when the server gave the id to something new.

### Reasoning

Kill is the only destructive action in the panel, and the failure mode was killing an operation the
user never selected, with nothing on screen to reveal it. A POC may be incomplete; it should not be
silently wrong behind a destructive action. Deferring this would also have meant shipping three
patches later instead of one idea now — the row key, the re-check and the history merge are the same
question asked in three places.

### Rejected alternatives

- **Send the displayed `secs_running` and reject a lower one.** Closes most of the window and is
  smaller, but leaves identity implicit, so the row key and the history merge stay broken.
- **Disable Kill for the POC.** Removes the demo's most compelling moment to avoid a bug that turned
  out to be tractable.
- **Defer with an issue** — the review's own recommendation. Rejected for the reason above.

---

## 0011 — Cost is bounded per connection, not per call

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** the two-vendor AI pre-review (S6, F3, F4, F8, S5)
**Evidence:** [iterations/01-poc/ai-pre-review.md](./iterations/01-poc/ai-pre-review.md#d3--polling-and-concurrency), commit `68dc3508`

### Question

Five findings described what the dashboard costs the cluster it is pointed at: a statistics limit of
eight applied per invocation while twenty panels can run at once, a `currentOp` fallback chain
re-walked every poll, two pollers asking the same question, nothing pausing while the panel was
hidden, and no procedure honouring `ctx.signal`. Coordinator now, or next iteration?

### Decision

Now. The statistics budget lives on the connection and every collector draws from it. The winning
`currentOp` form is remembered per connection. The two pollers share one request when they land in
the same tick. Polling stops while the panel is hidden. Both fan-outs take an `AbortSignal`.

### Reasoning

Every one of these is invisible to the user and visible to whoever operates the cluster. A ceiling
that was really a hundred and sixty, a poll that never stops, and a steady drip of authorization
failures into an audit log are precisely what a DBA would object to — and "it is only a POC" is not
an answer when the POC is pointed at production. Shipping first and fixing later means the first
impression is the bad one, and load complaints are hard to walk back.

The budget is claimed per command rather than per worker: a worker holding its slot for a whole pass
would let one collector take the entire budget and starve the others, which is the problem this
exists to prevent rather than a fix for it.

### Rejected alternatives

- **Restrict expansion to one database at a time.** Cheaper, but solves the symptom by removing a
  feature.
- **Cache the `currentOp` answer for the whole refresh interval.** Would let the pre-kill re-check
  act on a stale view — the exact mechanism 0010 exists to prevent. The share window is deliberately
  well under the cadence, and the re-check opts out entirely.

---

## 0012 — Warn at the sharing boundary rather than redact the preview

**Status:** Superseded by [0019](#0019--currentop-is-out-of-scope-for-this-iteration) · **Date:** 2026-08-24 · **Raised by:** the two-vendor AI pre-review (S1, S2, F12)
**Evidence:** [iterations/01-poc/ai-pre-review.md](./iterations/01-poc/ai-pre-review.md#d1--query-literals-in-the-export-clipboard-and-copilot-prompt), commit `73a43d68`

### Question

Redaction removes credential-bearing commands and secret-shaped field names. What survives is every
in-flight command's query filters and document values — application data under names no denylist can
know. Both reviewers proposed replacing the preview with a structural summary that drops literals.

### Decision

Take the warning, not the redesign. Export raises a modal naming what the document contains before
it is produced. The preview keeps showing real values.

### Reasoning

The tooltip's entire value is seeing the actual query; `{find: "orders", filter: {<string>}}` answers
none of the questions people open the Operations tab for. The export is different in kind — it
leaves the machine, and by the time anyone reads it the decision to share has already been made.
Warning at that boundary is the part that could not wait.

What a redacted-but-still-useful preview looks like is a product question. Getting it wrong is
expensive in both directions: over-redact and the feature is pointless, under-redact and it leaks
while looking safe. That is worth deciding deliberately rather than under demo pressure.

The more dangerous half was never the data — it was the comment above `exportDiagnostics` asserting
the output was already redacted and safe, which would have been inherited by every future reader.
That is gone.

### Rejected alternatives

- **Structural summary everywhere** — the reviewers' proposal. Correct about the risk, wrong about
  the cost to the feature. Revisit with a real requirement rather than in a POC.
- **Redact the export only** — plausible, but the export's value is that it reproduces what was on
  screen; a differently-redacted copy is a third representation to keep consistent.
- **Defer entirely.** Rejected: the export exists to be shared, so the gap is realised the first
  time anyone uses it as intended.

---

## 0013 — #753 is abandoned; this is the only cluster dashboard

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** Guanzhou Song (guanzhousongmicrosoft)
**Evidence:** Supersedes [0009](#0009--converge-with-pr-753-on-a-shared-feature-branch)

### Question

[0009](#0009--converge-with-pr-753-on-a-shared-feature-branch) proposed converging this work with
PR [#753](https://github.com/microsoft/vscode-documentdb/pull/753) on a shared `feature/` branch,
because the two registered colliding context-menu commands and neither was a superset of the other.
#753 has since been abandoned. What happens to the convergence?

### Decision

It does not apply. #753 is out of scope entirely. This PR targets `main` directly, the
`feature/cluster-dashboard` branch created to hold the convergence is deleted, and the cluster
dashboard is a single surface with a single command.

### Reasoning

0009 was not wrong — given two live PRs it was the right structure, and CONTRIBUTING §1.4 describes
exactly that shape. It is simply moot: a feature branch exists to let several PRs be reviewed into
one surface before it reaches `main`, and with one PR it adds a hop and nothing else.

Recording this as a reversal rather than editing 0009 is deliberate. 0009's reasoning — that the
two PRs were complementary, that neither superseded the other, and that the command collision had
to be settled before either shipped — remains the correct analysis of the situation as it stood.
A future reader finding two overlapping dashboards again should get that analysis, not a silence.

### Consequences

- **`Build & Package` runs again.** It is a required check on this repository, and its job condition
  admits only `main` and `release/**` base refs, so it was skipped for the whole time this PR
  targeted a feature branch. Retargeting restores packaging verification.
- **The command name is uncontested.** `vscode-documentdb.command.clusterDashboard.open` no longer
  competes with `clusterView.open`; the open question about a single public name is closed by there
  being only one.
- **Nothing in the code changes.** The convergence was never implemented, only proposed.

---

## 0014 — Step into a database, do not expand it

**Status:** Accepted (modified) · **Date:** 2026-09-02 · **Raised by:** Operator
**Evidence:** Three navigation prototypes built and compared side by side on a live cluster
**Modified by:** [0018](#0018--the-level-band-is-a-breadcrumb-back-stays-in-the-footer) — the exit
is a breadcrumb plus a footer button, not a back button alone.

### Question

The Data tab drew databases as a `size="small"` sortable table and a database's collections as an
`extra-small` table inside a tinted Card inside an expanded row of the first table. Two densities,
two column sets, two frames — and several expanded databases interleaved down the page. The
operator's objection: _"we mix two visual elements to show lists in two different formats."_

Three alternatives were prototyped in throwaway panels and opened together against the same
cluster: **A** a breadcrumb drill-down, **B** a back-button drill-down, **C** a split pane with no
level switching at all.

### Decision

**B.** One level is on screen at a time; both levels are drawn by the same table. A database row
steps in, a `← Databases` button steps out, and the title carries the location. The database's own
size, collection count and document count are restated beside the title, so stepping in does not
cost the reader the figures that sent them there.

### Reasoning

The two levels were never two shapes. A database and a collection are the same six facts — a named
container with a size, a data/index split, a child count, a document count — so `NamespaceTable`
renders either from one `NamespaceRow`, at one density, with one `colgroup`. Only the leading
heading and the trailing action differ, because those are the only things that actually do.

**A** was rejected on cost, not correctness: a breadcrumb is the better answer at three levels or
more, because Back degrades into a history the reader has to remember. This hierarchy is two levels
and is not growing, so the breadcrumb spent a permanent row of chrome to disambiguate a path that
cannot be ambiguous. **C** was rejected because a 320px master pane cannot afford the full column
set — it renders the same table `compact`, dropping the numeric columns — which reintroduces the
complaint that started the exercise in a subtler form.

### Consequences

- **`CollectionsPanel` is deleted**, along with the nested-table, detail-row and tinted-Card styles
  that existed only to keep the sub-table from reading as a broken continuation of its parent.
- **The fan-out concern in
  [S6](./iterations/01-poc/ai-pre-review.md#author-decisions-62) is moot.** It assumed N expanded
  databases each running their own bounded `collStats` pass; at most one database is open now. The
  shared `ConcurrencyBudget` stays — a storage pass and a collection pass still overlap.
- **`StorageTabViewState.expanded: Set<string>` becomes `currentDatabase: string | null`**, still
  hoisted to the dashboard so a trip to the Operations tab does not lose the level, the sort or the
  filter.
- **Collections are no longer cached per database.** A second visit re-reads, because a second visit
  is usually a second visit _because_ something changed.
- **The index-size column is renamed `Index size`.** With one geometry, `Indexes` would have named
  both a size and a count in adjacent columns.
- **No Alt+Left shortcut.** It was in the prototype and removed after testing: the browser performed
  a history navigation despite `preventDefault`, and a webview iframe has a history to be navigated
  out of. The Back button is focusable and reachable without it.

---

## 0015 — Storage refresh is explicit after initial load

**Status:** Accepted · **Date:** 2026-09-07 · **Raised by:** Operator
**Evidence:** Live testing and the `clusterDashboard.getStorageStats` dispatch log

### Question

Should the storage inventory re-read itself on a timer, or only when the reader asks it to?

The 60-second timer came from commit `3396eaa6`: two storage tiles sat beside live health tiles and
looked frozen when only health updated every five seconds. The later data-first restructure in
commit `a21aa57f` made the page an inventory and established [0007](#0007--nothing-above-the-fold-moves-reconstructed),
but the earlier timer survived that change. Its request set the same loading state as manual
Refresh, unexpectedly replacing the database or collection list with a skeleton and disabling the
Refresh button.

### Decision

After the dashboard's initial storage load, storage statistics are re-read only through the
reader's explicit Refresh action. There is no timed or visibility-driven storage refresh.

Entering a database still loads that database's collections because it is navigation to data that
has not yet been read, not a background refresh. Lightweight cluster-health sampling remains live
and does not replace the inventory list.

### Reasoning

Storage changes on an inventory timescale and is expensive to collect: it fans out into
per-database `dbStats` calls. More importantly, a background request should not replace a list the
reader is actively inspecting or disable its controls without an explicit action. This restores
the implementation to the interaction rule already accepted in [0007](#0007--nothing-above-the-fold-moves-reconstructed).

### Consequences

- Opening the dashboard performs the initial storage read.
- Refresh re-reads cluster storage and, when drilled into a database, that database's collections.
- Moving between the database and collection levels never triggers a cluster storage re-read.
- The five-second health sample continues independently and never puts the inventory into a loading state.

---

## 0016 — Row context-menu entries run on the host

**Status:** Accepted · **Date:** 2026-09-07 · **Raised by:** Operator, reviewing the surface after the feature reduction
**Evidence:** `clusterDashboardController.ts`, `clusterDashboardContextMenu.ts`

### Question

A row's native VS Code context menu was wired as a round trip: VS Code raised the menu command
**on the host**, the controller looked up the panel and posted a message **to the webview**, the
webview matched the action and called a `runNamespaceCommand` tRPC mutation **back to the host**,
which resolved the tree node and executed the command. Four hops for something that started and
ended in the same process.

The relay carried real cost. `runNamespaceCommand` needed a closed `NAMESPACE_COMMAND_IDS`
allowlist, because a command id was crossing the webview boundary and a webview must never be able
to name an arbitrary VS Code command for the host to run. The message contract needed a matching
runtime guard on the way in. Both existed only to police a boundary the work never actually had to
cross.

### Decision

The menu command does the work where it is raised. `openCollection` and `manageIndexes` call
`openCollectionViewInternal` directly; every tree command resolves the row's node through
`resolveNamespaceNode` and executes against it. Only **View Collections** still posts to the
webview, because stepping the open panel into a database is the one thing the host cannot do
itself.

### Reasoning

The `data-vscode-context` payload already gives the host the cluster, the database and the
collection, and the panel's own configuration supplies the display name and `viewId`. Nothing was
missing. With the command id never leaving the host, the allowlist is not a mitigation that was
removed — it is a boundary that no longer exists, which is the only safe way to delete a security
control.

Failure reporting improved as a side effect: "expand this cluster in the tree first" is now shown
by the same handler that failed, instead of being thrown across tRPC to be re-raised as a modal by
the webview.

### Consequences

- **`runNamespaceCommand` and `NAMESPACE_COMMAND_IDS` are deleted.**
- **`clusterDashboardContextMenu.ts` is now a contract, not a dispatcher**: command ids, the
  `data-vscode-context` shape, and the single `showCollections` message.
- **`openNamespace` becomes `openCollectionView`** and takes `{databaseName, collectionName}`
  rather than a `database.collection` string. The dot-splitting it needed existed because the
  namespace arrived as an operations-table `ns`; nothing produces one any more.
- Telemetry for a menu entry is now a host `clusterDashboard.contextMenuAction` event rather than a
  tRPC procedure event.

---

## 0017 — Diagnostics carry raw replies, not a second reading of them

**Status:** Accepted · **Date:** 2026-09-07 · **Raised by:** Operator, reviewing the surface after the feature reduction
**Evidence:** `getClusterHealth.ts`, `clusterDashboardRouter.ts` `exportDiagnostics`

### Question

`getClusterTopology` parsed `hello`, `replSetGetStatus`, `listShards` and `hostInfo` into a
`ClusterTopology` — roughly 250 lines of interpretation plus four exported interfaces. It was
written for the topology card, which is gone. Its only remaining consumer was the diagnostics
export, which **already carried the same four replies verbatim** in its `commands` list. Does the
interpretation still earn its place?

### Decision

No. `getClusterTopology` and its types are deleted. The four commands move into
`DIAGNOSTIC_COMMANDS`, so the export still reports everything the server said about its own shape —
just once, unmodified.

### Reasoning

The export's stated principle is that it reports what the server said rather than what the
dashboard kept. A parsed summary sitting beside the raw reply it was parsed from is a second
representation to keep consistent, and the derived one is the one that can be wrong. Nothing renders
it, so no reader would ever catch a drift.

`listShards` and `replSetGetStatus` will now be refused on clusters that are not sharded or not a
replica set. That is the intended behaviour of this document: a refusal is recorded, because
"vCore refuses `replSetGetStatus`" is a finding a bug report needs.

`currentOperations` deliberately stays interpreted. It is not a raw reply and must never become
one — mapping it is where credential-bearing commands lose their body and secret-shaped fields lose
their values.

### Consequences

- **`ClusterTopology`, `ClusterServer`, `ClusterHostFacts` and `ClusterShard` are deleted**, with
  `toReplicaSetMember`, `toHostFacts` and their tests.
- `aggregates` in the exported document is now `storage`, `currentOperations` and `health`.
- If a future surface needs a topology summary again, it is re-derivable from the replies the
  export already contains.

---

## 0018 — The level band is a breadcrumb; Back stays in the footer

**Status:** Accepted · **Date:** 2026-09-07 · **Raised by:** Recorded retrospectively while auditing the branch; rationale confirmed by the Operator
**Evidence:** commit `12485b0c`, `InventoryPanel.tsx`

### Question

[0014](#0014--step-into-a-database-do-not-expand-it) chose a back-button drill-down and rejected a
breadcrumb, on the grounds that a two-level hierarchy cannot produce an ambiguous path and so does
not need a permanent row of chrome to disambiguate one. The implementation subsequently adopted a
breadcrumb anyway, without recording the reversal. Which is the decision?

### Decision

The breadcrumb. The band above the table is a `Databases › <name>` breadcrumb at both levels, and
the `← Back to Databases` button stays in the list footer.

### Reasoning

0014's argument was about _disambiguation_ and it still holds — the breadcrumb is not earning its
place by resolving an ambiguous path. It earns it by being the same height at both levels. The
title-plus-back-button band it replaced changed height when stepping in, which moved the filter
row and the table underneath it on every drill-in and drill-out.

The footer's Back button is kept deliberately, for readers who do not work out that the breadcrumb
is clickable. That is not a hypothetical: a dashboard opened from a database node's inline command
lands **already inside a database**, so its reader never saw the database list, never performed the
step-in, and has no reason to read the trail above the table as a way back out. A labelled button
says what the breadcrumb only implies. It costs no vertical space, because it shares the footer's
existing row.

This entry exists mainly so the record matches the code: 0014 is otherwise a correct account of a
navigation model that the branch no longer implements in one of its details.

---

## 0019 — `currentOp` is out of scope for this iteration

**Status:** Accepted · **Date:** 2026-09-08 · **Raised by:** Operator
**Supersedes:** [0003](#0003--confirmation-on-the-host-kill-reports-the-request-not-the-outcome-reconstructed),
[0010](#0010--an-opid-is-not-an-identity-occurrences-are) · **Makes moot:**
[0012](#0012--warn-at-the-sharing-boundary-rather-than-redact-the-preview)

### Question

The Operations tab, the kill action and the observed-operation history were removed when the page
became a data inventory ([0006](#0006--the-page-is-a-data-inventory-not-a-performance-dashboard-reconstructed)).
`listCurrentOperations` survived them, feeding a `currentOperations` section of the diagnostics
export. Nothing on screen reads it. Does the iteration keep it?

### Decision

No. `currentOp` leaves this iteration entirely. The collector, its four-form privilege fallback,
its background-thread and self-inspection filters, and the credential-redaction pass over command
documents are deleted, along with the `currentOperations` section of the export.

### Reasoning

It was the last thing in the feature that read **what someone is running**, and therefore the only
thing that put application data — query filter values, document contents, the client addresses
that issued them — anywhere near a document a user is invited to attach to a bug report.

That single fact was carrying a disproportionate amount of machinery. Redaction could remove
credentials but, as [0012](#0012--warn-at-the-sharing-boundary-rather-than-redact-the-preview)
records, no denylist can recognise application data, so the export had to be gated behind a modal
that named what it could not remove. Dropping the source removes the exposure, the denylist, the
argument about how much of a query to redact, and the modal's most alarming clause in one move.
The remaining machinery was in the same position: a privilege-degradation chain and two
server-quirk filters, all reachable only through a JSON blob nobody was reading.

**"For this iteration" is the operative phrase.** Live operations remain a reasonable thing for a
cluster dashboard to show, and the work that was deleted was correct — the vCore parallel-worker
and self-inspection findings in particular were only reachable by live testing. When operations
come back they should come back as a **surface**, designed with its own answer to the redaction
question, rather than as a payload smuggled into an export.

### Rejected alternatives

- **Keep the export section, drop the modal.** The cheapest change, and the worst: it removes the
  warning while leaving the thing being warned about.
- **Keep it and redact structurally** (`{find: "orders", filter: {<string>}}`). 0012 rejected this
  while a tooltip existed to justify the literals. With no tooltip there is no longer a feature on
  the other side of the trade — only a lossy summary in a file nobody reads.
- **Leave the collector in place, unused.** Dead code that reads customer data is the kind that
  gets re-wired by someone who assumes it was reviewed for the use they have in mind.

### Consequences

- `listCurrentOperations`, `CurrentOpEntry`, `CurrentOperationsResult`, `CurrentOpScope`,
  `buildCommandPreview` and the credential name/fragment denylists are deleted, with their tests.
- The export's `aggregates` is now `storage` and `health`.
- **The export confirmation stays, with honest wording.** The document no longer contains
  application data, but it still names every database and collection and the addresses of the
  servers behind them. That is a description of someone's estate, and one dialog before producing
  a file whose purpose is to be sent elsewhere is proportionate. It no longer claims that
  application data is in there.
- Nothing in the dashboard requires the `inprog` privilege any more.
