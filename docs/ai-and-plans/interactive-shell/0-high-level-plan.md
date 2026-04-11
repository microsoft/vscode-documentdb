# Interactive Shell Integration — High-Level Plan

## Overview

This document describes the high-level plan for adding interactive shell capabilities to the DocumentDB for VS Code extension. The feature set spans intelligent autocompletion across all query editor surfaces, a Query Playground for writing and executing scripts, and an Interactive Shell (REPL) for ad-hoc exploration — all built on a shared foundation of schema analysis, operator metadata, and the DocumentDB API wire protocol.

The work was delivered as a series of incremental steps, each producing a reviewable PR merged into the `feature/shell-integration` branch. The umbrella PR is [#508](https://github.com/microsoft/vscode-documentdb/pull/508).

> **Note:** Aggregation Pipeline Editor completions were intentionally deferred and will be delivered as a separate work item. See [future-work/aggregation-pipeline.md](../future-work/aggregation-pipeline.md).

---

## Goals

1. **Rich autocompletion** — Context-aware operator, field, and BSON constructor suggestions in all query editors (filter, project, sort) and the Query Playground.
2. **Query Playground** — A `.documentdb` file for writing and executing DocumentDB API queries with JavaScript syntax, CodeLens-driven execution, and formatted results.
3. **Interactive Shell** — A REPL inside VS Code's terminal with shell commands (`show dbs`, `use db`, `it`, `help`, `exit`), persistent eval context, and cursor iteration.
4. **Shared infrastructure** — Reusable packages (`schema-analyzer`, `documentdb-constants`, `shell-runtime`) that decouple schema analysis, operator metadata, and evaluation from any single UI surface.

---

## Step Summary

| Step  | Description                               | PR                                                              | Status      |
| ----- | ----------------------------------------- | --------------------------------------------------------------- | ----------- |
| 1     | Schema Tool Decision                      | —                                                               | ✅ Complete |
| 2     | SchemaAnalyzer Refactoring                | [#506](https://github.com/microsoft/vscode-documentdb/pull/506) | ✅ Complete |
| 3     | `documentdb-constants` Package            | [#513](https://github.com/microsoft/vscode-documentdb/pull/513) | ✅ Complete |
| 3.5   | Monaco Language Architecture              | —                                                               | ✅ Complete |
| 4     | Filter `CompletionItemProvider`           | [#518](https://github.com/microsoft/vscode-documentdb/pull/518) | ✅ Complete |
| 4.5   | Context-Sensitive Completions             | [#530](https://github.com/microsoft/vscode-documentdb/pull/530) | ✅ Complete |
| 4.6   | Collection View & Autocompletion UX       | [#532](https://github.com/microsoft/vscode-documentdb/pull/532) | ✅ Complete |
| 5     | Legacy Scrapbook Removal                  | [#533](https://github.com/microsoft/vscode-documentdb/pull/533) | ✅ Complete |
| 6     | Query Playground (Scratchpad)             | [#536](https://github.com/microsoft/vscode-documentdb/pull/536) | ✅ Complete |
| 6.1   | Shared Schema Cache (`SchemaStore`)       | [#538](https://github.com/microsoft/vscode-documentdb/pull/538) | ✅ Complete |
| 6.2   | Persistent Worker Eval                    | [#540](https://github.com/microsoft/vscode-documentdb/pull/540) | ✅ Complete |
| 7     | Query Playground `CompletionItemProvider` | [#543](https://github.com/microsoft/vscode-documentdb/pull/543) | ✅ Complete |
| 7.1   | Shared Completion Migration               | [#551](https://github.com/microsoft/vscode-documentdb/pull/551) | ✅ Complete |
| 7.1.5 | Query Playground Name Unification         | [#553](https://github.com/microsoft/vscode-documentdb/pull/553) | ✅ Complete |
| 7.1.6 | Query Playground Console & Result Display | [#559](https://github.com/microsoft/vscode-documentdb/pull/559) | ✅ Complete |
| 7.2   | Pre-Shell Critical Items                  | [#560](https://github.com/microsoft/vscode-documentdb/pull/560) | ✅ Complete |
| 8     | Interactive Shell                         | [#561](https://github.com/microsoft/vscode-documentdb/pull/561) | ✅ Complete |

---

## Architecture Decisions

These decisions were made early and informed all subsequent implementation steps.

| #   | Decision                                | Outcome                                                                                                                                                                |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Language strategy for query editors** | `documentdb-query` custom language with JavaScript Monarch tokenizer, no TypeScript worker (~400–600 KB saved)                                                         |
| 2   | **Completion providers**                | Single `CompletionItemProvider` + URI routing (`documentdb://{editorType}/{sessionId}`) for webview editors; separate extension-host provider for the Query Playground |
| 3   | **Operator metadata**                   | `documentdb-constants` package — 308 operator entries bundled at build time; field data pushed via tRPC subscription                                                   |
| 4   | **Validation**                          | `acorn.parseExpressionAt()` for syntax errors; `acorn-walk` + `documentdb-constants` for identifier validation                                                         |
| 5   | **Document editors**                    | Stay on `language="json"` with existing JSON Schema validation                                                                                                         |
| 6   | **Query Playground language**           | `documentdb-playground` with built-in JS grammar; in-process eval using `@mongosh` packages and existing `MongoClient`                                                 |
| 7   | **Eval isolation**                      | Persistent worker thread per session (Option F) — lazy spawn on first Run, own `MongoClient`, infinite-loop protection via thread termination                          |
| 8   | **Interactive Shell UI**                | `vscode.Pseudoterminal`-based REPL with dedicated worker per session, persistent eval context, `CommandInterceptor` for shell commands                                 |
| 9   | **Schema sharing**                      | `SchemaStore` singleton accumulates schema per `{clusterId, db, collection}` across all surfaces                                                                       |

---

## Package Structure

The implementation introduced three new workspace packages and a shell API type definitions module:

| Package                                      | Location                              | Purpose                                                                                                   |
| -------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `@vscode-documentdb/schema-analyzer`         | `packages/schema-analyzer/`           | Incremental schema analysis with 24 BSON types, JSON Schema output                                        |
| `@vscode-documentdb/documentdb-constants`    | `packages/documentdb-constants/`      | 308 operator entries: query, update, stage, accumulator, BSON, system variables                           |
| `@microsoft/documentdb-vscode-shell-runtime` | `packages/documentdb-shell-runtime/`  | Shell eval runtime: `DocumentDBShellRuntime`, `CommandInterceptor`, `ResultTransformer`, `HelpProvider`   |
| Shell API `.d.ts`                            | `src/documentdb/scratchpad/typeDefs/` | TypeScript type definitions for `db.*`, cursor methods, BSON constructors — injected via TS server plugin |

---

## Cross-Cutting Patterns

### Schema Data Flow

```
Documents  →  SchemaAnalyzer  →  JSON Schema (with x- extensions)
                                       │
           ┌───────────────────────────┼──────────────────────────┐
           ▼                           ▼                          ▼
    getKnownFields()          Table column headers          SchemaStore
    → FieldEntry[]            (getPropertyNamesAtLevel)     (shared cache)
           │                                                      │
           ▼                                                      ▼
  FieldCompletionData[]                                Query Playground
  → Webview completion store                           CompletionItemProvider
  → Query editor completions                           (reads from SchemaStore)
```

### Completion Data Delivery

- **Static data** (`documentdb-constants`, ~30 KB) — bundled into the webview at build time; imported directly by extension-host providers.
- **Dynamic field data** (`FieldCompletionData[]`) — pushed from extension host to webview via tRPC subscription after each query execution, cached in the webview's `completionStore`. No per-keystroke round-trips.

### Query Parser

All query surfaces (filter, project, sort) use `@mongodb-js/shell-bson-parser` for parsing user input. This replaced the legacy hand-rolled regex parser and provides full support for unquoted keys, single-quoted strings, BSON constructors, and JavaScript expressions like `Math.min()`.

---

## Terminology

| Term                        | Meaning                                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Query Playground**        | A `.documentdb` file for writing and running queries — JavaScript syntax, CodeLens-driven execution, not interactive |
| **Interactive Shell**       | REPL with prompt, shell commands (`show dbs`, `use db`, `it`, `exit`), persistent eval context                       |
| **`documentdb-query`**      | Custom Monaco language for query editors (filter/project/sort) in the Collection View webview                        |
| **`documentdb-playground`** | VS Code language ID for `.documentdb` files — references built-in JS grammar                                         |
| **`shell-runtime`**         | Shared evaluation package consumed by both Query Playground and Interactive Shell                                    |

---

## Deferred Work

- **Aggregation Pipeline CompletionItemProvider** — Stage-aware completions inside `aggregate()` calls. See [future-work/aggregation-pipeline.md](../future-work/aggregation-pipeline.md).
- **Terminal autocompletion** — Awaiting VS Code `TerminalCompletionProvider` API finalization. See [future-work/terminal-enhancements.md](../future-work/terminal-enhancements.md).
- **Schema persistence** — Saving `SchemaStore` data across VS Code sessions.
- **Per-file connections** — Each Playground file remembers its own connection.

Individual plan documents reference their respective PRs and contain detailed discussion of design decisions, trade-offs, and implementation specifics.
