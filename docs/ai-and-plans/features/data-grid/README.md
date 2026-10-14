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

The current table and tree use SlickGrid. Modernization deliberately kept that implementation while
moving the webviews to Vite and the tests to Vitest. SlickGrid now has its own lazy JavaScript chunk,
which gives the replacement iteration a size baseline without mixing two changes in Collection View.

The replacement iteration will first make host-side result shapes grid-neutral, define an internal
table and tree interface, and capture current behavior in Vitest and browser fixtures. Candidate
grids are evaluated only after those contracts exist. The final choice must preserve selection,
step-in behavior, BSON type display, tree expansion, keyboard use, virtualization, resizing, and
loading behavior.

## Plan

See [slickgrid-removal.md](./slickgrid-removal.md) for the measured footprint, behavior contract,
candidate directions, sequential gates, and explicit non-scope. The build rationale for the current
SlickGrid chunk is in the
[build-and-test-stack design](../build-and-test-stack/design.md#code-splitting-groups-run-from-most-shared-to-least-shared).
