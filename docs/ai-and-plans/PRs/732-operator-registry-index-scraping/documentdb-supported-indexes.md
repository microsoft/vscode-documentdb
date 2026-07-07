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
- **Creatable index types (Create Index dialog):** currently
  `asc / desc / ttl / geospatial / text` only. Wildcard, Hashed, and Vector are
  documented and supported by the service but are **not yet offered in the
  create UI** — that requires backend create-index key-spec support and a UX
  decision.

---

## Refreshing this data

```bash
npm run scrape   --workspace=@documentdb-js/operator-registry   # re-scrape docs
npm run generate --workspace=@documentdb-js/operator-registry   # regenerate TS
```

If the counts here (8 types / 6 properties) change after a scrape, the upstream
compatibility page has been updated — reconcile the webview classification and
this summary accordingly.
