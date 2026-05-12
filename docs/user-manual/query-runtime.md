> **User Manual** &mdash; [Back to User Manual](../index#user-manual)

---

# Query Runtime: How It Works Behind the Scenes

The [Query Playground](./query-playground) and [Interactive Shell](./interactive-shell) share a common query runtime that is bundled directly into the extension. This page explains how the runtime works, what powers the autocompletion and schema awareness, and introduces the open-source packages that make it all possible.

**Table of Contents**

- [No External Tools Required](#no-external-tools-required)
- [How Queries Are Executed](#how-queries-are-executed)
- [How Autocompletion Works](#how-autocompletion-works)
- [The @documentdb-js Packages](#the-documentdb-js-packages)
  - [@documentdb-js/shell-runtime](#documentdb-jsshell-runtime)
  - [@documentdb-js/schema-analyzer](#documentdb-jsschema-analyzer)
  - [@documentdb-js/operator-registry](#documentdb-jsoperator-registry)
- [Schema Sharing Across Features](#schema-sharing-across-features)
- [Security and Isolation](#security-and-isolation)

## No External Tools Required

Before v0.8, the extension's scratchpad feature required a locally installed shell executable on your machine. That external dependency has been completely removed. The query runtime is now bundled into the extension itself.

This means:

- **Zero installation**: Just install the extension. No additional tools, no PATH configuration, no version mismatches.
- **Works with Entra ID**: The runtime reuses the connection you already established when connecting to your cluster. If you authenticated with Microsoft Entra ID, the Query Playground and Interactive Shell work automatically, with no extra credential configuration.
- **Cross-platform**: Works identically on Windows, macOS, and Linux.

## How Queries Are Executed

When you run a query in the Query Playground or Interactive Shell, the extension:

1. **Reuses the existing connection**: The runtime uses the database connection you already established when you connected to the cluster in the tree view. No new connection is created, and no credentials need to be re-entered.
2. **Evaluates in a sandboxed context**: Your code runs in an isolated JavaScript context with access to the `db` object, BSON constructors (`ObjectId`, `ISODate`, etc.), and standard JavaScript globals.
3. **Runs in a worker thread**: Each execution happens in a separate worker thread, so a slow or infinite query cannot freeze VS Code. If a query exceeds the timeout, the worker is terminated and a fresh one is created for the next run.
4. **Returns structured results**: Results are normalized into a consistent format with metadata (document count, execution time, cursor state), then displayed in the results panel or terminal.

The Query Playground uses **fresh context** mode by default: each execution starts with a clean slate. The Interactive Shell uses **persistent context** mode: variables, functions, and state carry over between commands within a session.

## How Autocompletion Works

Autocompletion across all query surfaces (Collection View, Query Playground, Interactive Shell) is powered by two data sources:

### Field Names from Your Data

The extension samples documents from your collection and analyzes their structure to learn what fields exist and what types they hold. This analysis happens incrementally: as you query and browse data, the schema knowledge grows. Field names appear in completion suggestions with type annotations (e.g., `name (String)`, `age (Int32)`, `tags (Array)`).

### Operators from Official Documentation

All supported DocumentDB API operators, stages, accumulators, BSON constructors, and system variables (over 300 in total) are available as completion items. Each entry includes a description, a code snippet, and a link to the official documentation page. The operator data is automatically sourced from the [DocumentDB compatibility reference](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language) and the [DocumentDB operator documentation](https://learn.microsoft.com/en-us/azure/documentdb/operators/), ensuring it stays up to date with the latest supported features.

## The @documentdb-js Packages

The query runtime and autocompletion features are built on three open-source packages, developed as part of this extension and published under the `@documentdb-js` scope. Each package is standalone and can be used independently in other tooling.

### @documentdb-js/shell-runtime

A sandboxed JavaScript evaluation engine for DocumentDB. It handles executing user code against a database, intercepting shell commands (`help`, `exit`, `cls`), transforming results into a consistent format, and generating help text.

The runtime supports two modes:

- **Fresh context**: Each evaluation starts clean. Used by the Query Playground, where each script block is independent.
- **Persistent context**: Variables, cursor state, and the database reference persist across evaluations. Used by the Interactive Shell, where you build up state command by command.

The runtime takes an existing database connection and wraps it for evaluation. It never opens or closes connections itself, which is why it works seamlessly with any authentication method the extension supports, including Entra ID.

📦 [npm](https://www.npmjs.com/package/@documentdb-js/shell-runtime) &middot; [Source](https://github.com/microsoft/vscode-documentdb/tree/main/packages/documentdb-js-shell-runtime)

### @documentdb-js/schema-analyzer

An incremental JSON Schema analyzer for DocumentDB and MongoDB API documents. It processes documents one at a time (or in batches) and produces an extended JSON Schema with statistical metadata:

- **Field occurrence counts**: How often each field appears across sampled documents.
- **BSON type distributions**: What types each field holds (`String`, `Int32`, `ObjectId`, `Array`, etc.), recognizing all 24 BSON types.
- **Value statistics**: Min/max values for numbers, string lengths, and array sizes.
- **Known field extraction**: A flat list of all known field paths with their types and occurrence probabilities, ready for autocompletion.

The analyzer uses version-based caching so derived data (like the field list) is only recomputed when new documents are added.

📦 [npm](https://www.npmjs.com/package/@documentdb-js/schema-analyzer) &middot; [Source](https://github.com/microsoft/vscode-documentdb/tree/main/packages/documentdb-js-schema-analyzer)

### @documentdb-js/operator-registry

A reference catalog of all operators supported by DocumentDB. It contains over 300 entries across query operators, update operators, expression operators, aggregation stages, accumulators, window operators, BSON type constructors, and system variables. Each entry includes:

- **Value**: The operator name (e.g., `$gt`, `$match`, `ObjectId`).
- **Description**: A human-readable explanation of what the operator does.
- **Code snippet**: A ready-to-insert template for autocompletion.
- **Documentation link**: A direct URL to the official DocumentDB documentation page.
- **Type metadata**: Which BSON types the operator applies to, and filterable meta-tags for context-aware suggestions.

The operator data is automatically generated from the official DocumentDB documentation using a built-in scraper. A CI test validates that the package always matches the upstream documentation, so when DocumentDB adds or removes operators, the package is updated accordingly.

📦 [npm](https://www.npmjs.com/package/@documentdb-js/operator-registry) &middot; [Source](https://github.com/microsoft/vscode-documentdb/tree/main/packages/documentdb-js-operator-registry)

## Schema Sharing Across Features

The extension maintains a shared schema cache that accumulates knowledge about your collections as you work. When you browse documents in the Collection View, the schema analyzer processes those documents. That same schema data is then available to the Query Playground and Interactive Shell for autocompletion.

**All schema analysis happens locally.** The extension analyzes documents that are already being fetched for display. No additional requests are made to your database for schema purposes, and no document data is sent to external services. The schema information stays entirely within your VS Code instance.

This means:

- **Schema builds up over time**: The more you interact with a collection, the richer the autocompletion becomes.
- **Shared across tabs**: If you browse a collection in one tab and then open a playground for the same collection, the field suggestions are already there.
- **On-demand refresh**: Use the **Quick Scan** action in the Collection View to sample a fresh batch of documents and update the schema immediately.

## Security and Isolation

- **Sandboxed execution**: User code runs in an isolated JavaScript context, not in the extension's main process. It has access only to the `db` object and standard globals, not to VS Code APIs, the file system, or network resources beyond the database connection.
- **Worker thread isolation**: Each execution runs in a dedicated worker thread. If code enters an infinite loop or consumes excessive resources, the worker is terminated without affecting VS Code.
- **Connection reuse only**: The runtime never creates new connections or stores credentials. It uses the connection you already established, which means your credentials are managed entirely by VS Code's secure storage.

---

> **Related**: [Query Playground](./query-playground) | [Interactive Shell](./interactive-shell)
