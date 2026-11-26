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

- [Migration report](./migration-research.md): the Cosmos DB migration PR, subsequent fixes and
  feature integrations, gains/losses, and recommended direction.
- [No-loss contract](./migration-parity.md): current DocumentDB behavior, especially object
  step-in, BSON type indicators, selection/document actions, paging and the tree.
- [SlickGrid update assessment](./slickgrid-update-assessment.md): relevant accessibility and
  resizing changes shipped since our pinned 9.13.0, through 11.0.0.
- [React Data Grid capabilities](./react-data-grid-capabilities.md): current releases, cheap
  additions, integration costs and runtime/API caveats.

The recommendation is to evaluate `react-data-grid` with a deliberate tree implementation, not
to drop tree or BSON behavior. The final library/version/tree decision is not yet approved.
Cosmos DB currently pins beta.61; the upstream latest is beta.64, so partner experience is not
proof of compatibility with the newest beta.

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

See [slickgrid-removal.md](./slickgrid-removal.md) for the earlier footprint snapshot,
candidate directions, sequential gates, and explicit non-scope. Use the newer research and parity
checklist above for current upstream facts and the expanded behavior inventory. The build rationale for the current
SlickGrid chunk is in the
[build-and-test-stack design](../build-and-test-stack/design.md#code-splitting-groups-run-from-most-shared-to-least-shared).
