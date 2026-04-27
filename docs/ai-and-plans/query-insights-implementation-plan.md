# Query Insights Performance Rating — Implementation Plan

**Date:** 2026-04-27
**Based on:** [query-insights-performance-rating-improvements.md](query-insights-performance-rating-improvements.md)
**Status:** DRAFT — awaiting review before implementation

---

## Executive Summary

This plan covers implementing the improvements proposed in the companion MD file. After analyzing the full codebase, most of the proposal maps cleanly onto the existing architecture. This document notes:

1. **What follows the proposal exactly** (the majority)
2. **What deviates**, why, and what the user-facing impact is
3. **Sequenced tasks** a coding agent can pick up individually

---

## Architecture Overview (As Found)

### Data flow

```
User runs query → CollectionView.tsx prefetches Stage 1 →
QueryInsightsTab.tsx auto-triggers Stage 2 →
collectionViewRouter.ts calls ClusterSession.getExecutionStats() →
ExplainPlanAnalyzer.analyzeExecutionStats() →
transformStage2Response() →
JSON sent to webview via tRPC
```

### Key files

| File                                                                                                                                                          | Role                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [src/documentdb/queryInsights/ExplainPlanAnalyzer.ts](../../src/documentdb/queryInsights/ExplainPlanAnalyzer.ts)                                              | Core analysis: `analyzeExecutionStats()`, `calculatePerformanceRating()` |
| [src/documentdb/queryInsights/transformations.ts](../../src/documentdb/queryInsights/transformations.ts)                                                      | `transformStage2Response()` — shapes data for the webview                |
| [src/webviews/documentdb/collectionView/collectionViewRouter.ts](../../src/webviews/documentdb/collectionView/collectionViewRouter.ts)                        | tRPC route handler for `getQueryInsightsStage2`                          |
| [src/webviews/documentdb/collectionView/types/queryInsights.ts](../../src/webviews/documentdb/collectionView/types/queryInsights.ts)                          | Shared types (`QueryInsightsStage2Response`, `PerformanceDiagnostic`)    |
| [QueryInsightsTab.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)                                         | React component rendering the full tab                                   |
| [PerformanceRatingCell.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/summaryCard/custom/PerformanceRatingCell.tsx) | Badge rendering (Fluent UI `Badge` + `Tooltip`)                          |
| [GenericCell.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/summaryCard/GenericCell.tsx)                            | Simple value cell in the 2×2 grid                                        |
| [CellBase.tsx](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/summaryCard/CellBase.tsx)                                  | Base cell component with skeleton/null handling                          |
| [SummaryCard.tsx / .scss](../../src/webviews/documentdb/collectionView/components/queryInsightsTab/components/summaryCard/SummaryCard.tsx)                    | Card wrapper + CSS grid (`grid-template-columns: repeat(2, 1fr)`)        |
| [ClustersClient.ts](../../src/documentdb/ClustersClient.ts)                                                                                                   | `estimateDocumentCount()` — already exists, with fallback                |

---

## Deviations from Proposal

### Deviation 1: `totalCollectionDocs` fetched in Stage 2 router, not passed into `calculatePerformanceRating`

**Proposal says:** Add `totalCollectionDocs`, `nReturned`, and `explainResult` as parameters to `calculatePerformanceRating`.

**Actual approach:** Keep `calculatePerformanceRating` focused on scoring. Instead:

- Fetch `estimateDocumentCount()` in the Stage 2 router (`collectionViewRouter.ts`)
- Add a new **post-analysis step** in `ExplainPlanAnalyzer` (e.g., `addIndexStrategyAdvisories(analysis, totalCollectionDocs, explainResult)`) that appends neutral diagnostics to `analysis.performanceRating.diagnostics`
- Pass `totalCollectionDocs` through to `transformStage2Response` for the Selectivity cell

**Rationale:**

- `calculatePerformanceRating` currently has a clean responsibility: score + diagnostics about the query's own execution quality. Adding index-strategy concerns inside it would muddy the separation the proposal itself advocates ("These are different questions with different audiences").
- A separate method makes it easier to test the index-strategy advisories independently
- `nReturned` and `explainResult` are already available in `analyzeExecutionStats` — passing them through again would be redundant
- `estimateDocumentCount` is an async call; `calculatePerformanceRating` is synchronous. Keeping the async work in the router is cleaner

