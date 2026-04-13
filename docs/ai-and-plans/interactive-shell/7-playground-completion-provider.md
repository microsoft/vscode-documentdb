# Step 7 — Query Playground CompletionItemProvider

**PR:** [#543](https://github.com/microsoft/vscode-documentdb/pull/543)

## Summary

Added intelligent autocompletion to the Query Playground (`.documentdb` files) using a two-layer architecture: TypeScript-based completions via a TS Server Plugin (Layer 1) and a custom `CompletionItemProvider` for DocumentDB-specific items (Layer 2). Delivered as five work items covering type definitions, the TS plugin, custom completions, dynamic schema integration, and shared logic extraction.

## Two-Layer Architecture

| Layer                        | Mechanism                                                   | What It Provides                                                                                                |
| ---------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Layer 1: TS Plugin**       | Inline Snapshot Injection into VS Code's TypeScript service | `db.*` method chains, cursor methods, BSON types, hover docs, signature help, variable tracking                 |
| **Layer 2: Custom Provider** | `vscode.languages.registerCompletionItemProvider`           | Query operators (`$gt`, `$match`), field names from SchemaStore, collection names, type-aware value suggestions |

### Discussion: Why Two Layers?

Layer 1 leverages VS Code's built-in TypeScript language service — it already knows how to parse JavaScript, track types through assignments, resolve method return types, and provide signature help. Reimplementing all of this would be enormous effort. By injecting `.d.ts` type definitions, we get method chains, return type inference, and hover documentation for free.

Layer 2 handles things the TypeScript service can't: DocumentDB API-specific query operators (`$gt`, `$regex`), schema-driven field names (dynamic, per-collection), BSON constructor snippets with tab stops, and context-aware operator ordering.

## WI-1: Shell API Type Definitions + TS Server Plugin

### `.d.ts` Type Definitions (865 lines)

A DocumentDB-scoped type definition file authored from scratch with original JSDoc documentation. Includes:

- 10 BSON classes, 17 BSON constructors, 7 shell globals
- Database interface (14 methods), Collection interface (25 methods)
- FindCursor (18 methods), AggregationCursor (8 methods)

**Design choice:** The file uses an intersection type (`DocumentDBDatabaseMethods & { [k: string]: DocumentDBCollection }`) to support both named methods (`db.getCollectionNames()`) and dynamic collection access (`db.anyName.find()`). A single interface with an index signature would cause TS2411 errors.

### TS Server Plugin: Inline Snapshot Injection

The initial approach (`getExternalFiles()` API) failed for virtual/untitled documents — TypeScript creates a file watcher but doesn't inject declarations into the project scope. This was confirmed via TypeScript issue #21280 (closed "not planned").

The final approach (Approach F) prepends the full `.d.ts` content inline to every scratchpad file's snapshot via a proxied `getScriptSnapshot()`. The plugin proxies 20 position-based `LanguageService` methods with constant character-offset arithmetic.

### Discussion: VSIX Packaging Challenge

The TS plugin stub at `dist/node_modules/documentdb-scratchpad-ts-plugin/` was never included in the VSIX because `@vscode/vsce` hardcodes `node_modules/**` exclusion. Negation patterns have no effect. Solution: adopted the Vue/Volar runtime stub pattern — the extension creates the `node_modules` stub at first scratchpad open, before the TS server restart.

## WI-2: Custom CompletionItemProvider

- Two-stage cursor context detection (JS-level method chain + inner query-object context)
- Dynamic collection names from `SchemaStore` after `db.` and in string literals
- Query operators and field names inside method arguments
- Deduplication: Layer 2 only provides what Layer 1 cannot

## WI-3: Dynamic Schema Integration

- **CollectionNameCache** — reads collection names synchronously from `ClustersClient`'s in-memory cache; background `listCollections()` bootstraps if no cache exists
- **"Discover fields" action** — when SchemaStore has no data for a collection, a completion item offers to sample ~100 documents via `$sample` to populate field completions
- **`getCollection()` chain resolution** — `db.getCollection('name').find({})` correctly resolves the collection name for field completions

## WI-4: Refinements

- **Sort prefix adjustment** — all `sortText` values prefixed with `!` (ASCII 33) to sort above TS service completions (AbortController, Array, etc.)
- **ScratchpadHoverProvider** — operator/BSON hover, field hover from SchemaStore, quoted dotted field name support
- **Type-aware value suggestions** — reuses the collection view's `getTypeSuggestionDefs()` for boolean, number, string, date, objectid, null, and array fields

## WI-5: Shared Completion Logic

Extracted platform-neutral completion logic into `src/webviews/documentdbQuery/shared/` so both the playground provider (VS Code API) and query editor provider (Monaco API) consume the same core modules.

## Testing

1,160 tests across 65 suites. 85 TDD behavior contracts covering context detection, collection name cache, hover provider, and shared completion logic.
