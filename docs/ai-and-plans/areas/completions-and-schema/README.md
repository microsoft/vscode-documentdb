---
area: completions-and-schema
kind: notes
status: active
prs: [506, 513, 518, 530, 532, 538, 543, 551, 717]
verified: 2026-08-14
code:
    - src/documentdb/query-language/**
    - src/documentdb/SchemaStore.ts
    - packages/documentdb-js-operator-registry/**
    - packages/documentdb-js-schema-analyzer/**
---

# Completions and Schema

**Status:** shipped · **Verified:** 2026-08-14

> The shared foundation every query surface completes from: operator metadata, inferred schema, and
> one language definition.

Autocompletion in this extension is not per-surface. Two standalone packages provide the raw
material — static operator metadata and inferred document schema — and a shared completion layer
turns them into context-aware suggestions for the Collection View query editors, the Query
Playground, and the Interactive Shell.

Sibling areas: [query-playground](../query-playground/README.md),
[interactive-shell](../interactive-shell/README.md). Program narrative:
[cross-cutting/query-surfaces-roadmap.md](../../cross-cutting/query-surfaces-roadmap.md).

## Code map

- `packages/documentdb-js-operator-registry/**` — the single source of truth for operator metadata:
  query and update operators, aggregation stages, accumulators, expression operators, BSON type
  constructors, system variables
- `packages/documentdb-js-schema-analyzer/**` — field inference with BSON type information
- `src/documentdb/SchemaStore.ts` — the shared per-`{clusterId, database, collection}` schema cache
- `src/documentdb/query-language/**` — the `documentdb-query` language, completion providers, hover
  provider, and the playground completion layer

## User docs

- [docs/user-manual/collection-view-querying.md](../../../user-manual/collection-view-querying.md)

## Architecture (intent — code is authoritative for behavior)

- **Operator metadata is a package, not a constant file.** Every surface reads the same registry, so
  operator documentation, categories, and links cannot drift per surface.
- **`documentdb-query` is a custom Monaco language** that reuses the JavaScript Monarch tokenizer
  without loading the TypeScript worker. Five architecture options were evaluated before this one
  (Option E) was chosen; the alternatives are recorded in
  [iterations/03.5-monaco-language-architecture.md](./iterations/03.5-monaco-language-architecture.md).
- **Completions are cursor-position aware.** The provider filters and ranks by where the cursor sits
  in the expression rather than offering a flat operator list everywhere.
- **The Playground uses two layers:** TypeScript-based completions through a TS Server plugin, and a
  custom provider for DocumentDB-specific items.
- **Schema is shared, not per-tab.** `SchemaStore` accumulates documents from the Collection View,
  the Playground, and the Shell against the same key.

## Timeline

| Step  | PR   | What changed                                       | Docs                                                                                                    |
| ----- | ---- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 2     | #506 | `SchemaAnalyzer` extracted into a package           | [iterations/02-schema-analyzer-refactor.md](./iterations/02-schema-analyzer-refactor.md)                     |
| 3     | #513 | `operator-registry` package                         | [iterations/03-documentdb-constants.md](./iterations/03-documentdb-constants.md)                             |
| 3.5   | —    | Monaco language architecture decision (Option E)    | [iterations/03.5-monaco-language-architecture.md](./iterations/03.5-monaco-language-architecture.md)         |
| 4     | #518 | Filter `CompletionItemProvider` and hover provider  | [iterations/04-filter-completion-provider.md](./iterations/04-filter-completion-provider.md)                 |
| 4.5   | #530 | Context-sensitive completions                       | [iterations/04.5-context-sensitive-completions.md](./iterations/04.5-context-sensitive-completions.md)       |
| 4.6   | #532 | Collection View and autocompletion UX fixes         | [iterations/04.6-collection-view-ux-improvements.md](./iterations/04.6-collection-view-ux-improvements.md)   |
| 6.1   | #538 | Shared schema cache (`SchemaStore`)                 | [iterations/06.1-shared-schema-cache.md](./iterations/06.1-shared-schema-cache.md)                           |
| 7     | #543 | Playground `CompletionItemProvider`                 | [iterations/07-playground-completion-provider.md](./iterations/07-playground-completion-provider.md)         |
| 7.1   | #551 | Shared completion code moved out of `webviews/`     | [iterations/07.1-shared-completion-migration.md](./iterations/07.1-shared-completion-migration.md)           |
| 8     | #717 | Correct aggregation references for unsafe field names | [iterations/08-referenceText-unsafe-field-names.md](./iterations/08-referenceText-unsafe-field-names.md)   |

Iteration numbers are the original step numbers of the shell-integration program where one existed.

## Decisions

No separate `decisions.md` yet. The one genuine architecture decision with recorded alternatives is
the Monaco language choice in
[iterations/03.5-monaco-language-architecture.md](./iterations/03.5-monaco-language-architecture.md).

## Open gaps

- [future-work.md](./future-work.md) — completion and IntelliSense improvements
- [future-work-schema-and-infrastructure.md](./future-work-schema-and-infrastructure.md) — schema
  persistence, build optimizations, and architectural items

## Note on scope

[iterations/04.6-collection-view-ux-improvements.md](./iterations/04.6-collection-view-ux-improvements.md)
is Collection View UX as much as it is completions. It is filed here because it shipped as part of
the completion work; it would move if a `collection-view` area is ever created.

## Reading order for newcomers

1. This README
2. [iterations/03.5-monaco-language-architecture.md](./iterations/03.5-monaco-language-architecture.md)
3. [iterations/04-filter-completion-provider.md](./iterations/04-filter-completion-provider.md)
