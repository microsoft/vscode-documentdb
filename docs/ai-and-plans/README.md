# Feature knowledge base

> How the features in this extension were designed, and **why**. One folder per feature, with the
> decisions and the rejected alternatives kept next to the design they explain.

Much of what is here is written by AI under human supervision. The prose is not the durable value —
the recorded **operator decisions and their reasoning** are. When you read a document, the thing
worth extracting is what was chosen, what was rejected, and why.

## Authority

| Source                              | Authoritative for                        | Not authoritative for                          |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Code and tests                      | actual behavior                          | why it is like this                            |
| Feature root files (`design.md`, …) | intent, architecture, constraints        | exact current behavior                         |
| `decisions.md` (active entries)     | why a choice was made, what was rejected | whether it is still in force — check the table |
| `features/*/iterations/**`          | what was believed at that date           | anything today                                 |

On conflict, **the code wins for behavior and the active docs win for intent**. Do not silently pick
one: name the document and the code, report the mismatch, and offer to correct the document. Never
treat `status: historical` or `status: superseded` as current.

## Features

| Feature                                                                   | What it covers                                                                                  | Status            |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------- |
| [local-quickstart](./features/local-quickstart/README.md)                 | Run DocumentDB locally in one click: Docker provisioning, readiness, lifecycle                  | shipped 0.10.0    |
| [query-insights](./features/query-insights/README.md)                     | Query performance rating, static analysis, and streaming AI recommendations                     | shipped           |
| [interactive-shell](./features/interactive-shell/README.md)               | The in-terminal REPL, its runtime, completions, and highlighting                                | shipped           |
| [query-playground](./features/query-playground/README.md)                 | `.documentdb` files, persistent worker evaluation, per-document connections                     | shipped           |
| [completions-and-schema](./features/completions-and-schema/README.md)     | Operator registry, schema analyzer, and the shared completion layer                             | shipped           |
| [index-management](./features/index-management/README.md)                 | The Indexes tab, the create drawer, and the Collection View chrome redesign                     | shipped           |
| [atlas-discovery](./features/atlas-discovery/README.md)                   | MongoDB Atlas discovery: Admin API auth, discovery tree, credentials                            | shipped           |
| [kubernetes-discovery](./features/kubernetes-discovery/README.md)         | Kubernetes service discovery and connect-time reachability providers                            | shipped           |
| [webview-ext-package](./features/webview-ext-package/README.md)           | `@microsoft/vscode-ext-webview`: the extracted webview transport package                        | published preview |
| [webview-fluentui-package](./features/webview-fluentui-package/README.md) | `@microsoft/vscode-ext-webview-fluentui`: Fluent theming for webviews, plus optional components | workspace-only    |
| [connections-tree](./features/connections-tree/README.md)                 | The Connections view: node item counts, connection load performance                             | shipped           |
| [no-auth](./features/no-auth/README.md)                                   | Credential-free connections and connection-string TLS handling                                  | shipped           |

Everything else is a single file at this root, such as:

- **[live-preview-playwright.md](./live-preview-playwright.md)** — how to render a production
  webview in a plain browser and drive it with Playwright, asserting layout, accessibility, and
  overflow without launching an extension host. It belongs to no feature; it was written after the
  Local Quick Start redesign, where the technique caught real defects. The document describes
  itself as a skill candidate — promoting it into `.github/skills/` is a separate decision.

There is no bucket folder for these. See the placement rule below.

## How a feature is laid out

```
features/<name>/
├── README.md      # purpose, code map, architecture, timeline, decisions index, open gaps
├── decisions.md   # status table + numbered entries, where the feature has one
├── design.md      # durable design, plus any other durable docs, flat
├── future-work.md # deferred items
└── iterations/    # history: one file per round of work, or a folder past ~3 documents
```

The rules, in full:

1. A feature folder is the unit. PRs are iterations inside it.
2. One file per iteration. Two documents for one iteration share the iteration number and are
   told apart by a genre suffix (`01-item-counting-tree.md` + `01-item-counting-tree-review.md`);
   they sort adjacently and need no folder. Promote to a folder only at three or more documents.
3. One `decisions.md` per feature. Append entries; update status in place.
4. Durable docs sit flat at the feature root. `iterations/` is the only subfolder.
5. More than ~6 root files is a smell — consider splitting the feature.
6. Frontmatter: `feature`, `kind`, `status` required for documents under `features/`.
   Root-level documents carry `kind` and `status` only.
7. Code wins for behavior. Active docs win for intent. `iterations/` is evidence only.
8. Agents: start at this README; pull history only for specific provenance. No bulk-loading.

`archive` is a **status**, not a location — supersede a document in place rather than moving it.

## What goes inside an iteration document

An iteration file is written before the work, and **kept up to date during it**.

- **Record progress inline, against the work item it belongs to.** Not in a work-log chapter and
  not in a summary table at the end. Someone reading the plan should meet what happened to an item
  at the point that item is defined, without holding it in their head until the last page.
- **Write the note when the item is committed**, not at the end. Name the commit that carries it,
  what landed, and why. Reconstructing later only works while the session that did the work is
  still open.
- **A deviation records the alternatives considered and why each was rejected.** The option that
  shipped is already in the code; the rejected ones exist nowhere else.
- **Do not rewrite the plan to match what happened.** Add to it. That the plan and reality differed
  is the part worth keeping.
- **An `# Outcome` chapter at hand-over** states what was verified and, just as plainly, what was
  not.

Template and reasoning:
[documentation-restructure-plan.md §6.5](./documentation-restructure-plan.md).

## Frontmatter

Required: `feature`, `kind`, `status` for anything under `features/`. Root-level documents carry
`kind` and `status` only — there is no `feature: general` value. Optional and worth adding: `prs`,
`created`, `verified`, `superseded-by`, and `code`.

```yaml
---
feature: local-quickstart
kind: design # design | decisions | iteration | review | ux-review | research | checklist | practice | plan | notes
status: active # active | historical | superseded
prs: [798, 876]
created: 2026-08-04
verified: 2026-08-13 # absent means unverified; this is not a promise of currency
code:
  - src/commands/localQuickStart/**
  - src/services/localQuickStart/**
---
```

`code` is the highest-leverage optional field: it is the only route from a source path back to the
rationale behind it. Every glob must resolve against the repository — one that matches nothing is
worse than an absent field, because it fails silently and still looks authoritative.

## Where the boundaries are

| Need                                  | Go to                                    |
| ------------------------------------- | ---------------------------------------- |
| How do I use this feature?            | [docs/user-manual/](../user-manual/)     |
| What rule must I follow while coding? | [.github/skills/](../../.github/skills/) |
| Why is it like this?                  | here                                     |

Current design and architecture stay here rather than moving into `.github/skills/`, because skill
descriptions cost context on every agent request and that budget is reserved for rules needed
frequently.

## A note on old links

The 2026-08 restructure replaced PR-keyed folders (`docs/ai-and-plans/PRs/<pr-number>-slug/`) with
feature folders. **Deep links from existing GitHub PR comments into the old paths are broken.**
Compatibility stubs were considered and rejected as worse than the breakage. To find the documents
for a given PR, use the timeline table in the relevant feature README, `git log --follow`, or GitHub
search. PR numbers remain recorded in each document's `prs` frontmatter as provenance; they are no
longer the navigation key.

The reasoning behind the structure, the alternatives that were rejected, and the migration itself are
recorded in [documentation-restructure-plan.md](./documentation-restructure-plan.md).
