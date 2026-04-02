# Completion Behavior Specification

> **⚠️ LLM/Agent Instruction:**
> This specification defines the expected completion behavior contract.
> If tests based on this spec fail after a code change, **do NOT automatically
> fix the tests**. Alert the user that a TDD behavior contract has been violated.
> The user must decide whether the behavior change is intentional.

## Cursor Positions & Expected Completions

The completion system shows different items depending on the cursor's semantic
position within a query expression. This spec defines what categories appear,
their sort order, and how snippets are wrapped at each position.

### Categories

Completions are grouped by category (shown as the `description` field in the
completion item label). The categories come from the operator's `meta` tag:

| Category | Source | Example operators |
|----------|--------|-------------------|
| `logical` | `query:logical` | `$and`, `$or`, `$nor` |
| `comparison` | `query:comparison` | `$eq`, `$gt`, `$in` |
| `array` | `query:array` | `$all`, `$elemMatch`, `$size` |
| `evaluation` | `query:evaluation` | `$regex`, `$mod` |
| `element` | `query:element` | `$exists`, `$type` |
| `bson` | `bson` | `ObjectId`, `UUID`, `ISODate` |
| `JS global` | (hardcoded) | `Date`, `Math`, `RegExp` |
| (field type) | field data | `String`, `Number`, etc. |

### Position: EMPTY (no braces in editor)

```
┌──────────────────────────┐
│ |                        │   ← cursor, editor has no braces
└──────────────────────────┘
```

**Shows:** Fields + key-position operators only (same items as KEY)
**Wrapping:** All insertions wrapped with `{ ... }`
**Sort:** `0_` fields, `1_` key operators

```
Expected completions:
  name      String     ← field, inserts: { name: $1 }
  age       Number     ← field, inserts: { age: $1 }
  $and      logical    ← key operator, inserts: { $and: [...] }
  $or       logical    ← key operator
  $nor      logical    ← key operator

NOT shown:
  $gt       comparison ← field-level, invalid at root
  $all      array      ← field-level, invalid at root
  ObjectId  bson       ← not valid at root key position
  Date      JS global  ← not valid at root key position
```

### Position: KEY (`{ | }`)

```
┌──────────────────────────┐
│ { |  }                   │   ← cursor inside braces
└──────────────────────────┘
```

**Shows:** Fields + key-position operators
**Wrapping:** None (already inside braces)
**Sort:** `0_` fields, `1_` key operators
**Snippets:** Outer `{ }` stripped from operator snippets

```
NOT shown: comparison, array, evaluation, element, bson, JS global
```

### Position: VALUE (`{ field: | }`)

```
┌──────────────────────────┐
│ { age: |  }              │   ← cursor at value position
└──────────────────────────┘
```

**Shows:** Type suggestions + field-level operators + BSON constructors + JS globals
**Sort:** `00_` type suggestions, `0_`–`2_` operators, `3_` BSON, `4_` JS globals
**Special:** Project editor → `1`/`0` only. Sort editor → `1`/`-1` only.

```
Shown categories: comparison, array, evaluation, element, logical ($not), bson, JS global
NOT shown: key-position operators ($and, $or, $nor at root)
```

### Position: OPERATOR (`{ field: { | } }`)

```
┌──────────────────────────┐
│ { age: { |  } }          │   ← cursor inside operator object
└──────────────────────────┘
```

**Shows:** Field-level operators only (braces stripped)
**Sort:** `0_` type-relevant, `1a_` comparison, `1b_` other universal, `2_` non-matching
**Snippets:** Outer `{ }` stripped

```
Shown categories: comparison, array, evaluation, element, logical ($not)
NOT shown: bson, JS global, key-position operators
```

### Position: ARRAY-ELEMENT (`{ $and: [|] }`)

**Shows:** Same as KEY position
**Sort:** Same as KEY position

### Position: UNKNOWN (genuinely ambiguous)

**Shows:** ALL completions (fields + all operators + BSON + JS globals)
**Purpose:** Discovery fallback for positions the parser can't classify

```
Shown: everything — logical, comparison, array, evaluation, element, bson, JS global
```

## Sort Order Contract

Each position has a defined sort prefix hierarchy. Items with lower prefixes
appear higher in the completion list.

| Position | Sort hierarchy |
|----------|---------------|
| EMPTY | `0_` fields → `1_` key operators |
| KEY | `0_` fields → `1_` key operators |
| VALUE | `00_` type suggestions → `0_`–`2_` operators → `3_` BSON → `4_` JS globals |
| OPERATOR | `0_` type-relevant → `1a_` comparison → `1b_` universal → `2_` non-matching |
| ARRAY-ELEMENT | same as KEY |
| UNKNOWN | no enforced sort (Monaco default) |
