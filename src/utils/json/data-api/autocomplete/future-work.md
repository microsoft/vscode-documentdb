# Autocomplete — Future Work

Outstanding TODOs flagged in code during the schema transformer implementation (PR #506).
These must be resolved before the completion providers ship to users.

---

## ~~1. `SPECIAL_CHARS_PATTERN` is incomplete + `insertText` quoting doesn't escape~~ ✅ RESOLVED

**Resolved in:** PR #506 (commit addressing copilot review comment)

Replaced `SPECIAL_CHARS_PATTERN` with `JS_IDENTIFIER_PATTERN` — a proper identifier validity check.
Added `\` → `\\` and `"` → `\"` escaping when quoting `insertText`.
Tests cover dashes, brackets, digits, embedded quotes, and backslashes.

---

## 2. `referenceText` is invalid MQL for special field names

**Severity:** Medium — will generate broken aggregation expressions
**File:** `toFieldCompletionItems.ts` — `referenceText` construction
**When to fix:** Before the aggregation completion provider is wired up

### Problem

`referenceText` is always `$${entry.path}` (e.g., `$address.city`). In MQL, the `$field.path` syntax only works when every segment is a valid identifier without dots, spaces, or `$`. For field names like `order-items`, `a.b`, or `my field`, the `$` prefix syntax produces invalid references.

### Examples

| Field name          | Current `referenceText` | Valid?         | Correct MQL                          |
| ------------------- | ----------------------- | -------------- | ------------------------------------ |
| `age`               | `$age`                  | ✅             | `$age`                               |
| `address.city`      | `$address.city`         | ✅ (nested)    | `$address.city`                      |
| `order-items`       | `$order-items`          | ❌             | `{ $getField: "order-items" }`       |
| `a.b` (literal dot) | `$a.b`                  | ❌ (ambiguous) | `{ $getField: { $literal: "a.b" } }` |
| `my field`          | `$my field`             | ❌             | `{ $getField: "my field" }`          |

### Proposed approaches

**Option A — Make `referenceText` optional:** Return `undefined` for fields that can't use `$`-prefix syntax. The completion provider would omit the reference suggestion for those fields.

**Option B — Use `$getField` for special names:**

```typescript
referenceText: needsQuoting
    ? `{ $getField: "${escaped}" }`
    : `$${entry.path}`,
```

**Option C — Provide both forms:** Add a `referenceTextRaw` (always `$path`) and `referenceTextSafe` (uses `$getField` when needed). Let the completion provider choose based on context.

**Recommendation:** Option B is pragmatic. Option C is more flexible if we later need to support both forms in different contexts (e.g., `$match` vs `$project`).

---

## 3. `FieldEntry.path` dot-concatenation is ambiguous for literal dots

**Severity:** Low (rare in practice) — fields with literal dots were prohibited before MongoDB API 3.6
**File:** `getKnownFields.ts` — path concatenation at `path: \`${path}.${childName}\``**When to fix:** When we encounter real-world schemas with literal dots, or during the next`FieldEntry` interface revision

### Problem

Paths are built by concatenating segments with `.` as separator. A root-level field named `"a.b"` produces `path: "a.b"`, which is indistinguishable from a nested field `{ a: { b: ... } }`.

This ambiguity flows downstream to all consumers: `toTypeScriptDefinition`, `toFieldCompletionItems`, `generateDescriptions`, and any future completion provider.

### Examples

| Document shape        | Resulting `path` | Ambiguous?                    |
| --------------------- | ---------------- | ----------------------------- |
| `{ a: { b: 1 } }`     | `"a.b"`          | —                             |
| `{ "a.b": 1 }`        | `"a.b"`          | ✅ Same as above              |
| `{ x: { "y.z": 1 } }` | `"x.y.z"`        | ✅ Looks like 3-level nesting |

### Proposed fix

Change `FieldEntry.path` from `string` to `string[]` (segment array):

```typescript
// Before
interface FieldEntry {
    path: string;        // "address.city"
    ...
}

// After
interface FieldEntry {
    path: string[];      // ["address", "city"]
    ...
}
```

Each consumer then formats the path for its own context:

- **TypeScript definitions:** Already use schema `properties` keys directly (no change needed there)
- **Completion items:** `entry.path.join('.')` for display, bracket notation for special segments
- **Aggregation references:** `$` + segments joined with `.`, or `$getField` chains for special segments

### Impact

This is a **breaking change** to the `FieldEntry` interface. Affected consumers:

- `toFieldCompletionItems.ts`
- `toTypeScriptDefinition.ts` (indirect — uses schema, not FieldEntry paths)
- `generateDescriptions.ts` (uses schema, not FieldEntry paths)
- `collectionViewRouter.ts` (imports `FieldEntry` type)
- `ClusterSession.ts` (imports `FieldEntry` type)
- `generateMongoFindJsonSchema.ts` (imports `FieldEntry` type)
- `SchemaAnalyzer.ts` (returns `FieldEntry[]` via `getKnownFields`)

**Recommendation:** Defer until the completion provider is built. The ambiguity only matters for fields with literal dots, which are uncommon. When fixing, do it as a single atomic change across all consumers.

---

## 4. TypeScript definition output references undeclared BSON type names

**Severity:** Low — the TS definition is for display/hover only, not compiled or type-checked
**File:** `toTypeScriptDefinition.ts` — `bsonToTypeScriptMap`
**When to fix:** Before the TS definition is used in a context where type correctness matters (e.g., Monaco intellisense with an actual TS language service)

### Problem

The BSON-to-TypeScript type mapping emits non-built-in type names such as `ObjectId`, `Binary`, `Timestamp`, `MinKey`, `MaxKey`, `Code`, `DBRef`, and `UUID`. These are MongoDB API BSON driver types, but the generated definition string doesn't include `import` statements or `declare` stubs for them.

If the output is ever fed to a TypeScript compiler or language service (e.g., Monaco with full TS checking), it will report "Cannot find name 'ObjectId'" etc.

### Current state

The generated output is used for documentation/hover display only — it's rendered as syntax-highlighted text, not compiled. So this is purely cosmetic today.

### Proposed fix (when needed)

**Option A — Emit `import type`:**

```typescript
import type { ObjectId, Binary, Timestamp, MinKey, MaxKey, Code, DBRef, UUID } from 'mongodb';
```

Only include types that actually appear in the schema.

**Option B — Emit `declare type` stubs:**

```typescript
declare type ObjectId = { toString(): string };
declare type Binary = { length(): number };
// ... etc.
```

Lightweight, no dependency on the `mongodb` package.

**Option C — Map everything to primitive types:**

```typescript
ObjectId → string  // (its string representation)
Binary → Uint8Array
Timestamp → { t: number; i: number }
```

Loses semantic precision but avoids the undeclared-type problem entirely.

**Recommendation:** Option A is the most correct approach. Collect the set of non-built-in types actually used in the schema, then prepend a single `import type` line. Defer until the output is consumed by a real TS language service.
