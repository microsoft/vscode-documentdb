# Cluster Dashboard — Restructure Plan (data-first)

Status: **proposal**, responding to review feedback on the POC.

> **Feedback received:** too many dynamic / interactive components; the page should focus on
> the database itself; storage should come first.

This document tests that feedback against how comparable products present a database portal,
then proposes a concrete restructure. Short version: the feedback is supported by both the
competitive evidence and the platform's real capabilities, and it happens to move the page
*towards* what Azure DocumentDB (vCore) can actually answer.

---

## 0. Design thesis

The tactical reading of the feedback is "reorder the tabs." The structural reading is that
the POC built the wrong *kind* of page, and the restructure should fix the identity, not the
ordering. Three commitments:

**1. This page is a place, not a feed.** A monitoring dashboard treats the server as a
patient: vitals, waveforms, constant motion, watched during an incident. An inventory treats
the database as a place: a map of what exists, visited between edits for orientation. A
developer inside VS Code is mid-task in their own code; they come here to get oriented —
"what's in this cluster, how big, did my import land" — not to keep vigil. Every design
question resolves differently depending on which of these the page is. It is the second.

**2. Nothing above the fold moves.** Motion is a claim on the user's attention, so it must
be earned by change the user cares about. The inventory changes on the timescale of
deployments; operations change on the timescale of seconds. Therefore: the header, tiles and
landing tab are static (refresh on open and on demand), and polling/animation are confined
to the Operations tab while it is the active tab. This is a rule, not a pruning exercise —
it decides every future "should this auto-refresh?" question in advance.