**Badge ordering:** Since `addIndexStrategyAdvisories` appends diagnostics after `calculatePerformanceRating` generates them, the final array will be mixed (positive from scoring, then neutral from advisories). Before rendering, diagnostics must be sorted by category in standard severity order: **positive → neutral → negative**. This follows the UX convention of leading with what's working (positive reinforcement), then advisories, then problems — avoiding an alarming "negative-first" presentation. The sort happens at the rendering level in `PerformanceRatingCell.tsx` (Task 9), after the visibility filter.

**User-facing impact:** None. Same diagnostics, same badges, same messages — just consistently ordered.

### Deviation 2: Badge color differentiation

**Proposal implies:** Three visual types (green positive, yellow neutral, red negative).

**Current code:** `diagnostic.type === 'positive' ? 'success' : 'informative'` — so both `neutral` and `negative` render as `informative` (blue/gray Fluent UI badge).

**Actual approach:** Add a `'warning'` color for `negative` diagnostics:

```tsx
color={
    diagnostic.type === 'positive' ? 'success' :
    diagnostic.type === 'negative' ? 'warning' :
    'informative'  // neutral
}
```

Fluent UI v9 `Badge` supports `'warning'` (orange/yellow) natively. This gives three distinct visual treatments:

- `positive` → green (`success`)
- `neutral` → blue/gray (`informative`) — the new index-strategy advisories
- `negative` → orange/yellow (`warning`) — genuine problems like in-memory sort

**User-facing impact:** `negative` diagnostics will now render with `warning` color instead of `informative`. This is a visual improvement — negative diagnostics (collection scan, slow execution) currently look identical to neutral ones, which is confusing.

**Why not red for negative?** Fluent UI v9 `Badge` `color` prop supports `'danger'` for red, but `'warning'` is more appropriate since these are actionable observations, not errors. The `'danger'` color is typically reserved for destructive states. This also avoids introducing too strong a visual signal that could alarm users. We can revisit if needed.

### Deviation 3: "No sorting required" and "Efficient sorting" badge suppression

**Proposal says:** Don't show "No sorting required" or "Efficient sorting" badges.

**Actual approach:** Rather than removing these diagnostics from the generation, filter them out at the **rendering** level. This way:

- The diagnostics still exist in the data for AI context (Stage 3) and telemetry
- Only the rendering changes

**Implementation:** In `PerformanceRatingCell.tsx`, filter the diagnostics array:

```tsx
const SHOWN_POSITIVE_IDS = ['High efficiency ratio', 'Fast execution', 'Index used'];
const visibleDiagnostics = diagnostics.filter((d) => d.type !== 'positive' || SHOWN_POSITIVE_IDS.includes(d.message));
```

**User-facing impact:** "No sorting required" and "Efficient sorting" badges disappear from the UI. Other badges unchanged.

> **NOTE:** This uses `message` string matching which is fragile for localization. A cleaner approach would be to add a `diagnosticId` field to `PerformanceDiagnostic`. See Task 1 below.

### Deviation 4: `findStageInPlan` — use `queryPlanner.winningPlan` not `executionStats`

**Proposal shows:** `findStageInPlan` traversing the plan tree from `queryPlanner.winningPlan`.

**Codebase reality:** The explain result passed to `analyzeExecutionStats` contains both `queryPlanner.winningPlan` (plan-time info, has `isBitmap`, `estimatedTotalKeysExamined`) and `executionStats.executionStages` (runtime info, has `nReturned`, `totalKeysExamined`).

For **isBitmap detection**, we need the queryPlanner tree (plan-time property).
For **multikey detection**, we need the executionStats tree (runtime stats).

**Approach:** The new `findStageInPlan` helper will accept a starting node and traverse from there. The caller picks the right tree:

- `queryPlanner.winningPlan` for `isBitmap`
- `executionStats` for multikey multiplier (already uses `totalKeysExamined` / `totalDocsExamined` from top-level stats)

**User-facing impact:** None.

### Deviation 5: `estimatedEntryCount` parsing from `scanKeys` strings

