---
feature: index-management
kind: notes
status: active
prs: [732]
verified: 2026-08-14
code:
    - src/webviews/documentdb/collectionView/indexesTab/**
    - src/commands/index.dropIndex/**
    - src/commands/index.hideIndex/**
    - src/commands/index.unhideIndex/**
    - src/commands/index.shared/**
---

# Index Management

**Status:** shipped · **Verified:** 2026-08-14

> What the Indexes tab does, what was tried and abandoned on the way, and where each review finding
> was resolved.

Index Management is the **Indexes** tab of the Collection View: an index list with metrics, a create
drawer covering standard, wildcard, and vector indexes, advanced editors, confirmations, row status,
and previews. It arrived together with a Collection View chrome redesign, because a per-tab action
bar was the prerequisite for adding a second heavyweight tab at all.

## Code map

- `src/webviews/documentdb/collectionView/indexesTab/**` — the tab, index list, create drawer
- `src/commands/index.*/**` — drop, hide, and unhide index commands and their shared pieces
- `packages/documentdb-js-operator-registry/**` — index type and property metadata consumed by the
  webview (see the scraper reference below)

## User docs

- [docs/user-manual/collection-view-index-management.md](../../../user-manual/collection-view-index-management.md)
- [docs/user-manual/collection-view-wildcard-indexes.md](../../../user-manual/collection-view-wildcard-indexes.md)
- [docs/user-manual/collection-view-index-management-troubleshooting.md](../../../user-manual/collection-view-index-management-troubleshooting.md)

## Related skills

- [.github/skills/fluentui](../../../../.github/skills/fluentui/SKILL.md) — toolbar overflow and
  component patterns the redesign depends on
- [.github/skills/react-webview-architecture](../../../../.github/skills/react-webview-architecture/SKILL.md)

## Architecture (intent — code is authoritative for behavior)

Three durable design documents sit at this area's root. They describe intent; the code is
authoritative for current behavior.

| Document                                                               | What it covers                                                                                                                                                                                            |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [design.md](./design.md)                                               | The consolidated design log: what shipped, the **tried-and-abandoned** decisions, the dev-tooling `ResizeObserver`/CSP discovery, and follow-ups. **Start here.**                                         |
| [design-collectionview-toolbar.md](./design-collectionview-toolbar.md) | The Collection View chrome redesign: tab strip first, contextual per-tab action bar, layout and responsive plan, and the full-bleed chrome plus SCSS refactor.                                            |
| [design-vector-index-support.md](./design-vector-index-support.md)     | Wildcard and vector indexes: vector concepts, service algorithms (IVF, HNSW, DiskANN), shared settings, commands, the Vector drawer and typed model, validation rules, and the Atlas Search Index future. |

Reference material, read on demand:

| Document                                                                           | What it covers                                                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [reference-supported-indexes.md](./reference-supported-indexes.md)                 | DocumentDB-supported index types and properties, and how they map onto the extension.     |
| [reference-operator-registry-scraper.md](./reference-operator-registry-scraper.md) | The operator-registry scraper migration and the index metadata it exposes to the webview. |

## Timeline

| Date       | PR   | What changed                                    | Docs                                                                                                                             |
| ---------- | ---- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-20 | #732 | Code review, first pass                         | [code-review-2026-07-20.md](./iterations/01-index-dashboard/code-review-2026-07-20.md)                                           |
| 2026-07-22 | #732 | UX review, iterations 1–2                       | [ux-review-iteration-1-2.md](./iterations/01-index-dashboard/ux-review-iteration-1-2.md)                                         |
| 2026-07-27 | #732 | UX review, iteration 3 (create-drawer redesign) | [ux-review-iteration-3-create-index-redesign.md](./iterations/01-index-dashboard/ux-review-iteration-3-create-index-redesign.md) |
| 2026-07-27 | #732 | Code review, second pass                        | [code-review-2026-07-27.md](./iterations/01-index-dashboard/code-review-2026-07-27.md)                                           |

## Decisions

No separate `decisions.md`. The decisions and the rejected alternatives live in the design documents
themselves; the densest is the "tried and abandoned" section of
[design.md](./design.md#tried-and-abandoned-and-why).

## Finding things fast

- **Why a decision was made, and what was rejected:**
  [design.md § Tried and abandoned](./design.md#tried-and-abandoned-and-why)
- **A specific UX finding and its fix:** the priority index in
  [ux-review-iteration-1-2](./iterations/01-index-dashboard/ux-review-iteration-1-2.md#priority-index)
  (findings 1–8) or
  [ux-review-iteration-3](./iterations/01-index-dashboard/ux-review-iteration-3-create-index-redesign.md#priority-index)
  (create-drawer redesign)
- **A correctness or severity concern and its resolution:** the severity summary in
  [code-review-2026-07-20](./iterations/01-index-dashboard/code-review-2026-07-20.md#severity-summary)

## Open gaps

- Vector index open decisions:
  [design-vector-index-support.md § Open decisions](./design-vector-index-support.md#open-decisions)
- Follow-ups recorded at the end of [design.md](./design.md)

## Reading order for newcomers

1. This README
2. [design.md](./design.md)
3. [design-collectionview-toolbar.md](./design-collectionview-toolbar.md) if you are touching the
   Collection View chrome, [design-vector-index-support.md](./design-vector-index-support.md) if you
   are touching index families