**3. The dashboard is the top of the map, and every row leads down.** The extension already
has per-collection surfaces: Collection View, the Indexes tab (PR #732), shell, playgrounds.
What no surface shows is the *whole cluster at once*. That aggregation is this page's entire
reason to exist — so it must never duplicate a leaf feature, only rank, summarize, and route
into them. Cluster → database → collection is the product's natural hierarchy; the dashboard
is its first level, not a separate genre of page bolted onto the side.

Two consequences worth naming. *Family coherence*: we are not "vscode-pgsql minus the eight
metric groups vCore can't answer" — a document database's center of gravity is its
collections, so a collection-ranked inventory is the DocumentDB-native counterpart of
pgsql's performance dashboard, not a diminished copy. *Agent-readiness*: a ranked, static,
table-shaped inventory is also the artifact an AI agent can consume and cite, which keeps
this restructure aligned with the Ask-Copilot direction rather than in tension with it.

---

## 1. Research — what comparable products show, and where

### 1.1 The two genres

Every product surveyed falls into one of two genres. They answer different questions and
they are not interchangeable.

| | **A. Performance dashboard** | **B. Data inventory / content browser** |
|---|---|---|
| Question | "Is the server healthy *right now*?" | "What is in this database, and what does it cost?" |
| Content | Time-series charts, sessions, waits, locks | Sorted tables: objects, sizes, counts |
| Motion | Live polling, animated charts, crosshairs | Static until refreshed |
| Audience | DBA / on-call operator | Developer working with the data |
| Examples | pgAdmin Dashboard, vscode-pgsql, Atlas RTPP | Compass, Studio 3T, SSMS reports, Supabase |

**The POC built genre A.** Our users are developers inside an editor, opening a cluster they
are building against. That is a genre B audience.

### 1.2 Product-by-product

**vscode-pgsql "Server Dashboard"** — our closest sibling, and the design doc's original
model. Details card → toolbar → four investigation tabs (Overview, Queries, Waits,
Sessions). Overview is the default and holds **nine** collapsible metric groups (Resources,
Connections, Disk I/O, Storage, Transactions & Workload, Wait Events, Maintenance &
Autovacuum, Transaction ID Safety, Replication), with legend toggles, synchronized
crosshairs, zoom, timezone and 1 h–30 d window selectors.

Two observations that matter for us:

- It is explicitly named a **Performance Dashboard**, and Storage is *one of nine* metric
  groups — not the headline. That is a defensible choice for Postgres, where the server
  exposes deep runtime statistics.
- **We cannot build this on vCore even if we wanted to.** Verified against a live M10:
  `serverStatus`, `$collStats {latencyStats}`, `top` are rejected, and `getLog` returns
  empty. Of pgsql's nine groups, the only one we can populate from the data plane is
  **Storage**.

**pgAdmin 4** — Dashboard tab with graphs (server/database sessions, transactions per
second, tuples in, tuples out, block I/O) plus a Server activity panel (sessions, locks,
prepared transactions). Notably, pgAdmin *also* ships a per-object **Statistics** tab —
static, tabular, no animation — which is where object sizes actually live. The live graphs
and the object inventory are deliberately separate surfaces.

**SSMS "Disk Usage by Top Tables"** — right-click database → Reports → Standard Reports. A
static table of the top 1000 tables sorted largest first, with row counts and index space.
No charts, no refresh loop. This is the closest existing thing to what the feedback asks
for, and it has survived two decades essentially unchanged — evidence that the format works.

**MongoDB Compass** — navigation is data-first: a Databases list, then a Collections list
per database, each row carrying general information about the object, then documents.
Real-time performance is a *separate* surface, not the landing view.

**MongoDB Atlas** — "Namespace Insights" ranks the **top 20 collections** by latency. The
unit of analysis is the collection, not the server. We cannot copy the metric
(`latencyStats` is unsupported on vCore) but the *shape* — a ranked list of collections —
is exactly right, and we can rank by size instead.

**Studio 3T** — Collection Statistics per collection: total storage size plus the size of
each index. Their own guidance for "all collections at once" is to run a script and **sort
the columns to find the collection with the most records, largest storage, or biggest
indexes**. That sentence is a product requirement in disguise.

**Azure Portal (Cosmos DB for MongoDB vCore)** — metrics blade with storage, data usage and
index usage per container; 5-minute aggregation, 7-day retention. Anything we build that is
purely time-series is competing with this and losing, because the portal has server-side
history and we have a 5-minute in-memory ring buffer.

**Supabase** — the Table Editor is the primary database surface. Notably they separate
**database size** (actual data) from **disk size** (data + WAL + logs) onto different pages,
because conflating them confuses people about what they are paying for.

### 1.3 What the UX literature says

A systematic review of 75 studies found **information overload is the most prevalent
dashboard problem, affecting 46.7% of users**, driven by excessive data density, poor visual
hierarchy, and lack of contextual filtering — and that most dashboards overwhelm because
they are *built to display raw data rather than support decisions*.

The prescribed remedies map directly onto the feedback:

- **Limit the number of visual elements** on one screen.
- **Progressive disclosure** — a clean summary first, drill down on demand.
- **Visual hierarchy** — most relevant information first, specifics revealed progressively.

### 1.4 Conclusions

1. **The feedback is correct and evidence-backed.** Storage-first matches genre B, matches
   our audience, matches the UX guidance, and matches what vCore can actually answer.
2. **Our differentiator is not live charts.** Azure Portal beats us on history; Compass beats
   us on polish. What neither has: *in-editor, one keystroke from the code, with actions that
   lead into the collection you were already working on*.
3. **The unit of analysis should be the collection, not the server.** Atlas, Studio 3T, SSMS
   and Compass all converge on this. Our Storage tab currently stops at the database.
4. **Operations stays — it just isn't the front page.** It is genuinely useful and genuinely
   differentiated (nothing else in VS Code can kill a running operation), but it answers a
   firefighting question, which is not the common case.

---

## 2. Proposed structure

```
┌───────────────────────────────────────────────────────────────────────────┐
│  ⚡ gsong-ddb-poc-test                     ● Connected      [PREVIEW]     │
│  Azure DocumentDB (vCore) · 8.0.0 · Sharded cluster · engine 1.115.0      │
│───────────────────────────────────────────────────────────────────────────│
│  [⟳ Refresh]  [Open Shell] [New Playground]  [Export diagnostics]         │
│───────────────────────────────────────────────────────────────────────────│
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐             │
│  │ Storage    │ │ Documents  │ │ Databases  │ │ Indexes    │             │
│  │ 60.3 MB    │ │ 231,000    │ │ 5 / 11     │ │ 29 · 62 MB │             │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘             │
│───────────────────────────────────────────────────────────────────────────│
│  [ Storage ]  [ Operations ]  [ Activity ]                                │
│  ──────────                                                               │
│   Databases, largest first — expand a row for its collections             │
│   ▼ iot            19.4 MB ████████████  80,800 docs   2 colls   18.0 MB  │
│       telemetry    18.9 MB ███████████   80,000 docs   3 idx     17.2 MB  │
│       devices       0.5 MB ▏                 800 docs   2 idx      0.8 MB  │
│   ▶ observability  13.4 MB ████████       50,000 docs   1 coll   13.3 MB  │
│   ▶ analytics      12.0 MB ███████        66,000 docs   2 colls   19.5 MB │
└───────────────────────────────────────────────────────────────────────────┘
```

**Changes from today:**

| | Now | Proposed |
|---|---|---|
| Default tab | Overview (charts) | **Storage** |
| Tab order | Overview, Operations, Storage | **Storage, Operations, Activity** |
| Status tiles | Latency, Active ops, Storage, DBs/Colls | **Storage, Documents, Databases/Collections, Indexes** |
| Storage depth | per database | **per database → expand → per collection** |
| Sparklines | on 2 tiles + 2 large charts | large charts only, on the demoted Activity tab |
| Poll cadence | everything at 5 s | Storage on open + manual; Operations 5 s only while its tab is active |

---

## 3. Work items

Ordered by value per unit of effort. WI-1 to WI-4 are the restructure; the rest are
follow-on.

**WI-1 — Make the inventory the landing view.** `ClusterDashboard.tsx`: default tab becomes
the inventory, tab order becomes **Data, Operations, Activity**. Rename Storage → **Data**:
storage size is one *column* of the inventory (alongside documents, collections, indexes),
not the concept — the tab is the map of the cluster, and its name should say so. Rename
Overview → Activity. *Effort: minutes. This alone delivers most of the feedback.*

**WI-2 — Data-first status strip.** Replace Latency and Active Operations tiles with
Documents and Indexes; keep Storage and Databases/Collections. Latency moves to the Activity
tab. Requires summing `objects` and index sizes already present in `ClusterStorageStats`,
plus adding an index count. *Effort: small. Removes two animated sparklines from above the
fold, directly addressing "too many dynamic components".*

**WI-3 — Collection-level drill-down.** Extend `getStorageStats` to fetch
`$collStats {storageStats}` per collection for an expanded database (lazily, on expand — not
for every database on load). Verified working on vCore: returns `count`, `size`,
`storageSize`, `totalIndexSize`, `avgObjSize`, `nindexes`. Render as an expandable row group,
sortable by size. Row actions: **Open Collection**, **Manage indexes** (deep link into PR
#732's Indexes tab). *Effort: medium. This is the substance of "focus on the database
itself", and the convergent pattern across Atlas, Studio 3T, SSMS and Compass.*

**WI-4 — Calm the refresh model.** Storage refreshes on open and on explicit Refresh only.
Operations polls only while its tab is selected. Health sampling continues (the connection
badge depends on it) but at a slower default. *Effort: small–medium. Also fixes the deferred
review findings about hidden-panel polling.*

**WI-5 — Total vs. on-disk honesty.** Adopt Supabase's distinction: label what we sum as
data + index size, and note that it is not the provisioned disk. *Effort: small.*

**WI-6 — Empty/first-run state.** A cluster with no user databases currently shows a bare
sentence. Make it the moment to offer "Create Database" / "Open Shell". *Effort: small.*

**WI-7 (later) — Azure storage percentage.** The one genuinely useful gauge the data plane
cannot provide: used vs. provisioned disk, from Azure Monitor. Belongs to the existing
Phase-2 Azure work, not this restructure.

### Explicitly not doing

- **No new chart types.** The direction is fewer moving parts, not different ones.
- **No index advice here** — PR #732 owns it; we link.
- **No removal of Operations or the kill flow.** It is demoted, not deleted: it is the
  clearest differentiator we have, and the pgsql precedent keeps an equivalent tab.

---

## 4. Trade-offs to state out loud

- **The live demo gets quieter.** The kill loop is the most compelling thing to *watch*;
  moving it off the landing tab means the first screen is a table. That is the correct
  trade for daily use and a small loss for a five-minute demo. Mitigation: the demo can still
  open on Storage and *navigate* to Operations, which is a better narrative anyway ("here is
  your data… and here is what is happening to it right now").
- **We diverge from vscode-pgsql.** Worth being deliberate: we diverge because our server
  cannot answer eight of their nine metric groups, not because we disagree with their design.
  That is a defensible answer if the family-consistency question is raised.
- **Collection-level stats cost round trips.** `$collStats` per collection on a database with
  hundreds of collections is not free. Hence lazy expansion and a cap, mirroring the existing
  `DATABASE_STATS_LIMIT` treatment.

## 5. Positions on the open questions

Taken from the design thesis rather than left open:

1. **Activity is capability-gated, and absent on vCore.** The thesis says tabs exist because
   the server can answer them. On vCore, Activity could only ever show ping latency (a
   number, not a story) and a currentOp sampling artifact presented as a rate — a chart that
   moves without informing, which is precisely the feedback. So: genuine MongoDB servers and
   the emulator (where `serverStatus` works) get the Activity tab with real opcounters;
   vCore does not get the tab at all, and latency lives beside the connection badge in the
   header. This is stronger than "hide the broken chart": it means the dashboard's shape is
   *grown from the capability probe*, which is the degradation model the design doc promised
   all along.
2. **Sort: size descending** (the SSMS model). The landing view answers "what is big?" with
   zero input. Sortable columns cover every other ordering.
3. **System databases: hidden, with a footnote count** ("3 system databases not shown"), not
   a toggle. A toggle is one more interactive component whose payoff is admin/local/config —
   the audience for those uses the shell.
