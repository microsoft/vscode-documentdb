# Future Work

Items moved outside the scope of the current project (filter/shell/scrapbook) or ideas generated during development.

---

## SchemaAnalyzer Enhancements

### Computed Probabilities on `getSchema()`

`SchemaAnalyzer` currently stores `x-occurrence` per field and `x-documentsInspected` on the schema root, allowing probability to be derived as `occurrence / documentsInspected`. However, probabilities are not pre-computed on the schema output.

**Proposal:** Add an optional `computeProbabilities` flag to `getSchema()` (default: `false`) that, when enabled, computes and includes `x-probability` (a number between 0 and 1) on every field entry in the schema output.

It should differentiate between "global" and "local" probability. local is within the path, so if a field "name" actually exists, then it's relevant to know when e.g. 90% is a string and 10% are numbers (would suggest an error). better than having a type as "global probability" for such a field.
Similarly it makes sense for fields in a subdocument: address exists in 10% of documents, then address.name exists in 10% of documents globally, but we are more likely to look at the "local" probability, as the information would be "name" exists in 100% of "address".

```typescript
// Proposed API change:
interface GetSchemaOptions {
  /** When true, adds x-probability to every field (occurrence / documentsInspected). Default: false. */
  computeProbabilities?: boolean;
}

getSchema(options?: GetSchemaOptions): JSONSchema;
```

**Use cases:**

- Schema statistics UI — show users which fields are sparse
- Query optimization hints — warn about queries on highly sparse fields
- LLM prompt enrichment — include field probability in schema definitions for smarter query generation

**Effort:** Low (~0.5 day). The data (`x-occurrence`, `x-documentsInspected`) is already tracked; this is a traversal + division operation during `getSchema()`.

---

## Field Statistics in Completion Items

### Problem

`FieldCompletionData` currently shows only the BSON type and a sparse/not-sparse flag in the completion list (e.g., `"String"` or `"String (sparse)"`). The underlying `SchemaAnalyzer` already computes rich per-field statistics — occurrence counts, type distributions, value ranges — but none of this reaches the completion UI.

A completion item for `age` could show `Number · 98% · 17–82` instead of just `Number`. This gives users immediate context about the data without running a query.

### Available Statistics (Already Computed by SchemaAnalyzer)

The schema's `x-` extension fields provide everything needed:

| Schema field                             | What it tells you                        | Example display          |
| ---------------------------------------- | ---------------------------------------- | ------------------------ |
| `x-occurrence` / `x-documentsInspected`  | Field presence rate                      | `98%` or `sparse (12%)`  |
| `x-typeOccurrence` (per type in `anyOf`) | Type distribution for polymorphic fields | `80% String, 20% Number` |
| `x-minValue` / `x-maxValue`              | Numeric range                            | `17–82`                  |
| `x-minLength` / `x-maxLength`            | String length range                      | `len 3–64`               |
| `x-minDate` / `x-maxDate`                | Date range                               | `2021-01–2024-12`        |
| `x-trueCount` / `x-falseCount`           | Boolean distribution                     | `73% true`               |
| `x-minItems` / `x-maxItems`              | Array size range                         | `[2–15] items`           |

### Proposal: Add `description` to `FieldCompletionData`

The simplest approach: add a pre-compiled `description` string to `FieldCompletionData`, built during `toFieldCompletionItems()` from the schema stats. Monaco renders this in the completion detail/documentation panel.

```typescript
export interface FieldCompletionData {
  // ... existing fields ...

  /**
   * Human-readable summary of field statistics from the schema sample.
   * Pre-compiled from SchemaAnalyzer's x- extension fields.
   *
   * Examples:
   *   "Number · 98% · range 17–82"
   *   "String · 100% · len 3–64"
   *   "Boolean · 12% (sparse) · 73% true"
   *   "80% String, 20% Number · 95%"
   */
  description?: string;
}
```

This keeps the interface simple — one optional string — while the compilation logic lives in `toFieldCompletionItems()` which already has access to the schema. The completion provider maps `description` to `CompletionItem.documentation` (shown in the detail panel on focus).

### Alternative: Structured Stats Object

For consumers that need programmatic access (e.g., type-aware operator ordering in Step 4.5, or a schema statistics UI):

