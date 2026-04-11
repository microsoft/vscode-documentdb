# Step 3 — `documentdb-constants` Package

**PR:** [#513](https://github.com/microsoft/vscode-documentdb/pull/513)

## Summary

Created a standalone npm workspace package (`packages/documentdb-constants/`) that provides static metadata for all DocumentDB-supported operators — query operators, update operators, aggregation stages, accumulators, expression operators, BSON type constructors, and system variables. This package is the single source of truth for operator metadata across all autocompletion surfaces.

## Motivation

Multiple extension surfaces need operator metadata: the filter bar, project/sort editors, the Query Playground, and eventually the aggregation pipeline editor. Previously, operator definitions were scattered — some hardcoded in `generateMongoFindJsonSchema()`, others in the legacy scrapbook's `SchemaService`. A centralized, well-typed package eliminates duplication and ensures consistency.

## Design

### Data Source

The primary data source is the [Azure DocumentDB compatibility reference](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language), which lists every operator with its support status. Operators not supported by DocumentDB are excluded. The package also includes per-operator documentation links generated from the DocumentDB docs URL pattern.

### Core Interface

Each operator entry includes:

- `value` — the operator string (e.g., `$gt`, `ObjectId`)
- `meta` — hierarchical category tag for filtering (e.g., `query:comparison`, `stage`, `bson`)
- `description` — one-line human-readable description
- `snippet` — Monaco/VS Code snippet with tab stops for insertion
- `link` — URL to DocumentDB documentation
- `applicableBsonTypes` — optional: restricts the operator to specific field types (e.g., `$regex` → `['string']`)
- `standalone` — whether the operator appears in completion lists (sub-operators like `$box` are marked `false`)

### Meta Tag Hierarchy

Tags use a hierarchical prefix scheme enabling efficient filtering:

- `query`, `query:comparison`, `query:logical`, `query:element`, etc.
- `update`, `update:field`, `update:array`
- `stage`, `accumulator`
- `expr:arith`, `expr:date`, `expr:string`, etc.
- `bson`, `variable`

### Consumer API

The primary API is `getFilteredCompletions({ meta, bsonTypes })` which returns operator entries matching the given filter. Convenience presets are exported for common contexts:

- `FILTER_COMPLETION_META` — for find filter bars and `$match` stages
- `STAGE_COMPLETION_META` — for aggregation pipeline top-level
- `UPDATE_COMPLETION_META` — for update operations
- `GROUP_EXPRESSION_COMPLETION_META` — for `$group`/`$project` stage bodies

### Data Collection Approach

A scripted pipeline was used:

1. **Scrape** — automated extraction from the DocumentDB docs repo
2. **Generate** — machine-generated TypeScript source files from the scraped data
3. **Override** — human-maintained overrides for descriptions, snippets, and doc links

This ensures the operator list stays in sync with the official documentation while allowing hand-tuned completions.

## Key Discussions

### DocumentDB vs Full API Scope

The package deliberately includes only DocumentDB-supported operators. When the extension connects to a full API-compatible instance, a separate constants source (or mode switch) provides the complete operator set. The `OperatorEntry` interface is designed for this future swap — consumers call `getFilteredCompletions()` regardless of the backing data source.

### Operator Count

308 entries total across all categories:

| Category                     | Count |
| ---------------------------- | ----- |
| Aggregation Stages           | 54    |
| Query & Projection Operators | 43    |
| Update Operators             | 22    |
| Expression Operators         | 143   |
| Accumulators                 | 20+   |
| BSON Constructors            | 15+   |
| System Variables             | 10+   |

### Type-Aware Filtering

The `applicableBsonTypes` field on `OperatorEntry` enables type-aware operator ordering in completions. For example, when the user is inside `{ age: { $▌ } }` and `age` is known to be `Number`, operators like `$regex` (applicable to strings only) are demoted in the list while remaining visible. Nothing is hidden — type affinity only affects sort order.

## Testing

- Structural tests verify every operator has required fields
- Reference tests validate the implementation matches the scraped documentation dump
- Consumer API tests verify filtering by meta tags and BSON types
