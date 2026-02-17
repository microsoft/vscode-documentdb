# Autocomplete — Future Work

Outstanding TODOs flagged in code during the schema transformer implementation (PR #506).
These must be resolved before the completion providers ship to users.

---

## 1. `SPECIAL_CHARS_PATTERN` is incomplete + `insertText` quoting doesn't escape

**Severity:** Medium — will produce broken query expressions for real-world field names
**File:** `toFieldCompletionItems.ts` — `SPECIAL_CHARS_PATTERN` and `insertText` construction
**When to fix:** Before the `CompletionItemProvider` is wired up

### Problem

`SPECIAL_CHARS_PATTERN` (`/[.$\s]/`) only catches dots, `$`, and whitespace. MongoDB field names can also contain:

| Character        | Example field name | Current behavior                                |
| ---------------- | ------------------ | ----------------------------------------------- |
| Dash `-`         | `order-items`      | Inserted unquoted → breaks JSON key context     |
| Brackets `[]`    | `items[0]`         | Inserted unquoted                               |
| Double quote `"` | `say"hi"`          | Wrapped as `"say"hi""` → broken string          |
| Single quote `'` | `it's`             | Inserted unquoted (may break some contexts)     |
| Backslash `\`    | `back\slash`       | Wrapped as `"back\slash"` → unescaped backslash |

Additionally, when quoting _is_ triggered, the current logic (`"${entry.path}"`) does not escape embedded `"` or `\` inside the value.

### Proposed fix

1. Replace `SPECIAL_CHARS_PATTERN` with an identifier check (same as `safePropertyName` in `toTypeScriptDefinition.ts`):
   ```typescript
   const JS_IDENTIFIER = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
   const needsQuoting = !JS_IDENTIFIER.test(entry.path);
   ```
2. When quoting, escape the content:
   ```typescript
   const escaped = entry.path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
   insertText: needsQuoting ? `"${escaped}"` : entry.path,
   ```

### Note on display vs insert

The `fieldName` property intentionally stays unescaped (human-readable) for the completion list label. Only `insertText` gets escaped — this is by design, so users see clean names in the dropdown and the escaped form is inserted on selection.

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

**Severity:** Low (rare in practice) — fields with literal dots were prohibited before MongoDB 3.6
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