```typescript
export interface FieldStats {
  /** Field presence rate (0–1), e.g. 0.98 means present in 98% of documents */
  presenceRate?: number;
  /** Type distribution for polymorphic fields, e.g. { "string": 0.8, "number": 0.2 } */
  typeDistribution?: Record<string, number>;
  /** Numeric value range */
  numericRange?: { min: number; max: number };
  /** String length range */
  stringLengthRange?: { min: number; max: number };
  /** Date range */
  dateRange?: { min: string; max: string };
  /** Boolean true rate (0–1) */
  booleanTrueRate?: number;
  /** Array size range */
  arraySizeRange?: { min: number; max: number };
}

export interface FieldCompletionData {
  // ... existing fields ...
  stats?: FieldStats;
  description?: string; // compiled from stats for display
}
```

Both approaches can coexist — `stats` for programmatic use, `description` for display. The compilation from `stats` to `description` is a simple formatting function.

### Implementation Path

1. Extend `FieldEntry` in `schema-analyzer` to carry raw stats (occurrence count, type occurrence counts, value ranges) — the data is already in the schema, just not surfaced on `FieldEntry`
2. Extend `toFieldCompletionItems()` to compile stats into a `description` string
3. Map `description` to `CompletionItem.documentation` in `documentdbQueryCompletionProvider.ts`

### Effort

Low (~1 day). The statistics are already computed and stored in the schema. This is a data-threading exercise — expose them on `FieldEntry`, format them in `toFieldCompletionItems()`, and display in the completion item.

---

## MongoDB Constants Package

When the extension connects to a MongoDB instance (not DocumentDB), the completion providers should offer the full MongoDB operator set. This requires a separate constants package:

- **Package:** `packages/mongodb-constants/` (or reuse `@mongodb-js/mongodb-constants` under Apache-2.0)
- **Interface:** Exports the same `OperatorEntry[]` interface as `documentdb-constants`
- **Scope:** Full MongoDB 8.0 operator set (superset of DocumentDB)
- The switching logic is already designed — `isDocumentDB(connection)` determines which constants to load

**Dependency:** Requires `documentdb-constants` to be built first (establishes the shared interface).

---

## Schema Statistics UI

A dedicated schema visualization panel showing:

- Field presence probability (occurrence / documents inspected)
- Type distribution per field (polymorphic fields)
- Value range statistics (min/max for numbers, dates, string lengths)
- Array size distributions

**Potential dependency:** `mongodb-schema` package for reservoir-sampled representative values and unique value detection (features `SchemaAnalyzer` does not provide). See 01-high-level-plan.md "When might mongodb-schema become attractive?" section.

---

## Document Editor Schema Integration (F1)

Wire `SchemaAnalyzer` output into Monaco's `setDiagnosticsOptions()` for the document view editor. This provides real-time validation and autocomplete when editing individual documents.

**Status:** Deferred from the main plan (listed as component F1 in 01-high-level-plan.md).

---

## Lazy / On-Demand Operator Data Loading

**Context:** `documentdb-constants` currently calls `loadOperators()` eagerly at module load time (in `index.ts`), which registers all ~300 operator entries — expression operators, stages, accumulators, window operators, BSON constructors, update operators, etc. — into memory on first import. For completions that are only relevant inside an aggregation pipeline, or only inside an `$update` call, there is no reason to load all categories at extension startup.

The refactor in PR #513 already lays the groundwork: each data module exports an independent `loadXxx()` function, and `loadOperators()` simply calls all of them. The architecture now supports selective loading without further restructuring.

### What to revisit

1. **Audit which categories are needed at launch vs. on-demand.**
   Categories needed for the most common use case (filter bar, shell prompt) are a subset:
   - Always load at launch: `query*`, `variable`, `bson` (small, universally needed)
   - Load on first aggregation: `stage`, `accumulator`, `window`, `expr*` (bulk of the data)
   - Load on first update: `update*`

2. **Introduce category-group load functions** in `index.ts`:

   ```typescript
   export function loadCoreCompletions(): void {
     /* query, variable, bson */
   }
   export function loadAggregationCompletions(): void {
     /* stage, accumulator, window, expr* */
   }
   export function loadUpdateCompletions(): void {
     /* update* */
   }
   ```

   The registry's idempotency guard (Set-based dedup added in PR #513) means calling these multiple times is safe — call them lazily on first need.

