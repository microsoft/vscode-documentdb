# Query Insights: Static Analysis Reference

**Last updated:** April 27, 2026 | **Commit:** `5497de13`

This document describes how the Query Insights feature analyzes query
execution plans and presents results to the user. It covers the four
summary indicators, all diagnostic badges, the performance score, and
the reasoning behind design decisions.

This is a living reference. When changing analysis behavior, update this
document and note the reason for the change so future teams do not
revert without understanding the context.

---

## Table of Contents

1. [Data Flow](#data-flow)
2. [Summary Indicators (4 cells)](#summary-indicators)
3. [Diagnostic Badges](#diagnostic-badges)
4. [Performance Score](#performance-score)
5. [Index Strategy Advisories](#index-strategy-advisories)
6. [Badge Visibility and Ordering](#badge-visibility-and-ordering)
7. [Design Decisions and Lessons Learned](#design-decisions-and-lessons-learned)

---

## Data Flow

```
  User runs query
       |
       v
  Router: getQueryInsightsStage2
       |
       |--- session.getExecutionStats()  -->  explain("executionStats")
       |--- session.filterObj            -->  user's parsed query filter
       |--- estimateDocumentCount()      -->  total collection size
       |
       v
  ExplainPlanAnalyzer.analyzeExecutionStats(explainResult, queryFilter)
       |
       |--- calculatePerformanceRating()   -->  score + 4 diagnostic badges
       |
       v
  ExplainPlanAnalyzer.addIndexStrategyAdvisories(analysis, totalDocs, explain)
       |
       |--- coverage badges (neutral)
       |--- low-cardinality badge (neutral, gated on efficiency < 90%)
       |--- multikey expansion badges (neutral or negative)
       |
       v
  transformStage2Response(analysis, totalDocs)
       |
       |--- computeSelectivity()    -->  "3.0%" or null
       |--- computeFetchOverhead()  -->  "Direct fetch", "Collection scan", etc.
       |
       v
  Webview: QueryInsightsTab renders SummaryCard + PerformanceRatingCell
```

---

## Summary Indicators

The "Query Efficiency Analysis" card shows four indicators. Each has a
tooltip that explains the current value in context.

### 1. Selectivity

**What it shows:** The percentage of the collection returned by the query.

**Computation:**
```
  selectivity = nReturned / totalCollectionDocs * 100
```

**Possible values:**

| Value   | Meaning                                           |
|---------|---------------------------------------------------|
| `0.1%`  | Highly selective, small slice of data              |
| `3.0%`  | Reasonable selectivity                             |
| `85.0%` | Broad query, most documents returned               |
| `—`     | Collection size unknown (could not be determined)  |

**Tooltip logic (dynamic):**

| Condition     | First paragraph                                     | Second paragraph                                                                    |
|---------------|-----------------------------------------------------|-------------------------------------------------------------------------------------|
| `< 1%`        | "This query returns X% of your collection."         | "Highly selective: only a small fraction of documents pass the filter."              |
| `1% - 19%`    | "This query returns X% of your collection."         | "Reasonable level of selectivity."                                                  |
| `>= 20%`      | "This query returns X% of your collection."         | "Broad query. Consider adding more specific filters."                               |
| `null`        | "Could not be determined for this query."            | (none)                                                                              |

### 2. Index Used

**What it shows:** The name of the index used, or "None (collection scan)".

**Possible values:**

| Value                       | Meaning                                        |
|-----------------------------|------------------------------------------------|
| `rating_1`                  | A specific index was used                      |
| `status_1_createdAt_-1`    | A compound index was used                      |
| `None (collection scan)`   | No index; every document was scanned           |

**Tooltip logic (dynamic):**

| Condition         | Tooltip content                                                                  |
|-------------------|----------------------------------------------------------------------------------|
| Index name exists | "The database used this index to locate matching documents directly."            |
| No index          | "No index was used. The database scanned every document. Adding an index would help." |

### 3. Fetch Overhead

**What it shows:** How the database retrieved documents after finding them.

**Computation (first match wins):**

```
  if nReturned === 0           --> "No matches"
  if isCovered && docsExam==0  --> "Covered query"
  if isCollectionScan          --> "Collection scan"
  if keysExam > docsExam       --> "Multikey expansion (X.X×)"  (capped at ">10×")
  else                         --> "Direct fetch"
```

**Possible values and tooltips:**

| Value                        | Tooltip summary                                                                  |
|------------------------------|----------------------------------------------------------------------------------|
| **Direct fetch**             | Index pointed to documents, which were loaded from storage. Normal, efficient.   |
| **Covered query**            | All data was in the index. No document loading needed. Most efficient.           |
| **Collection scan**          | Every document read sequentially. Slowest for filtered queries.                  |
| **Multikey expansion (N×)**  | Array index produced multiple entries per document. Expected but adds overhead.  |
| **No matches**               | Zero results. No fetching needed.                                                |

### 4. In-Memory Sort

**What it shows:** Whether the database sorted results in RAM.

**Possible values and tooltips:**

| Value  | Tooltip summary                                                                      |
|--------|--------------------------------------------------------------------------------------|
| **No** | Results came back in the right order naturally (from index or no sort requested).     |
| **Yes**| Database sorted in memory. Uses RAM, can fail for large sets. Add a compound index.  |

---

## Diagnostic Badges

Badges appear below the Performance Rating. Each badge has a
`diagnosticId`, a `type` (positive/neutral/negative), a short `message`,
and a detailed `details` shown in the tooltip.

### Scoring Badges (from `calculatePerformanceRating`)

These always appear (one per dimension):

#### Efficiency Ratio

```
  efficiency = nReturned / totalDocsExamined
```

| diagnosticId               | Condition              | Type     | Message                       |
|----------------------------|------------------------|----------|-------------------------------|
| `no_matching_documents`    | efficiency === 0       | neutral  | No matching documents         |
| `high_efficiency_ratio`    | efficiency >= 50%      | positive | High efficiency ratio         |
| `moderate_efficiency_ratio`| efficiency 10% - 49%   | neutral  | Moderate efficiency ratio     |
| `low_efficiency_ratio`     | efficiency 1% - 9%     | negative | Low efficiency ratio          |
| `very_low_efficiency_ratio`| efficiency < 1%        | negative | Very low efficiency ratio     |

#### Execution Time

| diagnosticId             | Condition        | Type     | Message                     |
|--------------------------|------------------|----------|-----------------------------|
| `fast_execution`         | < 100ms          | positive | Fast execution              |
| `acceptable_execution`   | 100ms - 499ms    | neutral  | Acceptable execution time   |
| `slow_execution`         | 500ms - 1999ms   | negative | Slow execution              |
| `very_slow_execution`    | >= 2000ms        | negative | Very slow execution         |

#### Index Usage

| diagnosticId             | Condition                           | Type     | Message               |
|--------------------------|-------------------------------------|----------|-----------------------|
| `index_used`             | Index scan used                     | positive | Index used            |
| `full_collection_scan`   | Collection scan, no filter          | neutral  | Full collection scan  |
| `full_collection_scan`   | Collection scan, filter present     | negative | Full collection scan  |
| `no_index_used`          | No index, no collection scan        | neutral  | No index used         |

**Empty query detection:** The `queryFilter` parameter is passed directly
from the user's parsed filter (via `ClusterSession`), not extracted from the
explain result. See [Design Decision 2](#2-empty-query-detection).

#### Sort Strategy

Only emitted when sorting is detected (via `$sort` in command or SORT stage):

| diagnosticId             | Condition           | Type     | Message                  |
|--------------------------|---------------------|----------|--------------------------|
| `in_memory_sort`         | In-memory sort      | negative | In-memory sort required  |
| `efficient_sorting`      | Index-based sort    | positive | Efficient sorting        |
| `no_sorting_required`    | No sorting needed   | neutral  | No sorting required      |

### Advisory Badges (from `addIndexStrategyAdvisories`)

These are appended after scoring. All are informational.

#### Coverage

Gated on: `isIndexScan === true` AND `totalCollectionDocs` available.

| diagnosticId                    | Condition         | Type    | Message                          |
|---------------------------------|-------------------|---------|----------------------------------|
| `returns_majority_of_collection`| coverage >= 50%   | neutral | Returns majority of collection   |
| `low_filter_selectivity`        | coverage 20%-49%  | neutral | Low filter selectivity           |

#### Low-Cardinality Index

Gated on: `isIndexScan === true` AND `efficiencyRatio < 0.9`.

Three independent signals (any one is sufficient):

| Signal | Source                     | Condition                                             |
|--------|----------------------------|-------------------------------------------------------|
| 1      | `queryPlanner.winningPlan` | `isBitmap === true` on the IXSCAN stage               |
| 2      | User's query filter        | Any filter value is a boolean literal                  |
| 3      | `executionStats` scanKeys  | `estimatedEntryCount >= 20%` of collection (single-key only) |

| diagnosticId           | Type    | Message                |
|------------------------|---------|------------------------|
| `low_cardinality_index`| neutral | Low-cardinality index  |

See [Design Decision 3](#3-compound-index-cardinality) for why Signal 3
skips compound indexes and why the badge is gated on efficiency.

#### Multikey Expansion

Not gated on index scan (relevant regardless).

| diagnosticId                | Condition   | Type     | Message                      | Score effect     |
|-----------------------------|-------------|----------|------------------------------|------------------|
| `severe_multikey_expansion` | >= 20× keys/docs | negative | Severe multikey expansion | Demoted one level |
| `high_multikey_expansion`   | 5× - 19×   | neutral  | High multikey expansion      | None             |

Score demotion: Excellent -> Good -> Fair -> Poor (one step down).

---

## Performance Score

The overall score is determined after all scoring badges are generated.

### Decision Tree

```
  Is it an empty query (no filter) with collection scan?
    |
    YES --> Score based on time + efficiency only:
    |       efficiency >= 50% AND time < 100ms   -->  Excellent
    |       efficiency >= 10% AND time < 500ms   -->  Good
    |       time < 2000ms                        -->  Fair
    |       else                                 -->  Poor
    |
    NO --> Collection scan AND efficiency < 1%?
            |
            YES --> Poor
            |
            NO --> efficiency >= 50% AND index AND no in-memory sort AND < 100ms?
                    |
                    YES --> Excellent
                    |
                    NO --> efficiency >= 10% AND (index OR < 500ms)?
                            |
                            YES --> Good
                            |
                            NO --> efficiency >= 1%?
                                    |
                                    YES --> Fair
                                    |
                                    NO --> Poor
```

### Post-Score Adjustment

After the score is computed, `addIndexStrategyAdvisories` may further
demote the score:

- Severe multikey expansion (>= 20× keys/docs): score demoted one level

---

## Badge Visibility and Ordering

Not all badges are shown in the UI. The rendering logic in
`PerformanceRatingCell.tsx` applies three steps:

### Step 1: Filter

Only three positive badges are shown (high-signal). All neutral and
negative badges are always shown.

```
  Shown positive IDs:
    - high_efficiency_ratio
    - fast_execution
    - index_used
```

Hidden positive badges (still in data for AI Stage 3):
- `efficient_sorting` (expected behavior, low signal value)
- `no_sorting_required` (expected behavior, low signal value)

### Step 2: Sort

Badges are ordered: **positive -> neutral -> negative**.

This follows the UX convention of leading with what works well, then
informational advisories, then problems.

### Step 3: Color

| Type     | Fluent UI Badge color | Visual              |
|----------|----------------------|---------------------|
| positive | `success`            | Green               |
| neutral  | `informative`        | Blue/gray           |
| negative | `warning`            | Orange/yellow       |

---

## Design Decisions and Lessons Learned

### 1. Zero-Results Edge Case

**Problem:** When a query returns zero documents but examines thousands
(e.g., `{ restaurant_id: { $regex: /\.com$/ } }`), the efficiency ratio
is `0/33698 = 0.0`, and the old badge said "examines thousands of
documents for each result returned." But there are no results returned,
so "per result" is mathematically undefined and the message is
misleading.

**Fix:** When `nReturned = 0` and `docsExamined > 0`, show a neutral
"No matching documents" badge instead. The actual performance concern
(collection scan, slow time) is already captured by the other badges.

**Score impact:** The score still correctly evaluates the query as
`Poor` when it scans many documents and finds nothing, because the
efficiency ratio (0.0) falls into the lowest scoring bracket. The badge
change is purely about message accuracy.

### 2. Empty Query Detection

**Problem:** DocumentDB returns the `command` field in the explain result
as a string (e.g., `"db.runCommand({explain: ...})"`), not a document
object. The code was extracting `command.filter`, which was always
`undefined`, making every query appear to have no filter. This caused
collection scan badges to show "no filter criteria are specified" even
for queries like `{ reviews: { $gte: 400 } }`.

**Initial attempt:** A heuristic fallback using efficiency ratio
(`< 90%` means a filter is likely present). This worked for most cases
but was fragile and could misclassify edge cases.

**Final fix:** Pass the user's actual parsed filter from
`ClusterSession.getCurrentFindQueryParamsWithObjects().filterObj` as a
parameter to `analyzeExecutionStats()`. This is deterministic and always
correct because it comes from the user's input, not the explain output.

### 3. Compound Index Cardinality

**Problem:** A user had a compound index `{hasOutdoorSeating: 1,
reviews: 1}` and queried `{hasOutdoorSeating: false, reviews: {$gt: 400}}`.
The query achieved 100% efficiency (664 returned / 664 examined). But
the "Low-cardinality index" badge appeared because:

- Signal 2 (boolean filter) detected `false` in the filter
- Signal 3 (estimatedEntryCount) found that key 1 (the boolean) had
  44148 entries out of 65K docs = 68% per bucket

Both signals evaluated individual keys in isolation, ignoring that the
compound key combination was highly selective.

**Fix (two layers):**

1. Signal 3 now skips compound indexes (when `scanKeys.length > 1`).
   For compound indexes, individual key cardinality is not meaningful
   because the key combination handles selectivity. A boolean equality
   prefix followed by a selective range is a standard, valid index
   pattern.

2. The entire low-cardinality badge is gated on `efficiencyRatio < 0.9`.
   When the index achieves >= 90% efficiency, it is clearly working well
   regardless of individual key cardinality. This catches cases where
   Signal 1 (isBitmap) or Signal 2 (boolean filter) might fire on a
   well-performing compound index.

**Why not just skip compound indexes entirely?** Signal 1 (isBitmap)
and Signal 2 (boolean) can still be useful for compound indexes with
poor efficiency. If a compound index has a low-cardinality prefix and
the query still examines many extra documents, the badge is genuinely
helpful. The efficiency gate ensures the badge only appears when the
index is underperforming.

### 4. Badge Message Formatting

**Problem:** Early badge details used em dashes (--) and contractions
("don't", "doesn't") which did not match the approved tone. The
implementation plan specified firm, friendly, and helpful language.

**Fix:** Replaced all em dashes with colons in user-facing strings.
Expanded contractions to full words. Formatted multi-reason lists with
bullet points for readability.

### 5. Collection Scan Messages

**Problem:** The original "Full collection scan" message said "since no
filter criteria are specified" even when a filter was present (see
Decision 2). After fixing filter detection, the messages were refined:

- **No filter:** "Your query retrieves all documents, so a full
  collection scan is expected."
- **With filter:** "Your query has filter criteria but no supporting
  index. The database scanned every document to find matches."

The with-filter message is `negative` type (orange badge) while the
no-filter message is `neutral` (blue/gray) because scanning everything
when you asked for everything is expected behavior.

---

## Configuration Constants

```
  COVERAGE_LOW_SELECTIVITY  = 0.2    // 20% of collection
  COVERAGE_HIGH_RETURN      = 0.5    // 50% of collection
  CARDINALITY_PER_KEY_RATIO = 0.2    // 20% per index bucket
  MULTIKEY_WARN_THRESHOLD   = 5      // 5x keys-to-docs
  MULTIKEY_SEVERE_THRESHOLD = 20     // 20x keys-to-docs
```

---

## Glossary

| Term               | Meaning                                                                          |
|--------------------|----------------------------------------------------------------------------------|
| Collection scan    | Database reads every document in the collection sequentially                     |
| Covered query      | All requested data is in the index; no document fetch needed                     |
| Efficiency ratio   | Documents returned / documents examined (higher is better)                       |
| In-memory sort     | Database sorts results in RAM instead of using index order                        |
| Index scan         | Database uses an index to locate matching documents efficiently                   |
| Multikey index     | Index on an array field; one document produces multiple index entries             |
| Selectivity        | Fraction of the collection that passes the query filter                           |
| Fetch overhead     | How documents are retrieved after the index identifies matches                    |
| Bitmap index       | Index strategy used by DocumentDB for low-cardinality fields                      |
| Compound index     | Index on multiple fields (e.g., `{status: 1, createdAt: -1}`)                   |
