---
kind: plan
status: active
created: 2026-09-30
code:
  - src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx
  - src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTree.tsx
  - src/webviews/slickgrid.scss
  - src/utils/slickgrid/**
  - src/webviews/utils/slickgrid/**
  - src/documentdb/ClusterSession.ts
---

# Removing SlickGrid from the Collection View

**Status:** guidance for a future iteration. Not scheduled. Written 2026-09-30 during the
modernization re-review ([build-and-test-stack.md, execution plan](./build-and-test-stack.md#execution-plan)).

**When:** after the modernization iteration, and not in parallel with it. The migration and the grid
swap both change `collectionView`, so doing both at once would make any regression impossible to
attribute. This iteration also depends on two modernization stages: **Vitest with jsdom** (the grid's
behavior tests are written once, in Vitest) and **per-view code splitting** (so the grid is its own
chunk, and the replacement's cost can be measured).

Everything below marked [MEASURED] was read from the code on 2026-09-30. Claims about candidate
libraries are marked [VERIFY]: check them against the current release at evaluation time, not
against this document.

---

## 1. Current footprint [MEASURED]

| Where        | File                                                                                             | What it does                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webview      | `collectionView/components/resultsTab/DataViewPanelTable.tsx` (226 lines)                        | Table view. The only `SlickgridReact` with selection and step-in                                                                                     |
| Webview      | `collectionView/components/resultsTab/DataViewPanelTree.tsx` (113 lines)                         | Tree view. `enableTreeData` over a flat `parentId` list                                                                                              |
| Webview      | `src/webviews/slickgrid.scss` (109 lines), used from `collectionView.scss`                       | `@use`s `@slickgrid-universal/common/.../slickgrid-theme-default.scss` with VS Code variable overrides                                               |
| Webview      | `src/webviews/utils/slickgrid/typeToDisplayString`                                               | BSON type -> tooltip text. Grid-neutral in substance, slickgrid in name only                                                                         |
| Host         | `src/utils/slickgrid/mongo/toSlickGridTable.ts` (93), `toSlickGridTree.ts` (168), `CellValue.ts` | Shape documents into rows and a flat tree. **Runs on the extension host**, called from `ClusterSession.ts` (`getCurrentPageAsTree`, `getDataAtPath`) |
| Host tests   | `toSlickGridTable.test.ts`, `toSlickGridTree.test.ts`                                            | Unit tests of the shaping. Keep them; they survive a rename                                                                                          |
| Dependencies | `slickgrid-react ~9.13.0`, which brings eight `@slickgrid-universal/*` packages                  | Upgraded to SlickGrid 9 in release 0.6                                                                                                               |
| Build config | `tsconfig.json` `allowSyntheticDefaultImports`, commented "to fix SlickGrid integration"         | A default-import interop shim. Recheck once the grid is gone                                                                                         |

The JSON view (`DataViewPanelJSON.tsx`) uses Monaco, not SlickGrid, and is out of scope.

## 2. The behavior contract to preserve

This is what the users rely on today, read from the two components. The replacement is done when all
of it holds, and the behavior tests in §5 assert it.

**Table view**

1. Columns are created dynamically from `liveHeaders`. Each has a minimum width of 100 px and
   auto-sizes to the container.
2. A cell renders `value.value`, with the CSS class `typedTableCell type-<bsonType>` and a tooltip
   naming the BSON type. A missing field renders empty, with the tooltip "This field is not set".
3. Rows can be selected, including multiple rows. A selection change (debounced 100 ms) updates the
   Collection View context: `disableDeleteDocument` when nothing is selected;
   `disableEditDocument` and `disableViewDocument` unless exactly one row is selected;
   `selectedDocumentIndexes`; and `selectedDocumentObjectIds` from each row's `x-objectid`.
4. Double-clicking a cell whose value has `type === 'object'` calls `handleStepIn(row, cell)`.
5. Text in cells can be selected, and keyboard cell navigation works.
6. The grid resizes with `.resultsDisplayArea` (today, a debounced `ResizeObserver` calls
   `resizeGrid`).
7. On first load, `LoadingAnimationTable` is shown instead of the grid.
8. Selection is cleared on unmount.
9. The following are deliberately **off** today and need not exist: column picker, reorder, context
   menu, grid menu, header buttons, header menu, checkbox selector.

**Tree view**

1. Three columns: Field (tree column, bold title), Value, Type.
2. The data is the flat list produced by `toSlickGridTree`: `{ id, parentId, field, value, type }`.
3. Nodes start collapsed. Indentation is 15 px per level. Expand and collapse work from the chevron
   and the keyboard.
4. The grid resizes with the container, as in the table view.

## 3. Known pain points (why this is worth doing)

All of these are visible in the current code or in the E2E research.

- **Stale closures.** SlickGrid binds handlers once, at initialization. The table keeps
  `liveDataRef` and `gridColumnsRef` and has a lint suppression (`react-hooks/refs`) to work around
  it. A React-native grid removes the whole pattern.
- **Manual re-render.** A `useEffect` calls `gridService.renderGrid()` on every data change because
  "SlickGrid does not consistently re-render when data changes".
- **Manual resize.** The built-in auto-resize is disabled, and the container is observed by hand
  with a selector string (`'#resultsDisplayAreaId'` / `'.resultsDisplayArea'`).
- **Tree mode needs filtering switched on** (`enableFiltering: true`, then the filter row hidden with
  `showHeaderRow: false`). A comment records a two-hour search for why the expand chevrons were
  missing.
- **The checkbox selector is broken** when columns change after the grid exists, so it is disabled.
- **Testing quirks:** the header row has `role="row"`, which is correct ARIA grid semantics (column
  headers sit inside a `row`), so tests must count data rows separately, not use a bare
  `getByRole('row')`. SlickGrid also needs a synthetic `scroll` event before it renders more rows in a
  headless browser ([e2e-testing-strategy.md](./e2e-testing-strategy.md), "Copy verbatim" table).
- **Styling is a second theme system.** The grid is themed through a SlickGrid SCSS theme with
  VS Code variable overrides, separately from the Fluent theming that
  `@microsoft/vscode-ext-webview-fluentui` now owns for every other surface.
- **Weight.** One wrapper plus eight `@slickgrid-universal/*` packages, and today all of it loads in
  every webview. The modernization's per-view splitting fixes the second half. Only removal fixes
  the first.

## 4. Candidate direction

Decide at evaluation time, against the contract in §2. What is known now:

| Candidate                                                              | For                                                                                                                                                                                                 | Against                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **`react-data-grid`**                                                  | Cosmos DB uses it (`~7.0.0-beta.59`), so knowledge and fixes can be shared, and so can their E2E patterns. React-native (no stale closures), virtualized, keyboard and ARIA grid semantics [VERIFY] | Still a beta. Its `TreeDataGrid` is row **grouping** by keys, not an arbitrary parent/child tree [VERIFY], so it may not fit the tree view |
| **Fluent UI v9 `DataGrid` / `Table`** (+ `FlatTree` for the tree view) | Already a dependency; themed by our own fluentui package, so one theme system. `FlatTree` takes a flat list with parent values, which matches `toSlickGridTree`'s output [VERIFY]                   | No built-in virtualization in the core `DataGrid`; it needs a contrib package or custom windowing [VERIFY]. Large pages must be measured   |
| **TanStack Table + TanStack Virtual** (headless)                       | Full control, small, handles both flat and nested rows                                                                                                                                              | We write the rendering, keyboard model and ARIA ourselves. That is the most code to own                                                    |
| **AG Grid Community**                                                  | Mature                                                                                                                                                                                              | Heavy. Tree data is an Enterprise feature [VERIFY]. **Reject** unless both of the above fail                                               |

A mixed answer is acceptable: one library for the table view and another for the tree view. The two
views share nothing but the container. Our own cluster dashboard plan already preferred "a plain
Fluent `Table` over slickgrid" for a small, static table
([cluster-dashboard implementation plan](../features/cluster-dashboard/iterations/01-poc/implementation-plan.md)).

## 5. The plan, sequential

The same shape as the modernization plan: each step is a stretch of agent work followed by one
operator gate. Steps G1 to G3 change no user-visible behavior, so they can be merged one by one while
SlickGrid still ships.

### G1: make the host grid-neutral (no UI change)

- **Agent:** move `src/utils/slickgrid/**` to a neutral name (for example `src/utils/resultShapes/`),
  and rename `toSlickGridTable` / `toSlickGridTree` / `TreeData` / `CellValue` to names that describe
  the data rather than the grid. Same for `src/webviews/utils/slickgrid/typeToDisplayString`. The
  host must not know which grid renders its data.
- **Automated:** the existing shaping tests pass unchanged apart from the renames; build.
- **Operator:** review the diff. No manual UI check.

### G2: one internal grid interface

- **Agent:** define `ResultsTable` and `ResultsTree` components with props taken from §2 (headers,
  rows, selection callback, step-in callback, loading state). Make `DataViewPanelTable` /
  `DataViewPanelTree` thin SlickGrid-backed implementations of them. After this step,
  `slickgrid-react` is imported in exactly two files, both behind the interface.
- **Automated:** build; the L2 production-bundle pass (modernization plan, "The automated checks") shows the
  Collection View unchanged.
- **Operator:** a quick visual check of both views.

### G3: behavior tests before the swap

- **Agent:** Vitest + jsdom tests against the **interface**, one per item in §2. Assert behavior
  (callbacks called, context updated, tooltips and classes present), never SlickGrid DOM. jsdom has
  no layout, so a virtualized grid renders zero rows unless the container size is mocked. Mock it once
  in a shared helper.
- **Also:** L2 fixtures with fake host payloads built from the real types: a wide document (50+
  columns), deep nesting, every BSON type, a missing field, and a 1,000-row page. These drive both
  the current grid and the replacement.
- **Automated:** the new tests pass on **SlickGrid**. That proves they describe today's behavior.
- **Operator:** review the test list against §2; add anything users depend on that the list misses.

### G4: evaluation spike (time-boxed)

- **Agent:** build the table view with the leading candidate behind the G2 interface, in a branch.
  Run the G3 tests and the L2 fixtures against it. In the integrated browser, measure first render
  and scroll for the 1,000-row fixture, the chunk size from the bundle report, and the accessibility
  tree (`grid`, `row`, `gridcell`, `columnheader`, `aria-selected`, correct `aria-rowcount` /
  `aria-rowindex` under virtualization; the header row is expected and counted separately). Repeat for the tree view if
  the candidate claims to support it; otherwise spike the tree candidate separately.
- **Operator gate:** choose the library (or libraries), based on the numbers and a hands-on try in
  the packaged VSIX. Record the decision and the rejected candidates.

### G5: swap

- **Agent:** replace the implementations behind the interface; delete `slickgrid.scss` and the
  `slickgrid-react` dependency; recheck whether `allowSyntheticDefaultImports` is still needed; theme
  through Fluent tokens instead of SCSS overrides.
- **Automated:** G3 tests unchanged and green; L1 (the SlickGrid chunk is gone, the new chunk is
  within the size budget agreed at G4); L2 fixtures clean (no console errors, no CSP violations, no
  horizontal overflow at a narrow width).
- **Operator gate:** real data on a real cluster: large and wide collections, deep documents,
  keyboard-only use, a screen reader pass, and dark, light and high-contrast themes.

### G6: clean-up

- **Agent:** remove the stale-closure refs and the `react-hooks/refs` suppression if the new grid no
  longer needs them; update the E2E strategy document's SlickGrid-specific notes; release notes entry.

## 6. What this plan does not cover

- New grid features (column reorder, sorting in the table view, column picker). The contract in §2
  is today's behavior. Add features after the swap, not during it.
- The JSON view.
- Paging logic, which lives in `ClusterSession` and does not depend on the grid.