3. **Wire into CompletionItemProviders** (Steps 4–8): each provider calls its relevant load group before returning completions. Because the registry is module-global and dedup-guarded, the load is a no-op on subsequent invocations.

4. **Measure the impact.** Profile `getAllCompletions()` time and initial `import` time before and after. The bulk is `expressionOperators.ts` (~143 entries) and `queryOperators.ts` (~43 entries). Both are synchronous array allocations, so the gain may be modest — measure first, optimize based on data.

### Related: other static data in the extension

Audit other eagerly-loaded static tables elsewhere in the extension for the same pattern:

- Grammar files (`grammar/`)
- Any `const` arrays populated at module scope in `src/` that are only used in specific views or commands

**Effort:** Medium (~1 day for the constants package split + provider wiring). Measurement first (~0.5 day).

**Dependency:** CompletionItemProvider implementation (Steps 4–8) must be at least partially in place before the wiring step is meaningful.

---

## Stage-Aware Aggregation Pipeline Preview

Compass implements per-stage preview (showing stage output next to the pipeline editor). This is a differentiating feature we could implement:

- Each stage shows a live preview of documents at that pipeline point
- Schema propagation between stages (what Compass does NOT implement — a competitive advantage)

**Dependency:** Requires Aggregation `CompletionItemProvider` (Step 8) to be complete first.

---

## TS Language Service for Advanced Completions (P2)

The analysis documents (17-implementation-recommendations.md) identified Monaco's built-in TypeScript Language Service as a P2 optional enhancement for completions:

- Load shell API `.d.ts` plus per-collection schema `.d.ts` into Monaco's TS worker via `addExtraLib()`
- Provides hover docs, type inference, and richer completions beyond static constant lists
- Complements (does not replace) `documentdb-constants`-based completions

**Prerequisite:** Shell API `.d.ts` generation (Step 5 in 01-high-level-plan.md).

---

## Index Advisor Integration with Completions

The index advisor feature could suggest index-friendly query patterns when users are writing queries. For example:

- When typing a `$match` stage, suggest fields that have indexes
- Warn when queries use operators that can't leverage existing indexes

**Dependency:** Requires both `documentdb-constants` and the index advisor to be operational.

---

## Agentic Workflow: Operator Reference Freshness Check

An automated agentic workflow that periodically re-scrapes the DocumentDB compatibility docs and detects external drift (new operators, changed descriptions, URL restructuring, deprecated operators).

### Motivation

The `documentdb-constants` package has CI tests that verify internal consistency — the implementation matches the checked-in dump and overrides. But these tests will never fail on their own because they only compare files within the repo. External drift (DocumentDB adds a new operator, changes a description, restructures docs URLs) is invisible until someone manually re-runs the scraper.

### Workflow Steps

```
1. npm run scrape
   → Fetches latest compatibility page + per-operator doc pages
   → Regenerates resources/operator-reference-scraped.md

2. git diff resources/operator-reference-scraped.md
   → If no diff: "No upstream changes. Done." → exit
   → If diff: continue

3. npm run evaluate
   → Reports: new gaps (operators with empty descriptions),
     redundant overrides (override provides description that now
     exists upstream), coverage stats

4. npm run generate
   → Regenerates .ts files from updated dump + existing overrides

5. npm test
   → Runs all CI tests against the updated code
   → Failures indicate drift that needs attention:
     - New operator in dump but missing from generated code
     - Description changed upstream (override may mask or conflict)
     - Doc URL changed (link verification test catches this)
     - Operator removed upstream (no-extras test catches this)

6. If diff or test failures exist:
   → Open a PR with:
     - Updated operator-reference-scraped.md
     - Updated generated .ts files (if generate succeeded)
     - Summary of what changed (from git diff)
     - List of test failures (if any)
     - Evaluation report (gaps, redundant overrides)
   → Assign for human review

7. Human reviews:
   → New operators: verify descriptions, add overrides if needed
   → Changed descriptions: decide whether to keep override or adopt upstream
   → Removed operators: confirm deprecation, update not-listed section
   → URL changes: verify links still resolve
```

### Schedule

Weekly or monthly. DocumentDB compatibility updates are typically tied to major/minor version releases (a few times per year), so monthly is sufficient. Weekly provides earlier detection.

