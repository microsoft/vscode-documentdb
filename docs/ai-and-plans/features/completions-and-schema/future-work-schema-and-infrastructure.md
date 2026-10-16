---
feature: completions-and-schema
kind: plan
status: active
created: 2026-04-10
code:
    - src/documentdb/query-language/**
    - packages/documentdb-js-operator-registry/**
    - packages/documentdb-js-schema-analyzer/**
verified: 2026-08-14
---

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

## Parse Shell Results in the Worker

**Priority:** P3 | **Impact:** Medium | **Effort:** 1–2 days

The shell worker holds the raw result objects, serializes them to EJSON for IPC, and the extension
host parses them straight back to feed `SchemaStore`. Have the worker compute the schema
contribution instead and ship a delta. Removes a redundant stringify/parse round trip and takes the
work off the main thread entirely — today it runs synchronously before the next prompt is drawn.
Raised during the PR #933 review; see
[iterations/09-bson-dual-package-hazard-review.md](./iterations/09-bson-dual-package-hazard-review.md).

---

## Dual-Package Hazard Signal in `SchemaAnalyzer`

**Priority:** P3 | **Impact:** Low | **Effort:** 0.5 day

`BSONTypes.inferType()` falls back to the `_bsontype` tag when `instanceof` fails, which keeps
inference correct when a second copy of `bson` is loaded — but silently. Expose a cheap monotonic
counter of fallback hits that the extension can sample into accumulating telemetry, so a bundler
regression is visible rather than merely survivable. Deliberately held back from 1.0.0: it adds
public API at the point the package commits to stability, and the call path is far too hot to
instrument per call.

---

## Constants & API Surface

### Full API Constants Package

**Priority:** P2 (when triggered) | **Effort:** 2–3 days

When the extension connects to a full API-compatible instance (not DocumentDB), the completion providers should offer the full operator set. Requires a separate constants source or mode switch.

### Shell Methods Registry

**Priority:** P2 | **Effort:** 1–2 days

Extend `operator-registry` (or create a sibling package) with shell API method metadata — which `db.*`, `db.collection.*`, and cursor methods are supported on DocumentDB. Enables `DocumentDBServiceProvider` to accurately block unsupported operations.

---

## Build & Bundle

### Revisit Webpack Externals

**Priority:** P3 | **Effort:** 0.5 day

On `@mongosh` version upgrade, check if the 7 externalized optional dependencies are still needed.

### Assert a Single `bson` Copy in the Bundle

**Priority:** P3 | **Effort:** 0.5 day

Iteration 09 leaves a manual post-build check that `dist/` contains no ESM `bson` chunk. Promote it
to a packaging assertion so a dynamic import cannot silently reintroduce a second copy — the
original regression went unnoticed for three and a half months precisely because nothing checked.
Note that `grep -c` exits non-zero on zero matches, so the check must be written as `! grep -q`.

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
