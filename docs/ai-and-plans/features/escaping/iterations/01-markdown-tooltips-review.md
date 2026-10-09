---
feature: escaping
kind: review
status: active
created: 2026-10-09
reviews: 01-markdown-tooltips.md
pr: 996
---

# Iteration 01 Review: Markdown Tooltips (PR #996)

Stage 1 AI review (CONTRIBUTING.md §6.1) of `dev/tnaum/tooltips-issue` against `main`, followed
by the author's decisions (§6.2) and the resulting changes (§6.3).

| Priority | Meaning                                                  |
| -------- | -------------------------------------------------------- |
| **P1**   | Resolve before the PR leaves draft                       |
| **P2**   | Fix in this PR unless the author records a reason not to |
| **P3**   | Nice to have, follow-up, or informational                |

## Summary

| #   | Priority | Area                              | Finding                                                               | Decision |
| --- | -------- | --------------------------------- | --------------------------------------------------------------------- | -------- |
| 1   | P1       | `escapeMarkdown` / `IndexItem.ts` | Bare `http(s)://` URLs in escaped metadata still autolink             | Fixed    |
| 2   | P2       | `IndexItem.ts`                    | `supportThemeIcons = true` lets database text render codicons         | Fixed    |
| 3   | P2       | Tests                             | The real-renderer regression test never runs in CI                    | Deferred |
| 4   | P3       | `IndexItem.test.ts`               | `SchemaStore` mock works around a local unbuilt workspace             | Kept     |
| 5   | P3       | `IndexItem.ts`                    | Content-sized JSON fences are unnecessary; the test pins the detail   | Fixed    |
| 6   | P3       | Follow-up                         | Shard-key code spans can break out; inline-code helpers not shareable | Fixed    |
| 7   | P3       | Docs                              | Missing trailing newlines; iteration log is mostly process narration  | Fixed    |

The four focused suites passed when the review ran (175 passed, 1 skipped). Findings 1 and 2 were
reproduced with harmless synthetic strings in the installed Monaco 0.52.2 Markdown renderer under
jsdom. VS Code's native tooltip renderer uses the same `marked`/GFM base and is expected to behave
the same.

---

## 1. [P1] Bare URLs in escaped metadata still autolink

`escapeMarkdown` escaped `[`, `]`, `(`, `)` and `.`, which stops `[text](url)` links, but GFM's
extended autolink still matched `https?://` or `ftp://`. An index named
`https://evil.example.com/login` rendered as a clickable link in the heading, and the same
happened for `status`. `www.` and email autolinks were not produced, because the escaped `.`
breaks them. Command trust is off, so this was limited to external links, but it contradicted the
stated intent that database text must not create links.

**Suggested fix:** add `:` to the `escapeMarkdown` character class. In the renderer,
`https\://evil\.example\.com/login` rendered as literal text with no anchor.

**Author decision:** fix as suggested.

**Resolution:** `escapeMarkdown` now escapes `:` for every caller of the shared helper. Tests now
cover bare `https://` and `ftp://` values in the index name and status, and the helper's own
cases. The Atlas project test was updated to expect `https\:`.

## 2. [P2] `supportThemeIcons = true` renders codicons from database text

`escapeMarkdown` does not escape `$`, and `\(`/`\)` are unescaped before icon substitution, so an
index named `$(trash) Drop $(warning)` rendered icons. The only authored `$(…)` usage was the
removed commented-out action block.

**Author decision:** set it to `false`.

**Resolution:** `IndexItem` sets `supportThemeIcons = false`. Tests assert the flag and that
`$(…)` stays literal.

## 3. [P2] The real-renderer regression test never runs in CI

The jsdom/Monaco test in `documentdbQueryHoverProvider.test.ts` is skipped in the default Node
environment that CI uses. It only runs with the one-off command recorded in the iteration doc.

**Author decision:** ignore for now. Running renderer tests in CI is planned future work.

## 4. [P3] `SchemaStore` mock in `IndexItem.test.ts`

The mock was added because the `schema-analyzer` workspace was unbuilt locally. CI builds
workspaces before Jest.

**Author decision:** ignore. The mock is harmless and keeps the suite isolated.

## 5. [P3] Content-sized JSON fences are unnecessary

Every line of `JSON.stringify(value, null, 2)` begins with optional indentation followed by a
JSON token, never a backtick, so a fixed triple fence cannot be closed early. The test asserted the
exact fence length.

**Author decision:** address it if the change is cheap and simple.

**Resolution:** `appendJsonCodeblock` now uses a fixed fence, with a comment explaining why that
is safe. The fence-length assertion was removed. The JSON round-trip and "no fence-like line"
assertions remain.

## 6. [P3] Same class of bug nearby; helpers not reusable

`CollectionItem` rendered shard keys as `` `${k}: ${valueText}` ``, so a backtick in a field name
broke out of the code span. The inline-code helper was private to `IndexItem`, and the Playground
hover had a private copy of `escapeMarkdown` that would drift.

**Author decision:** address it if the change is cheap and simple.

**Resolution:** `formatInlineCode` moved to `src/webviews/utils/escapeMarkdown.ts`. Index keys, the
index type badge, and `CollectionItem` shard keys use it. The Playground hover imports the shared
`escapeMarkdown`. The shard-key and helper cases have tests.

## 7. [P3] Documentation hygiene

The new docs lacked trailing newlines, and the iteration doc was mostly sub-agent progress
narration.

**Author decision:** address it if the change is cheap and simple.

**Resolution:** the iteration doc was condensed to the starting point, decisions, implementation,
and verification, and the README was aligned with it. Formatting is handled by `prettier-fix`.

---

## Checked and found correct

- All four `isTrusted: true` flags are now `false`. No explicit trusted Markdown remains in `src`.
  Documentation `supportHtml` settings are unchanged, and field-hover branches remain escaped and
  untrusted.
- Inline code spans follow CommonMark rules: the delimiter is longer than any internal backtick
  run, boundaries are padded where required, all-space content is left unpadded, and multiline
  values are JSON-quoted.
- The localized "cannot be copied" sentence is escaped after `l10n.t`.
- The tree label, `indexInfo`, children, and `contextValue` copyability are unchanged.
- No `TDD:` contract was modified.
