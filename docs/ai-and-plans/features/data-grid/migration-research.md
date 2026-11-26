---
feature: data-grid
kind: research
status: active
created: 2026-11-26
verified: 2026-11-26
code:
  - src/webviews/documentdb/collectionView/**
  - src/utils/slickgrid/**
  - src/webviews/utils/slickgrid/**
  - src/documentdb/ClusterSession.ts
---

# Collection View grid migration research

Preparation for [#1101](https://github.com/microsoft/vscode-documentdb/issues/1101).
**Recommendation: migrate to `react-data-grid`, with a DocumentDB-specific cell renderer and an
explicitly engineered tree implementation.** The partner's experience supports the direction,
but copying its original migration without its follow-up fixes would reproduce avoidable issues.
Do not trade away nested-document navigation, BSON types or selection safety to simplify the swap.

This is a research recommendation, **not an approved implementation decision or a completed
evaluation spike**. No production code, dependencies or remote state were changed.

## Reading guide

| Document | Purpose |
| --- | --- |
| This report | Recommendation, partner migration/history, gains, losses and implementation implications |
| [SlickGrid update assessment](./slickgrid-update-assessment.md) | What versions 10/11 actually fixed, and whether an upgrade remains credible |
| [No-loss contract](./migration-parity.md) | Detailed inventory of our current features and required migration acceptance checks |
| [React Data Grid capabilities](./react-data-grid-capabilities.md) | Current library releases, inexpensive additions, API/runtime caveats and features that are not cheap |
| [Earlier removal plan](./slickgrid-removal.md) | Existing staged approach; its September snapshot is not the current upstream assessment |

## 1. Executive findings

1. **SlickGrid has improved materially.** We ship 9.13.0; 11.0.0 is now published. Versions 10/11
   contain relevant keyboard/ARIA work, resize auto-scroll fixes and a particularly relevant
   stable resize-handle hit-box fix. "No upstream progress" is not a valid migration argument.
2. **Cosmos DB really did migrate**, in
   [microsoft/vscode-cosmosdb#2960](https://github.com/microsoft/vscode-cosmosdb/pull/2960),
   merged 2026-03-26. It replaced `slickgrid-react ~9.13.0` with
   `react-data-grid ~7.0.0-beta.59`. Its March release history describes the migration as
   addressing accessibility and theming.
3. **The partner gained a better integration foundation, not a finished JSON database browser.**
   Its row selection, header menu/resize dialog, VS Code theme and hierarchical tree remain
   custom application code. The mature asset to borrow is that integration and its lessons,
   not just the package name.
4. **Eight months of use produced useful corrective evidence.** Follow-ups address Space-key
   selection, hidden-menu focus, selected-document actions, one-row copy/export scope and stale
   results after changing connections. Several are cross-feature state bugs, not proven RDG
   regressions; they still define migration tests we should adopt from day one.
5. **Our requirements exceed the partner's table.** We must retain cross-row object step-in,
   breadcrumbs, root BSON identifiers, type annotations including UUID variants, missing-value
   semantics and our arbitrary document tree. None comes for free from RDG.
6. **There are cheap gains**, especially pinning `_id`, display-value copy, checkbox selection,
   controlled widths/reset and better type-aware React cells. Server sorting, inline writes,
   bulk paste/fill and arbitrary tree exploration are not simple enablement flags.
7. **Do not equate latest with partner-tested.** Cosmos DB currently pins beta.61; upstream
   publishes beta.64. Evaluate beta.64, but require our own runtime/parity checks. Its newer
   accessibility fixes have not been established as shipping in the partner.

## 2. Evidence and limits

Research date: **2026-11-26**.

| Baseline | Snapshot |
| --- | --- |
| DocumentDB worktree | Clean at start; branch `dev/tnaum/table-redesign`, commit [`8f81840d`](https://github.com/microsoft/vscode-documentdb/tree/8f81840d5aeeccece79321699e94d4789755a1fa) |
| Cosmos DB default branch | [`9a585583`](https://github.com/microsoft/vscode-cosmosdb/tree/9a585583e7a2b70076a2f7081045871d2170ac86), 2026-11-25 |
| Current SlickGrid release | [11.0.0](https://github.com/ghiscoding/slickgrid-universal/releases/tag/v11.0.0), 2026-11-10 |
| Current RDG release | [7.0.0-beta.64](https://github.com/Comcast/react-data-grid/releases/tag/v7.0.0-beta.64), 2026-11-05 |

Evidence comes from the original migration diff, pre/post source, subsequent component/path history,
related feature-fix PRs, manifests/lockfiles, upstream release notes and tagged APIs.
The history below selects meaningful changes, not every dependency/tooling commit.
**No installed-extension exercise, screen-reader test, UX comparison or performance benchmark
was performed.** "Verified" in frontmatter means sources were checked on that date, not that
the proposed replacement passes the release gates.

Package metadata was also read through the environment's preconfigured npm registry; its `latest`
tags agreed with the GitHub releases. **Direct npmjs.org access is not permitted.** No dependency
was installed, no public tarball was inspected, and no further npmjs.org access is part of this
research. Published-artifact/runtime verification remains an implementation gate using approved
sources and tooling.

## 3. What the partner migrated

### Investigation and original change

The bake-off was
[microsoft/vscode-cosmosdb#2958](https://github.com/microsoft/vscode-cosmosdb/pull/2958),
opened 2026-03-13 and closed unmerged 2026-04-16. It compared SlickGrid v10, SVAR,
React Data Grid and Material React Table because of accessibility limitations in SlickGrid v9.
The merged implementation was the separate
[microsoft/vscode-cosmosdb#2960](https://github.com/microsoft/vscode-cosmosdb/pull/2960)
(merge [`84e98b16`](https://github.com/microsoft/vscode-cosmosdb/commit/84e98b1644e332c2c75e28d9b979dc0e7596f273)).
Thus "they never considered updating SlickGrid" would be incorrect.

The 17-file migration removed the old table/tree/column-menu implementations and SlickGrid theme,
added a `ReactDataGrid/` component folder, rewrote tree conversion, changed dependencies and
localization, and allowed the library's stylesheet import.
The new table, tree and header menu together contained over 700 lines of TSX, plus a separate
VS Code theme. This was an integration project, not a three-line dependency swap.

Immutable comparison sources:
[old table](https://github.com/microsoft/vscode-cosmosdb/blob/c93192680d7650f2708e8583c394e6a956318b74/src/webviews/cosmosdb/QueryEditor/ResultPanel/ResultTabViewTable.tsx),
[old tree](https://github.com/microsoft/vscode-cosmosdb/blob/c93192680d7650f2708e8583c394e6a956318b74/src/webviews/cosmosdb/QueryEditor/ResultPanel/ResultTabViewTree.tsx),
[new table](https://github.com/microsoft/vscode-cosmosdb/blob/84e98b1644e332c2c75e28d9b979dc0e7596f273/src/webviews/cosmosdb/QueryEditor/ResultPanel/ReactDataGrid/ResultTabViewTable.tsx),
[new tree](https://github.com/microsoft/vscode-cosmosdb/blob/84e98b1644e332c2c75e28d9b979dc0e7596f273/src/webviews/cosmosdb/QueryEditor/ResultPanel/ReactDataGrid/ResultTabViewTree.tsx),
[new header menu](https://github.com/microsoft/vscode-cosmosdb/blob/84e98b1644e332c2c75e28d9b979dc0e7596f273/src/webviews/cosmosdb/QueryEditor/ResultPanel/ReactDataGrid/ColumnHeaderMenu.tsx).

### What changed architecturally

| Area | SlickGrid implementation | RDG integration |
| --- | --- | --- |
| Cell rendering | Imperative formatters, string/HTML output | React `renderCell`, shared string conversion and empty-value styling |
| Selection | Built-in row selection, debounced event handler | Application-owned selected-ID set, anchor/range logic and keyboard/mouse handlers |
| Sizing | Autosize/content estimates and imperative container resize configuration | Controlled column-width state, resizable columns, custom Fluent content-fit and numeric resize menu |
| Accessibility | Delayed DOM ARIA patches and custom active-cell live announcements | Library grid semantics, custom keyboard handling, accessible grid names and native tree expander buttons |
| Tree | SlickGrid flat `parentId` tree | Nested `TreeRow.children` model with custom expansion/flattened visible rows in ordinary `DataGrid` |
| Theme | SlickGrid SCSS override layer | `--rdg-*` to `--vscode-*` mapping; still a custom grid theme |
| Integration | Grid callbacks dispatch selected row indexes to Query Editor | Same surrounding state/action architecture, with a different selection adapter |

Important details: click selects one row; Ctrl/Meta-click toggles; Shift-click selects a range;
Space/Shift-Space and Shift-arrows implement keyboard selection. The final merged table does
**not** use a checkbox column. Early review raised checkbox-only selection and light-theme styling;
the final implementation contains custom selection instead. Do not copy an early PR screenshot as
the final design.

## 4. Evolution after migration

| Date | Evidence | Change and consequence |
| --- | --- | --- |
| 2026-02-13, before migration | [microsoft/vscode-cosmosdb#2934](https://github.com/microsoft/vscode-cosmosdb/pull/2934) | Added SlickGrid ARIA row/column counts after wrong NVDA/Narrator counts. The partner was already paying an accessibility-adapter cost. |
| 2026-03-26 | [microsoft/vscode-cosmosdb#2960](https://github.com/microsoft/vscode-cosmosdb/pull/2960) | Migrated both table and tree; kept JSON outside the grid. Added custom selection and header controls rather than relying solely on RDG defaults. |
| 2026-03-31 | [v0.33.2 release](https://github.com/microsoft/vscode-cosmosdb/releases/tag/v0.33.2) | First verified shipped version: release notes explicitly mention the migration; tag `c90f0f11ca8e7b2133743c030cce56a17480b1f9` contains the merge and beta.59 dependency. The nearby v0.33.3 preparation PR is not the first-release evidence. |
| 2026-05-05 / 05-13 | [microsoft/vscode-cosmosdb#3005](https://github.com/microsoft/vscode-cosmosdb/pull/3005), [microsoft/vscode-cosmosdb#3011](https://github.com/microsoft/vscode-cosmosdb/pull/3011) | String-helper import movement and minor stylesheet cleanup; not a new grid or major user-visible redesign. |
| 2026-05-18 | [microsoft/vscode-cosmosdb#3037](https://github.com/microsoft/vscode-cosmosdb/pull/3037) | Restored packaged webview rendering after Vite migration: preserved the render export and injected emitted CSS for RDG, Monaco and the splitter. Grid styling is a packaging dependency, not just a successful development import. Not caused by the original grid migration. |
| 2026-06-22 | [microsoft/vscode-cosmosdb#3168](https://github.com/microsoft/vscode-cosmosdb/pull/3168) | Hotkey cleanup and View/Edit/Delete fixes. A strict record guard discarded otherwise valid selected rows; selection consumers needed a less restrictive document-ID extractor. Not demonstrated to originate in RDG. |
| 2026-08-18 | [microsoft/vscode-cosmosdb#3272](https://github.com/microsoft/vscode-cosmosdb/pull/3272), reverted by [microsoft/vscode-cosmosdb#3281](https://github.com/microsoft/vscode-cosmosdb/pull/3281) | Tried beta.61, adapting keyboard event mode from `SELECT` to `ACTIVE` and guarding absent rows. Reverted the dependency batch the same day. The revert says CI trouble was determined to be Azure DevOps-side; do not describe it as an RDG failure. |
| 2026-09-07 | [microsoft/vscode-cosmosdb#3342](https://github.com/microsoft/vscode-cosmosdb/pull/3342) | Large Table-to-JSON switches could freeze/crash; added JSON size warning, preview cap and chunked streaming. This is a Monaco/JSON-view issue, not evidence that the new grid handles all large-result workflows automatically. |
| 2026-09-11 | [microsoft/vscode-cosmosdb#3346](https://github.com/microsoft/vscode-cosmosdb/pull/3346) | Exactly one selected row was treated as no selection by converters, so copy/export used the entire page. A concrete selection-to-feature regression to test, but introduction at the grid migration is not established. |
| 2026-09-16 | [microsoft/vscode-cosmosdb#3351](https://github.com/microsoft/vscode-cosmosdb/pull/3351) | Adopted the shared Fluent webview theming provider. This did not eliminate RDG's separate VS Code CSS-variable theme. |
| 2026-09-23 | [microsoft/vscode-cosmosdb#3359](https://github.com/microsoft/vscode-cosmosdb/pull/3359) | Added table tests, restored the `ACTIVE` event-mode adaptation and prevented native Space-key scrolling. Lockfile now resolved beta.61 while manifest still said `~beta.59`. The PR title does not reveal the grid changes. |
| 2026-09-25 | [microsoft/vscode-cosmosdb#3362](https://github.com/microsoft/vscode-cosmosdb/pull/3362) | Prevented stale results from a previous connection/container from enabling actions against another container. Double-click handling now checks connection/execution/edit state and carries the current execution ID. A crucial ownership invariant, not just a rendering detail. |
| 2026-10-11 | [microsoft/vscode-cosmosdb#3407](https://github.com/microsoft/vscode-cosmosdb/pull/3407) | Custom column-menu trigger could receive programmatic focus while `aria-hidden`. Removed that attribute while retaining `tabIndex=-1`, and added a regression test. Accessibility work remained necessary in the migration's own components. |
| 2026-11-03 | [microsoft/vscode-cosmosdb#3449](https://github.com/microsoft/vscode-cosmosdb/pull/3449) | Exact-pinned beta.61. Recorded concerns include newer beta header-renderer API changes and an unsupported Map method. The latter rationale needs source/runtime qualification; see the capabilities document. |
| 2026-11-04 | [microsoft/vscode-cosmosdb#3522](https://github.com/microsoft/vscode-cosmosdb/pull/3522) | Added JSON folding controls. A surrounding results feature, not a built-in benefit of the RDG migration. |

### Actual dependency trajectory

| Point | Manifest | Lockfile |
| --- | --- | --- |
| Original March migration | `~7.0.0-beta.59` | beta.59 |
| August update attempt | exact beta.61 | beta.61 |
| August revert | `~7.0.0-beta.59` | beta.59 |
| September 23 onward | `~7.0.0-beta.59` | beta.61 |
| November 3 through inspected HEAD | exact `7.0.0-beta.61` | beta.61 |

The prerelease range allowed movement without the manifest text changing.
For reproducible evaluation, record **both** manifest and lockfile, and exact-pin the candidate.
The partner has not established beta.64 compatibility merely by using a 7.0 beta.

## 5. What they gained, and what they may have lost

| Area | Evidence-backed gain | Loss, risk or qualification |
| --- | --- | --- |
| Accessibility | Native grid semantics replaced manual DOM patching. A reviewer [reported the relevant accessibility bugs fixed](https://github.com/microsoft/vscode-cosmosdb/pull/2960#issuecomment-4110304284): [microsoft/vscode-cosmosdb#2926](https://github.com/microsoft/vscode-cosmosdb/issues/2926), [microsoft/vscode-cosmosdb#2929](https://github.com/microsoft/vscode-cosmosdb/issues/2929), [microsoft/vscode-cosmosdb#2930](https://github.com/microsoft/vscode-cosmosdb/issues/2930). | The March 23 comment predates merge and does not specify the test environment. This is reported validation, not our own test result or a conformance claim. Custom header-menu focus still needed the October fix. |
| React integration | Cell/header controls and selection live in ordinary React; fewer SlickGrid-specific services/formatters and delayed DOM edits. | Application selection/range logic and custom tree are now maintained by the extension. React does not make lifecycle/focus errors impossible. |
| Resize UX | Controlled widths, pointer resize and explicit content/numeric resize controls. | Initial sizing changed: the old explicit first-load content-fit configuration is gone. Equivalent initial fit has not been demonstrated by this research. |
| Theme control | Direct CSS-variable mapping to VS Code; native Fluent menu/dialog controls. | Still two style domains: RDG CSS and Fluent. No evidence that it automatically follows every VS Code contrast theme correctly. |
| Selection | Familiar click/modifier/keyboard gestures implemented in the merged code. | Not a free library default. Custom key handling required an API adaptation and `preventDefault`; indexes still have to map to the correct documents. |
| Tree | Native button expanders and a simpler React-visible-row implementation. | Old tree sort/filter configuration and bespoke level/state live announcements were removed. The new component does not declare the old hierarchy through `aria-level`/`treegrid` in that file. Actual screen-reader equivalence remains unverified. |
| Visible columns | The bake-off described cleaner default presentation. | The migration also changed converter defaults: hide service columns; do not inject partition-key columns except for `SELECT *`. This is a real presentation reduction, not required by RDG. Do not copy it into our BSON/`_id` column policy. |
| Performance/size | RDG supports row/column virtualization; wrapper/plugin dependencies are removed. | SlickGrid already virtualized. No extension-specific before/after timings or byte reduction were established. Expanded-tree and JSON payload costs remain application problems. |
| Feature integration | Existing View/Edit/Delete, copy/export and external paging remained attached to Query Editor state. | Later selection-scope and result-ownership bugs show how easy it is to preserve the appearance but break the action target. Their causes must not all be attributed to migration without evidence. |

**Removed announcements are not automatically regressions.** Native grid semantics may make a
custom live region redundant or noisy. Test the actual spoken outcome; do not restore the old live
region merely to make the source diff look feature-equivalent. Conversely, hierarchical tree
context must not silently disappear because a flat grid announces cell values correctly.

### Feature coupling worth copying carefully

The partner's current table assigns synthetic row IDs `index + 1`, then dispatches `id - 1` as
indexes into raw `queryResult.documents`.
[`getSelectedDocumentIds`](https://github.com/microsoft/vscode-cosmosdb/blob/9a585583e7a2b70076a2f7081045871d2170ac86/src/webviews/cosmosdb/QueryEditor/ResultPanel/getSelectedDocumentIds.ts#L10-L37)
explicitly depends on converter order matching raw-document order. Its table disables sorting,
so adding local row sorting without changing this adapter would risk wrong-document actions.
We should use canonical identity instead.

Copy/export use those selected indexes with the **raw results**, not rendered/truncated cells or
the list of visible columns. The one-selected-row correction and explicit current-page/selected
scope labels are therefore important outside the grid component. This is different from the cheap
focused-cell **display-value** copy opportunity proposed for our extension.

The visibility change is verifiable in
[current table conversion](https://github.com/microsoft/vscode-cosmosdb/blob/9a585583e7a2b70076a2f7081045871d2170ac86/src/utils/convertors/table.ts#L212-L270):
`ShowPartitionKey` changed from `first` to `none`, and `ShowServiceColumns` from `last` to `none`
in the migration. `SELECT *` overrides partition-key presentation back to `first`.
The results panel calls the converter without exposing those options as a user control.

[microsoft/vscode-cosmosdb#3406](https://github.com/microsoft/vscode-cosmosdb/pull/3406)
proposed fixes for empty partition-key/unnamed-projection cells, but was closed **unmerged**.
The current renderer already strips a leading slash from partition-key headers, so the PR's
description is not sufficient to establish that symptom on current HEAD. Treat header/data-key
agreement and unnamed projections as required fixtures, not as confirmed current partner bugs.
No evidence was established here about CSV inclusion of hidden service columns or selection
lifetime across every partner view switch.

At inspected HEAD, open partner requests also include
[microsoft/vscode-cosmosdb#3194](https://github.com/microsoft/vscode-cosmosdb/issues/3194)
(add-to-filter/query cell context menu),
[microsoft/vscode-cosmosdb#3440](https://github.com/microsoft/vscode-cosmosdb/issues/3440)
(displayed result count), and
[microsoft/vscode-cosmosdb#3298](https://github.com/microsoft/vscode-cosmosdb/issues/3298) /
[microsoft/vscode-cosmosdb#3179](https://github.com/microsoft/vscode-cosmosdb/issues/3179)
(copy selected text versus broader results). These are evidence that such affordances are not
automatically delivered by adopting RDG, not proof all were caused by migration.

Current code:
[table](https://github.com/microsoft/vscode-cosmosdb/blob/9a585583e7a2b70076a2f7081045871d2170ac86/src/webviews/cosmosdb/QueryEditor/ResultPanel/ReactDataGrid/ResultTabViewTable.tsx#L145-L277),
[tree](https://github.com/microsoft/vscode-cosmosdb/blob/9a585583e7a2b70076a2f7081045871d2170ac86/src/webviews/cosmosdb/QueryEditor/ResultPanel/ReactDataGrid/ResultTabViewTree.tsx),
[header menu](https://github.com/microsoft/vscode-cosmosdb/blob/9a585583e7a2b70076a2f7081045871d2170ac86/src/webviews/cosmosdb/QueryEditor/ResultPanel/ReactDataGrid/ColumnHeaderMenu.tsx),
[theme](https://github.com/microsoft/vscode-cosmosdb/blob/9a585583e7a2b70076a2f7081045871d2170ac86/src/webviews/cosmosdb/QueryEditor/ResultPanel/ReactDataGrid/vscodeTheme.scss).

## 6. What we must not lose

The [complete parity checklist](./migration-parity.md) is the implementation acceptance input.
The highest-risk items are:

- Object-cell step-in **across the page**, with Level up/breadcrumb navigation, not merely a
  row-details popup. Add its missing keyboard equivalent.
- BSON-aware values and type markers, including UUID/legacy UUID; missing versus null; root
  `_id` retained at nested paths; correct canonical IDs for View/Edit/Delete.
- Multi-row selection, exact command enablement and safe selection invalidation after refresh,
  paging, deletion or a connection change.
- Both the table and arbitrary-depth tree, plus the untouched Monaco JSON alternative.
- Server query/projection/sort/skip/limit and existing paging; loading/empty/error states; wide
  result virtualization, usable resizing, focus visibility and refresh focus.

Our current formatted `CellValue` payload is not raw JSON. Do not copy Cosmos DB's generic
string renderer and lose BSON distinctions, or use its row-index arithmetic as document identity.
Changing column order must use logical field keys; today's step-in callback uses column indexes
and would otherwise navigate into the wrong field after reorder.

## 7. Recommended direction and staged gates

**Prefer RDG for the table; budget real engineering for the tree.** A custom tree on `DataGrid`
can share virtualization and cell rendering, but must implement proper arbitrary hierarchy,
keyboard behavior and focus/ARIA. Alternatively use a dedicated virtualized accessible tree/treegrid
behind the same feature-level contract. The partner's flat-row example is a starting point, not
proof this requirement is solved. Do not ship removal of SlickGrid until the tree gate passes.

The original staged plan still provides a useful sequence:

1. **Capture contracts and neutral result shapes.** Preserve schema analysis/BSON formatting
   while separating display cells, root identifiers and grid metadata. Keep backend query and
   column-policy decisions outside the renderer. Avoid creating a general-purpose grid framework.
2. **Make a parity-first table/tree spike.** Evaluate exact beta.64 against the partner's
   beta.61 reference; adapt to the selected API. Reuse the partner's header-menu/resize ideas and
   post-migration fixes, not its NoSQL-specific data conversion or stale execution assumptions.
3. **Exercise behavior before judging appearance.** Use the parity fixtures for nested values,
   all type categories, sparse/projection-changing results, multi-selection and stale-result
   actions. Expose field-keyed column-rebuild and focused-cell hooks required by #1101 without
   silently implementing a new column policy or clipboard format.
4. **Measure and test in the actual runtime.** Compare current SlickGrid and candidate production
   bundles with identical large/wide/deep fixtures. Record timings/bytes and agree budgets before
   acceptance; run keyboard and screen-reader journeys in packaged VS Code, not only jsdom.
   Include minimum supported VS Code/Electron, narrow panels, zoom and contrast themes.
5. **Choose and record the pin/tree approach after evidence.** An operator decision should record
   why RDG plus the selected tree was preferred over SlickGrid 11 and the alternatives. This
   report does not pre-empt that gate or invent the operator's rationale.
6. **Swap without optional features, then add inexpensive wins separately.** Remove SlickGrid
   dependencies/theme/workarounds only once both views pass. Preserve the existing query/document
   plumbing. Follow-up features should be independently reviewable and not obscure parity defects.

If needed, SlickGrid 11 is a legitimate temporary fallback, especially for a blocked tree
implementation. It also has breaking integration changes; the fallback is not "just bump npm".
Since migration effort is not the operator's main concern, do not choose a weaker tree, truncated
type model or mouse-only interaction merely to minimize changed lines.

## 8. Suggested inexpensive follow-up shortlist

After parity: **pin `_id`; focused-cell display-value copy; checkbox/page selection; remember/reset
widths; a proper type-aware value/badge renderer**. Column reorder/hide is next, once logical keys
and changing-schema layout state are proven. The
[capability/effort table](./react-data-grid-capabilities.md#2-what-is-actually-cheap) separates
actual built-ins from the small amount of integration required.

Not included in "cheap": safe inline database editing, bulk paste/fill, whole-collection
grouping/aggregates, server sorting integration or replacing collection export with visible-row
serialization. Keep these out of #1101's groundwork scope.

## Outcome

The preparation now has an upstream comparison, partner migration/follow-up history, a source-backed
no-loss inventory and a version-aware opportunity list. **Implementation, benchmarks, packaged
runtime compatibility and assistive-technology validation remain future work.** The evidence favors
migration, but does not support a promise of zero regressions or universal accessibility merely
from selecting the partner's library.
