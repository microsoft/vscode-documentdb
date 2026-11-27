---
feature: data-grid
kind: readme
status: active
created: 2026-10-14
code:
  - src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx
  - src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTree.tsx
  - src/utils/documentGrid/**
  - src/documentdb/ClusterSession.ts
  - src/webviews/documentdb/collectionView/CollectionView.tsx
---

# Collection View data grid

The Table and Tree result views now use React Data Grid. The migration is implemented on the
feature branch; G2 was released on 2026-11-27, with follow-up decisions recorded in the execution
plan.
This feature folder records the current architecture and its rationale. It does not imply a
released extension version or completion of the remaining handover gates.

## Current shape

- `react-data-grid@7.0.0-beta.64` renders the Table and the application-owned document Tree.
  The independent JSON view remains separate.
- `src/utils/documentGrid/` defines grid-neutral `TablePage` and `TreeNode` shapes, BSON display
  values, and the identity helpers used by host shaping. `ClusterSession` creates those shapes;
  React components do not depend on database documents directly.
- The Table supports nested-object step-in. The Tree flattens visible descendants from an
  arbitrary-depth document model rather than using RDG's `TreeDataGrid`.
- Long Table values ellipsize without hiding the BSON type indicator or adding per-cell Tab stops.
- Row selection and document-action eligibility are separate. Rows without a safe, unique
  identity remain browsable and selectable, but cannot become View/Edit/Delete targets.

The exact VS Code support declaration is `^1.123.0` in the root `package.json` (minimum
`1.123.0`). A9's isolated VSIX install and activation on VS Code 1.123.0 passed, but did not
exercise a live Collection View. The exact stable-version Collection View interaction check and
screen-reader manual checks were not done. See the [execution plan](./iterations/02-rdg-execution-plan.md)
for A9 evidence and the remaining workbench checks.

## Code map

| Area | Source |
| --- | --- |
| Grid-neutral model and host shapers | [`types.ts`](../../../../src/utils/documentGrid/types.ts), [`toTablePage.ts`](../../../../src/utils/documentGrid/toTablePage.ts), [`toTreeNodes.ts`](../../../../src/utils/documentGrid/toTreeNodes.ts), [`documentIdentity.ts`](../../../../src/utils/documentGrid/documentIdentity.ts) |
| Query-session shaping | [`ClusterSession.ts`](../../../../src/documentdb/ClusterSession.ts) |
| Table, Tree, and tree expansion | [`DataViewPanelTable.tsx`](../../../../src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx), [`DataViewPanelTree.tsx`](../../../../src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTree.tsx), [`useTreeRows.ts`](../../../../src/webviews/documentdb/collectionView/components/resultsTab/useTreeRows.ts) |
| Navigation, action guards, and view focus | [`CollectionView.tsx`](../../../../src/webviews/documentdb/collectionView/CollectionView.tsx), [`collectionViewContext.ts`](../../../../src/webviews/documentdb/collectionView/collectionViewContext.ts) |

## Durable references

- [Design](./design.md): current architecture, interaction contracts, identity invariants,
  verification, and exclusions.
- [Decisions](./decisions.md): accepted rationale and constraints.
- [Grid scorecard](./grid-scorecard.md) and [migration parity contract](./migration-parity.md):
  evaluation evidence and the behavior inventory.
- [Execution plan](./iterations/02-rdg-execution-plan.md): gates, implementation record, and
  outstanding handover checks.

## Verification status

The L2-dev Collection View scenarios are on-demand, not CI checks. The recipe is in
[`build/verification/README.md`](../../../../build/verification/README.md#l2-dev-source-scenarios).
The execution plan records Integrated Browser scenarios for Table and Tree behavior and
navigation help on dark, light, and high-contrast routes. Actual screen-reader announcements and
Windows contrast themes in a packaged VS Code workbench remain unverified; browser emulation is
not a substitute for either.

The migration does not add spreadsheet-style cell-range selection, Tree row selection, or
cross-page/shard duplicate-ID mitigation.

With Table rows selected, plain Escape clears the selection while retaining focus on the current
cell or header; a second plain Escape returns focus to the view picker. With no Table selection,
or from Tree, plain Escape exits immediately; popups that handle Escape take precedence. After
clearing, Space on a focused data cell selects only that row if desired. No Ctrl+Space binding is
added.
