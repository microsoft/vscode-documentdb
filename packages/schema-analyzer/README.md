# @vscode-documentdb/schema-analyzer

Incremental JSON Schema analyzer for DocumentDB API and MongoDB API documents. Processes documents one at a time (or in batches) and produces an extended JSON Schema with statistical metadata — field occurrence counts, BSON type distributions, min/max values, and array length stats.

> **Note:** This package is not yet published to npm. We plan to publish it once the API stabilizes. For now, it is consumed internally via npm workspaces within the [vscode-documentdb](https://github.com/microsoft/vscode-documentdb) repository.

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
