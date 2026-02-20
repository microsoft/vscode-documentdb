# Scripts

Helper scripts for maintaining the `@vscode-documentdb/documentdb-constants` package.

## scrape-operator-docs.ts

Scrapes the DocumentDB compatibility page and per-operator documentation to produce `resources/operator-reference-scraped.md`.

```bash
npm run scrape
```

**When to run:** When the upstream DocumentDB documentation changes (new operators, updated descriptions, etc.). This is infrequent — typically once per DocumentDB release.

**Output:** `resources/operator-reference-scraped.md` — a machine-generated Markdown dump of all supported operators, their descriptions, syntax blocks, and doc links.

## generate-from-reference.ts

Reads the scraped dump and the hand-maintained overrides file, then generates the TypeScript operator data files in `src/`.

```bash
npm run generate
```

**When to run:**

- After running the scraper (`npm run scrape`)
- After editing `resources/operator-reference-overrides.md`

**Inputs:**

| File                                        | Purpose                            |
| ------------------------------------------- | ---------------------------------- |
| `resources/operator-reference-scraped.md`   | Primary data (machine-generated)   |
| `resources/operator-reference-overrides.md` | Manual overrides (hand-maintained) |

**Outputs:** Seven TypeScript files in `src/`:

- `queryOperators.ts` — comparison, logical, element, evaluation, geospatial, array, bitwise, projection, misc query operators
- `updateOperators.ts` — field, array, and bitwise update operators
- `expressionOperators.ts` — arithmetic, array, bitwise, boolean, comparison, conditional, data-size, date, literal, misc, object, set, string, timestamp, trig, type, and variable expression operators
- `accumulators.ts` — group and other-stage accumulators
- `windowOperators.ts` — window function operators
- `stages.ts` — aggregation pipeline stages
- `systemVariables.ts` — system variables (`$$NOW`, `$$ROOT`, etc.)

> **Do not edit the generated `src/` files by hand.** Put corrections in `resources/operator-reference-overrides.md` instead. The generated files contain a header warning to this effect.

## evaluate-overrides.ts

Evaluates the relationship between scraped data and manual overrides. Produces a color-coded report.

```bash
npm run evaluate
```

**When to run:**

- After re-scraping (`npm run scrape`) to see if previously-missing descriptions are now available
- Periodically, to check coverage and detect redundant overrides

**Report sections:**

1. **GAPS** — operators with empty scraped descriptions and no override (need attention)
2. **POTENTIALLY REDUNDANT** — operators that have **both** a scraped description and an override description; the override may no longer be needed
3. **ACTIVE OVERRIDES** — overrides filling real gaps, with both override and scraped values shown
4. **SUMMARY** — total counts and coverage percentage

## Workflow

```
  ┌──────────────────────┐
  │  Upstream docs change │
  └──────────┬───────────┘
             ▼
      npm run scrape
             │
             ▼
  operator-reference-scraped.md
             │
             ├──── npm run evaluate  (check gaps & redundant overrides)
             │
             ├──── operator-reference-overrides.md (manual)
             │
             ▼
     npm run generate
             │
             ▼
    src/*.ts (generated)
             │
             ▼
      npm run build
```
