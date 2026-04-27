# Query Insights — Performance Rating & Informational Badges

> **Reference commit:** `2a4316c3` (April 2026)
>
> This document describes how the Query Insights feature computes
> performance ratings and generates informational badges for each query.
> It is intended for end users and developers who want to understand
> what the rating means and how to improve their queries.

---

## How the Performance Rating Works

When you run a query, the extension asks the database to **explain** it.
The explain output reveals how the database executed the query — which
indexes it used, how many documents it examined, how long it took, etc.

The extension analyzes this output and produces:

1. **A performance score** — `Excellent`, `Good`, `Fair`, or `Poor`
2. **Diagnostic badges** — short labels with detailed tooltips explaining
   why the score is what it is

### Overview

```
                    ┌─────────────────────────────────┐
   Your query  ───▶ │   Database Explain Plan           │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │   Analyze Execution Stats         │
                    │   (efficiency, time, index, sort) │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │   Calculate Performance Score     │
                    │   + Generate Diagnostic Badges    │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │   Add Index Strategy Advisories   │
                    │   (coverage, cardinality, multikey)│
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │   Display in Query Insights Tab   │
                    └─────────────────────────────────┘
```

---

## Scoring Criteria

The score is determined by four dimensions. Each dimension generates a
badge so you can see exactly what contributed to the score.

### 1. Efficiency Ratio

> How many documents were returned vs. how many were examined?

```
  Efficiency = Documents Returned ÷ Documents Examined
```

| Efficiency     | Badge                       | Type     |
|----------------|-----------------------------|----------|
| ≥ 50%          | **High efficiency ratio**   | Positive |
| 10% – 49%     | Moderate efficiency ratio   | Neutral  |
| 1% – 9%       | Low efficiency ratio        | Negative |
| < 1%           | Very low efficiency ratio   | Negative |

**Example:** Your query returns 500 documents but the database examined
10,000. That's 5% efficiency — you'll see a "Low efficiency ratio" badge.

### 2. Execution Time

> How long did the query take?

| Time               | Badge                     | Type     |
|--------------------|---------------------------|----------|
| < 100 ms           | **Fast execution**        | Positive |
| 100 ms – 499 ms    | Acceptable execution time | Neutral  |
| 500 ms – 1,999 ms  | Slow execution            | Negative |
| ≥ 2,000 ms         | Very slow execution       | Negative |

### 3. Index Usage

> Did the query use an index?

| Situation                                  | Badge                     | Type     |
|-------------------------------------------|---------------------------|----------|
| Index scan used                           | **Index used**            | Positive |
| Collection scan, no filter (all docs)     | Full collection scan      | Neutral  |
| Collection scan, filter present           | Full collection scan      | Negative |
| No index, no collection scan              | No index used             | Neutral  |

**Note:** A collection scan on a query with no filter (e.g., `db.users.find({})`)
is expected — there's nothing to index against. This is treated as neutral.

### 4. Sort Strategy

> If sorting was requested, how was it done?

| Situation                     | Badge                  | Type     |
|-------------------------------|------------------------|----------|
| Sorting uses index ordering   | Efficient sorting      | Positive |
| Sorting done in memory (RAM)  | In-memory sort required| Negative |
| No sorting needed             | No sorting required    | Neutral  |

> **Note:** The "Efficient sorting" and "No sorting required" badges are
> hidden from the UI to reduce clutter — they are still present in the data
> for AI analysis. Only "In-memory sort required" is shown when relevant.

### Score Determination

The overall score considers all four dimensions:

```
  Excellent:  efficiency ≥ 50%  AND  index used  AND  no in-memory sort  AND  < 100ms
  Good:       efficiency ≥ 10%  AND  (index used OR < 500ms)
  Fair:       efficiency ≥ 1%
  Poor:       efficiency < 1%   OR   collection scan with filter
```

For queries with **no filter** (e.g., `find({})`), the collection scan
penalty is waived. The score is based only on execution time and efficiency.

---

## Summary Card Cells

The "Query Efficiency Analysis" card shows four cells plus the performance
rating:

