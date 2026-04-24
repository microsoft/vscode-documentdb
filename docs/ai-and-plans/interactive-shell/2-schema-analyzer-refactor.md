# Step 2 — SchemaAnalyzer Refactoring

**PR:** [#506](https://github.com/microsoft/vscode-documentdb/pull/506)

## Summary

Extracted the `SchemaAnalyzer` from a utility file inside the extension source tree into a standalone npm workspace package at `packages/schema-analyzer/`. Enriched `FieldEntry` with BSON type information to support type-aware completions in later steps.

## Motivation

The extension already had a capable schema analyzer — it powered table column headers and basic field name extraction in the Collection View. However, the implementation was tightly coupled to the extension source tree and its `FieldEntry` type lacked BSON type information, which future completion providers needed for type-aware operator ordering (e.g., prioritizing `$regex` for string fields, `$size` for array fields).

### Why SchemaAnalyzer Before `documentdb-constants`

The original plan proposed building `documentdb-constants` first. After deeper analysis, SchemaAnalyzer refactoring came first because:

1. The `FieldEntry` enhancement (adding `bsonType`) determines how `CompletionItemProvider` receives type information. This interface had to be settled before building the provider that consumes both constants and field entries.
2. The SchemaAnalyzer had an array element stats bug that silently overwrote data across documents — this needed fixing before building on top of it.
3. `documentdb-constants` is purely static data and has no runtime dependency on schema. It could be built in parallel once the interfaces were settled.

## Key Decisions

### JSON Schema as Universal Protocol

JSON Schema (with `x-` extensions like `x-bsonType`, `x-occurrence`, `x-typeOccurrence`) was formally adopted as the canonical protocol between `SchemaAnalyzer` and all consumers. This was already the de facto output format, but this step made it an explicit architectural choice.

All downstream transformers (`getKnownFields`, `toFieldCompletionItems`, future `toTypeScriptDefinition`) are standalone functions that take JSON Schema as input. They don't access SchemaAnalyzer internals — clear data flow with no coupling.

### BSON Type Tracking

The `SchemaAnalyzer` tracks 24 BSON types via its type inference system — Int32, Double, Decimal128, Long, UUID, Code, DBRef, MinKey, MaxKey, and more. This granularity was surfaced through `x-bsonType` per type entry, enabling later steps to distinguish `Int32` from `Double` rather than just "number."

### Package Extraction

The analyzer was extracted to `packages/schema-analyzer/` as a zero-dependency npm workspace package. This ensures:

- Independent versioning and testing
- No VS Code imports (the package works in any Node.js or browser context)
- Transformers can be tested in isolation with hand-crafted JSON Schema fixtures

## What Changed

| Before                                      | After                                                            |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `src/utils/json/mongo/SchemaAnalyzer.ts`    | `packages/schema-analyzer/src/SchemaAnalyzer.ts`                 |
| `MongoBSONTypes` enum                       | Renamed to `BSONTypes`                                           |
| `src/utils/json/mongo/` directory           | Renamed to `src/utils/json/data-api/`                            |
| `FieldEntry` — no type info                 | `FieldEntry` — with `bsonType`, `bsonTypes`, `arrayItemBsonType` |
| Array element stats overwritten across docs | Fixed: per-element type tracking with occurrence counts          |

## Consumer Inventory

Six consumers of the JSON Schema output were identified and verified:

1. **Collection View — Table Headers** — `getPropertyNamesAtLevel()` — unchanged
2. **Collection View — Filter Bar** — `getKnownFields()` → `FieldEntry[]` — gains `bsonType`
3. **Document JSON Editors** — direct JSON Schema → Monaco `setDiagnosticsOptions()` — unchanged
4. **Query Playground** — `toTypeScriptDefinition()` transformer (added in Step 7)
5. **Aggregation Pipeline** — field names + types — future consumer
6. **Tree View** — `getSchemaFromDocument()` — single-document, unchanged

## Testing

Comprehensive test suite covering: sparse documents, all BSON types, embedded objects, arrays with mixed types, multi-document incremental merging, schema traversal with various path structures.
