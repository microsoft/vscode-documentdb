# Feature knowledge base

> How the features in this extension were designed, and **why**. One folder per area, with the
> decisions and the rejected alternatives kept next to the design they explain.

Much of what is here is written by AI under human supervision. The prose is not the durable value —
the recorded **operator decisions and their reasoning** are. When you read a document, the thing
worth extracting is what was chosen, what was rejected, and why.

## Authority

| Source                           | Authoritative for                        | Not authoritative for                          |
| -------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Code and tests                   | actual behavior                          | why it is like this                            |
| Area root files (`design.md`, …) | intent, architecture, constraints        | exact current behavior                         |
| `decisions.md` (active entries)  | why a choice was made, what was rejected | whether it is still in force — check the table |
| `areas/*/iterations/**`          | what was believed at that date           | anything today                                 |

On conflict, **the code wins for behavior and the active docs win for intent**. Do not silently pick
one: name the document and the code, report the mismatch, and offer to correct the document. Never
treat `status: historical` or `status: superseded` as current.

## Areas

| Area                                                             | What it covers                                                                            | Status            |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| [local-quickstart](./areas/local-quickstart/README.md)           | Run DocumentDB locally in one click: Docker provisioning, readiness, lifecycle             | shipped 0.10.0    |
| [query-insights](./areas/query-insights/README.md)               | Query performance rating, static analysis, and streaming AI recommendations                | shipped           |
| [interactive-shell](./areas/interactive-shell/README.md)         | The in-terminal REPL, its runtime, completions, and highlighting                           | shipped           |
| [query-playground](./areas/query-playground/README.md)           | `.documentdb` files, persistent worker evaluation, per-document connections                | shipped           |
| [completions-and-schema](./areas/completions-and-schema/README.md) | Operator registry, schema analyzer, and the shared completion layer                        | shipped           |
| [index-management](./areas/index-management/README.md)           | The Indexes tab, the create drawer, and the Collection View chrome redesign                | shipped           |
| [atlas-discovery](./areas/atlas-discovery/README.md)             | MongoDB Atlas discovery: Admin API auth, discovery tree, credentials                       | shipped           |
| [kubernetes-discovery](./areas/kubernetes-discovery/README.md)   | Kubernetes service discovery and connect-time reachability providers                       | shipped           |
| [webview-ext-package](./areas/webview-ext-package/README.md)     | `@microsoft/vscode-ext-webview`: the extracted webview transport package                   | published preview |
| [connections-tree](./areas/connections-tree/README.md)           | The Connections view: node item counts, connection load performance                        | shipped           |
| [no-auth](./areas/no-auth/README.md)                             | Credential-free connections and connection-string TLS handling                             | shipped           |

Two buckets sit beside the areas:

- **[cross-cutting/](./cross-cutting/)** — documents that genuinely govern several areas: the
  [query surfaces roadmap](./cross-cutting/query-surfaces-roadmap.md) that ties the shell,
  playground, and completion work together, the
  [cross-feature navigation links](./cross-cutting/cross-feature-links.md), and the user-facing
  [multi-connection behavior](./cross-cutting/multi-connection-behavior.md).
- **[practices/](./practices/)** — reusable contributor procedures rather than area history:
  [live webview preview with Playwright](./practices/live-preview-playwright.md) and the
  [webview package migration manual](./practices/webview-ext-migration-manual.md).

## How an area is laid out

```
areas/<name>/
├── README.md      # purpose, code map, architecture, timeline, decisions index, open gaps
├── decisions.md   # status table + numbered entries, where the area has one
├── design.md      # durable design, plus any other durable docs, flat
├── future-work.md # deferred items
└── iterations/    # history: one file per round of work, or a folder when it grew past ~3 documents
```

The rules, in full:

1. An area folder is the unit. PRs are iterations inside it.
2. One file per iteration. Make it a folder only when it gets unwieldy (~3+ documents, or a merge
   that would exceed ~1000 lines).
3. One `decisions.md` per area. Append entries; update status in place.
4. Durable docs sit flat at the area root. `iterations/` is the only subfolder.
5. More than ~6 root files is a smell — consider splitting the area.
6. Frontmatter: `area`, `kind`, `status` required. Everything else optional.
7. Code wins for behavior. Active docs win for intent. `iterations/` is evidence only.
8. Agents: start at this README; pull history only for specific provenance. No bulk-loading.

`archive` is a **status**, not a location — supersede a document in place rather than moving it.

## Frontmatter

Required: `area`, `kind`, `status`. Optional and worth adding: `prs`, `created`, `verified`,
`superseded-by`, and `code`.

```yaml
---
area: local-quickstart
kind: design # design | decisions | iteration | review | ux-review | research | checklist | practice | plan | notes
status: active # active | historical | superseded
prs: [798, 876]
created: 2026-08-04
verified: 2026-08-13 # absent means unverified; this is not a promise of currency
code:
    - src/commands/localQuickstart/**
---
```

`code` is the highest-leverage optional field: it is the only route from a source path back to the
rationale behind it.

## Where the boundaries are

| Need                              | Go to                                        |
| --------------------------------- | -------------------------------------------- |
| How do I use this feature?        | [docs/user-manual/](../user-manual/)         |
| What rule must I follow while coding? | [.github/skills/](../../.github/skills/) |
| Why is it like this?              | here                                         |

Current design and architecture stay here rather than moving into `.github/skills/`, because skill
descriptions cost context on every agent request and that budget is reserved for rules needed
frequently.

## A note on old links

The 2026-08 restructure replaced PR-keyed folders (`docs/ai-and-plans/PRs/<pr-number>-slug/`) with
area folders. **Deep links from existing GitHub PR comments into the old paths are broken.**
Compatibility stubs were considered and rejected as worse than the breakage. To find the documents
for a given PR, use the timeline table in the relevant area README, `git log --follow`, or GitHub
search. PR numbers remain recorded in each document's `prs` frontmatter as provenance; they are no
longer the navigation key.

The reasoning behind the structure, the alternatives that were rejected, and the migration itself are
recorded in [documentation-restructure-plan.md](./documentation-restructure-plan.md).
