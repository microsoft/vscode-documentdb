---
feature: completions-and-schema
kind: iteration
status: active
prs: [933]
created: 2026-09-18
---

# BSON wrapper types misclassified as plain objects (bson dual-package hazard)

**Branch:** `dev/tnaum/schema-analyzer-bson-fix`
**Base:** `dev/tnaum/integrated-shell-improvements` (stacked; branched off `main`)
**Date:** 2026-09-18
**PR URL:** https://github.com/microsoft/vscode-documentdb/pull/933

---

## Symptom

Field completions and the Collection View offered the _internals_ of BSON wrapper values
as if they were real document fields:

```
db['restaurants-original'].find({
_id.buffer                            additionalInfo.averageWaitTime.value
additionalInfo.priceLevel.value       address.building.value
rating.value                          reviews.value
```

Expected: `_id`, `additionalInfo.averageWaitTime`, `rating`, and so on.

Every BSON wrapper type was affected, in one of two shapes:

| Failure                        | Types                                                                                                                                                                                                                                                                                     | Result                |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Internals leaked as sub-fields | `ObjectId` → `.buffer`; `Double`/`Int32` → `.value`; `Long`/`Timestamp` → `.high`/`.low`/`.unsigned`; `Decimal128` → `.bytes`; `Binary`/`UUID` → `.buffer`/`.position`/`.sub_type`; `Code` → `.code`/`.scope`; `DBRef` → `.collection`/`.db`/`.oid`; `BSONRegExp` → `.pattern`/`.options` | Wrong paths and types |
| Field disappeared entirely     | `MinKey`, `MaxKey` — no own enumerable properties, so they inferred as an empty object                                                                                                                                                                                                    | Silent omission       |

Unaffected: strings, numbers, booleans, plain nested objects, arrays, and `Date` (a native
JS class, shared across module copies).

## Why

`BSONTypes.inferType()` identified BSON values purely by `instanceof` against classes
imported from `mongodb`. Those checks return `false` whenever the value was constructed by
a **different copy** of the `bson` package — the classic dual-package hazard. `inferType()`
then fell through to `BSONTypes.Object`, so `SchemaAnalyzer` walked _into_ the wrapper and
enumerated its private fields.

Two copies were reaching the extension host at once:

- `bson@7` declares split conditional exports — `import` → `lib/bson.node.mjs`,
  `require` → `lib/bson.cjs`.
- Three call sites used `await import('bson')`. Webpack resolved those through the
  `import` condition and pulled in the **ESM** build as a separate chunk.
- `mongodb`, and every static `import … from 'bson'` (which swc emits as `require`),
  resolved to the **CJS** build.

`EJSON.parse()` in the shell and playground paths therefore returned instances of
ESM-copy classes, which the analyzer compared against CJS-copy classes.

The Collection View looked broken too even though it feeds raw driver documents: it reads
the same shared `SchemaStore`, which the shell and playground had already polluted.

### When it was introduced

The `await import('bson')` call sites date to 2026-03-25 but were harmless then — with
swc's default `commonjs` output, `import()` was downleveled to `require()`, so only the
CJS copy ever loaded.

The regression was triggered by `e6dd3923` (_feat(kubernetes): add multi-source service
discovery_, authored 2026-04-29, merged 2026-06-01), which added `ignoreDynamic: true` to
the swc loader options in `webpack.config.ext.js` so that webpack could split lazy runtime
dependencies. That made webpack see real dynamic imports — and pull in the second copy of
`bson`.

| Date       | Event                                                                                        |
| ---------- | -------------------------------------------------------------------------------------------- |
| 2026-03-25 | `await import('bson')` call sites added — harmless, swc downlevels `import()` to `require()` |
| 2026-04-29 | `e6dd3923` authored (`ignoreDynamic: true`)                                                  |
| 2026-06-01 | `e6dd3923` merged to `main` — bug becomes live on `main`                                     |
| 2026-06-03 | `v0.8.1` — tagged from an earlier commit, **not** affected                                   |
| 2026-06-18 | `v0.9.0` — **first affected release**                                                        |
| 2026-06-26 | `v0.9.1` — affected                                                                          |
| 2026-08-04 | `v0.9.2` — affected                                                                          |
| 2026-08-16 | `v0.10.0` — affected                                                                         |
| 2026-09-02 | `v0.10.1` — affected                                                                         |
| 2026-09-11 | `v0.10.2` — affected                                                                         |
| 2026-09-18 | Reported and fixed                                                                           |

Exposure: **92 days in released builds** (v0.9.0 → 2026-09-18), 109 days on `main`, across
six consecutive releases.

It survived that long because the failure is silent — no error, no crash, just quietly
wrong schema output. `EJSON.stringify` duck-types on `_bsontype`, so serialization and
rendering kept working perfectly; only type _inference_ was broken. That asymmetry is the
reason the hardening below is worth its cost.

## What changed

**Root cause — one `bson` copy again.** The three `await import('bson')` call sites became
static `import { EJSON } from 'bson'`:

- `src/documentdb/feedResultToSchemaStore.ts` (shell path)
- `src/documentdb/playground/PlaygroundEvaluator.ts` (playground path)
- `src/documentdb/playground/playgroundWorker.ts` (worker IPC serialization)