**Proposal shows:** Parsing `estimatedEntryCount` from strings like `"key 1: [(isInequality: false, estimatedEntryCount: 22074)]"` in `executionStats.executionStages.indexUsage[].scanKeys`.

**DocumentDB schema confirms:** `scanKeys` is `string[]` in `ExecutionStatsIndexUsage`. This is a DocumentDB-specific field — the MongoDB API explain plan doesn't have `scanKeys` with this format.

**Approach:** Implement the regex parsing as proposed. However, mark this as a DocumentDB-specific signal with a comment, since it parses an implementation detail of the gateway's explain output format. The `isBitmap` and boolean-filter signals provide the same cardinality detection for MongoDB API-compatible plans.

**User-facing impact:** None. Extra signal for better cardinality detection on DocumentDB.

### Deviation 6: `isMultiKey` field from `QueryPlanIndexUsage`

The DocumentDB explain schema includes an `isMultiKey` boolean in `indexUsage` entries (in `queryPlanner.winningPlan`). The proposal's multikey detection uses `totalKeysExamined / totalDocsExamined` ratio, which catches multikey behavior at runtime. The schema's `isMultiKey` is an additional plan-time signal we could use as a future enhancement but is NOT needed for the multiplier-based detection proposed here.

### Deviation 7: No tooltip on 2×2 cells

**Proposal says:** "No subtitles." and the user's constraint says "no tooltips either."

The current GenericCell has no tooltips. The MetricsRow stat cards above DO have tooltips (via `tooltipExplanation`). The 2×2 cells will remain tooltip-free as specified.

### Deviation 8: `Selectivity` cell gets the percentage from `transformStage2Response`

**Proposal says:** Source is `executionStats.nReturned` and `db.collection.estimatedDocumentCount()`.

The computation will happen in the router (where we have access to the DB) and pass through `transformStage2Response`. The `efficiencyAnalysis` object in `QueryInsightsStage2Response` will get a new field: `selectivity: string | null` (e.g., `"33.2%"` or `null` if count unavailable).

The cell will render `selectivity` value via `GenericCell`, showing `"—"` when null.

### Deviation 9: User-facing message adjustments

All user-facing messages from the proposal are preserved as-is. The only additions:

| Change    | Message                                                        | Reason                                                            |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| NEW       | `l10n.t('Selectivity')` label                                  | New 2×2 cell replacing "Execution Strategy"                       |
| NEW       | `l10n.t('Fetch Overhead')` label                               | New 2×2 cell replacing "Examined-to-Returned Ratio"               |
| CHANGED   | `l10n.t('None (collection scan)')`                             | For Index Used cell on COLLSCAN (currently shows `null` → "None") |
| PRESERVED | All diagnostic `message` and `details` texts from the proposal | As approved                                                       |

---

## Implementation Tasks

### Task 1: Add `diagnosticId` to `PerformanceDiagnostic` (foundation)

**Files:** `ExplainPlanAnalyzer.ts`, `types/queryInsights.ts`

Add a `diagnosticId` field to `PerformanceDiagnostic`:

```typescript
export interface PerformanceDiagnostic {
  diagnosticId: string; // NEW — stable identifier for filtering
  type: 'positive' | 'negative' | 'neutral';
  message: string;
  details: string;
}
```

Update all existing diagnostic pushes in `calculatePerformanceRating` to include `diagnosticId`. Use snake_case IDs:

- `high_efficiency_ratio`, `moderate_efficiency_ratio`, `low_efficiency_ratio`, `very_low_efficiency_ratio`
- `fast_execution`, `acceptable_execution`, `slow_execution`, `very_slow_execution`
- `index_used`, `full_collection_scan`, `no_index_used`
- `in_memory_sort`, `efficient_sorting`, `no_sorting_required`

This avoids fragile string matching for badge filtering.

**Testing:** No behavior change. Just add `diagnosticId` to every diagnostic.

---

### Task 2: Threshold constants

**File:** `ExplainPlanAnalyzer.ts` (top of file)

```typescript
// Collection coverage thresholds
const COVERAGE_LOW_SELECTIVITY = 0.2; // 20%
const COVERAGE_HIGH_RETURN = 0.5; // 50%

// Index cardinality threshold
const CARDINALITY_PER_KEY_RATIO = 0.2; // 20%

// Multikey expansion thresholds
const MULTIKEY_WARN_THRESHOLD = 5; // 5×
const MULTIKEY_SEVERE_THRESHOLD = 20; // 20×
```

