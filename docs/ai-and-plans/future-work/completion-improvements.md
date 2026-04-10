# Future Work: Completion & IntelliSense Improvements

> Enhancements to the autocompletion and IntelliSense system across all editor surfaces.

---

## SignatureHelpProvider for BSON Constructors

**Priority:** P2 | **Impact:** Medium | **Effort:** 0.5 day

Shows parameter hints when typing inside BSON constructor calls — e.g., `ObjectId(│hex string│)`, `NumberDecimal(│value│)`. The metadata is already available in `OperatorEntry.snippet` tab stops.

---

## CodeActionProvider with Quick-Fixes

**Priority:** P2 | **Impact:** Medium | **Effort:** 0.5 day

Quick-fix actions for near-miss warnings from the `acorn` validator. When "Did you mean 'Date'?" appears for `Daate.now()`, clicking the lightbulb applies the replacement.

---

## Dynamic `.d.ts` Per-Collection Types

**Priority:** P3 | **Impact:** Medium | **Effort:** 2–3 days

Generate per-collection TypeScript interfaces from `SchemaStore` so the TS plugin knows that `db.users.find({ name: ... })` has a `name` field of type `string`. Uses existing `toTypeScriptDefinition()`.

---

## Field Statistics in Completion Items

**Priority:** P3 | **Impact:** Medium-High | **Effort:** 1 day

Show rich field statistics in completion detail: `"Number · 98% · range 17–82"` instead of just `"Number"`. Data already exists in `SchemaAnalyzer`'s `x-occurrence`, `x-minValue`, `x-maxValue` extensions.

---

## TS Language Service for Collection View Monaco Editors

**Priority:** P3 | **Impact:** Medium | **Effort:** 2–3 days

Load the shell API `.d.ts` plus per-collection schema `.d.ts` into Monaco's TS worker via `addExtraLib()` for the collection view query editors. Provides hover docs, type inference, and richer completions beyond static constant lists.

---

## Backward Scanner String Literal Boundaries

**Priority:** P3 | **Impact:** Low | **Effort:** 0.5 day

The `cursorContext.ts` backward scanner doesn't track whether characters are inside quoted strings. A structural character inside a string literal like `{ msg: "{", ▌ }` causes misclassification. Currently degrades gracefully to "unknown" context.

---

## Deep Nesting Context Detection

**Priority:** P3 | **Impact:** Low | **Effort:** 1 day

The cursor context detector handles 2–3 levels of nesting reliably but may misclassify at deeper levels. Currently falls back to "show everything" — acceptable degradation.