### Agent Prompt (Draft)

```
You are maintaining the documentdb-constants package in vscode-documentdb.

1. Run: cd packages/documentdb-constants && npm run scrape
2. Check: git diff resources/operator-reference-scraped.md
3. If no changes: report "No upstream drift detected" and stop.
4. If changes: run npm run evaluate, then npm run generate, then npm test.
5. If tests pass: commit all changes and open a PR titled
   "chore: update documentdb-constants operator reference"
   with a summary of what changed.
6. If tests fail: open a PR anyway with the failures noted,
   flagged for human review.
```

### Prerequisites

- The scraper (`scripts/scrape-operator-docs.ts`) must remain functional — it depends on the structure of the upstream docs repo
- GitHub Actions or equivalent CI runner with network access for the scraper
- Agent must have permission to create branches and open PRs

### Existing Infrastructure

| Component                        | Status       | Location                                    |
| -------------------------------- | ------------ | ------------------------------------------- |
| Scraper                          | ✅ Built     | `scripts/scrape-operator-docs.ts`           |
| Override system                  | ✅ Built     | `resources/operator-reference-overrides.md` |
| Generator                        | ✅ Built     | `scripts/generate-from-reference.ts`        |
| Evaluator                        | ✅ Built     | `scripts/evaluate-overrides.ts`             |
| CI tests (internal consistency)  | ✅ Built     | `src/operatorReference.test.ts`             |
| CI tests (merged dump+overrides) | ✅ Built     | `src/operatorReference.test.ts`             |
| GitHub Actions workflow          | ❌ Not built | Needs `.github/workflows/` YAML             |

---

## Additional Monaco Language Feature Providers

### Context

Beyond `CompletionItemProvider` and `HoverProvider` (implemented in Step 4), Monaco exposes many more language feature providers. The table below catalogues all of them with a per-editor-type usefulness rating.

### Provider Reference Table

| Provider | Query Editors (filter/project/sort) | Aggregation Pipeline | Scrapbook | Notes |
|---|---|---|---|---|
| **CompletionItemProvider** | **Implemented** | Planned (Step 8) | Planned (Step 7) | Static operators + dynamic fields |
| **HoverProvider** | **Implemented** | Planned | Planned | Operator docs on hover |
| **SignatureHelpProvider** | **High** | **High** | **High** | Parameter hints for BSON constructors, e.g. `ObjectId(│hex│)` |
| **CodeActionProvider** | **High** | **High** | Medium | Quick-fix for near-miss warnings → auto-replace typo |
| **InlayHintsProvider** | **High** | Medium | Low | Inline type annotations, e.g. `{ age: ▸int 25 }` |
| **DocumentFormattingEditProvider** | Medium | **High** | **High** | Auto-format/prettify; low value for single-line filters |
| **FoldingRangeProvider** | Low | **High** | **High** | Fold pipeline stages, nested objects |
| **DocumentSymbolProvider** | Low | **High** | **High** | Outline / breadcrumbs — pipeline stages as symbols |
| **CodeLensProvider** | Medium | Medium | **High** | "Run" / "Run Stage" above code blocks |
| **LinkProvider** | Medium | Medium | Low | Clickable operator names → docs (currently shown in hover only) |
| **RenameProvider** | Low | Medium | **High** | Rename field references across pipeline or script |
| **DocumentRangeFormattingEditProvider** | Low | Medium | Medium | Format selection only |
| **OnTypeFormattingEditProvider** | Medium | Medium | Medium | Auto-indent on `{`, `}`, `,` |
| **DocumentSemanticTokensProvider** | Medium | Medium | Medium | Richer coloring: operators vs fields vs constructors |
| **InlineCompletionProvider** | Low | Medium | Medium | Ghost-text suggestions (Copilot-style); needs AI backend |
| **DocumentHighlightProvider** | Low | Low | Medium | Highlight all occurrences of a symbol |
| **DefinitionProvider** | Low | Low | Medium | Go to definition (only meaningful with `let`/`const`) |
| **ReferenceProvider** | Low | Low | Medium | Find all references |
| **LinkedEditingRangeProvider** | Low | Low | Low | Simultaneous edit of matching tags; not applicable |
| **DeclarationProvider** | Low | Low | Low | Mostly redundant with DefinitionProvider |
| **ColorProvider** | Low | Low | Low | Color picker — not applicable |

