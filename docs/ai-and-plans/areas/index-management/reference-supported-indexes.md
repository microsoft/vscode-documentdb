---
area: index-management
kind: research
status: active
created: 2026-07-07
code:
    - src/webviews/documentdb/indexView/**
verified: 2026-08-14
---

# DocumentDB-supported indexes (from documentation scraping)

**Source:** [MicrosoftDocs/nosql-docs](https://github.com/MicrosoftDocs/nosql-docs) →
`azure/documentdb/compatibility-query-language.md`
([rendered](https://learn.microsoft.com/en-us/documentdb/compatibility-query-language))
**Scraped by:** `@documentdb-js/operator-registry` →
`resources/scraped/index-reference.md` → generated `src/indexReference.ts`
(`INDEX_TYPES`, `INDEX_PROPERTIES`)
**Last scraped:** 2026-07-07

This file summarizes what we currently know, from the official documentation,
about the indexes DocumentDB supports over its MongoDB-compatible (MQL) wire
protocol. It is derived data — re-run `npm run scrape` in the operator-registry
package to refresh it.

---

## Index types

All eight documented index types are marked **supported**.

| Type             | Description                                      | Type-column badge?                     |
| ---------------- | ------------------------------------------------ | -------------------------------------- |
| **Single Field** | Indexes a single field for faster lookups.       | ✅ (field count = 1)                   |
| **Compound**     | Indexes multiple fields in one index.            | ✅ (field count > 1)                   |
| **Multikey**     | Indexes array fields by indexing each element.   | ❌ needs runtime array data            |
| **Text**         | Supports text search on string fields.           | ✅ (`text` key direction)              |
| **Wildcard**     | Dynamically indexes all or selected fields.      | ✅ (`$**` in a key field)              |
| **Geospatial**   | Supports spatial queries on GeoJSON data.        | ✅ (`2dsphere` / `2d` / `geoHaystack`) |
| **Hashed**       | Indexes hashed field values, often for sharding. | ✅ (`hashed` key direction)            |
| **Vector**       | Enables similarity search on vector data.        | ❌ special key form; DocumentDB-only   |

> The **Type-column badge** column notes how the Index Management webview
> classifies an _existing_ index from its key spec (see
> `src/webviews/documentdb/indexView/utils/indexType.ts`). Two additional
> display-only badges exist that are not index _types_ per se: `Default` (the
> immutable `_id_` index) and `ObjectId` (a single `_id` field).

### Notes per type

- **Vector** is documented as _"only in DocumentDB"_ and links out to the
  dedicated vector-search docs. It is the one type with no direct MongoDB
  equivalent.
- **Multikey** is not a user-declared type — any index automatically becomes
  multikey when it covers an array field, so it cannot be detected from the key
  spec alone.
- **Hashed** and **Wildcard** are detectable from the key spec and were the two
  types previously mislabeled by the UI (now fixed).
- **Wildcard projection** — a wildcard index on the all-fields `$**` key accepts
  an optional `wildcardProjection` that limits which paths the index covers. Each
  listed path maps to `1` (**include**) or `0` (**exclude**), so the projection
  is either an _include_ list (`{ "name": 1, "metadata.category": 1 }`) or an
  _exclude_ list (`{ "secret": 0 }`). Include and exclude statements cannot be
  mixed in the same projection — the only exception is adding/removing `_id`. A
  projection is valid **only** on the all-fields `$**` key; a scoped `path.$**`
  key already narrows the index and rejects `wildcardProjection`. The Create
  Index dialog surfaces this as an Include/Exclude choice plus a field list,
  shown only for the "All fields" scope.

---

## Index properties

All six documented index properties are marked **supported**. Properties are
modifiers that can be combined with the index types above.

| Property               | Description                                                                   |
| ---------------------- | ----------------------------------------------------------------------------- |
| **TTL** (time-to-live) | Automatically deletes documents after a specified time-to-live period.        |
| **Unique**             | Ensures that all values in the indexed field are unique.                      |
| **Partial**            | Indexes only documents that match a specified filter condition.               |
| **Case Insensitive**   | Supports case-insensitive indexing for string fields.                         |
| **Sparse**             | Indexes only documents that contain the indexed field.                        |
| **Background**         | Allows the index to be created in the background without blocking operations. |

> Documentation caveat (from the same page): creating a **unique index** takes
> an exclusive lock on the collection for the whole build and blocks reads and
> writes until it completes.

---

## How this maps to the extension today

- **Reference data:** available programmatically via
  `import { INDEX_TYPES, INDEX_PROPERTIES } from '@documentdb-js/operator-registry';`
- **Existing-index classification (Type column):** Default, ObjectId,
  Single Field, Compound, Text, Geospatial, **Hashed**, **Wildcard**.
- **Creatable index types (Create Index dialog):** the drawer offers three
  mutually-exclusive kinds via a tab selector:
  - **Standard** — one or more fields, each `asc / desc / text / 2dsphere /
    hashed`, plus `unique / sparse / TTL`, partial filter, and collation.
  - **Wildcard** — a single ascending wildcard key: **All fields** (`$**`) or
    **Fields below a path** (`metadata.$**`, empty path falls back to `$**`),
    with an optional include/exclude **projection** on the all-fields key, plus
    partial filter and collation.
  - **Vector** — placeholder tab; creation is not yet implemented.
- Hashed keys are available as a Standard per-field type; Vector creation still
  requires a UX and backend decision and is intentionally left as a stub.

---

## Refreshing this data

```bash
npm run scrape   --workspace=@documentdb-js/operator-registry   # re-scrape docs
npm run generate --workspace=@documentdb-js/operator-registry   # regenerate TS
```

If the counts here (8 types / 6 properties) change after a scrape, the upstream
compatibility page has been updated — reconcile the webview classification and
this summary accordingly.
