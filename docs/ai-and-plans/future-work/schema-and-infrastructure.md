# Future Work: Schema & Infrastructure

> Schema enhancements, build optimizations, and architectural improvements.

---

## Schema Persistence Across Sessions

**Priority:** P2 | **Impact:** Medium | **Effort:** 1–2 days

Persist `SchemaStore` data across VS Code sessions using workspace state or a cache file. Currently, all schema knowledge is lost on restart — users must requery to get field completions.

---

## Document Editor Schema Integration

**Priority:** P2 | **Impact:** Medium | **Effort:** 2 days

Wire `SchemaAnalyzer` output into Monaco's `setDiagnosticsOptions()` for the document view editor. Provides real-time validation and autocomplete when editing individual documents.

---

## Index Advisor Integration

**Priority:** P3 | **Impact:** Medium | **Effort:** 2–3 days

Suggest index-friendly query patterns. When typing a `$match` stage, suggest fields that have indexes. Warn when queries use operators that can't leverage existing indexes.

---

## Schema Statistics UI

**Priority:** P2 | **Impact:** Medium | **Effort:** 3–5 days

Dedicated schema visualization panel showing field presence probability, type distribution, value range statistics, and array size distributions.

---

## Constants & API Surface

### Full API Constants Package

**Priority:** P2 (when triggered) | **Effort:** 2–3 days

When the extension connects to a full API-compatible instance (not DocumentDB), the completion providers should offer the full operator set. Requires a separate constants source or mode switch.

### Shell Methods Registry

**Priority:** P2 | **Effort:** 1–2 days

Extend `documentdb-constants` (or create a sibling package) with shell API method metadata — which `db.*`, `db.collection.*`, and cursor methods are supported on DocumentDB. Enables `DocumentDBServiceProvider` to accurately block unsupported operations.

---

## Build & Bundle

### Revisit Webpack Externals

**Priority:** P3 | **Effort:** 0.5 day

On `@mongosh` version upgrade, check if the 7 externalized optional dependencies are still needed.

### Lazy Operator Data Loading

**Priority:** P3 | **Effort:** 1 day (measure first)

Load operator categories selectively. Always load: `query`, `bson`, `variable`. Load on demand: `stage`, `accumulator`, `expr*`, `update`.

### Worker Warm-Up Heuristic

**Priority:** P3 | **Effort:** 0.5 day

Eagerly spawn the playground worker when a `.documentdb` file is opened (before `Run` is clicked) to eliminate first-run latency.

---

## Additional Monaco Providers

| Provider                       | Priority | Description                                                  |
| ------------------------------ | -------- | ------------------------------------------------------------ |
| InlayHintsProvider             | P3       | Inline type annotations in query editors: `{ age: ▸int 25 }` |
| DocumentFormattingEditProvider | P3       | Auto-format aggregation pipelines and playground files       |
| FoldingRangeProvider           | P3       | Code folding for pipeline stages and nested objects          |
| DocumentSymbolProvider         | P3       | Outline/breadcrumbs for pipeline stages                      |
