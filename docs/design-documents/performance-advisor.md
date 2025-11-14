# Query Insights Tab & Advisor

This document outlines the structure and data presented in the **Query Insights** tab for query analysis within the DocumentDB VS Code extension.

---

## 1. Overview

When a user executes a `find` (and other explainable read commands), a **Query Insights** tab appears alongside **Results**. The feature is organized in **three stages**:

1.  **Initial View (cheap data + plan)**
    Show a **Summary Bar** with immediate, low-cost metrics (client timing, docs returned) and parse the **query planner** via `explain("queryPlanner")`. No re-execution.
2.  **Detailed Execution Analysis (cancellable)**
    Run `explain("executionStats")` to gather authoritative counts and timing. Populate the Summary Bar with examined counts and render per-shard stage details.
3.  **AI-Powered Advisor (opt-in)**
    Send the collected statistics (shape + metrics) to an AI service for actionable recommendations.

> **Note on Aggregation Pipelines**
> The **API** returns explain data for aggregation pipelines in a structure that differs from `find`. We will document pipeline handling separately when we implement pipeline insights. This document focuses on `find` and similarly structured read commands.

---

## 2. Stage 1: Initial Performance View (Cheap Data + Query Plan)

Populated as soon as the query finishes, using fast signals plus `explain("queryPlanner")`. No full re-execution.

### 2.1. Metrics Row (Top Area)

> **Always visible**, displayed as individual metric cards. For **sharded** queries, aggregate across shards; for **non-sharded**, show single values.

**Metrics displayed:**

- **Execution Time** — Shows server timing from Stage 2 (e.g., `180 ms`)
- **Documents Returned** — Count of documents in result set (e.g., `100`)
- **Keys Examined** — Shows `n/a` until Stage 2, then actual count (e.g., `100`)
- **Docs Examined** — Shows `n/a` until Stage 2, then actual count (e.g., `100`)

**Aggregation rules (when sharded):**

- `KeysExamined = Σ shard.totalKeysExamined`
- `DocsExamined = Σ shard.totalDocsExamined`
- `Documents Returned`: prefer top-level `nReturned` once Stage 2 runs; before that, use the count in **Results**.
- `Execution Time`: prefer `executionTimeMillis` (Stage 2); otherwise client timing.

**Stage 1 — Metrics display**

All metrics shown in individual metric cards. Initially:

- Execution Time: Shows client timing (e.g., `180 ms`)
- Documents Returned: Shows count from results (e.g., `100`)
- Keys Examined: `n/a`
- Docs Examined: `n/a`

### 2.2. Query Plan Summary (Planner-only)

Built from `explain("queryPlanner")`. This is **fast** and does **not** execute the plan. Use it to populate concise UI without runtime stats.

#### What we show (planner-only)

- **Winning Plan** — the **full logical plan tree** chosen by the planner (not just a single stage).
- **Rejected Plans** — a count, if exists
- **Targeting (sharded)** — which shards are listed in `shards[]`.
- **Execution Time (client)** — end-to-end as measured by the client (the planner has no server timing).

#### Non-sharded example (planner-only)

**Winning plan (snippet)**

```json
{
  "queryPlanner": {
    "parsedQuery": { "status": { "$eq": "PENDING" } },
    "winningPlan": {
      "stage": "PROJECTION",
      "inputStage": {
        "stage": "FETCH",
        "inputStage": {
          "stage": "IXSCAN",
          "indexName": "status_1",
          "keyPattern": { "status": 1 },
          "indexBounds": { "status": ["[\"PENDING\",\"PENDING\"]"] }
        }
      }
    },
    "rejectedPlans": [{ "planSummary": "COLLSCAN" }]
  }
}
```

**UI from this plan**

- **Winning Plan:** `IXSCAN → FETCH → PROJECTION`
- **Rejected Plans:** `1 other plan considered` (`COLLSCAN`)

#### Sharded example (planner-only)