**Testing:** No behavior change.

---

### Task 3: `findStageInPlan` helper

**File:** `ExplainPlanAnalyzer.ts`

Add a static helper to recursively find a stage by name in a plan tree:

```typescript
private static findStageInPlan(plan: Document | undefined, stageName: string): Document | undefined
```

Traverses `inputStage` / `inputStages` recursively, returns the first match. This is similar to existing patterns in `detectSortingInPlan` and `findFailedStage`, but generalized.

**Testing:** Unit test with nested plan trees.

---

### Task 4: `detectLowCardinalityIndex` helper

**File:** `ExplainPlanAnalyzer.ts`

Add static method as proposed. Three signals:

1. `isBitmap === true` on the IXSCAN stage (from `queryPlanner.winningPlan`)
2. Boolean literal in the query filter
3. `estimatedEntryCount` from `scanKeys` strings ≥ `CARDINALITY_PER_KEY_RATIO` × `totalCollectionDocs`

Returns `{ isLowCardinality: boolean; reasons: string[] }`.

**Testing:** Unit tests per signal, including edge cases (no IXSCAN, no filter, etc.).

---

### Task 5: `addIndexStrategyAdvisories` method

**File:** `ExplainPlanAnalyzer.ts`

New public static method:

```typescript
public static addIndexStrategyAdvisories(
    analysis: ExecutionStatsAnalysis,
    totalCollectionDocs: number | undefined,
    explainResult: Document,
): void
```

This method mutates `analysis.performanceRating.diagnostics` by appending index-strategy advisories. All are **gated on `analysis.isIndexScan === true`**.

Appends (in order):

1. **Coverage badges** (neutral, gated on `isIndexScan`):
   - `coverage >= 0.5` → "Returns majority of collection"
   - `coverage >= 0.2` → "Low filter selectivity"
2. **Low cardinality badge** (neutral, gated on `isIndexScan`):
   - Calls `detectLowCardinalityIndex`, appends if positive
3. **Multikey expansion badges**:
   - `≥ 20×` → negative "Severe multikey expansion"
   - `≥ 5×` → neutral "High multikey expansion"

Also adjusts the score for severe multikey:

- If `multikeyMultiplier >= MULTIKEY_SEVERE_THRESHOLD`, demote score by one level (excellent→good, good→fair)

All messages use the **exact text from the proposal** (approved messages).

**Testing:** Unit tests per diagnostic. See Test Cases A–H from the proposal.

---

### Task 6: Fetch `estimateDocumentCount` in Stage 2 router

**File:** `collectionViewRouter.ts` (`getQueryInsightsStage2` handler)

After analyzing the explain result, fetch the document count:

```typescript
// Fetch total collection docs for index-strategy advisories
let totalCollectionDocs: number | undefined;
try {
  totalCollectionDocs = await session.getClient().estimateDocumentCount(databaseName, collectionName);
} catch {
  // Non-critical — advisories will simply not fire
  totalCollectionDocs = undefined;
}

// Add index-strategy advisories
ExplainPlanAnalyzer.addIndexStrategyAdvisories(analyzed, totalCollectionDocs, explainResult);
```

Also pass `totalCollectionDocs` to `transformStage2Response` (new optional parameter) for the Selectivity cell.

For **debug override** mode: skip the `estimateDocumentCount` call (no session available). The advisories won't fire — acceptable for debug mode.

**Testing:** Integration-level; mostly covered by Task 5 unit tests.

---

### Task 7: Update `transformStage2Response` for new 2×2 cells

**File:** `transformations.ts`

Add new fields to the `efficiencyAnalysis` object:

```typescript
efficiencyAnalysis: {
    // EXISTING (unchanged):
    indexUsed: string | null,
    hasInMemorySort: boolean,
    performanceRating: PerformanceRating,

    // REMOVED:
    // executionStrategy: string,        // → replaced by selectivity
    // examinedReturnedRatio: string,    // → replaced by fetchOverhead

    // NEW:
    selectivity: string | null,          // e.g. "33.2%" or null
    fetchOverhead: string,               // State-based: "Direct fetch", "Covered query", etc.
}
```

