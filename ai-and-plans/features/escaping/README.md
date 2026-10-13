---
feature: escaping
kind: notes
status: active
created: 2026-10-09
verified: 2026-10-09
code:
  - src/tree/documentdb/IndexItem.ts
  - src/tree/documentdb/CollectionItem.ts
  - src/documentdb/query-language/playground-completions/PlaygroundHoverProvider.ts
  - src/webviews/query-language-support/documentdbQueryHoverProvider.ts
  - src/webviews/query-language-support/completions/mapCompletionItems.ts
  - src/webviews/utils/escapeMarkdown.ts
---

# Escaping

**Status:** active · **Verified:** 2026-10-09

How user-controlled and database-derived content is rendered safely in Markdown tooltips and
documentation, and which Markdown capabilities those surfaces enable. This area starts with
Markdown tooltips and can grow to cover other rendering surfaces; it does not claim the whole
extension has been audited.

## Code map

- `src/webviews/utils/escapeMarkdown.ts` — `escapeMarkdown` for literal text and
  `formatInlineCode` for code spans that cannot be broken out of
- `src/tree/documentdb/IndexItem.ts` — index tooltip (names, statuses, keys, definitions)
- `src/tree/documentdb/CollectionItem.ts` — collection tooltip (names, shard keys)
- Operator documentation surfaces: `PlaygroundHoverProvider.ts`, `documentdbQueryHoverProvider.ts`,
  `mapCompletionItems.ts`

## Agreed Intent

- **Least privilege.** Markdown surfaces do not enable command trust (`isTrusted`), HTML, or theme
  icons unless their own authored content needs it. None of the current surfaces need command links.
- **Escape at the point of insertion.** Database and user values are escaped where they enter
  Markdown text, using the right form for the context: `escapeMarkdown` for prose,
  `formatInlineCode` for inline code, and JSON code blocks for structured values. Whole
  documents are never blanket-escaped.
- **`escapeMarkdown` also escapes `:`**, so a bare `https://…` value renders as text instead of a
  GFM autolink.
- **Authored documentation keeps its Markdown.** Operator documentation keeps its HTML setting and
  its HTTP(S) documentation links, which work without command trust in both Monaco and VS Code.
- **Command links need a new decision.** If a later feature needs them, evaluate an explicit
  command allow-list with safe arguments. An allow-list does not replace escaping.

## Iterations

| Iteration                                                                              | Scope                                                                               | Status                                                                        |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [01 - Markdown tooltip trust and index metadata](./iterations/01-markdown-tooltips.md) | Index and shard-key escaping, trust/HTML/icon settings, documentation-link coverage | Implemented; reviewed ([review](./iterations/01-markdown-tooltips-review.md)) |
