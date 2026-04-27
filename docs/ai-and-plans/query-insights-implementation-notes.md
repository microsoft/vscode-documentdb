# Query Insights Performance Rating — Implementation Notes

> **Date:** April 27, 2026
> **Branch:** `dev/tnaum/query-insights-performance-rating`

## Changes from Approved Messages

All user-facing messages from the implementation plan were preserved as-is,
with the following additions and changes:

### New Messages (not in original plan)

| Message                     | Context                        | Reason                                                                          |
|-----------------------------|--------------------------------|---------------------------------------------------------------------------------|
| `'Query failed'`           | Fetch Overhead cell (failed)   | `createFailedQueryResponse` needed a fetchOverhead value for the new cell shape |
| `'None (collection scan)'` | Index Used cell (null fallback)| More descriptive than the previous `'None'` when no index is used              |

### Unchanged Messages

All diagnostic `message` and `details` texts from the plan are preserved
verbatim, including:

- Efficiency ratio badges (high/moderate/low/very low)
- Execution time badges (fast/acceptable/slow/very slow)
- Index usage badges (index used/full collection scan/no index used)
- Sort strategy badges (in-memory sort/efficient sorting/no sorting required)
- Coverage advisories (returns majority of collection, low filter selectivity)
- Cardinality advisory (low-cardinality index)
- Multikey expansion badges (high/severe)

### Fetch Overhead Labels

These are new user-facing strings added via `l10n.t()`:

- `'No matches'` — when nReturned === 0
- `'Covered query'` — covered index query
- `'Collection scan'` — full collection scan
- `'Multikey expansion ({0}×)'` — parameterized with ratio
- `'Multikey expansion (>10×)'` — capped display for very high ratios
- `'Direct fetch'` — normal index scan + fetch

## Implementation Deviations

### Deviation from Plan: `examinedReturnedRatioFormatted` cleanup

The plan said to keep `examinedReturnedRatio` in `efficiencyAnalysis`.
Since the field was removed from the type and no consumers reference it,
the `formatRatioForDisplay` helper was removed as dead code. The raw
`examinedToReturnedRatio` number remains as a top-level field on
`QueryInsightsStage2Response` for the concerns logic and AI context.

### Deviation from Plan: Stage 1 `efficiencyAnalysis` unchanged

The plan only specified changes to Stage 2's `efficiencyAnalysis`. Stage 1
still uses its own type with `executionStrategy` since it doesn't have
execution stats. This is intentional — Stage 1 has no performance rating.

### Deviation from Plan: `executionStrategy` top-level field kept

The `executionStrategy` string remains as a top-level field on
`QueryInsightsStage2Response` (used by concerns logic). Only removed
from `efficiencyAnalysis` (the 2×2 grid data object).