**Selectivity computation:**

```typescript
const selectivity =
  totalCollectionDocs && analyzed.nReturned !== undefined
    ? `${((analyzed.nReturned / totalCollectionDocs) * 100).toFixed(1)}%`
    : null;
```

**Fetch Overhead state machine** (first match wins):

1. `nReturned === 0` → `"No matches"`
2. `isCovered && docsExamined === 0 && nReturned > 0` → `"Covered query"`
3. `isCollectionScan` → `"Collection scan"`
4. `keysExamined > docsExamined && docsExamined > 0` → `"Multikey expansion (X.X×)"` (cap at `>10×`)
5. Default → `"Direct fetch"`

**Type update in `types/queryInsights.ts`:**

```typescript
efficiencyAnalysis: {
  selectivity: string | null; // replaces executionStrategy
  indexUsed: string | null;
  fetchOverhead: string; // replaces examinedReturnedRatio
  hasInMemorySort: boolean;
  performanceRating: PerformanceRating;
}
```

Keep `executionStrategy` and `examinedReturnedRatio` as top-level fields on the response (used by concerns logic and potentially by Stage 3 AI). Only remove from `efficiencyAnalysis` which feeds the 2×2 grid.

**Testing:** Unit tests for the state machine.

---

### Task 8: Update QueryInsightsTab 2×2 grid

**File:** `QueryInsightsTab.tsx`

Replace:

```tsx
<GenericCell label={l10n.t('Execution Strategy')} value={...executionStrategy} />
<GenericCell label={l10n.t('Examined-to-Returned Ratio')} value={...examinedReturnedRatio} />
```

With:

```tsx
<GenericCell
    label={l10n.t('Selectivity')}
    value={getCellValue(() => queryInsightsState.stage2Data?.efficiencyAnalysis.selectivity)}
    nullValuePlaceholder="—"
/>
<GenericCell
    label={l10n.t('Fetch Overhead')}
    value={getCellValue(() => queryInsightsState.stage2Data?.efficiencyAnalysis.fetchOverhead)}
/>
```

The grid order becomes:

```
Row 1: [Selectivity]   [Index Used]
Row 2: [Fetch Overhead] [In-Memory Sort]
Row 3: [Performance Rating (full width)]
```

**Testing:** Visual verification.

---

### Task 9: Filter, sort, and style badges in PerformanceRatingCell

**File:** `PerformanceRatingCell.tsx`

**Step 1 — Filter:** Remove non-shown positive diagnostics:

```tsx
const SHOWN_POSITIVE_IDS: string[] = ['high_efficiency_ratio', 'fast_execution', 'index_used'];

const filteredDiagnostics = (diagnostics ?? []).filter(
  (d) => d.type !== 'positive' || SHOWN_POSITIVE_IDS.includes(d.diagnosticId),
);
```

This uses `diagnosticId` from Task 1. Non-positive badges (neutral, negative) are always shown.

**Step 2 — Sort by category:** Order badges **positive → neutral → negative**. This follows the standard UX pattern of leading with positive reinforcement, then informational advisories, then problems. Avoids an alarming "negative-first" presentation.

```tsx
const TYPE_ORDER: Record<string, number> = { positive: 0, neutral: 1, negative: 2 };

const visibleDiagnostics = filteredDiagnostics.sort((a, b) => (TYPE_ORDER[a.type] ?? 1) - (TYPE_ORDER[b.type] ?? 1));
```

**Step 3 — Badge color:**

```tsx
color={
    diagnostic.type === 'positive' ? 'success' :
    diagnostic.type === 'negative' ? 'warning' :
    'informative'
}
```

**Testing:** Verify that only the 3 specified positive badges render. Verify ordering is positive → neutral → negative. Verify negative badges get `warning` color.

---

### Task 10: Localization & formatting

Run `npm run l10n` to update localization bundles for new strings:

- `'Selectivity'`
- `'Fetch Overhead'`
- `'Direct fetch'`
- `'Covered query'`
- `'Collection scan'`
- `'Multikey expansion ({0}×)'`
- `'No matches'`
- `'None (collection scan)'`
- All diagnostic `message` and `details` texts

