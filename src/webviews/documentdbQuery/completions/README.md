# Completions Module

Context-sensitive completion items for the `documentdb-query` Monaco language.

## Architecture

```
registerLanguage.ts
  └─ provideCompletionItems()
       │
       ├─ cursorContext.ts        ← detect semantic cursor position
       │
       └─ completions/
            ├─ createCompletionItems.ts   ← main entry, context routing
            ├─ mapCompletionItems.ts      ← operator/field → CompletionItem
            ├─ typeSuggestions.ts         ← type-aware value suggestions
            ├─ snippetUtils.ts           ← snippet text manipulation
            └─ completionKnowledge.ts    ← curated domain rules & constants
```

### Flow

1. Monaco calls `provideCompletionItems()` (registered in `registerLanguage.ts`)
2. `detectCursorContext()` scans backward from the cursor to determine the semantic position
3. `createCompletionItems()` routes to the appropriate builder:
   - **key / array-element / unknown** → field names + key-position operators
   - **value** → type suggestions + operators (with braces) + BSON constructors
   - **operator** → operators only (braces stripped, type-aware sorting)

## Sorting

Completion items use `sortText` prefixes so Monaco displays them in the intended order. Lower prefixes appear higher in the list.

### Value position

| Prefix | Content | Example |
|--------|---------|---------|
| `00_00` – `00_99` | Type suggestions | `true` / `false` for boolean fields |
| `0_$eq` – `2_$op` | Query operators (type-aware) | `{ $eq: … }`, `{ $gt: … }` |
| `3_ObjectId` | BSON constructors | `ObjectId(…)`, `ISODate(…)` |
| `4_Date` | JS globals | `Date`, `Math`, `RegExp`, `Infinity` |

### Key position

| Prefix | Content | Example |
|--------|---------|---------|
| `0_fieldName` | Schema field names | `age`, `name`, `_id` |
| `1_$and` | Key-position operators | `$and`, `$or`, `$nor` |

### Operator position (type-aware)

When the field's BSON type is known, operators are tiered by relevance:

| Prefix | Tier | Meaning |
|--------|------|---------|
| `0_` | Type-relevant | Operator's `applicableBsonTypes` matches the field |
| `1a_` | Comparison (universal) | `$eq`, `$ne`, `$gt`, `$in`, etc. — no type restriction, most commonly used |
| `1b_` | Other universal | Element/evaluation/geospatial operators with no type restriction |
| `2_` | Non-matching | Operator has type restrictions that don't match the field |

Within each tier, operators sort alphabetically by name (`$eq` < `$gt` < `$in`).

**Example — boolean field `isActive`:**
- Tier `1a_`: `$eq`, `$gt`, `$gte`, `$in`, `$lt`, `$lte`, `$ne`, `$nin` (comparison)
- Tier `1b_`: `$exists`, `$type`, `$mod`, `$expr`, `$jsonSchema` (other universal)
- Tier `2_`: `$regex` (string-only), `$elemMatch` (array-only), `$bitsAllSet` (int/long-only)

### Decision matrix

```
Has field type info?
├─ NO  → no sortText override (Monaco default alphabetical)
├─ YES
│   ├─ Operator has applicableBsonTypes matching field? → "0_"
│   ├─ Operator has no applicableBsonTypes?
│   │   ├─ Is comparison operator (meta = query:comparison)? → "1a_"
│   │   └─ Other category? → "1b_"
│   └─ Operator has applicableBsonTypes NOT matching field? → "2_"
```

## Key concepts

### `completionKnowledge.ts`

Curated domain rules that go beyond the auto-generated operator registry in `documentdb-constants`. Contains:

- **`KEY_POSITION_OPERATORS`** — operators valid only at query root level (`$and`, `$or`, etc.)
- **`LABEL_PLACEHOLDER`** — the `…` character used in display labels
- **`INFO_INDICATOR`** — the `ℹ` character prepended to example descriptions

### Snippet handling

Operator snippets in `documentdb-constants` include outer braces: `{ $gt: ${1:value} }`.

- **Value position**: inserted as-is (user is replacing the entire value)
- **Operator position**: outer `{ }` stripped via `stripOuterBraces()` (user is already inside braces)
- **Key position**: outer `{ }` stripped (user is already inside the query object)
- **`$` escaping**: `escapeSnippetDollars()` prevents Monaco from treating `$gt` as a variable reference
