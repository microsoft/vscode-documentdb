# Future Work: Aggregation Pipeline

> Aggregation Pipeline Editor and CompletionItemProvider — deferred from the shell integration feature, to be delivered as a separate work item.

---

## Aggregation Pipeline CompletionItemProvider

**Priority:** P1 | **Impact:** High | **Effort:** 3–5 days

### What

Full context-aware completions inside aggregation pipeline arrays. The completion provider distinguishes stage operators (`$match`, `$group`, `$project`) from field-level operators.

### Expected Behavior

| Context                                      | What Shows                                                      |
| -------------------------------------------- | --------------------------------------------------------------- |
| `aggregate([{ $▌ }])`                        | Stage operators (`$match`, `$group`, `$project`, `$sort`, etc.) |
| `aggregate([{ $match: { ▌ } }])`             | Field names + query operators (same as filter editor)           |
| `aggregate([{ $group: { total: { $▌ } } }])` | Accumulator operators (`$sum`, `$avg`, `$max`)                  |
| `aggregate([{ $project: { ▌ } }])`           | Expression operators + field names                              |

### Architecture

The `documentdb-constants` package already has the meta tag hierarchy needed:

- `STAGE_COMPLETION_META` — for top-level stage selection
- `FILTER_COMPLETION_META` — reused inside `$match` stages
- `GROUP_EXPRESSION_COMPLETION_META` — expressions + accumulators
- `EXPRESSION_COMPLETION_META` — expressions only (other stages)

The three-category stage mapping (an established pattern in MongoDB API tooling) maps each stage to its operator scope.

### What Exists Today

- `documentdb-constants` has all operator entries with correct meta tags
- The webview `CompletionItemProvider` infrastructure handles `documentdb-query` language
- `cursorContext.ts` detects cursor position within query objects
- The Query Playground's `CompletionItemProvider` has `provideMethodArgumentCompletions()` with an `argCtx.methodName` that can route on method type

### What Needs to Be Built

1. **Stage detection** — in the webview aggregation editor, detect whether the cursor is at the pipeline array level or inside a specific stage
2. **Stage-to-meta-tag mapping** — route `$match` → query operators, `$group`/`$project` → expression+accumulator, other stages → expression only
3. **`$`-prefixed field references** — inside expression contexts, typing `"$"` should suggest `"$fieldName"` for known schema fields
4. **Scratchpad integration** — the playground's `provideMethodArgumentCompletions()` should route on `aggregate` to show stage operators instead of query operators

### Discussion: Method-Aware Catalog Routing

Currently, the scratchpad completion provider shows all query operators regardless of method context. `db.users.aggregate([{ $▌ }])` should show stage operators, not query operators. Similarly, `db.users.updateOne({}, { ▌ })` should show update operators (`$set`, `$unset`).

The `scratchpadContextDetector.ts` has structural scaffolding for `insideArgOf` detection that is currently unused. The working path uses `detectMethodArgContext()` instead — a separate backward scanner. Implementation should either populate the existing scaffolding or replace it with explicit routing in `provideMethodArgumentCompletions()`.

---

## Stage Output Schema Propagation

**Priority:** P3 | **Impact:** High (when agg pipeline editor exists) | **Effort:** 5+ days

Track how each aggregation stage transforms the document schema. `$project` reduces fields, `$unwind` changes array→scalar, `$group` creates a new shape.

### Architecture

- Run each stage's preview (debounced, ~700ms)
- Analyze output documents with `SchemaAnalyzer`
- Feed the resulting schema to the next stage's completion provider
- `SchemaAnalyzer` already works on any set of documents — not tied to a specific collection

This is a differentiation opportunity — existing MongoDB API tooling does not propagate schema between stages.

---

## Per-Stage Preview

**Priority:** P2 | **Impact:** High | **Effort:** 5–10 days

Show output documents at each pipeline stage point, updating as the user edits stages.