`deserializeResultForSchema()` and `PlaygroundEvaluator.deserializeResult()` are now
synchronous — the `async` existed only to await the dynamic import — and the shell call
site in `DocumentDBShellPty.maybeFeedSchemaStore()` was updated to match.

There was never a lazy-loading benefit to defend: `bson` is statically imported by roughly
ten other extension-host modules, so the CJS copy was always eagerly present. The dynamic
import only ever _added_ a second copy.

**Hardening — the package no longer trusts `instanceof` alone.**
`BSONTypes.inferType()` now falls back to the `_bsontype` discriminator that every BSON
wrapper instance carries, when all `instanceof` checks fail. `instanceof` stays the fast
path. The fallback covers `ObjectId`, `Int32`, `Double`, `Long`, `Decimal128`, `Binary`,
`BSONSymbol`, `BSONRegExp`, `Code`, `DBRef`, `Timestamp`, `MinKey`, and `MaxKey`, and
preserves the existing `Binary` + `sub_type` → `UUID`/`UUID_LEGACY` and `Code` + `scope` →
`CodeWithScope` refinements.

## Decisions

| Decision                                                                  | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Changed from the proposal? |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Fix the imports **and** harden the analyzer, rather than only the imports | The import fix alone restores correct behavior, but the failure mode was _silent_ — no error, just quietly wrong schema output, which took three and a half months and a user report to notice. A published package whose contract is "tell me the type of this value" should not return confidently wrong answers because of a bundler condition it cannot see.                                                                                                                                                                      | No                         |
| Duck-type on `_bsontype` rather than on structural shape                  | `_bsontype` is the discriminator the `bson` library itself uses internally (`EJSON.stringify` duck-types on it, which is why serialization kept working while inference did not). Structural checks on `.buffer`/`.value` would misfire on ordinary user documents.                                                                                                                                                                                                                                                                   | No                         |
| Keep `instanceof` as the fast path                                        | It is correct in the normal single-copy case and cheaper than a property lookup plus map lookup.                                                                                                                                                                                                                                                                                                                                                                                                                                      | No                         |
| Make the deserialize functions synchronous instead of keeping `async`     | With the dynamic import gone there is nothing to await; leaving `async` would keep a misleading signature and trip `@typescript-eslint/require-await`. It does move the work ahead of the next prompt rather than just after it: `EJSON.parse` walks the whole printable, and the 100-document cap applies afterwards, in `feedResultToSchemaStore`. Accepted because `OutputFormatter.formatResult()` already walks the same payload synchronously on the line above, so this is a second pass over something already paid for once. | No                         |

## Constraint this establishes

**Never `await import('bson')`. Always import it statically.** The same trap applies to any
dependency that ships split `import`/`require` conditions and exposes classes compared with
`instanceof` — the driver's own `bson` re-export is the one that matters here.

`playgroundWorker.ts` still lazy-imports the driver itself (`await import('mongodb')`). That is
safe today only by accident of packaging: `mongodb@7.2.0` publishes no `exports` field, so every
resolution lands on `lib/index.js` (CommonJS), including the `bson` classes it re-exports. A
future driver release that adds an `exports` map with an ESM entry would reintroduce the identical
hazard through the driver rather than through `bson`. Re-check on driver major upgrades, and on
the ESM migration (#687).

Post-build check, since webpack does not clean `dist/`:

```bash
grep -c vendors-node_modules_bson_lib_bson_node_mjs dist/main.js   # must be 0
```

## Verification

- Cross-copy reproduction confirmed the mechanism directly: values parsed by
  `lib/bson.node.mjs` return `false` for `instanceof` against `lib/bson.cjs` classes, while
  `_bsontype` survives.
- Post-fix, the analyzer classifies all fifteen probe values correctly in that worst case:
  `objectid`, `binary`, `code`, `double`, `decimal128`, `int32`, `long`, `maxkey`, `minkey`,
  `regexp`, `dbref`, `timestamp`, `uuid`, `date`, `string`.
- Regression test: `packages/documentdb-js-schema-analyzer/test/SchemaAnalyzer.foreignBson.test.ts`
  simulates values from a foreign `bson` copy and asserts they are classified by type rather
  than traversed, and that genuinely untagged plain objects are still traversed as nested
  documents.
- `dist/main.js` and `dist/playgroundWorker.js` no longer reference the ESM `bson` chunk.

## Follow-ups

- Schema data cached before the fix is stale; `SchemaStore` clears on window reload, so no
  migration is needed in-product. Downstream consumers that persist `getKnownFields()`
  output should invalidate it on upgrade.
- `@documentdb-js/schema-analyzer` released as **1.0.0** with a new `CHANGELOG.md`. A major
  bump rather than a patch because `getKnownFields()` output changes for consumers, and
  because 1.0.0 is where the API gains a stability commitment that 0.x by definition did
  not carry. The changelog describes 0.8.0/0.8.1 as public preview releases — they are live
  on npm — rather than internal ones.
- The three sibling `@documentdb-js/*` packages stay at 0.8.1, so the version lockstep set
  by `49d2cbd5` is now broken. The publish workflow takes a per-package input, so drift is
  mechanically fine; a coordinated 1.0.0 is still open if the packages are announced
  together.
