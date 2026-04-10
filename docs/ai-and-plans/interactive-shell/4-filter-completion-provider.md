# Step 4 — Filter CompletionItemProvider

**PR:** [#518](https://github.com/microsoft/vscode-documentdb/pull/518)

## Summary

Replaced the old JSON Schema autocomplete pipeline with a custom Monaco `CompletionItemProvider` for the `documentdb-query` language. This gives the Collection View query editors (filter, project, sort) context-aware completions from `documentdb-constants` (static operators) and `SchemaAnalyzer` (dynamic field names), plus a `HoverProvider` for inline operator documentation and `acorn`-based validation for syntax errors and identifier typos.

## What Was Built

| Component                    | Description                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| **Language registration**    | `documentdb-query` custom language with JS Monarch tokenizer (idempotent, reused across editors) |
| **Model URI scheme**         | `documentdb://{filter\|project\|sort}/{sessionId}` for per-editor context routing                |
| **Completion data store**    | `Map<sessionId, CompletionContext>` in the webview for field data                                |
| **CompletionItemProvider**   | Single provider, URI-routed, returns operators + fields based on editor type                     |
| **HoverProvider**            | Shows operator description + documentation link on hover                                         |
| **Validation**               | `acorn.parseExpressionAt()` for syntax errors; `acorn-walk` for identifier validation            |
| **`$` prefix range fix**     | Extends replacement range so `$gt` doesn't insert as `$$gt`                                      |
| **Query parser replacement** | `@mongodb-js/shell-bson-parser` replaces hand-rolled 230-line regex parser                       |

## What Was Removed

| Removed                                       | Replacement                                                |
| --------------------------------------------- | ---------------------------------------------------------- |
| `generateMongoFindJsonSchema()` (271 lines)   | `documentdb-constants` (308 operators)                     |
| `basicMongoFindFilterSchema.json` (173 lines) | Not needed — custom language has no JSON service           |
| `getAutocompletionSchema` tRPC endpoint       | `getFieldCompletionData` returning `FieldCompletionData[]` |
| `toFilterQuery.ts` (230 lines, regex parser)  | `@mongodb-js/shell-bson-parser` (battle-tested)            |
| `setDiagnosticsOptions()` calls               | Not needed — custom language has no JSON diagnostics       |
| 2-second delay hack for schema loading        | Eliminated by push-based completion store                  |

## Key Discussion: Query Parser Mismatch

A critical discovery during implementation: the `documentdb-query` language accepts relaxed JavaScript expression syntax (unquoted keys, BSON constructors like `ObjectId()`), but the execution path used `EJSON.parse()` which requires strict JSON.

The resolution was to adopt `@mongodb-js/shell-bson-parser` — a battle-tested parser for the MongoDB API wire protocol. It handles:

- All 20+ BSON constructors (not just 4)
- JavaScript expressions (`Math.min()`, `Date.now()`)
- Unquoted keys and single-quoted strings
- A sandboxed evaluation scope for safe execution

This eliminated the mismatch between "what you can type" and "what actually executes."

## Key Discussion: Validation Approach

The team discussed whether to defer `acorn`-based validation to a later step. The decision was to include it in Step 4 because:

1. `acorn` would be needed anyway for the aggregation pipeline editor — one code path is simpler than two
2. The dependency is small (~30 KB gzipped) and well-proven (used by Webpack, Rollup, ESLint)
3. Near-miss typo detection ("Did you mean `ObjectId`?" for `ObjctId`) provides immediate value

The validator handles both direct calls (`ObjctId("abc")`) and member expressions (`Daate.now()`) with Levenshtein distance ≤ 2 for near-miss suggestions.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  CompletionItemProvider (URI → editorType → meta)        │
│  HoverProvider ($operator → docs)                        │
│  Validator (acorn parse + walk, 300ms debounce)          │
└───────────┬──────────────────────────┬───────────────────┘
            ↑                          ↑
    documentdb-constants        completionStore
    (308 operators)             (Map<sessionId, FieldCompletionData[]>)
                                ← tRPC push after query execution
```

## Testing

817 tests across 51 suites. New test coverage includes completion mapping, meta tag routing, field completions, sort prefixes, type-aware ordering, syntax error detection, and near-miss identification.
