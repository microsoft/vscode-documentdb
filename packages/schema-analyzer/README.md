# @vscode-documentdb/schema-analyzer

Incremental JSON Schema analyzer for DocumentDB API and MongoDB API documents. Processes documents one at a time (or in batches) and produces an extended JSON Schema with statistical metadata — field occurrence counts, BSON type distributions, min/max values, and array length stats.

> **⚠️ Pre-1.0 — API subject to change**
>
> This package is published as part of the [DocumentDB for VS Code](https://github.com/microsoft/vscode-documentdb) project. All versions below `1.0.0` should be considered **unstable** — the API may change between minor releases without notice.
>
> We are actively working toward a stable `1.0.0` release, but will prioritize API stabilization based on community demand. If you are interested in using this package in your own project, please [open an issue](https://github.com/microsoft/vscode-documentdb/issues) to let us know — it helps us prioritize.

> **Monorepo package** — this package is part of the `vscode-documentdb` workspace.
> Dev dependencies (Jest, ts-jest, Prettier, TypeScript, etc.) are provided by the
> root `package.json`. Always install from the repository root:
>
> ```bash
> cd <repo-root>
> npm install
> ```

## Overview

The `SchemaAnalyzer` incrementally builds a JSON Schema by inspecting DocumentDB API / MongoDB API documents. It is designed for scenarios where documents arrive over time (streaming, pagination) and the schema needs to evolve as new documents are observed.

Key capabilities:

- **Incremental analysis** — add documents one at a time or in batches; the schema updates in place.
- **BSON type awareness** — recognizes BSON types defined by the MongoDB API (`ObjectId`, `Decimal128`, `Binary`, `UUID`, etc.) and annotates them with `x-bsonType`.
- **Statistical extensions** — tracks field occurrence (`x-occurrence`), type frequency (`x-typeOccurrence`), min/max values, string lengths, array sizes, and document counts (`x-documentsInspected`).
- **Known fields extraction** — derives a flat list of known field paths with their types and occurrence probabilities, useful for autocomplete and UI rendering.
- **Version tracking & caching** — a monotonic version counter enables efficient cache invalidation for derived data like `getKnownFields()`.

## Usage

```typescript
import { SchemaAnalyzer } from '@vscode-documentdb/schema-analyzer';

// Create an analyzer and feed it documents
const analyzer = new SchemaAnalyzer();
analyzer.addDocument(doc1);
analyzer.addDocuments([doc2, doc3, doc4]);

// Get the JSON Schema with statistical extensions
const schema = analyzer.getSchema();

// Get a flat list of known fields (cached, version-aware)
const fields = analyzer.getKnownFields();
```

## Requirements

- **Node.js** ≥ 18
- **mongodb** driver ≥ 6.0.0 (peer dependency)

## License

[MIT](../../LICENSE.md)