**Targeting & per-shard plans (snippet)**

```json
{
  "queryPlanner": {
    "winningPlan": {
      "stage": "SHARD_MERGE",
      "inputStages": [
        {
          "shardName": "shardA",
          "winningPlan": {
            "stage": "FETCH",
            "inputStage": {
              "stage": "IXSCAN",
              "indexName": "status_1",
              "indexBounds": { "status": ["[\"PENDING\",\"PENDING\"]"] }
            }
          }
        },
        {
          "shardName": "shardB",
          "winningPlan": {
            "stage": "COLLSCAN",
            "filter": { "status": { "$eq": "PENDING" } }
          }
        }
      ]
    },
    "rejectedPlans": []
  }
}
```

**UI from this plan**

- **Targeting:** `shards[] = [shardA, shardB]`
- **Merge Summary:** top node `SHARD_MERGE` (results will be merged).
- **Per-shard Winning Plans:**
  - **shardA:** `IXSCAN → FETCH`
  - **shardB:** `COLLSCAN` **(badge)**
- **Rejected Plans:** `0`

#### Answers to common UI questions (planner-only) (these are actualy relevant to stage 2)

- **Is “Winning Plan” the whole plan or just `IXSCAN`?**
  It’s the **whole plan tree** chosen by the planner. Render it as a sequential spine; `IXSCAN` is the access stage within that plan.

- **How many plans were considered? Do we know why rejected?**
  The planner returns a **list/count of `rejectedPlans`** (summaries only). No per-plan runtime stats or explicit rejection reasons in planner-only mode.

- **Are the index bounds good or bad?**
  **Good bounds** are narrow and specific, minimizing the keys scanned. An equality match like `status: ["PENDING", "PENDING"]` is very efficient. **Bad bounds** are wide or unbounded, forcing a large index scan. For example, `status: ["[MinKey", "MaxKey"]` means the entire index is scanned, which offers no filtering advantage and is often a sign that the index is only being used for sorting. Flag this as **Unbounded bounds**.

- **Why is an in-memory sort bad?**
  A `SORT` stage means results are sorted outside index order, which is typically slower and memory-heavy. If a `SORT` stage is present in the plan (or implied by the requested sort without an index), flag **Blocked sort**; confirm in Stage 2.

- **How to know if no `FETCH` is expected (index-only/covering)?**
  If the winning path **does not include `FETCH`** and the projection uses only indexed fields, mark **Index-only**. Confirm in Stage 2 (executed plan).

### 2.3. Query Efficiency Analysis Card

> **PENDING**: This card is implemented in the UI mock but needs data model design.

A summary card displaying high-level query efficiency metrics:

- **Execution Strategy** — The top-level stage type (e.g., `COLLSCAN`, `IXSCAN`, `SHARD_MERGE`)
- **Index Used** — Name of the index if IXSCAN, otherwise "None"
- **Examined/Returned Ratio** — Formatted ratio (e.g., `5,000 : 1`)
- **In-Memory Sort** — Yes/No indicator if SORT stage is present
- **Performance Rating** — Visual rating (Good/Fair/Poor) with description based on efficiency metrics

### 2.4. Call to Action

> **[Button] Run Detailed Analysis**
>
> _Runs `explain("executionStats")` to populate examined counts, timing, and per-stage stats._
>
> **Note**: In the current implementation, Stage 2 analysis starts automatically after Stage 1 completes.

---

## 3. Stage 2: Detailed Execution Analysis (executionStats)

Built from `explain("executionStats")`. Executes the winning plan to completion (respecting `limit/skip`) and returns **authoritative runtime metrics**.

### 3.1. Metrics Row (now authoritative)

Replace `n/a` with real values from `executionStats`.

**Stage 2 — Metrics display**

All metrics updated with authoritative server data:

- **Execution Time:** Server-reported `executionTimeMillis` (e.g., `120 ms`)
- **Documents Returned:** From `nReturned` (e.g., `100`)
- **Keys Examined:** From `totalKeysExamined` (e.g., `100`)
- **Docs Examined:** From `totalDocsExamined` (e.g., `100`)