Then run `npm run prettier-fix` and `npm run lint`.

---

## Task Dependency Graph

```
Task 1 (diagnosticId)  ─┐
Task 2 (constants)      ─┤
Task 3 (findStageInPlan) ┤
                         ├→ Task 5 (addIndexStrategyAdvisories) ─→ Task 6 (router wiring)
Task 4 (cardinality)    ─┘

Task 7 (transformStage2Response) ─→ Task 8 (QueryInsightsTab 2×2 grid)

Task 1 ─→ Task 9 (PerformanceRatingCell badge filtering)

Task 10 (l10n + formatting) — last, after all changes
```

Tasks 1–4 are independent and can be done in parallel.
Tasks 7 and 8 are independent of Tasks 5–6.
Task 9 depends on Task 1.
Task 10 is always last.

---

## Preserving Data for AI Context (Stage 3)

The full `diagnostics` array (including filtered-out positives like "No sorting required") is still present in the data sent to the webview. The rendering filter (Task 9) is purely UI-side. Stage 3 AI recommendations receive the complete `rawExecutionStats` and can use all diagnostics for richer context — this is explicitly called out in the proposal.

---

## What About `executionStrategy` and `examinedReturnedRatio` top-level fields?

These are kept on `QueryInsightsStage2Response` as top-level fields (`executionStrategy: string`, `examinedToReturnedRatio: number`, `examinedReturnedRatio` formatted). They're used by:

- The `concerns` array logic
- The Stage 3 AI context
- The query plan summary component

Only the `efficiencyAnalysis` sub-object (which feeds the 2×2 grid) changes. This minimizes blast radius.

---

## Backward Compatibility

- If `totalCollectionDocs` is `undefined` (failed to fetch, debug mode), all new advisories skip and behavior is identical to today
- The `diagnosticId` field is additive — existing consumers that don't use it are unaffected
- The score formula changes only for queries with ≥20× multikey expansion (severe) — a rare case
- The 2×2 grid cells change labels and values but keep the same component structure

---

## Open Questions

1. **Badge icon differentiation?** Currently all badges use `<InfoRegular />`. Should `negative` badges use `<WarningRegular />` instead? The proposal doesn't specify, but it would reinforce the color distinction.

2. **Debug override file support for `totalCollectionDocs`?** Currently debug files only contain the explain result. Should we extend the debug file format to optionally include a `totalCollectionDocs` field so index-strategy advisories can be tested in debug mode?

3. **Sharded queries:** The proposal doesn't discuss sharded queries. The current code has sharded query support in both stage 1 and stage 2. Should index-strategy advisories fire for sharded queries? The `estimateDocumentCount` call would still work, but the explain plan structure is different (per-shard plans). For now, the advisories will only fire for non-sharded queries (where `findStageInPlan` works on the single winning plan). Sharded support can be added later.

4. **`examinedReturnedRatio` displayed elsewhere?** The formatted ratio string (`"50 : 1"`) was used in the 2×2 grid. After replacing it with "Fetch Overhead", is it referenced anywhere else in the UI? Quick check says no — the `concerns` array uses the raw number, and Stage 3 AI uses `rawExecutionStats`. Safe to remove from `efficiencyAnalysis`.

---

## Estimated Complexity by Task

| Task                          | Files Changed | Lines Added/Modified | Risk                   |
| ----------------------------- | ------------- | -------------------- | ---------------------- |
| 1. diagnosticId               | 2             | ~40                  | Low                    |
| 2. Constants                  | 1             | ~10                  | Trivial                |
| 3. findStageInPlan            | 1             | ~20                  | Low                    |
| 4. detectLowCardinalityIndex  | 1             | ~50                  | Medium (regex parsing) |
| 5. addIndexStrategyAdvisories | 1             | ~80                  | Medium                 |
| 6. Router wiring              | 1             | ~15                  | Low                    |
| 7. transformStage2Response    | 2             | ~60                  | Medium                 |
| 8. QueryInsightsTab 2×2 grid  | 1             | ~20                  | Low                    |
| 9. PerformanceRatingCell      | 1             | ~15                  | Low                    |
| 10. l10n + formatting         | —             | —                    | Trivial                |
