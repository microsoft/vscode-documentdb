# Changelog

## 1.0.0

First release with a stability commitment. The package has been on npm since 0.8.0; from this version on, breaking changes come with a major version bump.

No API signatures changed in this release.

### Fixed

- **BSON wrapper values were misclassified as plain objects.**

    `BSONTypes.inferType()` identified values using `instanceof` alone. Those checks return `false` whenever the value was constructed by a _different copy_ of the `bson` package than the one the analyzer is linked against — the dual-package hazard, which a bundler can introduce silently when a dependency ships split `import`/`require` export conditions.

    Inference then fell through to `BSONTypes.Object`, so `SchemaAnalyzer` descended _into_ the wrapper and reported its internals as document fields. `getKnownFields()` returned paths such as:

    | Type                 | Reported instead of the field    |
    | -------------------- | -------------------------------- |
    | `ObjectId`           | `.buffer`                        |
    | `Double`, `Int32`    | `.value`                         |
    | `Long`, `Timestamp`  | `.high`, `.low`, `.unsigned`     |
    | `Decimal128`         | `.bytes`                         |
    | `Binary`, `UUID`     | `.buffer`, `.position`, `.sub_type` |
    | `Code`               | `.code`, `.scope`                |
    | `DBRef`              | `.collection`, `.db`, `.oid`     |
    | `BSONRegExp`         | `.pattern`, `.options`           |

    `MinKey` and `MaxKey` have no own enumerable properties, so those fields were inferred as an empty object and vanished from the output entirely — a silent omission rather than a visible wrong answer.

    Strings, numbers, booleans, arrays, plain nested objects, and `Date` were unaffected. `Date` is a native JavaScript class shared across module copies, so its `instanceof` check never failed.

    `inferType()` now falls back to the `_bsontype` discriminator that every BSON wrapper instance carries, when the `instanceof` checks fail. This is the same discriminator the `bson` library uses internally, which is why serialization kept working while inference did not. `instanceof` remains the fast path. The fallback covers `ObjectId`, `Int32`, `Double`, `Long`, `Decimal128`, `Binary`, `BSONSymbol`, `BSONRegExp`, `Code`, `DBRef`, `Timestamp`, `MinKey`, and `MaxKey`, and preserves the existing `Binary` + `sub_type` → `UUID`/`UUID_LEGACY` and `Code` + `scope` → `CodeWithScope` refinements.

### Changed

- **Binary values are classified by subtype, not by class.**

    `UUID` extends `Binary` and carries `_bsontype: 'Binary'`, so the subtype is the only discriminator the tag fallback can use. Classifying by class in one path and by subtype in the other would have produced two different answers for the same value depending on which copy of `bson` created it — the failure mode this release exists to remove.

    Both paths now classify any `Binary` with subtype `4` as `BSONTypes.UUID` and subtype `3` as `BSONTypes.UUID_LEGACY`. Previously only `UUID` _instances_ were classified that way, so a plain `new Binary(bytes, 4)` reported `binary` and now reports `uuid`. Values already reported as `uuid`/`uuid-legacy` are unaffected, since `UUID` instances always carry subtype `4`.

### Upgrading

`getKnownFields()` and `getSchema()` output changes for any document containing BSON wrapper values: correct field paths and types replace the wrapper internals, and `MinKey`/`MaxKey` fields reappear. A `Binary` with subtype `3` or `4` now reports as `uuid-legacy`/`uuid` rather than `binary`. Invalidate any persisted or cached schema derived from an earlier version.

Consumers that bundle this package should ensure a single copy of `bson` is resolved — import it statically rather than through a dynamic `import('bson')`, which resolves a different export condition and loads a second copy. The `_bsontype` fallback makes the analyzer resilient to this, but a duplicated `bson` remains a problem for any other `instanceof` check in the same application.

## 0.8.0 – 0.8.1

- Preview releases. Public on npm, but published without an API stability commitment.
- Incremental `SchemaAnalyzer`, `getKnownFields()`, `BSONTypes`, value formatters, and the JSON Schema statistical extensions.
