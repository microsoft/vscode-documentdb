# Schema Analyzer Generification — Implementation Plan

**Audience:** coding agents and engineers executing this refactor.
**Status:** Approved plan. Not yet implemented.
**Target branch:** `dev/tnaum/schema-general` (PR target: `next`).

---

## Terminology

[DocumentDB](https://documentdb.io/) is an open-source document
database built on PostgreSQL, with **native BSON support**, rich
indexing, and vector search. It uses the MongoDB-compatible wire
protocol, runs locally with Docker, and is MIT licensed.

What that means for this plan:

- The product name in docs, identifiers, and user-facing strings is
  **DocumentDB**.
- When we mean "MongoDB-API–compatible behaviour", say "DocumentDB API"
  or "DocumentDB / MongoDB API" — never "MongoDB" on its own.
- **BSON is a first-class part of DocumentDB**, not a MongoDB-only
  concept. It is the native document type system of DocumentDB. Using
  the word "BSON" as a technical term (format name, type enum values)
  is correct and does not need to be avoided. We still name the
  adapter / subpath `documentdb` rather than `bson`, because the
  adapter represents "the DocumentDB value-classification policy"
  (Int32 vs Long vs Double disambiguation, ObjectId, Binary
  subtypes, UUID legacy handling, etc.) — which is broader than just
  "BSON types" in the abstract.
- The `BSONTypes` enum keeps its name. Its values match the type
  strings defined by the DocumentDB API / MongoDB API spec
  ([reference](https://www.mongodb.com/docs/manual/reference/bson-types/)),
  and renaming the enum would be noisy churn with no semantic gain.

Apply this to every identifier and doc string introduced by this plan.

---

## Goal

Make `@documentdb-js/schema-analyzer` usable beyond DocumentDB, so
other database shapes (Cosmos DB NoSQL / plain JSON, future AWS/GCP,
…) can plug in their own value classifier. Keep the DocumentDB
extension consumer happy and the code easy to maintain.

Motivating fact: another Microsoft team (vscode-cosmosdb) has
already forked this package to adapt it to plain JSON. We want a
clean extension point so they (and anyone else) can consume ours
instead of maintaining a divergent fork.

---

## Current state (what makes the package DocumentDB-specific today)

- [packages/documentdb-js-schema-analyzer/src/BSONTypes.ts](../../packages/documentdb-js-schema-analyzer/src/BSONTypes.ts)
  imports `ObjectId, Decimal128, Binary, UUID, …` from `mongodb` and
  defines `enum BSONTypes`, `inferType`, `toJSONType`.
- [packages/documentdb-js-schema-analyzer/src/SchemaAnalyzer.ts](../../packages/documentdb-js-schema-analyzer/src/SchemaAnalyzer.ts)
  hard-codes the output key `x-bsonType` and the branching on
  `BSONTypes.Object` / `BSONTypes.Array`. Also imports `Document,
WithId` from `mongodb` (used only as type hints).
- [packages/documentdb-js-schema-analyzer/src/getKnownFields.ts](../../packages/documentdb-js-schema-analyzer/src/getKnownFields.ts)
  reads `x-bsonType` and sorts `_id` first.
- [packages/documentdb-js-schema-analyzer/src/ValueFormatters.ts](../../packages/documentdb-js-schema-analyzer/src/ValueFormatters.ts)
  imports `Binary`, `BSONRegExp`, `ObjectId` from `mongodb` for
  SlickGrid display formatting — not a schema concern.

### In-repo consumers

- [src/documentdb/SchemaStore.ts](../../src/documentdb/SchemaStore.ts)
  owns one `SchemaAnalyzer` per collection.
- [src/documentdb/feedResultToSchemaStore.ts](../../src/documentdb/feedResultToSchemaStore.ts)
  feeds BSON-rehydrated documents.
- [src/documentdb/ClusterSession.ts](../../src/documentdb/ClusterSession.ts),
  [src/webviews/documentdb/collectionView/collectionViewRouter.ts](../../src/webviews/documentdb/collectionView/collectionViewRouter.ts),
  and `src/utils/json/data-api/autocomplete/*` consume `FieldEntry`.
- [src/utils/slickgrid/mongo/toSlickGridTable.ts](../../src/utils/slickgrid/mongo/toSlickGridTable.ts)
  and [toSlickGridTree.ts](../../src/utils/slickgrid/mongo/toSlickGridTree.ts)
  use `BSONTypes` + `valueToDisplayString`.
- `src/documentdb/query-language/playground-completions/*` use the
  `BSONTypes` enum for strongly-typed comparisons.

---

## Design

### Adapter contract

```ts
/**
 * Classifies document values into a closed set of "type tags" and,
 * optionally, records per-type statistics onto a JSON-Schema entry.
 *
 * The engine walks the document tree and manages the schema; the
 * adapter only labels leaf values and (optionally) records stats.
 */
export interface TypeAdapter<TTag extends string = string> {
  /** Short identifier for diagnostics (e.g. 'documentdb', 'json'). */
  readonly name: string;

  /** Classify a value. Must be total: return a tag for any input. */
  inferType(value: unknown): TTag;

  /**
   * Map a tag to a JSON-Schema `type`
   * ('string' | 'number' | 'boolean' | 'object' | 'array' | 'null').
   */
  toJSONSchemaType(tag: TTag): string;

  /**
   * Optional. Called once per value with the tag the adapter produced.
   * `firstOccurrence` is `true` exactly once per (field, tag) pair —
   * the adapter should initialize stats then and aggregate otherwise.
   * Adapters that do not track stats omit this method entirely.
   */
  recordStats?(value: unknown, tag: TTag, target: JSONSchema, firstOccurrence: boolean): void;

  /**
   * Optional. Field names that should sort first in `FieldEntry[]`
   * output. Defaults to [].
   *   - DocumentDB adapter: ['_id']
   *   - Generic-JSON adapter: ['id']
   */
  readonly primaryIdFields?: readonly string[];
}
```

### Why this shape (and what we rejected)

1. **Single canonical output key `x-type`** replaces the BSON-specific
   `x-bsonType`. Consumers never have to branch on which key a payload
   uses. (vscode-cosmosdb's fork keeps a per-adapter `typeExtensionKey`;
   we don't need that.)
2. **Engine, not adapter, decides recursion.** The engine uses
   structural JS checks (`Array.isArray(v)` → recurse as array;
   `typeof v === 'object' && v !== null && !Array.isArray(v)` →
   recurse as object). No `objectTypeId`/`arrayTypeId` knobs, so
   adapters cannot misconfigure traversal; tags are pure labels.
3. **One `recordStats` method** with a `firstOccurrence: boolean`
   flag replaces the init+aggregate pair. Adapters that record no
   stats omit the method entirely.
4. **No `trackNestedObjectDocs` flag.** The engine always maintains
   `x-documentsInspected` on nested objects — it's a correctness fix
   for probability math that every adapter benefits from (see the
   existing comment in [SchemaAnalyzer.ts](../../packages/documentdb-js-schema-analyzer/src/SchemaAnalyzer.ts)
   around the "uniform probability" explanation).
5. **Adapter (composition) over inheritance / global registry.** One
   object passed to the analyzer; tree-shakable; no global state.

### Output schema change

- `x-bsonType` → **`x-type`** (on entries in `anyOf`).
- All other `x-*` extensions (`x-documentsInspected`, `x-occurrence`,
  `x-typeOccurrence`, `x-minValue`/`-maxValue`,
  `x-minLength`/`-maxLength`, `x-minDate`/`-maxDate`,
  `x-trueCount`/`-falseCount`, `x-minItems`/`-maxItems`,
  `x-minProperties`/`-maxProperties`) stay as-is.

Adapters are free to write additional `x-*` keys from `recordStats`.

### `FieldEntry` renames

```ts
export interface FieldEntry {
  path: string;
  /** JSON Schema type ('string','number','object','array',…). */
  type: string;
  /** Adapter-specific dominant type tag (was `bsonType`). */
  typeTag: string;
  /** All observed type tags when polymorphic (was `bsonTypes`). */
  typeTags?: string[];
  isSparse?: boolean;
  /** Dominant array-element tag (was `arrayItemBsonType`). */
  arrayItemTypeTag?: string;
}
```

### Built-in adapters

- **`DocumentDbTypeAdapter`** in
  `packages/documentdb-js-schema-analyzer/src/documentdb/` — today's
  `BSONTypes.inferType`, `toJSONType`, and stats logic, lifted into
  the adapter interface. Imports from `mongodb` are confined here.
- **`JsonTypeAdapter`** in
  `packages/documentdb-js-schema-analyzer/src/json/` — plain-JSON
  classifier: `string | number | boolean | null | undefined | object
| array`. Stats: string length, numeric min/max, true/false counts,
  array/object sizes. `primaryIdFields: ['id']`. No `mongodb`
  dependency.

(See the Terminology section above for why the adapter is named
`DocumentDbTypeAdapter` / `documentdb` rather than `bson`, and why
the `BSONTypes` enum keeps its name.)

### Package layout after the refactor

```
packages/documentdb-js-schema-analyzer/
  src/
    index.ts                         # root exports
    JSONSchema.ts                    # unchanged interface (x-type instead of x-bsonType)
    SchemaAnalyzer.ts                # thin delegator
    getKnownFields.ts                # reads x-type, uses primaryIdFields
    core/
      TypeAdapter.ts                 # NEW — interface only
      schemaTraversal.ts             # NEW — BFS engine, no mongodb import
    documentdb/
      index.ts                       # re-exports adapter + enum
      BSONTypes.ts                   # MOVED from src/ (name preserved)
      DocumentDbTypeAdapter.ts       # NEW — wraps today's BSON logic
    json/
      index.ts                       # re-exports adapter
      JsonTypeAdapter.ts             # NEW — plain JSON
  test/
    SchemaAnalyzer.test.ts           # expectation rename x-bsonType → x-type
    SchemaAnalyzer.arrayStats.test.ts
    SchemaAnalyzer.versioning.test.ts
    SchemaAnalyzer.json.test.ts      # NEW — plain JSON fixtures
    mongoTestDocuments.ts            # unchanged
  package.json                       # exports map + optional mongodb peer
```

### `package.json` changes

- Add `exports`:
  ```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    },
    "./documentdb": {
      "types": "./dist/documentdb/index.d.ts",
      "default": "./dist/documentdb/index.js"
    },
    "./json": {
      "types": "./dist/json/index.d.ts",
      "default": "./dist/json/index.js"
    }
  }
  ```
- Move `mongodb` from `peerDependencies` to `peerDependenciesMeta`
  (optional). The `/documentdb` subpath still requires it; `/json`
  and the core engine do not.
- Bump version `0.8.0` → `0.9.0` (pre-1.0 minor; the output-key
  rename is intentionally breaking).

### `src/index.ts` exports after the refactor

```ts
export { SchemaAnalyzer, buildFullPaths, getPropertyNamesAtLevel } from './SchemaAnalyzer';
export { getKnownFields, type FieldEntry } from './getKnownFields';
export { type JSONSchema, type JSONSchemaMap, type JSONSchemaRef } from './JSONSchema';
export { type TypeAdapter } from './core/TypeAdapter';
export { DocumentDbTypeAdapter, BSONTypes } from './documentdb';
export { JsonTypeAdapter } from './json';
// note: valueToDisplayString is intentionally NOT exported — it moves out of the package.
```

Default behaviour: `new SchemaAnalyzer()` continues to use
`DocumentDbTypeAdapter`, so existing consumers work with minimal
churn (only the renamed field names need updating).

---

## Execution (single PR)

Do everything below in one PR on `dev/tnaum/schema-general`. The
consumers in `src/**` and the package live in the same repo, so an
atomic rename is simpler than a multi-release migration.

### Step 1 — Create the core engine

- **Add** `packages/documentdb-js-schema-analyzer/src/core/TypeAdapter.ts`
  with the interface above.
- **Add** `packages/documentdb-js-schema-analyzer/src/core/schemaTraversal.ts`.
  - Lift the body of `updateSchemaWithDocumentInternal`,
    `findTypeEntry`, and `updateMinMaxStats` from
    [SchemaAnalyzer.ts](../../packages/documentdb-js-schema-analyzer/src/SchemaAnalyzer.ts).
  - Replace `BSONTypes.inferType(v)` with `adapter.inferType(v)`.
  - Replace `BSONTypes.toJSONType(tag)` with `adapter.toJSONSchemaType(tag)`.
  - Replace the output key `'x-bsonType'` with `'x-type'`.
  - Replace `BSONTypes.Object`/`.Array` switch cases with structural
    checks: `Array.isArray(v)` / `isPlainObject(v)` (define a small
    helper locally).
  - Delete `initializeStatsForValue` and `aggregateStatsForValue`
    from the engine. Replace the call sites with
    `adapter.recordStats?.(value, tag, target, firstOccurrence)`.
    Compute `firstOccurrence` as `typeEntry['x-typeOccurrence'] === 1`
    after the increment (matches today's logic).
  - **No `mongodb` imports in this file.**
  - Public API of this module: `updateSchemaWithDocument(schema,
document, adapter)`.

### Step 2 — Move BSON types, build the DocumentDB adapter

- **Move** `src/BSONTypes.ts` to `src/documentdb/BSONTypes.ts`
  (unchanged content).
- **Add** `src/documentdb/DocumentDbTypeAdapter.ts`:
  - `name: 'documentdb'`.
  - `inferType` = existing `BSONTypes.inferType`.
  - `toJSONSchemaType` = existing `BSONTypes.toJSONType`.
  - `primaryIdFields: ['_id'] as const`.
  - `recordStats`: merge the bodies of `initializeStatsForValue`
    (when `firstOccurrence`) and `aggregateStatsForValue` (otherwise).
    Minor cleanup: the `Binary` length code currently assumes
    `Buffer` — keep that assumption (today's test coverage drives it).
- **Add** `src/documentdb/index.ts` re-exporting
  `DocumentDbTypeAdapter`, `BSONTypes`, and the existing
  `BSONTypes.toDisplayString`/`toString` helpers.

### Step 3 — Build the generic JSON adapter

- **Add** `src/json/JsonTypeAdapter.ts`:
  - `name: 'json'`.
  - Tags: `'string' | 'number' | 'boolean' | 'null' | 'undefined' |
'object' | 'array'`.
  - `inferType(v)`:
    - `v === null` → `'null'`
    - `v === undefined` → `'undefined'`
    - `typeof v` match for primitives
    - `Array.isArray(v)` → `'array'`
    - else → `'object'`
  - `toJSONSchemaType(tag)`: identity for primitives/object/array;
    `'null'`/`'undefined'` → `'null'`.
  - `primaryIdFields: ['id'] as const`.
  - `recordStats`: string length min/max, numeric min/max, true/false
    counts (using `x-trueCount`/`x-falseCount` keys, same as the BSON
    adapter). **Do not** emit `x-minDate`/`-maxDate` (plain JSON has
    no date type).
- **Add** `src/json/index.ts` re-exporting `JsonTypeAdapter`.

### Step 4 — Rewrite `SchemaAnalyzer`

- **Rewrite** [SchemaAnalyzer.ts](../../packages/documentdb-js-schema-analyzer/src/SchemaAnalyzer.ts)
  as a thin class:
  - Private `_adapter: TypeAdapter` (defaults to
    `new DocumentDbTypeAdapter()`).
  - Constructor signature: `constructor(options?: { adapter?:
TypeAdapter })`.
  - `addDocument(document: Record<string, unknown>)`: calls
    `updateSchemaWithDocument(this._schema, document, this._adapter)`
    and increments `_version`.
  - `addDocuments(documents: ReadonlyArray<Record<string, unknown>>)`:
    loops and increments version once.
  - `getSchema`, `getDocumentCount`, `reset`, `clone`,
    `getKnownFields`, `fromDocument`, `fromDocuments` preserved.
  - `getKnownFields()` passes `{ primaryIdFields:
this._adapter.primaryIdFields ?? [] }` to `getKnownFields(…)`.
  - **Drop** the `import { type Document, type WithId } from
'mongodb'` type leak.
  - Keep `getPropertyNamesAtLevel` and `buildFullPaths` exports in
    this file for now (they're consumed directly from the root
    export). Update `getPropertyNamesAtLevel`'s hard-coded `_id`
    sort to accept an optional `primaryIdFields` param with default
    `['_id']` for back-compat. Internal callers from the class pass
    the adapter's `primaryIdFields`.

### Step 5 — Rewrite `getKnownFields`

- In [getKnownFields.ts](../../packages/documentdb-js-schema-analyzer/src/getKnownFields.ts):
  - Change the `FieldEntry` field names: `bsonType` → `typeTag`,
    `bsonTypes` → `typeTags`, `arrayItemBsonType` → `arrayItemTypeTag`.
  - Read `entry['x-type']` instead of `entry['x-bsonType']` in
    `collectBsonTypes` and `getDominantArrayItemBsonType` (rename
    these helpers to `collectTypeTags` and
    `getDominantArrayItemTypeTag`).
  - Change the exported signature to
    `getKnownFields(schema: JSONSchema, options?: { primaryIdFields?: readonly string[] }): FieldEntry[]`
    with `['_id']` as the default to preserve behaviour for direct
    callers.
  - Replace the hard-coded `_id` comparator with a priority table
    derived from `primaryIdFields`.

### Step 6 — Update `JSONSchema.ts`

- Replace `'x-bsonType'?: string;` with `'x-type'?: string;` in
  [JSONSchema.ts](../../packages/documentdb-js-schema-analyzer/src/JSONSchema.ts).
- No other changes.

### Step 7 — Move `ValueFormatters` out of the package

- **Delete**
  [packages/documentdb-js-schema-analyzer/src/ValueFormatters.ts](../../packages/documentdb-js-schema-analyzer/src/ValueFormatters.ts).
- **Create** `src/utils/slickgrid/valueToDisplayString.ts` in the
  extension with the exact same contents. Update the copyright
  header to match the extension's style if needed.
- **Update imports** in
  [src/utils/slickgrid/mongo/toSlickGridTable.ts](../../src/utils/slickgrid/mongo/toSlickGridTable.ts)
  and [toSlickGridTree.ts](../../src/utils/slickgrid/mongo/toSlickGridTree.ts)
  from `@documentdb-js/schema-analyzer` to the new local path.
- **Remove** `valueToDisplayString` from the package's `index.ts`.
- Keep the `import { BSONTypes } from '@documentdb-js/schema-analyzer'`
  in the SlickGrid files — `BSONTypes` is still exported from the
  root package index.

### Step 8 — Update the extension consumers (rename sweep)

Run these renames across `src/**`:

- `FieldEntry.bsonType` → `FieldEntry.typeTag`
- `FieldEntry.bsonTypes` → `FieldEntry.typeTags`
- `FieldEntry.arrayItemBsonType` → `FieldEntry.arrayItemTypeTag`

Known touch points (verify with a repo-wide grep before committing):

- [src/documentdb/ClusterSession.ts](../../src/documentdb/ClusterSession.ts)
- [src/webviews/documentdb/collectionView/collectionViewRouter.ts](../../src/webviews/documentdb/collectionView/collectionViewRouter.ts)
- `src/utils/json/data-api/autocomplete/toTypeScriptDefinition.ts`
- `src/utils/json/data-api/autocomplete/generateDescriptions.ts`
- `src/utils/json/data-api/autocomplete/toFieldCompletionItems.ts`
- `src/utils/json/data-api/autocomplete/getKnownFields.test.ts`
- `src/utils/json/data-api/autocomplete/toTypeScriptDefinition.test.ts`
- `src/utils/json/data-api/autocomplete/generateDescriptions.test.ts`
- `src/utils/json/data-api/autocomplete/toFieldCompletionItems.test.ts`

Playground completions/hover providers that use the `BSONTypes` enum
(`src/documentdb/query-language/playground-completions/*`) keep
working unchanged — they import `BSONTypes` from the root, and we
preserve that export.

### Step 9 — Update package tests

- In existing package tests
  (`SchemaAnalyzer.test.ts`, `SchemaAnalyzer.arrayStats.test.ts`,
  `SchemaAnalyzer.versioning.test.ts`), change every expectation on
  `'x-bsonType'` to `'x-type'`. No behaviour changes — the produced
  tags are identical for the default (DocumentDB) adapter.
- **Add** `test/SchemaAnalyzer.json.test.ts`:
  - No `mongodb` import anywhere in the file.
  - Construct `new SchemaAnalyzer({ adapter: new JsonTypeAdapter() })`.
  - Cover: primitives, nested objects, arrays of mixed primitives,
    sparse fields, `id`-first ordering in `getKnownFields`,
    `x-minLength`/`-maxLength` on strings, `x-minValue`/`-maxValue`
    on numbers, `x-trueCount`/`-falseCount` on booleans,
    `x-minItems`/`-maxItems` on arrays, `x-minProperties`/
    `-maxProperties` on objects.

### Step 10 — Package metadata

- Update [package.json](../../packages/documentdb-js-schema-analyzer/package.json):
  - Add the `exports` map shown above.
  - Move `mongodb` from `peerDependencies` to
    `peerDependenciesMeta` as optional.
  - Bump `version` to `0.9.0`.
- Update the package README with a short "Adapters" section and a
  link to this plan doc.

### Step 11 — PR checklist

Before marking the PR ready for review:

1. **Localization** — `npm run l10n` (no user-facing strings are
   expected to change; run anyway).
2. **Formatting** — `npm run prettier-fix`.
3. **Linting** — `npm run lint`.
4. **Build** — `npm run build`.
5. **Tests** — from the workspace root: `npm test`. From the
   package dir: `cd packages/documentdb-js-schema-analyzer && npm test`.

---

## Verification

1. Existing package test suites (`SchemaAnalyzer.test.ts`,
   `arrayStats`, `versioning`) pass after the mechanical
   `x-bsonType` → `x-type` rename. No other expectation changes.
2. New `SchemaAnalyzer.json.test.ts` passes and contains no
   `mongodb` import.
3. Workspace root `npm run build && npm run lint && npm test` green
   after the `FieldEntry` rename sweep.
4. F5 smoke test: open a DocumentDB collection, verify the schema
   tree, autocomplete suggestions, and SlickGrid table/tree render
   identically to before this PR.
5. Optional but recommended: create a scratch directory outside the
   repo, `npm i` the newly-built tarball **without** installing
   `mongodb`, then `import { SchemaAnalyzer, JsonTypeAdapter } from
'@documentdb-js/schema-analyzer/json'` and scan a JSON array — no
   runtime or module-resolution errors.

---

## Scope

**In scope**

- Package refactor to adapter pattern.
- Ship built-in `DocumentDbTypeAdapter` and `JsonTypeAdapter`.
- Rename `x-bsonType` → `x-type` and `FieldEntry.bsonType*` →
  `FieldEntry.typeTag*` atomically across the monorepo.
- Relocate `ValueFormatters` into the extension.

**Out of scope**

- Merging packages with vscode-cosmosdb.
- Rewriting SlickGrid renderers beyond the import-path change.
- New statistics (histograms, cardinality estimates, …).
- Publishing the package to the public npm registry.

---

## Decisions already made (do not re-litigate)

1. Adapter (composition) over inheritance or global registry.
2. Single output key `x-type` — no per-adapter key knob.
3. Engine decides recursion structurally — no `objectTypeId`/
   `arrayTypeId` knobs.
4. One `recordStats` method with `firstOccurrence: boolean`.
5. One package, subpath exports `./documentdb` and `./json`.
6. `mongodb` becomes an optional peer dependency.
7. Output-key rename is atomic with the refactor (no dual-write
   transition).
8. `FieldEntry.bsonType*` → `typeTag*` is atomic.
9. `ValueFormatters` leaves the package.
10. The enum `BSONTypes` keeps its name (accurate technical term);
    the module/subpath is `documentdb/` (product-level naming).

---

## Appendix: vscode-cosmosdb fork analysis and migration path

### How vscode-cosmosdb adapted our schema analyzer

The vscode-cosmosdb team copied `@documentdb-js/schema-analyzer` into
their repo as `@cosmosdb/schema-analyzer` (private, under
`packages/schema-analyzer/`). They refactored it into a
generic-engine + adapter architecture to support two document models:

- **`./bson` subpath** — for the MongoDB API (vCore), class-based
  `SchemaAnalyzer` (essentially our original code), uses BSON types.
- **`./json` subpath** — for Cosmos DB NoSQL (plain JSON), function-
  based API (`getSchemaFromDocuments`, `getSchemaFromDocument`), uses
  `NoSQLTypes`.

Their architecture:

```
@cosmosdb/schema-analyzer
  src/
    core/
      schemaTraversal.ts   ← shared BFS engine
      schemaUtils.ts       ← getKnownFields, buildFullPaths, etc.
      JSONSchema.ts        ← shared JSONSchema interface
    bson/
      BSONTypes.ts         ← enum + inferBsonType + bsonTypeToJSONType
      SchemaAnalyzer.ts    ← class wrapping the engine with bsonTypeAdapter
    json/
      NoSqlTypes.ts        ← type + inferNoSqlType + noSqlTypeToJSONType
      SchemaAnalyzer.ts    ← function-based API wrapping the engine with jsonTypeAdapter
```

#### Their `TypeAdapter` interface

```ts
interface TypeAdapter<TType extends string = string> {
  inferType(value: unknown): TType;
  toJSONType(type: TType): string;
  typeExtensionKey: string; // 'x-bsonType' or 'x-dataType'
  initializeStats(value: unknown, type: TType, entry: JSONSchema): void;
  aggregateStats(value: unknown, type: TType, entry: JSONSchema): void;
  trackNestedObjectDocs?: boolean; // default false
}
```

Key characteristics:

1. **Per-adapter output key (`typeExtensionKey`).**
   The BSON adapter writes `x-bsonType`; the JSON adapter writes
   `x-dataType`. Consumers must know which key to look for.
2. **Separate `initializeStats` / `aggregateStats` methods.**
   Every adapter must implement both. No way to opt out of stats.
3. **`trackNestedObjectDocs` defaults to `false`.**
   Only the BSON adapter enables it. The JSON adapter does not track
   `x-documentsInspected` on nested objects, meaning the probability
   calculation for nested fields in Cosmos DB NoSQL is less accurate.
4. **Engine uses `adapter.toJSONType()` for recursion decisions.**
   The BFS engine switches on the _result_ of `adapter.toJSONType(tag)`
   to decide object/array branches, rather than testing the raw JS
   value with `typeof` / `Array.isArray()`.
5. **`_id`-first sort is hard-coded in `getKnownFields`.**
   Not configurable per adapter.
6. **No `primaryIdFields` concept.**
   Cosmos DB NoSQL uses `id` (not `_id`), but `getKnownFields` still
   hard-codes `_id`-first sorting.

#### Their `FieldEntry` shape

```ts
interface FieldEntry {
  path: string;
  type: string;
  dataType: string; // adapter-specific tag
  dataTypes?: string[]; // all observed tags (polymorphic)
  isSparse?: boolean;
  arrayItemDataType?: string; // dominant array-element tag
}
```

#### Their `getKnownFields` signature

```ts
function getKnownFields(schema: JSONSchema, typeExtensionKey: string): FieldEntry[];
```

The `typeExtensionKey` parameter is passed by the consumer; neither
the BSON nor JSON adapter object is passed to this function. This
means the caller must know the key (e.g. `'x-bsonType'`) and pass it
explicitly.

#### Adapter instantiation

Adapters are plain objects (not classes), created as module-level
singletons:

```ts
// In json/SchemaAnalyzer.ts
const jsonTypeAdapter: TypeAdapter<NoSQLTypes> = { ... };

// In bson/SchemaAnalyzer.ts
const bsonTypeAdapter: TypeAdapter<BSONType> = { ... };
```

#### JSON types

```ts
type NoSQLTypes =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null'
  | 'undefined'
  | 'timestamp' // present but not used in practice (no Date inference)
  | '_unknown_';
```

The JSON adapter's `inferType` is purely `typeof`-based — no
`instanceof` checks, no BSON driver imports.

#### API asymmetry

The BSON adapter exposes a stateful class (`SchemaAnalyzer`); the JSON
adapter exposes stateless functions (`getSchemaFromDocuments`,
`getSchemaFromDocument`). This means the APIs are not interchangeable
— you cannot switch adapters without also changing your calling
pattern.

#### `mongodb` dependency

`mongodb` is an optional peer dependency at the package level, but the
`./bson` subpath hard-requires it at runtime. The `./json` subpath
has no dependency on `mongodb`.

---

### Side-by-side comparison: their fork vs. our new proposal

| Aspect                            | `@cosmosdb/schema-analyzer` (fork)                                          | `@documentdb-js/schema-analyzer` (proposal)                                                                     |
| --------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Adapter interface**             | `TypeAdapter` with 5 required members + 1 optional flag                     | `TypeAdapter` with 3 required members + 1 optional method + 1 optional property                                 |
| **Stats methods**                 | `initializeStats` + `aggregateStats` (both required)                        | Single `recordStats?(…, firstOccurrence)` (optional)                                                            |
| **Output type key**               | Per-adapter: `x-bsonType` or `x-dataType` via `typeExtensionKey`            | Universal: `x-type` (engine-controlled, no knob)                                                                |
| **Recursion decision**            | Engine uses `adapter.toJSONType()` result to switch on `'object'`/`'array'` | Engine uses structural JS checks (`typeof` / `Array.isArray`)                                                   |
| **Nested `x-documentsInspected`** | Opt-in via `trackNestedObjectDocs` flag (default `false`)                   | Always tracked (correctness, not optional)                                                                      |
| **Primary-ID sort**               | Hard-coded `_id` first in `getKnownFields`                                  | Configurable via `adapter.primaryIdFields` (default `['_id']`)                                                  |
| **`FieldEntry` naming**           | `dataType`, `dataTypes`, `arrayItemDataType`                                | `typeTag`, `typeTags`, `arrayItemTypeTag`                                                                       |
| **`getKnownFields` API**          | `getKnownFields(schema, typeExtensionKey: string)`                          | `getKnownFields(schema, options?: { primaryIdFields? })` — no key param needed since the key is always `x-type` |
| **BSON API shape**                | Class-based (`SchemaAnalyzer`)                                              | Class-based (`SchemaAnalyzer` with optional adapter)                                                            |
| **JSON API shape**                | Function-based (different calling pattern)                                  | Same class (`new SchemaAnalyzer({ adapter: new JsonTypeAdapter() })`) — interchangeable                         |
| **Adapter naming**                | `bson/` and `json/` subpaths                                                | `documentdb/` and `json/` subpaths                                                                              |
| **Adapter instantiation**         | Plain objects (module-level singletons)                                     | Classes (`new DocumentDbTypeAdapter()`, `new JsonTypeAdapter()`)                                                |
| **`mongodb` dependency**          | Optional peer (fork-level)                                                  | Optional peer (package-level), only needed by `./documentdb` subpath                                            |
| **`ValueFormatters`**             | Not present (dropped during fork)                                           | Moved to extension (not in package)                                                                             |
| **Package visibility**            | Private (`"private": true`)                                                 | Internal to monorepo (not yet published)                                                                        |

#### Design improvements in our proposal

1. **Single output key eliminates branching bugs.** With per-adapter
   `typeExtensionKey`, every consumer function must know which key to
   read. If a caller passes the wrong key, results are silently empty.
   With `x-type`, there is no wrong key to pass.

2. **Unified class API for all adapters.** Their fork forces JSON
   consumers onto a function-based API and BSON consumers onto a
   class-based API. Switching adapters requires rewriting call sites.
   Ours uses the same `SchemaAnalyzer` class for both — swap the
   adapter, keep the API.

3. **Optional `recordStats` avoids empty method stubs.** Their fork
   requires both `initializeStats` and `aggregateStats` even when an
   adapter tracks no stats. Ours lets adapters omit `recordStats`
   entirely.

4. **Always-on `x-documentsInspected`** on nested objects. Their fork
   defaults this off for JSON, producing incorrect probability for
   fields inside nested objects or arrays. Our engine always tracks it,
   and the probability computation is correct for every adapter.

5. **Configurable `primaryIdFields`** instead of hard-coded `_id`.
   Their fork sorts `_id` first for both JSON and BSON, even though
   Cosmos DB NoSQL uses `id`. Our adapter declares which fields go
   first.

---

### Migration path for vscode-cosmosdb

When `@documentdb-js/schema-analyzer` ships this refactor, the
vscode-cosmosdb team can replace their `@cosmosdb/schema-analyzer`
fork with our package. Here is what they would need to change:

#### 1. Replace the dependency

```diff
- "@cosmosdb/schema-analyzer": "workspace:*"
+ "@documentdb-js/schema-analyzer": "^0.9.0"
```

Remove the `packages/schema-analyzer/` directory from their monorepo.

#### 2. Rewrite their JSON adapter as a `TypeAdapter`

Their `jsonTypeAdapter` singleton becomes a class implementing our
`TypeAdapter` interface. The key differences:

| Their code                         | New code                                        |
| ---------------------------------- | ----------------------------------------------- |
| `typeExtensionKey: 'x-dataType'`   | Remove — engine writes `x-type` automatically   |
| `initializeStats(v, t, entry)`     | Merge into `recordStats(v, t, entry, firstOcc)` |
| `aggregateStats(v, t, entry)`      | (merged above)                                  |
| `trackNestedObjectDocs: undefined` | Remove — always tracked now                     |
| `toJSONType(tag)`                  | Rename to `toJSONSchemaType(tag)`               |

They can either:

- Use our built-in `JsonTypeAdapter` directly (if their `NoSQLTypes`
  mapping is equivalent — it is, modulo their unused `'timestamp'`
  tag), or
- Create a `CosmosDbTypeAdapter` class implementing `TypeAdapter` if
  they want Cosmos-specific behaviour (e.g. treating `_ts` as a
  special numeric type, detecting ISO 8601 date strings, etc.).

#### 3. Rewrite their BSON adapter usage

Replace:

```ts
import { SchemaAnalyzer } from '@cosmosdb/schema-analyzer/bson';
```

With:

```ts
import { SchemaAnalyzer } from '@documentdb-js/schema-analyzer';
// Default adapter is DocumentDbTypeAdapter — same behaviour
```

No adapter construction needed; the default is identical.

#### 4. Update `FieldEntry` field references

| Their field               | Our field                |
| ------------------------- | ------------------------ |
| `entry.dataType`          | `entry.typeTag`          |
| `entry.dataTypes`         | `entry.typeTags`         |
| `entry.arrayItemDataType` | `entry.arrayItemTypeTag` |

Mechanical rename across their consumers.

#### 5. Update `getKnownFields` calls

Their current pattern:

```ts
import { getKnownFields } from '@cosmosdb/schema-analyzer';
const fields = getKnownFields(schema, 'x-bsonType');
```

Becomes:

```ts
import { getKnownFields } from '@documentdb-js/schema-analyzer';
const fields = getKnownFields(schema); // no typeExtensionKey needed
// or with custom ID sort:
const fields = getKnownFields(schema, { primaryIdFields: ['id'] });
```

#### 6. Update schema key reads

Any code that reads `x-bsonType` or `x-dataType` from schema nodes:

```diff
- const tag = entry['x-bsonType'];
- const tag = (entry as Record<string, unknown>)[typeExtensionKey];
+ const tag = entry['x-type'];
```

#### 7. Convert function-based JSON API to class-based

Their Cosmos DB NoSQL code currently uses:

```ts
import { getSchemaFromDocuments } from '@cosmosdb/schema-analyzer/json';
const schema = getSchemaFromDocuments(documents);
```

This becomes:

```ts
import { SchemaAnalyzer, JsonTypeAdapter } from '@documentdb-js/schema-analyzer';
const analyzer = new SchemaAnalyzer({ adapter: new JsonTypeAdapter() });
analyzer.addDocuments(documents);
const schema = analyzer.getSchema();
```

Or, if they prefer a one-liner helper, they can write a thin wrapper
in their own repo:

```ts
function getSchemaFromDocuments(docs: Record<string, unknown>[]): JSONSchema {
  return SchemaAnalyzer.fromDocuments(docs, { adapter: new JsonTypeAdapter() }).getSchema();
}
```

#### 8. Remove their fork

Delete `packages/schema-analyzer/` from their monorepo and remove it
from their workspace/build configuration.

#### Summary of effort

The migration is mechanical — primarily import-path changes, field
renames, and the removal of the `typeExtensionKey` parameter. No
algorithmic changes are needed. Their existing test suites should pass
after the renames, confirming behavioural equivalence.

The one substantive behavioural change is that `x-documentsInspected`
will now be tracked on nested objects for JSON documents too. This is
a correctness improvement (their probability calculation for nested
fields was previously inaccurate), so their tests should either
already pass or improve.
