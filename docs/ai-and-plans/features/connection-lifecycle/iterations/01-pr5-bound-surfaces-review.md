---
feature: connection-lifecycle
kind: review
status: active
created: 2026-11-24
---

# PR5 pre-review: identity-bound views

[PR #1121](https://github.com/microsoft/vscode-documentdb/pull/1121), reviewed at
`98530222e` against `feature/connection-lifecycle`. Claude Opus 5.5 performed the initial
review. A second review validated the findings and performed an independent sweep. No
published GitHub review was present. The later lint and formatting cleanup is separate.

## Validated findings

| ID  | Severity | Finding and recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | High     | Dashboard row commands can continue after their initial identity check without the originating binding. Bind Dashboard Import, Export and Delete at the point of database access, while keeping tree commands unchanged. For Paste, either carry the binding through the entire Dashboard destination flow, including index copy, or keep Paste available only from the tree until the Dashboard path can be fully bound. Do not retain a partially guarded Dashboard Paste. [Dashboard dispatch](../../../../../src/webviews/documentdb/clusterDashboard/clusterDashboardController.ts#L249) |
| F2  | Medium   | An interrupted initial collections read can render as an empty database. Distinguish **not loaded** from **loaded and empty**. Preserve existing rows and let an explicit Refresh load missing data after recovery. Block a new drill-in while the copy escape hatch is active. [Collections state](../../../../../src/webviews/documentdb/clusterDashboard/components/useDatabaseCollections.ts#L113)                                                                                                                                                                                        |
| F3  | Medium   | An interrupted index create can leave a phantom **Creating…** row and keep status polling active. Remove only the affected optimistic entry, preserve the last verified list, and leave an unacknowledged operation's outcome unknown until an explicit refresh. [Index creation](../../../../../src/webviews/documentdb/collectionView/indexesTab/IndexesTab.tsx#L469)                                                                                                                                                                                                                       |
| F4  | Medium   | Interrupted Query Insights stages 1 and 2 can stay in a loading state. Stop the incomplete stage, retain any completed analysis, and require an explicit Run or Refresh. Resetting to idle could start a background fetch. [Collection View prefetch](../../../../../src/webviews/documentdb/collectionView/CollectionView.tsx#L257) and [Query Insights](../../../../../src/webviews/documentdb/collectionView/queryInsightsTab/QueryInsightsTab.tsx#L329)                                                                                                                                   |
| N1  | Medium   | The Dashboard native row menu does not honor the panel's copy-only state. Apply the same availability rule to native dispatch as to the webview: copying existing content stays possible, but database actions stay blocked until Retry succeeds. [Native menu dispatch](../../../../../src/webviews/documentdb/clusterDashboard/clusterDashboardController.ts#L249)                                                                                                                                                                                                                          |
| N2  | Medium   | Dashboard create wizards perform name-validation reads without the panel's binding. Carry the host-only binding through validation and execution. Report a connection or identity failure as unavailable, not an invalid name. [Database validation](../../../../../src/commands/createDatabase/DatabaseNameStep.ts#L59) and [collection validation](../../../../../src/commands/createCollection/CollectionNameStep.ts#L63)                                                                                                                                                                  |

The second review found no separate defect in the native **Close view** confirmation. Index-list
loading and delete/hide busy flags have their own cleanup and do not need the F3 change.

## Author decisions

The operator approved fixes for F1–F4 and N1–N2, asking for the simplest changes that preserve
the identity guard and avoid operation replay. In F1, keep Paste Collection available from the
tree only; a Dashboard entry would need to bind the full copy flow, including optional index
copy. No change to ordinary tree commands is intended.

After consulting Opus, the operator approved permanently locking existing views after saved
connection edits, including password-only changes, in WI-7. See [decision 0018](../decisions.md#0018-saved-connection-edits-permanently-lock-existing-views).
That policy simplifies later recovery; it does not replace the PR5 command guards.
OP-4 remains cleared.

## Fixes and verification

- **F1, N1, N2:** `5975620a2` binds Dashboard commands and wizard validation, leaves Paste in
  the tree, and reopens the unavailable dialog instead of running blocked native row actions.
- **F2:** `e2fe7afa4` distinguishes interrupted inventory from loaded, empty inventory.
- **F3:** `9cc97ffd1` clears unacknowledged index creation placeholders without replay.
- **F4:** `20df3fe4c` stops interrupted Query Insights stages and preserves completed results.

Case 2: formatting and localization regeneration completed; localization check, lint, build,
strict workspace test type-check, full Vitest (442 files, 9,863 passed, one skipped), and VSIX
packaging passed. The final native-menu notification adjustment received an additional focused
controller run (18 passed), lint, build, and packaging. OP-4 live evidence and the operator's
password-only test waiver are recorded in the [delivery plan](./01-dev-plan.md).

## Copilot inline review follow-up

Claude Opus 5.5 validated the 21 original threads at `c19d0c1d5`. The operator asked
for the smallest safe fixes and to skip low-priority work unless the fix is
straightforward. The operator approved [decision 0019](../decisions.md#0019-require-a-new-dashboard-delete-after-disconnect)
for pending Dashboard deletes and keeping Dashboard Copy with tree-only Paste.

- **Fixed:** R1 (pending Delete), R4 (acknowledged document ID), R5 (drop errors),
  R7–R9 (bound imports, optional stats and transfer startup), R11 (duplicate
  notification), and R13–R20 (Dashboard recovery, interrupted reads, and Collection
  View and Query Insights guards). Each has a dedicated commit and an inline reply.
- **No code change:** R2 (rare new-tab handoff), R3 (approved tree-reference copy),
  R6 (export stream fallback), R10 (unchanged Native rejection policy),
  R12 (transparent same-identity replacement), R21 (Stage 1 plan presentation).
  These decisions do not change the PR6 saved-edit lock.

Follow-up verification: Case 1 build passed and 307 focused tests passed across
25 files. The full Case 2 suite above was run for the earlier review handoff, not
repeated for this follow-up.