### 3.2. Query Efficiency Analysis Card (now populated)

The Query Efficiency Analysis card is updated with real execution data:

- **Execution Strategy:** Extracted from top-level stage (e.g., `COLLSCAN`, `IXSCAN`)
- **Index Used:** From IXSCAN stage's `indexName` or "None"
- **Examined/Returned Ratio:** Calculated as `DocsExamined : Returned` (e.g., `5,000 : 1`)
- **In-Memory Sort:** Detected from presence of SORT stage
- **Performance Rating:** Calculated based on examined/returned ratio:
  - Good: < 10:1
  - Fair: 10:1 to 100:1
  - Poor: > 100:1

### 3.3. Execution details (what we extract)

- **Execution Time** — server-reported `executionTimeMillis` (prefer this over client time).
- **nReturned** — actual output at the root (and per shard, when available).
- **totalDocsExamined / totalKeysExamined** — totals (and per shard).
- **DocsExamined / Returned ratio** — efficiency signal (warn > 100, danger > 1000).
- **Per-stage counters** — from `executionStages`, including `keysExamined`, `docsExamined`, `nReturned` at each stage.
- **Sort & memory** — if a `SORT` stage indicates in-memory work or spill, surface it.
- **Covering** — confirm **no `FETCH`** in the executed path when index-only.
- **Sharded attribution** — a **per-shard overview** row (keys, docs, returned, time) with badges, plus aggregated totals.

**PENDING/EVALUATING**: The following features from the original design are not yet in the UI mock:

- Per-shard breakdown visualization (sharded queries)
- Rejected plans count display
- Detailed per-stage counters view (currently shows high-level stage flow)
- Badges for specific issues (COLLSCAN, Blocked sort, Inefficient, Spilled, Unbounded bounds, Fetch heavy)

### 3.3. Non-sharded example (executionStats)

**Execution summary (snippet)**

```json
{
  "executionStats": {
    "nReturned": 100,
    "executionTimeMillis": 120,
    "totalKeysExamined": 100,
    "totalDocsExamined": 100,
    "executionStages": {
      "stage": "PROJECTION",
      "nReturned": 100,
      "inputStage": {
        "stage": "FETCH",
        "nReturned": 100,
        "docsExamined": 100,
        "inputStage": {
          "stage": "IXSCAN",
          "indexName": "status_1",
          "keysExamined": 100,
          "nReturned": 100
        }
      }
    }
  }
}
```

**UI from this execution**

- **Execution Time:** `120 ms`
- **nReturned / Keys / Docs:** `100 / 100 / 100`
- **Docs/Returned:** `1 : 1` (Not covering because `FETCH` exists).
- **Plan confirmation:** `IXSCAN(status_1) → FETCH → PROJECTION` with per-stage counters.
- **Sort path:** no `SORT` node → no blocked sort.

### 3.4. Sharded example (executionStats)

**Merged + per-shard stats (snippet)**

```json
{
  "executionStats": {
    "nReturned": 50,
    "executionTimeMillis": 1400,
    "totalKeysExamined": 8140,
    "totalDocsExamined": 9900,
    "executionStages": {
      "stage": "SHARD_MERGE",
      "nReturned": 50,
      "inputStages": [
        {
          "shardName": "shardA",
          "executionStages": {
            "stage": "FETCH",
            "nReturned": 30,
            "docsExamined": 7500,
            "inputStage": {
              "stage": "IXSCAN",
              "indexName": "status_1",
              "keysExamined": 6200
            }
          }
        },
        {
          "shardName": "shardB",
          "executionStages": {
            "stage": "SORT",
            "inMemorySort": true,
            "nReturned": 20,
            "inputStage": {
              "stage": "COLLSCAN",
              "docsExamined": 2400
            }
          }
        }
      ]
    }
  }
}
```

