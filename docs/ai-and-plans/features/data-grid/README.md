---
feature: data-grid
kind: readme
status: planned
created: 2026-10-14
code:
  - src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx
  - src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTree.tsx
  - src/utils/slickgrid/**
  - src/webviews/utils/slickgrid/**
---

# Data grid

**Status:** planned. No shipped feature currently owns the Collection View grid as a durable design
surface, so this folder is its home.

## Migration research

Preparation for [#1101](https://github.com/microsoft/vscode-documentdb/issues/1101), researched
2026-11-26:

- [Grid evaluation](./grid-scorecard.md): **current recommendation**. Our priorities, how we
  tested while looking for a way to stay on SlickGrid (including a hands-on Narrator check of both
  grids' demos), 1–10 ratings in 15 weighted categories with accessibility as a hard gate, feature
  mapping, and how we could help SlickGrid close the gaps we found.
- [Grid options evaluation](./grid-options-evaluation.md): SlickGrid 11 versus React Data Grid
  evidence (maintainers, releases, range selection, accessibility, features); its second-pass
  SlickGrid recommendation is superseded by the scorecard.
- [Migration report](./migration-research.md): the Cosmos DB migration PR, subsequent fixes and
  feature integrations, gains/losses (its first-pass recommendation is superseded).
- [No-loss contract](./migration-parity.md): current DocumentDB behavior, especially object
  step-in, BSON type indicators, selection/document actions, paging and the tree.
- [SlickGrid update assessment](./slickgrid-update-assessment.md): relevant accessibility and
  resizing changes shipped since our pinned 9.13.0, through 11.0.0.
- [React Data Grid capabilities](./react-data-grid-capabilities.md): current releases, cheap
  additions, integration costs and runtime/API caveats.

The current recommendation is to **migrate to React Data Grid, exact-pinned to a beta**, because
accessibility (keyboard navigation in particular) is a hard requirement and RDG passes that gate on
its own foundation, while SlickGrid 11 needs our additions to reach it. Range selection with Excel
copy is buildable on RDG beta.64's public APIs without a fork (about 2–3 developer-weeks). Both
projects have one dominant maintainer; RDG has been in 7.0 pre-release since 2019, so expect to
budget for API renames on upgrades. The final decision is not yet approved; record it in
`decisions.md` once taken.

## Current architecture

The current table and tree use SlickGrid. Modernization deliberately kept that implementation while
moving the webviews to Vite and the tests to Vitest. SlickGrid now has its own lazy JavaScript chunk,
which gives the replacement iteration a size baseline without mixing two changes in Collection View.

The replacement iteration will first make host-side result shapes grid-neutral, define an internal
table and tree interface, and capture current behavior in Vitest and browser fixtures. Candidate
grids are evaluated only after those contracts exist. The final choice must preserve selection,
step-in behavior, BSON type display, tree expansion, keyboard use, virtualization, resizing, and
loading behavior.

## Plan

**Accepted plan:** [iterations/01-rdg-migration-plan.md](./iterations/01-rdg-migration-plan.md),
ordered work items for the React Data Grid migration (high level; detailed interfaces follow in the
next iteration).

See [slickgrid-removal.md](./slickgrid-removal.md) for the earlier footprint snapshot,
candidate directions, sequential gates, and explicit non-scope. Use the newer research and parity
checklist above for current upstream facts and the expanded behavior inventory. The build rationale for the current
SlickGrid chunk is in the
[build-and-test-stack design](../build-and-test-stack/design.md#code-splitting-groups-run-from-most-shared-to-least-shared).
