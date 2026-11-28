---
feature: data-grid
kind: research
status: active
created: 2026-11-26
verified: 2026-11-26
code:
  - src/webviews/documentdb/collectionView/components/resultsTab/**
  - package.json
---

# Grid evaluation: SlickGrid 11 vs React Data Grid

Decision support for [#1101](https://github.com/microsoft/vscode-documentdb/issues/1101), comparing
`slickgrid-react` **11.0.0** (stable, 2026-11-10), which we already use at 9.13, with
`react-data-grid` **7.0.0-beta.64** (2026-11-05), which our partner extension Cosmos DB adopted.
Detailed evidence and sources are in [grid-options-evaluation.md](./grid-options-evaluation.md) and
[migration-research.md](./migration-research.md); this file states what we needed, how we checked
it, and the result. No prototype was built.

**Outcome:** migrate to React Data Grid, pinned to an exact beta. The deciding factor was
accessibility in row selection, a hard requirement for us. SlickGrid did well in many other
categories, and the last chapter describes how we might help it close the gaps we found.

## Our priorities

Stated by the operator on 2026-11-26, in order of weight:

1. **Accessibility is a hard requirement**, keyboard navigation in particular. It is applied as a
   gate: an option that cannot meet it is out, whatever its other scores. Our open accessibility
   bugs for this grid include a Sev1 for keyboard access to the table and tree
   ([#383](https://github.com/microsoft/vscode-documentdb/issues/383)).
2. **No functional loss** from today's Collection View: dynamic columns, BSON values and type
   markers, stepping into nested objects, multi-row selection for View/Edit/Delete, the Tree View,
   paging ([no-loss contract](./migration-parity.md)).
3. **Planned features** soon after the choice: pin `_id` (and more columns from the header),
   multi-cell selection with Shift+arrows or the mouse with copy to Excel, a context menu aware of
   that selection, and later in-cell editing.
4. **No fork.** We want to stay on upstream releases.
5. **Long-term maintainability:** release stability, maintainer activity, bus factor.
6. Migration effort is **not** a constraint. Column header grouping is **not** a deciding factor.
   A custom tree on React Data Grid is considered manageable.

## How we evaluated: looking for a way to stay on SlickGrid

We started from the position that **not migrating** was preferable: SlickGrid is already in place,
has stable releases, a very active maintainer, and built-in features we want (range selection,
Excel copy, tree data, editors). Each step below tried to confirm that staying was viable.

1. **Upstream review of SlickGrid 10 and 11.** Release notes and source since our pinned 9.13
   showed substantial accessibility and resizing work
   ([slickgrid-update-assessment.md](./slickgrid-update-assessment.md)). Our partner's March 2026
   rejection of SlickGrid predates most of it, so it could not be relied on.
2. **Partner history.** Cosmos DB's migration and its eight months of follow-up fixes
   ([migration-research.md](./migration-research.md)) showed what React Data Grid did and did not
   solve for them; it is evidence, not a reason in itself.
3. **Our own reported accessibility bugs.** Of four grid-related issues, two come from our own
   styling (focus outline and type-marker contrast) and one (resizing without dragging) needs app
   work on either grid. Only the keyboard Sev1 depends on the grid choice.
4. **Feature and cost mapping** of today's features and the planned ones onto both grids (see
   [Feature support](#feature-support-what-we-have-today-and-what-comes-next)). SlickGrid covers
   more out of the box; nothing is lost with either.
5. **Hands-on screen-reader check.** The operator tested the live demos of both grids with Windows
   Narrator in Edge (NVDA could not attach to the browser in this environment). This was a quick
   pass, not a full audit, using the libraries' own demos rather than our extension.

### Hands-on results

**SlickGrid 11** ([live demos](https://ghiscoding.github.io/slickgrid-react-demos/)):

| Demo       | Configuration ([source](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/demos/react/src/examples/slickgrid/Example48.tsx)) | Result                                             |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 48, grid 1 | `selectionType: 'mixed'` (cell ranges plus row selection on the `id` column), editable, Excel copy                                        | **Pass**: cell contents announced while navigating |
| 48, grid 2 | Same, plus `enableCheckboxSelector` and `selectionType: 'row'`                                                                            | **Fail**: navigation not narrated correctly        |
| 10         | Row selection with checkbox column, multi-select                                                                                          | **Issues**, apparently around multi-row selection  |
| 27         | Tree data (`parentId`), our Tree View's setup                                                                                             | **Fail**: no meaningful narration                  |

**React Data Grid** ([live demos](https://comcast.github.io/react-data-grid/)):

| Demo                                                                                         | Result                                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [CommonFeatures](https://comcast.github.io/react-data-grid/#/CommonFeatures) (row selection) | **Pass**: the selected checkbox state is announced, and header cells are narrated with position ("column x of y")                                            |
| [TreeView](https://comcast.github.io/react-data-grid/#/TreeView)                             | **Partial**: narration of rows and cells is good, but Enter or Space on the expand (chevron) button does nothing, so the tree cannot be expanded by keyboard |

**What we concluded from the tests:**

- **Row selection**, which drives our document actions, is the deciding difference: it narrated
  well on React Data Grid and did not on SlickGrid 11. This behaviour sits inside the library, so
  we cannot fix it in our own code.
- **Tree:** SlickGrid's tree data gave no meaningful narration. React Data Grid's tree demo
  narrated well, but its expand button did not respond to the keyboard; that button is example
  code in the demo
  ([`TreeView.tsx`](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/website/routes/TreeView.tsx)),
  not part of the library. We would build our own tree either way, and **an accessible document
  tree is the main piece of work we take on**.
- SlickGrid's cell and range mode narrated well, which shows the foundation is there.

Limits: these were the libraries' own demo configurations in a browser, with one screen reader. A
final check must run inside our packaged extension, ideally with NVDA as well.

## Scorecard

Scores are **1–10 judgments**, higher is better for us. Weight 5 = hard requirement, 3 = deciding,
2 = important, 1 = nice to have.

| #   | Category                                              | Weight |           SlickGrid 11            |                       RDG beta.64                        | Edge           |
| --- | ----------------------------------------------------- | :----: | :-------------------------------: | :------------------------------------------------------: | -------------- |
| 1   | Cell-range selection + Excel copy                     |   3    |               **9**               |                            5                             | SlickGrid      |
| 2   | Accessibility (average of 9 sub-scores)               | **5**  |                5.8                |                         **7.6**                          | RDG            |
| 3   | Release stability / API churn                         |   3    |               **8**               |                            3                             | SlickGrid      |
| 4   | Document (row) selection and actions                  |   2    |               **8**               |                            7                             | SlickGrid      |
| 5   | Tree view                                             |   2    |               **8**               |                            6                             | SlickGrid      |
| 6   | In-cell editing                                       |   2    |               **8**               |                            6                             | SlickGrid      |
| 7   | Column resizing (pointer, keyboard, width stability)  |   2    |                 6                 |                          **8**                           | RDG            |
| 8   | Maintainer activity and responsiveness                |   2    |               **8**               |                            5                             | SlickGrid      |
| 9   | Bus factor / governance                               |   2    |                 4                 |                          **5**                           | RDG (slightly) |
| 10  | React integration / developer experience              |   2    |                 4                 |                          **9**                           | RDG            |
| 11  | Look and feel in VS Code                              |   2    |                 6                 |                          **7**                           | RDG            |
| 12  | Partner alignment / proven in a VS Code extension     |   1    |                 5                 |                          **8**                           | RDG            |
| 13  | Bundle size and runtime footprint                     |   1    |                 6                 |                          **8**                           | RDG            |
| 14  | Built-in extras (export, menus, picker, row grouping) |   1    |               **9**               |                            4                             | SlickGrid      |
| 15  | Column header grouping                                |   1    |                 5                 |                          **8**                           | RDG            |
|     | **Weighted average** (total weight 31)                |        |                6.7                |                           6.3                            | SlickGrid      |
|     | Unweighted average                                    |        |                6.7                |                           6.4                            | close          |
|     | **Accessibility gate (hands-on)**                     |        | **Not yet** (row selection, tree) | **Pass** (row selection hands-on; tree is ours to build) | **RDG**        |

**Reading:** the weighted average slightly favours SlickGrid, because it adds up many categories in
which SlickGrid is strong: built-in range selection, editing, tree, extras, release stability and
maintainer activity. With accessibility as a hard requirement, the gate decides instead: React Data
Grid passed it for the configurations we need, and SlickGrid 11 did not yet.

### Sensitivity

| Change                                                 | SlickGrid | RDG | Result    |
| ------------------------------------------------------ | :-------: | :-: | --------- |
| As scored                                              |    6.7    | 6.3 | SlickGrid |
| Range-selection cost on RDG accepted (RDG cat. 1 → 7)  |    6.7    | 6.5 | SlickGrid |
| Release churn not a concern (both cat. 3 → 7)          |    6.6    | 6.7 | RDG       |
| Developer experience weighted 3 instead of 2           |    6.7    | 6.4 | SlickGrid |
| Accessibility applied as a gate (operator's rule)      |     —     |  —  | **RDG**   |
| SlickGrid 11 surprises positively in real a11y testing |     —     |  —  | Re-open   |

The weighted ranking flips only if the beta concern is dropped. Under the accessibility gate,
React Data Grid is the choice unless SlickGrid's row selection and tree pass a future check.

## Category details

### 1. Cell-range selection + Excel copy (weight 3) — SlickGrid 9, RDG 5

**SlickGrid:** built in. Hybrid selection (`selectionType: 'mixed'`) gives mouse-drag rectangles,
Shift+arrow extension and row selection in the same grid; `enableExcelCopyBuffer` copies TSV that
pastes into Excel. Live demo:
[Example 3](https://ghiscoding.github.io/slickgrid-react-demos/#/Example3). Our work: BSON copy
format, disable paste-to-write, keep document actions on the row-selection column. Estimate
**2–4 days**. Not 10 because the copy format and paste safety are ours.

**RDG:** not provided; requested since 2020 (Comcast/react-data-grid#2260), community PR open since
2022 (Comcast/react-data-grid#2865), pgAdmin forked. Scored 5 because, **unlike pgAdmin's base
version, beta.64 makes it possible without a fork** (next section), at a real cost.

#### Can we build range selection on RDG without forking?

**Yes, using public beta.64 APIs.** pgAdmin forked because it needed per-cell `onMouseEnter`,
range-aware cell classes and `aria-selected` inside the grid's `Cell` and `Row` components
(their diff adds exactly those). beta.64 exposes enough to do that from outside:

| Need                                    | Public beta.64 mechanism                                                                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start a drag                            | `onCellMouseDown` (gives row and column), `preventGridDefault()` to suppress default handling                                                                                                                                                          |
| Extend while dragging                   | Custom cell renderer: `renderers.renderCell(key, props)` returning the exported `<Cell {...props} onPointerEnter={…} />`. `Cell` spreads extra props onto the cell element.                                                                            |
| Highlight the range                     | Same wrapper: add a class and `aria-selected` for cells in range. `Cell` applies `{...props}` after its own `aria-selected`, so our value wins. A small store read with `useSyncExternalStore` re-renders only affected cells despite row memoisation. |
| Keyboard extension                      | `onCellKeyDown` (Shift+arrows, Shift+Home/End, Ctrl+A) with `preventGridDefault()`, plus `setActivePosition`                                                                                                                                           |
| Auto-scroll when dragging past the edge | `DataGridHandle.element` scroll plus `scrollToCell`; ours to implement                                                                                                                                                                                 |
| Copy                                    | `onCellCopy` or a `copy` listener on the grid; serialise the range from row data (works with virtualised rows)                                                                                                                                         |

Sources: [types.ts](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/src/types.ts),
[Cell.tsx](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/src/Cell.tsx),
[index.ts exports](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/src/index.ts),
[DataGrid.tsx](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/src/DataGrid.tsx);
pgAdmin's change: [pgadmin-org/react-data-grid@8ddaa7be](https://github.com/pgadmin-org/react-data-grid/commit/8ddaa7be).

**Estimated cost (engineering judgment, not measured):**

| Part                                             | Production code | Notes                                                                  |
| ------------------------------------------------ | --------------- | ---------------------------------------------------------------------- |
| Range state, mouse drag, highlight wrapper       | 150–250 lines   | Interaction with active cell, row selection and editing                |
| Keyboard extension and select-all                | ~100 lines      | Must not fight RDG's own Shift+Space row selection                     |
| Drag auto-scroll across virtualised rows/columns | ~80 lines       | Frozen `_id` column complicates hit-testing                            |
| TSV serialisation and clipboard                  | ~80 lines       | Same BSON format decision as SlickGrid                                 |
| Range announcement for screen readers            | ~50 lines       | `aria-selected` on cells plus a live summary ("3 by 4 cells selected") |
| Browser tests                                    | ~300 lines      | Drag, keyboard, scroll, copy, virtualisation                           |

Roughly **500–700 lines plus tests, about 2–3 developer-weeks** including accessibility review,
versus 2–4 days on SlickGrid. Ongoing cost: re-verify on every beta upgrade (about half a day to a
day each), because the wrapper depends on `RenderCellProps`, `Cell`'s prop spreading and
`CellMouseArgs`, all of which have been renamed in recent betas. That dependency, not the initial
build, is the main risk.

### 2. Accessibility (weight 5, hard requirement and gate) — SlickGrid 5.8, RDG 7.6

Sub-scores are judgments from source, release notes and issues. The hands-on Narrator check is
described in [How we evaluated](#how-we-evaluated-looking-for-a-way-to-stay-on-slickgrid); its
results are reflected in the gate, not in these sub-scores.

| Sub-category                         | SlickGrid 11 | RDG beta.64 | Evidence                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | :----------: | :---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keyboard navigation in cells         |      8       |    **9**    | Both: arrows, Home/End, Ctrl+Home/End, PageUp/PageDown, Tab, Enter/Escape. RDG documents the model in its README and its tests fail if page focus is lost.                                                                                                                                 |
| Header keyboard access (focus, sort) |      8       |    **9**    | SlickGrid: Tab into headers and menus, Enter/Space sort (10.0). RDG: headers in the roving tab order, Enter/Space sort, Ctrl+Enter multi-sort.                                                                                                                                             |
| Keyboard column resize               |      2       |    **9**    | RDG: Ctrl+Left/Right on a header. SlickGrid: none found in source or issues; we would add a header-menu "Resize column…" dialog.                                                                                                                                                           |
| Screen-reader semantics              |      7       |    **8**    | SlickGrid: `role=grid`, header row/rowgroup (10.10), row/column counts (10.0), `aria-sort` and `aria-selected` sync (11.0). RDG: `grid`/`treegrid`, row and column indexes under virtualisation; open PR Comcast/react-data-grid#4267 stops misusing `aria-selected` for the focused cell. |
| Focus management and visible focus   |      6       |    **9**    | SlickGrid: focus-visible styles and refined focus sink (10.0/10.2). RDG: rows focusable, focus sink removed (beta.60), focus contrast raised (Nov 2026), focus-loss tests.                                                                                                                 |
| High contrast / forced colours       |      4       |    **8**    | RDG: explicit forced-colours support (beta.64). SlickGrid: not established; would rely on our VS Code token mapping, to be verified in High Contrast themes.                                                                                                                               |
| Tree keyboard and semantics          |    **7**     |      5      | SlickGrid: Space/Left/Right expand and collapse (10.2), built in; but no meaningful Narrator output in the hands-on check. RDG: our own document tree; `aria-level`/`aria-expanded`/focus on collapse are ours.                                                                            |
| Range selection accessibility        |    **7**     |      5      | SlickGrid: Shift+arrow ranges, `aria-selected` on range cells. RDG: ours, via the `Cell` wrapper; `aria-selected` on range cells plus a live summary.                                                                                                                                      |
| Independent validation               |      3       |    **6**    | RDG: partner reviewer reported three screen-reader bugs fixed. SlickGrid v10/v11: none found; the partner rejected v9 for accessibility.                                                                                                                                                   |
| **Average**                          |   **5.8**    |   **7.6**   |                                                                                                                                                                                                                                                                                            |

**Gate result (after the hands-on check):**

- **React Data Grid: pass for the library.** Row selection, headers and navigation were narrated
  well. What remains is our own work: the document tree, range selection and a keyboard way to
  step into objects must be built accessibly, and each beta upgrade re-checked.
- **SlickGrid 11: not yet.** Cell and range mode narrated well, but row selection and tree data,
  the two configurations we depend on, did not. Both sit inside the library, so we cannot fix them
  in our own code. Several sub-scores above also depend on work we would add ourselves (keyboard
  column resizing, high-contrast styles).

SlickGrid's accessibility has improved a great deal across 10.x and 11.0, and much of that work is
recent. The gaps we found are specific and look addressable; see
[How we could help SlickGrid](#how-we-could-help-slickgrid-pass-these-checks).

#### Accessibility issues already reported against our grid

Four of the 23 `a11y`-labelled issues in this repository concern the Collection View grid; all are
open (checked 2026-11-26).

| Issue                                                                                                      | WCAG / severity | Cause                                                                                                                                                                                       | Depends on grid choice?                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#383](https://github.com/microsoft/vscode-documentdb/issues/383) Table and tree not keyboard accessible   | 2.1.1, **Sev1** | SlickGrid 9.13 focus and tree keyboard behaviour, plus ours (no keyboard step-in; active-cell border removed in our theme). A later comment says the **Tree View** is worse than the table. | **Yes.** RDG's table foundation is stronger; SlickGrid 11 has a built-in keyboard tree, while on RDG the tree's keyboard support is ours.                                                                                                                                                                                                                                            |
| [#775](https://github.com/microsoft/vscode-documentdb/issues/775) Cell focus indicator contrast below 3:1  | 1.4.11, Sev2    | **Ours**: 1 px `#aaaaaa` active-cell shadow in `slickgrid.scss`                                                                                                                             | No; fix in our theme either way (RDG's 2 px default helps).                                                                                                                                                                                                                                                                                                                          |
| [#776](https://github.com/microsoft/vscode-documentdb/issues/776) Column width only adjustable by dragging | **2.5.7**, Sev2 | No single-pointer alternative                                                                                                                                                               | No; needs a header menu with "Resize column…" and "Fit to content" on **either** grid. RDG's Ctrl+arrow resize is keyboard, not single-pointer. Cosmos DB fixed the same bug on SlickGrid v9 ([microsoft/vscode-cosmosdb#2666](https://github.com/microsoft/vscode-cosmosdb/issues/2666), [microsoft/vscode-cosmosdb#2723](https://github.com/microsoft/vscode-cosmosdb/pull/2723)). |
| [#382](https://github.com/microsoft/vscode-documentdb/issues/382) "AB" type marker contrast 2.85:1         | 1.4.3, Sev2     | **Ours**: `.typedTableCell::before` at `opacity: 0.4`                                                                                                                                       | No; fix in CSS, or replace with the planned type badge.                                                                                                                                                                                                                                                                                                                              |

**Effect on the scores:** none applied. Because #776 forces a header-menu resize dialog on both grids,
SlickGrid's "keyboard column resize" gap narrows in practice (that dialog is keyboard-operable);
raising that sub-score from 2 to 4 would move SlickGrid's accessibility average from 5.8 to 6.0 and
its weighted total by under 0.1, without changing the gate result. The Sev1 (#383) is the one that
matters: it confirms keyboard navigation of **both** table and tree is the acceptance test, and that
on RDG the accessible document tree is the highest-risk item we would own.

### 3. Release stability / API churn (weight 3) — SlickGrid 8, RDG 3

SlickGrid: stable semver, majors roughly every 6–9 months with migration guides (and AI migration
skills). RDG: 7.0 pre-release since 2019, last stable 2018, ~12 API renames between betas in the
last year, 7-month release gap, partner pinned to beta.61. RDG gets 3 rather than lower because
pinning is workable and the code is well tested.

### 4. Document (row) selection and actions (weight 2) — SlickGrid 8, RDG 7

Both support multi-row selection. SlickGrid's hybrid model lets row selection coexist with cell
ranges. RDG has a checkbox column; Cosmos DB still wrote click/Shift/Ctrl selection itself.

### 5. Tree view (weight 2) — SlickGrid 8, RDG 6

SlickGrid: `parentId` tree data, what we use today, keyboard expand/collapse since 10.2. RDG:
`TreeDataGrid` groups by key; an arbitrary document tree is application code, as in the
[TreeView demo](https://comcast.github.io/react-data-grid/#/TreeView) and Cosmos DB's tree.
Manageable, but ours to build and keep accessible (`aria-level`, expand state, focus on collapse).

### 6. In-cell editing (weight 2) — SlickGrid 8, RDG 6

SlickGrid: many editors, per-column validators, undo via edit command handler, composite row
editor. RDG: `renderEditCell`, text editor, `onRowsChange`; validation, undo and typed editors are
ours. The BSON round-trip and database write are ours either way.

### 7. Column resizing (weight 2) — SlickGrid 6, RDG 8

RDG: pointer and keyboard resize, double-click fit, controlled widths that survive paging. SlickGrid:
pointer resize fixed in 10.5/10.10/11.0, content sizing rewritten in 11.0, no keyboard resize. The
"headers resize when paging" problem is a width-retention policy we need with either grid.

### 8. Maintainer activity and responsiveness (weight 2) — SlickGrid 8, RDG 5

Last 12 months: SlickGrid ~1,025 human commits, 27 releases, 48 features, 182 fixes, 1 open issue.
RDG ~162 human commits (about two-thirds tooling), 6 releases, 47 open issues, community range PR
unreviewed for years. RDG's October–November 2026 work was strong, hence 5.

### 9. Bus factor / governance (weight 2) — SlickGrid 4, RDG 5

Both ≈1: SlickGrid 98% one person (personal repository; employer Schneider Electric appears to use
it); RDG 94% one person. RDG scores one point higher only because the repository belongs to the
Comcast organisation, which could appoint new maintainers; there is little evidence it would.

### 10. React integration / developer experience (weight 2) — SlickGrid 4, RDG 9

RDG is a React component with props and renderers. SlickGrid's React wrapper is a thin layer over
the framework-independent core: handlers are bound at initialisation (hence our ref workaround), we
call `renderGrid()` manually, and formatters return strings or HTML. That design lets one maintainer
support five frameworks, and he has said React is not his main focus; it is a fair trade-off for
the project, but it costs us more glue code.

### 11. Look and feel in VS Code (weight 2) — SlickGrid 6, RDG 7

Both need a VS Code token mapping. RDG's CSS variables are small and modern (`light-dark()`, forced
colours); its cells are React, so Fluent badges and icons fit naturally. SlickGrid has a Fluent theme
and Fluent icon set, but a larger SCSS surface and HTML-string formatters.

### 12. Partner alignment (weight 1) — SlickGrid 5, RDG 8

Same grid and visual language as Cosmos DB, with eight months of their fixes as lessons. Not higher
because their selection, tree, menus and theme are app-specific and reusable mostly as ideas and
tests. SlickGrid gets 5 because we already run it in production.

### 13. Bundle size and runtime footprint (weight 1) — SlickGrid 6, RDG 8

RDG has no runtime dependencies. SlickGrid brings seven packages, already isolated in a lazy chunk.
Not measured in our build.

### 14. Built-in extras (weight 1) — SlickGrid 9, RDG 4

SlickGrid: CSV/Excel/PDF export, header/context/grid menus, column picker, row grouping with
aggregators, pinning. RDG: reorder and summary rows; menus, picker and export are ours.

### 15. Column header grouping (weight 1) — SlickGrid 5, RDG 8

RDG supports nested header groups of any depth; SlickGrid one pre-header level. Not a deciding
factor for us.

## Feature support: what we have today, and what comes next

Not scored above; this chapter maps the Collection View's **current** features, and the additions
planned right after the grid choice, onto `slickgrid-react` 11.0.0 and `react-data-grid`
7.0.0-beta.64. Current behaviour is taken from the
[no-loss contract](./migration-parity.md) (IDs in brackets).

Legend: **Built-in** = configuration; **Hooks** = the grid provides events or renderers and we write
moderate code; **Ours** = we build it; **App** = lives outside the grid either way. Effort
estimates are judgments for one developer, not measurements.

### Features we ship today

| Today's feature                                                                                   | SlickGrid 11                                                                                                                                  | RDG beta.64                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Columns built from the schema at the current path, heterogeneous rows (T01)                       | Built-in. Same as today; avoid the v10 `hidden`-column changes affecting our dynamic `setColumns` use.                                        | Built-in. Columns are a memoised array keyed by field path.                                                                                                          |
| BSON value with a short type marker and type-name tooltip (T06–T08)                               | Hooks. Today's formatter (`text`, `addClasses`, `toolTip`) keeps working; markers stay CSS `::before` text unless we move to HTML formatters. | Hooks. A React `renderCell` can render a proper Fluent badge/icon with an accessible type description; tooltip via Fluent. **Better fit for the planned type icon.** |
| Missing field ≠ `null` ≠ empty string (T09)                                                       | Hooks (formatter, as today)                                                                                                                   | Hooks (`renderCell`)                                                                                                                                                 |
| Double-click an object cell to step in, breadcrumbs, Level up (T03–T04)                           | Hooks. `onDblClick`, as today; add a key handler for a keyboard equivalent. Breadcrumbs are App.                                              | Hooks. `onCellDoubleClick` plus `onCellKeyDown` (for example Enter) for the keyboard equivalent. Breadcrumbs are App.                                                |
| Native text selection inside a cell (T11)                                                         | Built-in (`enableTextSelectionOnCells`)                                                                                                       | Verify; not a documented option. See the conflict note below.                                                                                                        |
| Multi-row selection → enables View / Edit / Delete (S01–S02)                                      | Built-in. v10 renames `enableRowSelection` → `enableSelection`, `rowSelectionOptions` → `selectionOptions`.                                   | Hooks. `SelectColumn` checkbox column built-in; click/Ctrl/Shift row gestures are ours (Cosmos DB wrote them).                                                       |
| Delete removes rows locally and clears selection; clear on unmount (S04–S05)                      | App                                                                                                                                           | App                                                                                                                                                                  |
| Tree View: Field / Value / Type, collapsed initially, indentation, arrays ≤ 10 expanded (R01–R04) | Built-in tree data over our `parentId` list, as today. v11 drops the old `.slick-group-toggle` class.                                         | Ours. Flattened visible rows with an expander cell, as in the TreeView demo and Cosmos DB; `aria-level`/`aria-expanded` ours.                                        |
| JSON View (Monaco)                                                                                | Not a grid feature                                                                                                                            | Not a grid feature                                                                                                                                                   |
| Paging, page size, query, schema accumulation (W01–W03)                                           | App                                                                                                                                           | App                                                                                                                                                                  |
| First-load skeleton, empty result, announcements (W04)                                            | App (plus an optional empty-data warning component)                                                                                           | App (plus `renderers.noRowsFallback`)                                                                                                                                |
| Grid follows the container size (W06)                                                             | Hooks. Today's `ResizeObserver` + `resizeGrid()`; v11 autoResize improvements.                                                                | Built-in. The grid sizes with CSS and observes itself.                                                                                                               |
| Minimum column width, auto-size columns                                                           | Built-in (`minWidth`, auto-size; v11 canvas-based content sizing)                                                                             | Built-in `minWidth`; content-fit on double-click of the resize handle. No automatic fit on load.                                                                     |
| Keyboard cell navigation (T05, W09)                                                               | Built-in                                                                                                                                      | Built-in                                                                                                                                                             |
| VS Code theming, light/dark/high contrast (W07)                                                   | Hooks. SCSS variable overrides, as today, or the Fluent theme.                                                                                | Hooks. Map `--rdg-*` variables to VS Code tokens, as Cosmos DB did.                                                                                                  |

**Conclusion for today's features:** nothing we ship today is lost with either grid. SlickGrid covers
more of it with configuration, especially the tree. RDG needs the tree and row gestures written by
us, but is the better base for the planned richer type icon.

### Planned additions after the grid choice

| Planned feature                                          | SlickGrid 11                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | RDG beta.64                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pin `_id` by default**                                 | Built-in: `pinned: 'left'` on the `_id` column (v11 pinning). **XS**, under a day.                                                                                                                                                                                                                                                                                                                                                                                                                            | Built-in: `frozen: 'start'` on the `_id` column. **XS**, under a day.                                                                                                                                                                                                                                                                                    |
| **Pin more columns from the header** (pin icon)          | Built-in commands: the v11 Header Menu includes "Pin to Left / Pin to Right / Unpin" by default; `pinnable: false` keeps `_id` locked. A pin icon in the header itself is the Header Buttons plugin. We keep pinned field paths across schema/page changes. Menu text needs our `l10n` strings via the `locales` option. **S**, 2–3 days.                                                                                                                                                                     | Hooks: a pin toggle button in `renderHeaderCell` (Fluent icon button, `aria-pressed`), state in React, `frozen` set per column. Frozen columns move to the edge, so the visible order changes. Header buttons must use the cell's `tabIndex` to join the header's keyboard model, as Cosmos DB's header menu does. **S**, 2–4 days.                      |
| **Multi-cell selection** with Shift+arrows or mouse drag | Built-in: hybrid selection (`selectionType: 'mixed'`), range decorator, Shift/Ctrl+Shift keys, Excel copy. Keep document actions on a row-selection column (`rowSelectColumnIds`). **S**, 2–4 days incl. BSON copy format.                                                                                                                                                                                                                                                                                    | Ours, without a fork (see [category 1](#can-we-build-range-selection-on-rdg-without-forking)): drag, Shift+arrow, highlight via a `Cell` wrapper, auto-scroll, copy, announcements. **M–L**, 2–3 weeks, plus re-checking on each beta upgrade.                                                                                                           |
| **Context menu aware of the multi-selection**            | Built-in plugin: `enableContextMenu` with `commandItems`; `itemVisibilityOverride` / `itemUsabilityOverride` and `onCommand` can read `grid.getSelectionModel().getSelectedRanges()` to show, for example, "Copy 12 cells", "Copy as JSON", or hide single-cell commands. Menu keyboard navigation improved in 10.x. Caveats: it is SlickGrid's own menu DOM (Fluent icon set available, not Fluent React components); opening via the keyboard Context Menu key / Shift+F10 needs checking. **S**, 2–4 days. | Hooks: `onCellContextMenu` opens a Fluent `Menu` positioned at the pointer; Shift+F10 / Context Menu key via `onCellKeyDown`; selection awareness from our own range store (right-clicking inside the range must not collapse it: `preventGridDefault`). Fully Fluent, consistent with the rest of the webview. **S–M**, 3–5 days, after the range work. |

**Conflict to design for (both grids):** once mouse dragging selects cell ranges, the same gesture
can no longer select text inside a cell. Decide which wins (for example drag selects cells; double-click
or F2 enters a cell to select text), and keep copying a single value easy.

**Rough totals for the four planned additions:**

|                              | SlickGrid 11                                                  | RDG beta.64                                               |
| ---------------------------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Pinning (`_id` + header pin) | 2–3 days                                                      | 2–4 days                                                  |
| Multi-cell selection + copy  | 2–4 days                                                      | 2–3 weeks                                                 |
| Selection-aware context menu | 2–4 days                                                      | 3–5 days                                                  |
| **Total**                    | **~1.5–2 weeks**                                              | **~3.5–4.5 weeks**                                        |
| Result                       | Mostly configuration of built-ins; menus are SlickGrid-styled | Mostly our React code; fully Fluent and under our control |

On SlickGrid the planned work is cheaper; on RDG it costs about 2–3 extra weeks but produces Fluent
menus and selection behaviour we control end to end. That difference is mainly range selection, and
it is a one-time cost plus upgrade checks, not a blocker.

## Conclusion

**Recommendation: migrate to React Data Grid, pinned to an exact beta.**

- **Accessibility decides it.** In the hands-on check, React Data Grid's row selection narrated
  well and SlickGrid 11's did not; that is library behaviour we cannot fix ourselves.
- **Range selection does not need a fork.** beta.64's public renderer and event APIs are enough:
  about 2–3 developer-weeks, plus a check on each beta upgrade.
- **What we take on:** an accessible document tree, range selection, editing extras such as
  validation and undo, pinning a beta and budgeting for API renames, and one dominant maintainer
  (as with SlickGrid).
- **Planned additions** (pinning, multi-cell selection, a selection-aware context menu) cost about
  1.5–2 weeks on SlickGrid and 3.5–4.5 weeks on React Data Grid, almost all of the difference
  being range selection.
- **What would reverse this:** SlickGrid's row selection and tree passing a screen-reader check in a
  future release, or React Data Grid stalling or breaking APIs badly enough that pinning stops
  being workable.

Build a grid-neutral boundary in our code first either way; it keeps the other option open.

## How we could help SlickGrid pass these checks

SlickGrid is maintained essentially by one person, who has been generous with his time towards our
team (every issue we previously opened was fixed) and who has shipped a large amount of
accessibility work across 10.x and 11.0. Nothing here is a request or an expectation. It records
the criteria we used, where SlickGrid 11 fell short of them in our check, and paths that might
resolve each gap, so that we can offer help (issues with reproduction steps, or pull requests) if
that is welcome.

### Criteria we used

- A keyboard-only user can reach the grid, move between cells and headers, and always see where
  focus is.
- A screen reader announces each cell with its column, the row position, and any selection state.
- **Row selection** (checkbox column and keyboard) announces selected and not selected, and
  navigation keeps being narrated while it is enabled.
- **Tree data** announces each row's level and expanded or collapsed state, and can be expanded and
  collapsed from the keyboard.
- Column widths can be changed without dragging (WCAG 2.5.7) and from the keyboard.
- Focus, selection and range highlights stay visible in Windows high-contrast themes.

### What we observed, and possible paths

| Area                      | What we observed (SlickGrid 11.0.0)                                                                                                                                                                            | Possible path                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Row selection             | In demo 48, grid 2 (`selectionType: 'row'` with a checkbox column) and in demo 10, Narrator did not narrate navigation correctly, while grid 1 (`'mixed'`) did.                                                | Compare the accessibility tree of grid 1 and grid 2 (for example in `edge://accessibility` or with Accessibility Insights) to find what the row-selection mode changes: focus target, roles on the checkbox cell, or `aria-selected` on rows versus cells. A small reproduction and an issue would be the first step; a fix may be local to the row-selection path. |
| Tree data                 | Demo 27 gave no meaningful narration. In the v11 source, `aria-expanded` is on the toggle icon inside the cell, and rows carry no `aria-level`, `aria-setsize` or `aria-posinset`; the grid role stays `grid`. | Expose tree state on the row: `aria-level`, `aria-expanded`, and optionally `aria-setsize`/`aria-posinset`, with the grid role switched to `treegrid` when tree data is enabled. The tree service already knows each item's level, so this may be a contained change. A good candidate for a pull request from us.                                                  |
| Keyboard column resize    | The resize handle has `role="separator"` but is not focusable, and no keys resize a column.                                                                                                                    | Either support Ctrl+Left/Right on a focused header (as some other grids do), or make the handle focusable with `aria-valuenow` and arrow-key handling. Worth discussing first, since it touches header and resize design.                                                                                                                                           |
| Resizing without dragging | The header menu offers "Resize by content" but no way to enter a width.                                                                                                                                        | An optional "Resize column…" header-menu command that opens a small dialog for a width in pixels. It would help every SlickGrid user meet WCAG 2.5.7; we would need it in our own app regardless.                                                                                                                                                                   |
| High contrast             | No `forced-colors` rules in the v11 stylesheets.                                                                                                                                                               | A `@media (forced-colors: active)` block mapping the active cell, selected rows and range highlight to system colours (`Highlight`, `CanvasText`, `SelectedItem`). Self-contained and low risk; another good candidate for a pull request.                                                                                                                          |
| Documentation             | The [accessibility page](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/frameworks/slickgrid-react/docs/features/accessibility.md) lists the main keys and roles.                              | Add tree keys (Space, Left, Right), range keys (Shift and Ctrl+Shift with arrows), header and menu keys, and which configurations have been checked with a screen reader.                                                                                                                                                                                           |

### How we might offer it

1. Share these observations as separate, specific issues with the demo, the keys pressed and what
   Narrator said, so each can be judged on its own.
2. Offer pull requests where the change is contained (tree row semantics, high-contrast styles,
   documentation), and ask before proposing anything that touches header or resize design.
3. Re-run the same Narrator check, plus NVDA, on any release that includes changes, and share the
   results back.

If row selection and tree data pass that check in a future release, we would reopen this decision,
since SlickGrid would then meet our hard requirement with more built in.
