# @documentdb-js/schema-analyzer

[DocumentDB](https://documentdb.io/) is an open-source document database built on PostgreSQL, with native BSON support, rich indexing, and vector search. It uses the MongoDB-compatible wire protocol, runs locally with Docker, and is MIT licensed.

This package is an incremental JSON Schema analyzer for DocumentDB and MongoDB API documents. Processes documents one at a time (or in batches) and produces an extended JSON Schema with statistical metadata — field occurrence counts, BSON type distributions, min/max values, and array length stats.

> **Pre-1.0 notice** — The API may change between minor versions until `1.0.0` is released.
> If you depend on this package and need stability guarantees sooner, please
> [open an issue](https://github.com/microsoft/vscode-documentdb/issues) and let us know.

## Features

- **Incremental analysis** — add documents one at a time or in batches; the schema updates in place.
- **BSON type awareness** — recognizes BSON types defined by the MongoDB API (`ObjectId`, `Decimal128`, `Binary`, `UUID`, etc.) and annotates them with `x-bsonType`.
- **Statistical extensions** — tracks field occurrence (`x-occurrence`), type frequency (`x-typeOccurrence`), min/max values, string lengths, array sizes, and document counts (`x-documentsInspected`).
- **Known fields extraction** — derives a flat list of known field paths with their types and occurrence probabilities, useful for autocomplete and UI rendering.
- **Version tracking & caching** — a monotonic version counter enables efficient cache invalidation for derived data like `getKnownFields()`.

## Installation

```bash
npm install @documentdb-js/schema-analyzer
```

Requires `mongodb` ≥ 6.0.0 as a peer dependency.

## Usage

```typescript
import { SchemaAnalyzer } from '@documentdb-js/schema-analyzer';

// Create an analyzer and feed it documents
const analyzer = new SchemaAnalyzer();
analyzer.addDocument(doc1);
analyzer.addDocuments([doc2, doc3, doc4]);

// Get the JSON Schema with statistical extensions
const schema = analyzer.getSchema();

// Get a flat list of known fields (cached, version-aware)
const fields = analyzer.getKnownFields();
```

## Origin

This package was developed while building features for the [DocumentDB VS Code extension](https://github.com/microsoft/vscode-documentdb), which remains the primary consumer. The analyzer is designed to work with any JSON/BSON documents and can be used independently in other tooling.

## License

[MIT](LICENSE.md)