**UI from this execution**

- **Execution Time:** `1.4 s`
- **nReturned / Keys / Docs (Σ):** `50 / 8,140 / 9,900`
- **Docs/Returned:** `198 : 1` **(warn)**
- **Per-shard overview:**
  - **shardA:** keys `6,200`, docs `7,500`, returned `30`
  - **shardB:** keys `0`, docs `2,400`, returned `20`, **COLLSCAN**, **Blocked sort**
- **Merge Summary:** `SHARD_MERGE` (final merge).
- **Attribution:** surface shardB as the bottleneck (sort rows by worst efficiency).

### 3.5. Answers to common UI questions (executionStats)

- **Is the winning plan still the whole plan?**
  Yes. `executionStages` is the executed **plan tree** with per-stage counters. Render as the same sequential spine (plus optional details toggle).

- **How many plans were considered? Do we know why rejected?**
  `executionStats` covers the **winning plan** only. Use Stage 1’s `rejectedPlans` to show candidate count. If you ever run `allPlansExecution`, you can show per-candidate runtime stats; otherwise there’s **no rejection reason** here.

- **How to confirm that an index was used?**
  Look for **`IXSCAN`** in `executionStages` with a concrete `indexName` and non-zero `keysExamined`. Aggregate across shards where present.

- **How to confirm a blocked/in-memory sort?**
  Presence of a `SORT` stage with indicators like `inMemorySort` or memory metrics confirms sorting outside index order. Badge **Blocked sort** and display any memory/spill hints provided.

- **How to confirm index-only (no `FETCH`)?**
  Verify the executed path **does not contain `FETCH`** and that the projection uses only indexed fields. If true, mark **Index-only** (covering). If a `FETCH` appears, full documents were read.

- **How to attribute work in sharded scenarios?**
  Use per-shard `executionStages` to populate a **per-shard overview list** (keys, docs, returned, time) and compute **aggregated totals** for the Summary Bar.

### 3.6. Quick Actions

> **Added in implementation**: A card with action buttons appears after Stage 2 completes.

**Available actions:**

- **Export Optimization Opportunities** — Export AI suggestions and recommendations
- **Export Execution Plan Details** — Export the execution statistics
- **View Raw Explain Output** — Show the raw explain command output

### 3.7. Call to Action

> **[Button] Get AI Suggestions**
>
> _The collected, non-sensitive query shape and execution statistics will be sent to an AI service to generate performance recommendations. This may take 10-20 seconds._

---

## 4. Stage 3: AI-Powered Recommendations

After Stage 2 completes, users can optionally request AI-powered analysis of their query performance.

### 4.1. Optimization Opportunities Section

The "Optimization Opportunities" section displays AI-generated suggestions as animated cards:

**AI Suggestion Cards** include:

- **Title** — Brief description of the optimization (e.g., "Create Index")
- **Priority Badge** — Optional badge for high-priority issues (e.g., "HIGH PRIORITY")
- **Explanation** — Detailed reasoning based on execution stats
- **Recommended Action** — Specific index definition or query modification
- **Code Snippet** — Copy-able command (e.g., `createIndex` command)
- **Risks** — Potential downsides or considerations
- **Action Buttons** — "Apply", "Copy", "Learn More"

**Example AI Suggestions:**

1. **Create Index** (High Priority)
   - Identifies COLLSCAN with poor selectivity
   - Recommends specific index definition
   - Shows before/after execution plan comparison

2. **No Index Changes Recommended**
   - Explains when existing strategy is optimal
   - Provides context on selectivity and performance

3. **Understanding Your Query Execution Plan**
   - Educational content explaining how the query executes
   - Visual breakdown of execution stages
   - Helps users understand the impact of optimizations

### 4.2. Performance Tips Card

An optional educational card with general DocumentDB performance best practices:

- **Use Covered Queries** — Return results from index without fetching documents
- **Optimize Index Strategy** — Compound index best practices
- **Limit Returned Fields** — Use projection to reduce data transfer
- **Monitor Index Usage** — Identify and remove unused indexes

