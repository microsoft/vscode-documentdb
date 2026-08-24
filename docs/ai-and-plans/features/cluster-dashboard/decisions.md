---
feature: cluster-dashboard
kind: decisions
status: active
prs: [823]
created: 2026-08-24
---

# Cluster Dashboard — Decisions

> The decisions that shaped the Cluster Dashboard, and what was rejected on the way.

| #    | Decision                                                  | Status              | Changed from the proposal?                         | Date       | PR   |
| ---- | --------------------------------------------------------- | ------------------- | -------------------------------------------------- | ---------- | ---- |
| 0001 | Poll from the webview, not tRPC subscriptions             | Accepted            | Accepted as proposed, scoped down for the POC      | 2026-07-27 | #823 |
| 0002 | Per-command try/catch, no capability probe                | Accepted            | Accepted as proposed                               | 2026-07-27 | #823 |
| 0003 | Confirmation on the host; kill reports the request        | Accepted (modified) | Outcome vocabulary added after live testing        | 2026-07-28 | #823 |
| 0004 | Custom SVG sparkline instead of a charting dependency     | Accepted            | Accepted as proposed                               | 2026-07-27 | #823 |
| 0005 | Panel de-duplication keyed on `clusterId`, never `treeId` | Accepted            | Accepted as proposed                               | 2026-07-27 | #823 |
| 0006 | The page is a data inventory, not a performance dashboard | Accepted            | **Reverses the genre-A model in `design.md` §1.1** | 2026-07-28 | #823 |
| 0007 | Nothing above the fold moves                              | Accepted            | Raised from a review note to a standing rule       | 2026-07-28 | #823 |
| 0008 | A tab exists only when the server can answer it           | Accepted            | Emerged from live vCore testing, not the plan      | 2026-07-28 | #823 |
| 0009 | Converge with PR #753 on a shared `feature/` branch       | Proposed            | Needs sign-off from #753's author and a maintainer | 2026-08-24 | #823 |

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

**Status:** Accepted (modified) · **Date:** 2026-07-28 · **Raised by:** implementation, then live testing
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

**Status:** Accepted · **Date:** 2026-08-24 · **Raised by:** the two-vendor AI pre-review (S4, S10, F2)
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

**Status:** Accepted (modified) · **Date:** 2026-08-24 · **Raised by:** the two-vendor AI pre-review (S1, S2, F12)
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