```
  ┌─────────────────┬───────────────────┐
  │  Selectivity     │  Index Used       │
  │  e.g. "33.2%"   │  e.g. "myIndex"   │
  ├─────────────────┼───────────────────┤
  │  Fetch Overhead  │  In-Memory Sort   │
  │  e.g. "Direct"  │  "Yes" / "No"     │
  ├─────────────────┴───────────────────┤
  │  Performance Rating: Good           │
  │  [High efficiency] [Fast execution] │
  └─────────────────────────────────────┘
```

### Selectivity

Percentage of the collection your query returns.

```
  Selectivity = Documents Returned ÷ Total Collection Size × 100
```

Shows `—` when the collection size couldn't be determined.

### Index Used

The name of the index used (e.g., `status_1_createdAt_-1`), or
`None (collection scan)` when no index was used.

### Fetch Overhead

Describes how efficiently documents were fetched. First match wins:

| State                  | When                                                     |
|------------------------|----------------------------------------------------------|
| No matches             | Query returned zero documents                           |
| Covered query          | All data came from the index — no document fetch needed |
| Collection scan        | Every document was scanned sequentially                 |
| Multikey expansion (N×)| Index on array field — multiple keys per document        |
| Direct fetch           | Normal index lookup followed by document fetch          |

### In-Memory Sort

`Yes` if the database sorted results in memory (RAM). `No` otherwise.
In-memory sorts are limited by available RAM and can fail for large
result sets.

---

## Index Strategy Advisories

After the core score is computed, the system checks for additional
patterns and adds **informational badges** (neutral or negative).

### Coverage Badges

> Only fire when an index is used. They indicate the index may not be
> providing much benefit because the query returns a large portion of
> the collection.

| Coverage of Collection | Badge                           | Type    |
|------------------------|---------------------------------|---------|
| ≥ 50%                  | Returns majority of collection  | Neutral |
| 20% – 49%             | Low filter selectivity          | Neutral |

**Example:** Your collection has 100,000 documents and the query returns
60,000. Even though an index is used, it has to look up 60% of the
collection — a collection scan might actually be faster.

### Low-Cardinality Index

> Fires when the index doesn't differentiate well between documents.

Detected by three signals (any one is sufficient):

1. **Bitmap index:** The database uses a bitmap index (DocumentDB-specific)
2. **Boolean filter:** The query filters on a field that has only `true`/`false`
3. **High entry count:** The index has ≥20% of the collection in a single bucket

**Example:** Indexing a `isActive` boolean field that is `true` for 90% of
documents. The index must still scan most of the collection.

### Multikey Expansion

> Detects when indexes on array fields cause excessive key examination.

```
  Multiplier = Keys Examined ÷ Documents Examined
```

| Multiplier | Badge                         | Type     | Effect          |
|------------|-------------------------------|----------|-----------------|
| ≥ 20×     | Severe multikey expansion     | Negative | Score demoted   |
| 5× – 19×  | High multikey expansion       | Neutral  | Informational   |

**Score demotion:** Severe multikey expansion (≥20×) demotes the score by
one level (e.g., Excellent → Good, Good → Fair).

**Example:** A `tags` field with an average of 25 tags per document,
indexed as a multikey index. A query examining 1,000 documents may examine
25,000 index keys — a 25× multiplier.

---

## Badge Visibility Rules

Not all badges are shown in the UI. Some positive badges are hidden to
reduce visual noise — only the most actionable ones appear:

| Badge                       | Shown? | Reason                              |
|-----------------------------|--------|-------------------------------------|
| **High efficiency ratio**   | ✓      | Key positive signal                 |
| **Fast execution**          | ✓      | Key positive signal                 |
| **Index used**              | ✓      | Key positive signal                 |
| Efficient sorting           | ✗      | Expected behavior, low signal value |
| No sorting required         | ✗      | Expected behavior, low signal value |
| Moderate efficiency ratio   | ✓      | Always shown (neutral)              |
| All negative badges         | ✓      | Always shown (actionable)           |
| All advisory badges         | ✓      | Always shown (informational)        |

