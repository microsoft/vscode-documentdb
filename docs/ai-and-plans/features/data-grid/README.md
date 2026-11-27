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
plan. The approved WI-G3-1 through WI-G3-5 source changes are also implemented. G3a and G3b are
not released.
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
- After keyboard step-in, focus moves to the same root row's `_id` cell after the matching Table
  page is applied. Pointer step-in is unchanged.
- Long Table values ellipsize without hiding the BSON type indicator or adding per-cell Tab stops.
  Defined values expose their full BSON type before the value in the accessible cell name; the
  visual glyph is decorative and there is no BSON type hover tooltip.
- Row selection and document-action eligibility are separate. Rows without a safe, unique
  identity remain browsable and selectable, but cannot become View/Edit/Delete targets.
- Object `_id` values with more than one own key and an integer-like key at any depth are
  conservatively ineligible for document actions. Their rows remain displayed and selectable.

The exact VS Code support declaration is `^1.123.0` in the root `package.json` (minimum
`1.123.0`). A9's isolated VSIX install and activation on VS Code 1.123.0 passed, but did not
exercise a live Collection View. The exact stable-version Collection View interaction check and
screen-reader manual checks were not done. See the [execution plan](./iterations/02-rdg-execution-plan.md)
for A9 evidence and the remaining workbench checks.

## Code map

| Area                                      | Source                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grid-neutral model and host shapers       | [`types.ts`](../../../../src/utils/documentGrid/types.ts), [`toTablePage.ts`](../../../../src/utils/documentGrid/toTablePage.ts), [`toTreeNodes.ts`](../../../../src/utils/documentGrid/toTreeNodes.ts), [`documentIdentity.ts`](../../../../src/utils/documentGrid/documentIdentity.ts)                                                                            |
| Query-session shaping                     | [`ClusterSession.ts`](../../../../src/documentdb/ClusterSession.ts)                                                                                                                                                                                                                                                                                                 |
| Table, Tree, and tree expansion           | [`DataViewPanelTable.tsx`](../../../../src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx), [`DataViewPanelTree.tsx`](../../../../src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTree.tsx), [`useTreeRows.ts`](../../../../src/webviews/documentdb/collectionView/components/resultsTab/useTreeRows.ts) |
| Navigation, action guards, and view focus | [`CollectionView.tsx`](../../../../src/webviews/documentdb/collectionView/CollectionView.tsx), [`collectionViewContext.ts`](../../../../src/webviews/documentdb/collectionView/collectionViewContext.ts)                                                                                                                                                            |

## Durable references

- [Design](./design.md): current architecture, interaction contracts, identity invariants,
  verification, and exclusions.
- [Decisions](./decisions.md): accepted rationale and constraints.
- [Grid scorecard](./grid-scorecard.md) and [migration parity contract](./migration-parity.md):
  evaluation evidence and the behavior inventory.
- [Execution plan](./iterations/02-rdg-execution-plan.md): gates, implementation record, and
  outstanding handover checks.
- [Review-fix plan](./iterations/05-review-fixes-plan.md): proposed implementation of the
  approved "do now" findings, excluding the explanation and numeric-fidelity follow-up issues.

WI-G3-1 through WI-G3-5 are now implemented; the plan records their earned source evidence.

## Verification status

The L2-dev Collection View scenarios are on-demand, not CI checks. The recipe is in
[`build/verification/README.md`](../../../../build/verification/README.md#l2-dev-source-scenarios).
Focused test/build evidence for all five G3 code items and affected source-scenario runs are
recorded in the [review-fix plan](./iterations/05-review-fixes-plan.md); R1 save/filter coverage is
mocked, not live:

- WI-G3-1: 76/76 focused tests, build, and failing-first identity/save contracts.
- WI-G3-2: 29/29 focused tests, 146/146 harness tests, build, and 21 affected source journeys
  with 228/228 assertions.
- WI-G3-3: 11 component tests, 78/78 harness tests, build, and 9 source journeys with 90/90
  assertions.
- WI-G3-4: 3 cell tests, 79/79 harness tests, build, and 15 source journeys with 261/261
  assertions across three themes. Browser-computed names matched `Int32 7` and `Decimal128 12.50`;
  this is not spoken screen-reader verification.
- WI-G3-5: 154/154 focused/harness tests, build, and 15 source journeys with 177/177 assertions.

This is source evidence, with mocked save-path coverage; no live collection was exercised.
R3's strict packaged Collection View readiness is implemented, but a fresh packaged normal run and
broken-CSS negative control are still pending. Actual NVDA/Narrator announcements, Windows contrast
themes, and the packaged/manual G3b checks remain unverified. Browser emulation is not a
substitute for them, and neither G3a nor G3b has been released.

The migration does not add spreadsheet-style cell-range selection, Tree row selection, or
cross-page/shard duplicate-ID mitigation.

With Table rows selected, plain Escape clears the selection while retaining focus on the current
cell or header; a second plain Escape returns focus to the view picker. With no Table selection,
or from Tree, plain Escape exits immediately; popups that handle Escape take precedence. After
clearing, Space on a focused data cell selects only that row if desired. No Ctrl+Space binding is
added.