**Interaction:**

- Can be dismissed by user
- Appears during AI processing to provide context
- Re-appears if AI suggestions are requested again

### 4.3. Animation and Loading States

**Loading experience:**

- Shows loading indicator on "Get AI Suggestions" button
- Displays Performance Tips card while waiting
- Stagger-animates AI suggestion cards (1 second between each)
- Smooth transitions using CollapseRelaxed animation

### 4.4. Data Sent to AI Service

**PENDING/EVALUATING**: Document the exact data structure sent to AI service, including:

- Query shape (without literal values)
- Execution statistics
- Collection schema information
- Index definitions

---

## 5. Tech Background: Paging and Query Scope

The current paging implementation in the extension relies on `skip` and `limit` to display results in pages. This approach is practical for some scenarios. For instance, the MongoDB RU (Request Unit) implementation has a cursor that expires after 60 seconds, making it risky to maintain a long-lived cursor for paging. Using `skip` and `limit` provides a stateless and reliable way to handle pagination in such environments.

However, this presents a challenge for the Query Insights tab. The `explain` plan reflects the query with `skip` and `limit`, which analyzes the performance of fetching a single page, not the overall query. For meaningful performance analysis, the insights should be based on the entire query scope, without the paging modifiers.

To address this, we should consider one of the following solutions:

1.  **Rebuild Paging Entirely**: We could move to a cursor-based paging system. In this model, we would initiate a cursor for the base query (without `skip` or `limit`) and fetch documents page by page. This way, the `explain` plan would analyze the performance of the full query, providing a more accurate picture.
2.  **Run an Unbounded Query for Analysis**: Alternatively, when the performance tab is activated, we could run a separate, unbounded query (without `skip` or `limit`) specifically for `explain("executionStats")`. This would allow us to gather performance metrics for the full query scope while keeping the existing `skip`/`limit` paging for the results view.

The goal is to ensure that the Query Insights tab always reflects the performance of the "full result" scope, giving users accurate and actionable recommendations.

---

## 6. Failure Scenarios

If the **API** cannot produce an explain plan for the executed command (e.g., commands that include write stages), show **Not available (`n/a`)** with a brief reason. The Summary Bar still shows **client timing** and **docs returned**; other metrics remain `n/a`.

---

## 7. Appendix — What the UI renders at a glance

**Updated based on implementation:**

- **Metrics Row (top, always):**
  Individual metric cards for Execution Time, Documents Returned, Keys Examined, Docs Examined

- **Query Efficiency Analysis Card:**
  Execution Strategy, Index Used, Examined/Returned Ratio, In-Memory Sort, Performance Rating (with visual indicator)

- **Query Plan Summary:**
  Sequential stage flow (e.g., IXSCAN → FETCH → PROJECTION) with expandable details for each stage

- **Optimization Opportunities:**
  - GetPerformanceInsightsCard (Stage 2) with loading state
  - Animated AI suggestion cards (Stage 3)
  - Performance tips card (dismissible)

- **Quick Actions (Stage 2+):**
  Export Optimization Opportunities, Export Execution Plan Details, View Raw Explain Output

**PENDING/EVALUATING - Not yet in UI mock:**

- **Per-shard overview list (when sharded):**
  For each shard: plan summary, nReturned, keys, docs, time, badges; sorted by worst efficiency.

- **Per-shard details (expand):**
  Linear stage list (breadcrumb rail) with per-stage counters. `$or` appears as a single `OR (n)` item with a flyout of clause mini-paths and clause metrics. Optional "View as tree" toggle for complex shapes.

- **Badges:**
  `COLLSCAN`, `Blocked sort`, `Inefficient (>100:1)`, `Spilled`, `Unbounded bounds`, `Fetch heavy`, `Index-only` (positive).

- **Rejected plans count** — Not currently displayed in UI
