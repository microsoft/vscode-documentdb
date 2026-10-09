---
feature: escaping
kind: iteration
status: active
created: 2026-10-09
code:
  - src/tree/documentdb/IndexItem.ts
  - src/tree/documentdb/IndexItem.test.ts
  - src/tree/documentdb/CollectionItem.ts
  - src/webviews/utils/escapeMarkdown.ts
  - src/documentdb/query-language/playground-completions/PlaygroundHoverProvider.ts
  - src/webviews/query-language-support/documentdbQueryHoverProvider.ts
  - src/webviews/query-language-support/completions/mapCompletionItems.ts
---

# Iteration 01: Markdown Tooltips

## Starting Point

The index tree tooltip inserted database metadata into Markdown as-is and enabled command trust
and HTML. Three operator-documentation surfaces also enabled command trust, although they only
need HTTP(S) documentation links.

| Surface                                                   | Content source                                                           | Trust needed? | Escaping needed?           |
| --------------------------------------------------------- | ------------------------------------------------------------------------ | ------------- | -------------------------- |
| Index tree hover: `IndexItem.buildTooltip`                | Index names, statuses, keys, definitions, partial filters, search fields | No            | Yes, per rendering context |
| Playground operator hover: `getPlaygroundHoverContent`    | Bundled operator registry                                                | No            | Not for the authored body  |
| Webview operator hover: `getHoverContent`                 | Bundled operator registry                                                | No            | Not for the authored body  |
| Webview completion details: `mapOperatorToCompletionItem` | Bundled descriptions and documentation URLs                              | No            | Not for the authored body  |

## Decisions

- Turn off command trust on all four surfaces. HTTP(S) links do not need it in Monaco 0.52.2 or
  VS Code 1.105.0.
- Index tooltip: also turn off HTML and theme icons. No authored content uses them, and
  `$(…)` in database text would otherwise render as an icon.
- Escape dynamic text where it enters Markdown, not in the model. Stored names and tree labels
  are unchanged.
- Keep the authored documentation Markdown, its HTML setting, links, opener callbacks, and
  completion acceptance commands.
- Documentation HTML policy is out of scope for this iteration (operator decision).
- Remove the commented-out Drop/Hide/Unhide command-link block in `IndexItem`. It was the only
  reason trust appeared to be needed.

## Implementation

- `escapeMarkdown` escapes `:` as well, so bare `scheme://` URLs in database text are not
  autolinked. This applies to every caller of the shared helper.
- `formatInlineCode` (shared) chooses a delimiter longer than any backtick run in the value, pads
  the value at its boundaries as CommonMark requires, and renders multiline values as JSON
  strings. It is used for index keys, the index type badge, and collection shard keys.
- Index JSON sections (definition, partial filter, search fields) use a fixed fence. Pretty-printed
  JSON escapes newlines inside strings, so no line can start with backticks and close the block.
- The Playground hover uses the shared `escapeMarkdown` instead of a private copy.
- `IndexItem.test.ts` mocks `SchemaStore` so the suite does not load the schema-analyzer package.

## Verification

Case 1: `npm run build` and the focused Jest suites passed. New regression tests cover:

- untrusted, HTML-free, icon-free index tooltips
- escaping of link, HTML, bare-URL, and `$(…)` syntax in index metadata
- inline-code delimiting with backticks, spaces, and newlines
- JSON block integrity and round trips
- shard-key code spans
- the trust flags and preserved bodies and links of all three documentation surfaces

A real Monaco renderer test in `documentdbQueryHoverProvider.test.ts` shows that HTTP(S) links stay
and `command:` links are dropped when trust is off. It is skipped in the default Node environment
and runs with:

```bash
npx jest --no-coverage src/webviews/query-language-support/documentdbQueryHoverProvider.test.ts --env jsdom --transform '{"^.+\\.[jt]sx?$": ["@swc/jest", {"swcrc": false, "module": {"type": "commonjs"}, "jsc": {"target": "es2021", "parser": {"syntax": "typescript", "tsx": true}}}]}' --transformIgnorePatterns 'node_modules/(?!monaco-editor/)'
```

Running it in CI is planned as future work (review finding 3).

Manual checks (operator-confirmed, 2026-10-09):

| Surface                            | Check                                                        | Result                                                                    |
| ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Collection View operator hover     | Hover `$gt` in the Filter and click Documentation            | Tooltip shown; HTTPS documentation opened                                 |
| Collection View completion details | Select `$gt` in suggestions and click its documentation link | Details shown; HTTPS documentation opened                                 |
| Playground operator hover          | Hover `$gt` and click Documentation                          | Tooltip shown; HTTPS documentation opened                                 |
| Index tree hover                   | Hover an existing index                                      | Metadata readable, literal punctuation, no unintended formatting or links |
| Database-field hover               | Hover a known field in the editors                           | Inferred type shown normally                                              |

## Outcome

Implemented and reviewed. Findings and the author's decisions are recorded in
[01-markdown-tooltips-review.md](./01-markdown-tooltips-review.md).