### Badge Ordering

Badges are sorted by category: **positive → neutral → negative**. This
follows the convention of leading with what's working well, then showing
informational advisories, then highlighting problems.

### Badge Colors

| Type     | Fluent UI Color | Visual            |
|----------|----------------|-------------------|
| Positive | `success`      | Green badge       |
| Neutral  | `informative`  | Blue/gray badge   |
| Negative | `warning`      | Orange/yellow badge |

---

## Examples

### Example A — Well-optimized query

```
Query:   db.orders.find({ status: "shipped", customerId: "C-1234" })
Index:   { status: 1, customerId: 1 }
```

```
  Docs Returned:   12
  Docs Examined:   12      →  Efficiency: 100%
  Keys Examined:   12
  Exec Time:       3ms
  In-Memory Sort:  No
  Collection Size: 500,000
```

**Score:** `Excellent`

**Visible Badges:**
- ✓ High efficiency ratio (positive, green)
- ✓ Fast execution (positive, green)
- ✓ Index used (positive, green)

**Summary Card:**
- Selectivity: `0.0%`
- Index Used: `status_1_customerId_1`
- Fetch Overhead: `Direct fetch`
- In-Memory Sort: `No`

### Example B — Missing index

```
Query:   db.orders.find({ region: "EU" }).sort({ createdAt: -1 })
Index:   none
```

```
  Docs Returned:   25,000
  Docs Examined:   500,000   →  Efficiency: 5%
  Keys Examined:   0
  Exec Time:       1,200ms
  In-Memory Sort:  Yes
  Collection Size: 500,000
```

**Score:** `Poor`

**Visible Badges:**
- ⚠ Low efficiency ratio (negative, orange)
- ⚠ Slow execution (negative, orange)
- ⚠ Full collection scan (negative, orange)
- ⚠ In-memory sort required (negative, orange)

**Summary Card:**
- Selectivity: `5.0%`
- Index Used: `None (collection scan)`
- Fetch Overhead: `Collection scan`
- In-Memory Sort: `Yes`

### Example C — Index used but low cardinality

```
Query:   db.users.find({ isActive: true })
Index:   { isActive: 1 }
```

```
  Docs Returned:   450,000
  Docs Examined:   450,000   →  Efficiency: 100%
  Keys Examined:   450,000
  Exec Time:       850ms
  In-Memory Sort:  No
  Collection Size: 500,000
```

**Score:** `Good`

**Visible Badges:**
- ✓ High efficiency ratio (positive, green)
- ✓ Index used (positive, green)
- ● Returns majority of collection (neutral, blue)
- ● Low-cardinality index (neutral, blue)
- ⚠ Slow execution (negative, orange)

### Example D — Multikey expansion on array field

```
Query:   db.products.find({ tags: "electronics" })
Index:   { tags: 1 }     (multikey)
```

```
  Docs Returned:   1,000
  Docs Examined:   1,000     →  Efficiency: 100%
  Keys Examined:   25,000    →  25× multikey multiplier
  Exec Time:       45ms
  In-Memory Sort:  No
  Collection Size: 50,000
```

**Score:** `Good` (demoted from Excellent due to severe multikey)

**Visible Badges:**
- ✓ High efficiency ratio (positive, green)
- ✓ Fast execution (positive, green)
- ✓ Index used (positive, green)
- ⚠ Severe multikey expansion (negative, orange)

---

## Glossary

| Term               | Meaning                                                                          |
|--------------------|----------------------------------------------------------------------------------|
| Collection scan    | Database reads every document in the collection sequentially                     |
| Covered query      | All requested data is in the index — no need to fetch the actual documents       |
| Efficiency ratio   | Documents returned ÷ documents examined (higher is better)                       |
| In-memory sort     | Database sorts results in RAM instead of using index order                        |
| Index scan         | Database uses an index to locate matching documents efficiently                   |
| Multikey index     | Index on an array field — one document produces multiple index entries            |
| Selectivity        | How narrowly a query filters — percentage of collection returned                  |
| Fetch overhead     | How the database retrieves document data after finding matches in the index       |
