# @vscode-documentdb/documentdb-constants

Static operator metadata for all DocumentDB-supported operators, aggregation stages, accumulators, update operators, BSON type constructors, and system variables.

## Purpose

This package is the **single source of truth** for operator metadata when the connected database is DocumentDB. It provides:

- `OperatorEntry` objects with value, description, snippet, documentation link, and type metadata
- Meta-tag based filtering (`getFilteredCompletions()`) for context-aware autocompletion
- Convenience presets for common completion contexts (filter bar, aggregation pipeline, etc.)
- Documentation URL generation (`getDocLink()`)

## Data Source

All operator data is derived from the official DocumentDB documentation:

- **Compatibility reference:** [DocumentDB Query Language Compatibility](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language) — lists every operator with its support status across DocumentDB versions 5.0–8.0.
- **Per-operator docs:** [DocumentDB Operators](https://learn.microsoft.com/en-us/azure/documentdb/operators/) — individual pages with descriptions and syntax for each operator.
- **Source repository:** [MicrosoftDocs/azure-databases-docs](https://github.com/MicrosoftDocs/azure-databases-docs) — the GitHub repo containing the raw Markdown source for all documentation pages above (under `articles/documentdb/`).

The scraper (`scripts/scrape-operator-docs.ts`) fetches data from these sources and generates the `resources/scraped/operator-reference.md` dump file that serves as the contract between the documentation and the TypeScript implementation.

## Usage

```typescript
import {
  getFilteredCompletions,
  getAllCompletions,
  FILTER_COMPLETION_META,
  STAGE_COMPLETION_META,
} from '@vscode-documentdb/documentdb-constants';

// Get operators for a filter/query context
const filterOps = getFilteredCompletions({ meta: FILTER_COMPLETION_META });

// Get operators for a specific BSON type
const stringOps = getFilteredCompletions({
  meta: FILTER_COMPLETION_META,
  bsonTypes: ['string'],
});

// Get all stage names
const stages = getFilteredCompletions({ meta: STAGE_COMPLETION_META });
```

## Scraper

The operator data is sourced from the official DocumentDB documentation. To re-scrape:

```bash
npm run scrape --workspace=@vscode-documentdb/documentdb-constants
```

This runs the scraper and then formats the output with Prettier. The scraper:

1. **Verifies** upstream doc structure (early fail-fast)
2. **Extracts** all operators from the [compatibility page](https://learn.microsoft.com/en-us/azure/documentdb/compatibility-query-language)
3. **Fetches** per-operator documentation (descriptions, syntax) with a global file index fallback for operators filed in unexpected directories
4. **Generates** `resources/scraped/operator-reference.md` in a structured heading format (`### $operator` with description, syntax, and doc link)

The dump serves as the authoritative reference for the TypeScript implementation. A Jest test (`src/operatorReference.test.ts`) validates that the implementation matches the dump.

## Structure

| File                                        | Purpose                                      |
| ------------------------------------------- | -------------------------------------------- |
| `src/types.ts`                              | `OperatorEntry` interface and `MetaTag` type |
| `src/metaTags.ts`                           | Meta tag constants and completion presets    |
| `src/docLinks.ts`                           | Documentation URL generation                 |
| `src/getFilteredCompletions.ts`             | Primary consumer API: filter by meta tags    |
| `src/index.ts`                              | Barrel exports for all public API            |
| `resources/scraped/operator-reference.md`   | Auto-generated scraped operator dump         |
| `resources/overrides/operator-overrides.md` | Hand-maintained overrides                    |
| `resources/overrides/operator-snippets.md`  | Snippet templates per category               |
| `scripts/scrape-operator-docs.ts`           | Scraper script                               |