### Recommended Next Providers

#### 1. SignatureHelpProvider

**Usefulness:** High across all editor types.

Shows parameter hints when typing inside BSON constructor or function calls — e.g., `ObjectId(|hex string|)`, `NumberDecimal(|value|)`, `ISODate(|ISO 8601 string|)`.

The metadata is already available: `OperatorEntry.snippet` defines the parameter structure with tab stops (`${1:hex}`). The provider parses the snippet definition to extract parameter names and types, then shows them as the user types between parentheses.

**Effort:** Low (~0.5 day). Trigger characters: `(`, `,`. Parse the matching `OperatorEntry.snippet` for the current function name.

#### 2. CodeActionProvider

**Usefulness:** High for query editors and aggregation pipelines.

Provides quick-fix actions for the near-miss warnings already produced by the `acorn` validator. When the validator emits "Did you mean 'Date'?" for `Daate.now()`, the CodeActionProvider offers a one-click fix that replaces `Daate` with `Date`.

This pairs directly with the existing `Diagnostic` infrastructure — each warning diagnostic becomes a `CodeAction` with a `WorkspaceEdit` that performs the replacement.

**Effort:** Low (~0.5 day). The validator already computes the exact offset range and the suggested replacement. The CodeActionProvider maps diagnostics to edits.

#### 3. FoldingRangeProvider

**Usefulness:** High for aggregation pipelines and scrapbook, low for single-line query editors.

Enables code folding for nested objects, arrays, and pipeline stages. In a multi-stage aggregation pipeline, each stage can be collapsed independently. In scrapbook scripts, function bodies and complex expressions can be folded.

**Effort:** Low (~0.5 day). Can be implemented with simple brace/bracket matching or by reusing the `acorn` AST to identify foldable regions.

---

## Completion Provider Enhancements

### Dot-triggered method completions for JS globals

When the user types `Date.` or `Math.`, trigger method-specific completions dynamically instead of showing the full completion list. This requires detecting the word before the `.` trigger character and returning method completions for that specific object.

**Approach:** In the completion provider, when charBefore is `.` and the word before the dot is a known JS global (`Date`, `Math`), return whitelisted methods from shell-bson-parser's `ALLOWED_CLASS_EXPRESSIONS`.

**Effort:** Medium (~1 day). Requires changes to cursor context detection and a new method resolution path in the completion provider.

### Projection/sort value suggestions

Project editors need `1` / `0` / `true` / `false` as value-position suggestions (include/exclude fields). Sort editors need `1` / `-1` (ascending/descending). Currently no type suggestions are shown at value position in these editors because the BSON field type is not relevant for projection semantics.

**Approach:** Detect `EditorType.Project` or `EditorType.Sort` in `createValuePositionCompletions` and return editor-specific value suggestions instead of BSON-type-based ones.

**Effort:** Low (~0.5 day).

### Method-level validation for JS globals

The validator currently checks object-level identifiers (`Date` → known, `Daate` → warning) but does not validate method names (`Date.nodw()` → no diagnostic). Adding method-level validation would require maintaining a whitelist of methods per global class, matching shell-bson-parser's `ALLOWED_CLASS_EXPRESSIONS`.

**Effort:** Low (~0.5 day). The whitelist already exists in shell-bson-parser's scope.js.

### Field name validation against schema

The validator intentionally does not flag unknown field names (`{ nonExistentField: 1 }` produces no diagnostic). With the completion store holding known fields per session, field names could be validated against the schema with severity `'info'` (hint) — "Field 'nonExistentField' not found in the sampled schema."

**Effort:** Medium (~1 day). Requires wiring the completion store into the validator, which currently has no Monaco or session dependencies.

### Deep nesting context detection (3+ levels)

The cursor context heuristic scans backward through 1-2 levels of nesting. At 3+ levels (e.g., `{ $and: [{ age: { $gt: { $numberLong: | } } }] }`), it may fall back to `unknown`. An AST-based approach (dummy completion insertion) could improve accuracy for deeply nested positions.

**Effort:** High (~2 days). The dummy completion strategy has fundamental ambiguity issues (see 4.5 plan "Why Not Use a Dummy Completion Strategy").
