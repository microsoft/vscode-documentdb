# PR #717: Correct MQL aggregation references for unsafe field names

**Branch:** `fix/709-referenceText-unsafe-field-names`
**Base:** `main`
**Date:** 2026-06-23
**PR URL:** https://github.com/microsoft/vscode-documentdb/pull/717
**Fixes:** #709

---

## Why

`toFieldCompletionItems()` produces a `referenceText` for each schema field — the
aggregation field reference (e.g. `$age`) that a future aggregation completion
provider will offer. The original implementation always emitted `"$" + path`,
which is **invalid MQL** for field names that are not valid `$`-prefix references:

| Field name      | Old `referenceText` | Valid? |
| --------------- | ------------------- | ------ |
| `order-items`   | `$order-items`      | ❌     |
| `my field`      | `$my field`         | ❌     |
| `say"hi"`       | `$say"hi"`          | ❌     |

This was documented as future work in
[`future-work.md`](../../../src/utils/json/data-api/autocomplete/future-work.md)
(item 2), with `$getField` (Option B) recommended as the fix.

An initial pass added a single-segment `$getField` fallback, but it had three
correctness gaps that this PR closes:

1. **Nested paths were broken.** `a.order-items` produced
   `{ $getField: "a.order-items" }`, which references a *top-level* field
   literally named `a.order-items` — the wrong document — instead of the nested
   `order-items` field inside `a`.
2. **`$`-containing names were misclassified as safe.** The identifier check
   allowed `$`, so a field named `$price` emitted `$$price`, which MQL reads as
   the **variable** `$$price`, not the field.
3. The interface doc claimed nested paths were handled when they were not.

### Scope cleanup (rebase)

The branch was originally stacked on the contributor's `#659` (index-count)
branch, so the PR carried unrelated `IndexesItem.ts` changes that duplicated a
feature **already merged to `main`** — the source of the merge conflict. The
branch was rebased onto `main`, dropping the stale `#659` commits and keeping
only the `#709` work. The PR now changes four files: the two autocomplete
sources ([`toFieldCompletionItems.ts`](../../../src/utils/json/data-api/autocomplete/toFieldCompletionItems.ts)
and its test), the [`future-work.md`](../../../src/utils/json/data-api/autocomplete/future-work.md)
status update, and this note.

---

## What was done

### 1. Stricter aggregation-safe segment check

A new `AGGREGATION_SAFE_SEGMENT_PATTERN` (`/^[a-zA-Z_][a-zA-Z0-9_]*$/`) replaces
the previous reuse of `JS_IDENTIFIER_PATTERN` for reference safety. It is
intentionally stricter: it rejects `$` because `$`/`$$` are reserved in
aggregation expressions. `JS_IDENTIFIER_PATTERN` is still used unchanged for
`insertText` quoting (a separate concern).

### 2. `buildAggregationReference(path)` — correct nested references

```
$a.b.c                                   ← every segment safe (compact form)
{ $getField: "order-items" }             ← unsafe top-level field
{ $getField: { field: "order-items",     ← unsafe leaf in a nested path
               input: "$a" } }
```

- A fully safe path keeps the compact `$a.b.c` form (unchanged behavior).
- Otherwise the reference is built with `$getField`. The leading run of safe
  segments is collapsed into a single quoted `"$a.b"` field-path used as the
  innermost `input`, and each subsequent (unsafe or trailing) segment is wrapped
  in `{ $getField: { field, input } }`. This is what makes nested references
  semantically correct.
- All literal segment names are escaped via the existing `escapeFieldName`
  (`\` → `\\`, `"` → `\"`).

### 3. Documentation

- The `referenceText` JSDoc now describes the `$getField` forms and the
  literal-dot limitation.
- `future-work.md` item 2 is marked ✅ RESOLVED (mirroring item 1), with the
  original description preserved in a `<details>` block.

---

## Where this applies (scope)

`referenceText` is the **aggregation field-path expression** (`$field`) form. It
is used wherever a field appears as an _expression value_, not as a _key_:

```
✔ affected (uses referenceText / "$field" form)
  • db.coll.aggregate([ { $project / $group / $addFields / $match: { $expr } ... } ])
  • find / update with $expr:   find({ $expr: { $gt: ["$order-items", 5] } })
  • pipeline-form updates:       updateOne(filter, [ { $set: { x: "$a.order-items" } } ])

✘ NOT affected (uses insertText — the quoted key, a different field)
  • plain find filters:          { "order-items": 5 }
  • projection include/exclude:  { "order-items": 1 }
  • index keys, sort keys, etc.  { "order-items": -1 }
```

In a query a field is either a **key** (left of `:`) → `insertText`, unchanged by
this PR — or an **expression value** (a `$`-reference) → `referenceText`, fixed
here. So this is effectively "aggregation-expression contexts" (pipelines plus
`$expr` and pipeline-style updates), not plain field-name positions.

---

## How it surfaces (examples)

### Sample collection

```
db.orders  —  a document looks like:
┌─────────────────────────────────────────────┐
│ {                                            │
│   "age":         30,                          │
│   "address":   { "city": "Berlin" },          │
│   "order-items": [ ... ],     ← dash (unsafe) │
│   "a":         { "order-items": 5 },  ← nested│
│   "$price":      9.99         ← leading $      │
│ }                                             │
└─────────────────────────────────────────────┘
```

### Where the completion kicks in

The cursor sits where an **expression** is expected, and the provider lists fields:

```
db.orders.aggregate([
  { $project: { total: ▮ } } ◄── cursor here, provider lists fields
])
                  │
                  ▼
        ┌──────────────────────────┐
        │ ▸ age            number   │
        │ ▸ address.city   string   │
        │ ▸ order-items    array    │  ◄ pick one →
        │ ▸ a.order-items  number   │     inserts its
        │ ▸ $price         number   │     referenceText
        └──────────────────────────┘
```

### Before vs. after (what gets inserted)

```
field picked        BEFORE (always "$"+path)        AFTER (this PR)
──────────────────  ──────────────────────────────  ─────────────────────────────────────────────────
age                 $age                      ✅     $age                                          ✅ (unchanged)
address.city        $address.city             ✅     $address.city                                 ✅ (unchanged)

order-items         $order-items              ❌     { $getField: "order-items" }                  ✅
                    └ parsed as  $order MINUS items

a.order-items       $a.order-items            ❌     { $getField: { field: "order-items",          ✅
                    └ "$" form breaks on dash                      input: "$a" } }
                                                     └ walks INTO "a", then reads the leaf

$price              $$price                   ❌     { $getField: "$price" }                       ✅
                    └ "$$" = a VARIABLE, not a field └ name treated as a literal
```

### The subtle one — nested vs. top-level (the core fix)

The earlier single-segment patch would have emitted `{ $getField: "a.order-items" }`,
which is still wrong: `$getField` with a plain string reads a _top-level_ field
literally named `a.order-items`.

```
{ $getField: "a.order-items" }                         { $getField: { field: "order-items", input: "$a" } }
┌───────────── ROOT ──────────────┐                    ┌───────────── ROOT ──────────────┐
│ looks for a key literally named  │                    │ input: $a  ──►  { order-items: 5}│
│ "a.order-items"  →  not found    │  ✗                 │ field: "order-items" ──► 5       │  ✓
└──────────────────────────────────┘                    └──────────────────────────────────┘
```

---

## Edge cases covered (tests)

All in
[`toFieldCompletionItems.test.ts`](../../../src/utils/json/data-api/autocomplete/toFieldCompletionItems.test.ts):

| Case                                  | Input            | `referenceText`                                                                  |
| ------------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| Safe scalar / nested (regression)     | `age`, `address.city` | `$age`, `$address.city`                                                     |
| Unsafe top-level                      | `order-items`    | `{ $getField: "order-items" }`                                                    |
| Embedded quotes (top-level)           | `say"hi"`        | `{ $getField: "say\"hi\"" }`                                                      |
| **Unsafe leaf in nested path**        | `a.order-items`  | `{ $getField: { field: "order-items", input: "$a" } }`                           |
| **Safe multi-segment prefix collapse**| `a.b.c-d`        | `{ $getField: { field: "c-d", input: "$a.b" } }`                                  |
| **Unsafe segment then safe segment**  | `order-items.city` | `{ $getField: { field: "city", input: { $getField: "order-items" } } }`        |
| **Embedded quotes (nested)**          | `a.say"hi"`      | `{ $getField: { field: "say\"hi\"", input: "$a" } }`                             |
| **Case 3 — `$` in name**              | `$price`, `a$b`, `a.$inner` | `{ $getField: "$price" }`, `{ $getField: "a$b" }`, `{ $getField: { field: "$inner", input: "$a" } }` |
| **Case 4 — literal-dot ambiguity**    | `a.b`            | `$a.b` (treated as nested — documented limitation)                               |
| **Case 5 — empty / degenerate**       | `""`, `a..b`     | `{ $getField: "" }`, nested `$getField` chain (defensive; never emitted by `getKnownFields`) |

### Known limitation (out of scope)

A field literally named `"a.b"` is indistinguishable from a nested `{ a: { b } }`
because `FieldEntry.path` is a flattened, dot-joined string. Dots are always
interpreted as nesting. Resolving this requires changing `path` to a segment
array — tracked as item 3 in `future-work.md`.

### Why no production-behavior risk

`referenceText` is currently consumed only by tests; no production code path
reads it yet (the aggregation completion provider is not wired up). This change
prepares correct data for that future provider with no user-facing behavior
change today.
