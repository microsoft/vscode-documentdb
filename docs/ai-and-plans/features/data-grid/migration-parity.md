---
feature: data-grid
kind: checklist
status: active
created: 2026-11-26
verified: 2026-11-26
code:
  - src/webviews/documentdb/collectionView/**
  - src/utils/slickgrid/**
  - src/webviews/utils/slickgrid/**
  - src/documentdb/ClusterSession.ts
  - packages/documentdb-js-schema-analyzer/src/**
---

# Grid migration: no-loss contract

Companion to [the migration research](./migration-research.md), for
[#1101](https://github.com/microsoft/vscode-documentdb/issues/1101).
Inventory read at DocumentDB commit
[`8f81840d`](https://github.com/microsoft/vscode-documentdb/tree/8f81840d5aeeccece79321699e94d4789755a1fa).
This is a source-backed checklist, **not a claim that the current grid passes accessibility
testing**, nor that the replacement has been implemented or verified.

**Classification:** preserve = existing behavior; improve = an explicit migration acceptance
requirement or necessary accessibility equivalent; follow-up = optional new functionality.
Preserve the user outcome, not an implementation accident or a defect.

## 1. Table, nested documents and types

| ID  | Classification | Contract and evidence                                                                                                                                                                                                                                                                                                               |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 | Preserve       | Dynamic columns come from the schema at the current object path, not just the first document. Keep heterogeneous rows and fields absent from individual documents. `ClusterSession.getCurrentPageAsTable`, `SchemaStore.getPropertyNamesAtLevel`.                                                                                   |
| T02 | Preserve       | Include the root document's `_id` at nested levels; inject an `_id` header if absent. Nested inspection must not change which root document View/Edit/Delete acts on. `getDataAtPath`, `CollectionView.getDataForView`.                                                                                                             |
| T03 | Preserve       | Double-click an **object** cell to step into that field across the page, not just expand that one row. Other documents remain rows even if the path is missing. `_id` is deliberately not a step-in target. Arrays are not currently table step-in targets.                                                                         |
| T04 | Preserve       | Append the actual field name to the current path; allow Level up and direct jumps to Root Level or any breadcrumb ancestor. Retain the path-driven data reload and step-in telemetry. `ToolbarTableNavigation`, `CollectionView.handleStepInRequest`.                                                                               |
| T05 | Improve        | Provide a keyboard-equivalent step-in action and discoverable instruction, with predictable return focus. A mouse-only double-click handler is not an accessibility contract worth preserving unchanged.                                                                                                                            |
| T06 | Preserve       | Display the formatted value **and** a distinct data-type indicator. Currently indicators are CSS-generated short text (`Ab`, `i32`, `d128`, `{ }`, `[ ]`, `ID`, `U`, `U~`, etc.), with a full type-name tooltip. They are not images. A new icon/badge must retain the information and have an accessible textual type description. |
| T07 | Preserve       | Keep ordinary numbers, Int32, Double, Decimal128 and Long distinct; do not convert everything to JavaScript `number`. Preserve date, Boolean, ObjectId, binary, regex, timestamp and other BSON-aware display formatting. Reuse schema-analyzer formatters rather than a JSON-only partner formatter.                               |
| T08 | Preserve       | Retain UUID and UUID (Legacy) type annotations. These were explicitly added in [commit `02a8ae29`](https://github.com/microsoft/vscode-documentdb/commit/02a8ae29175fcdeb6b768a0916616905cd083d27); do not lose them in a generic JSON cell renderer.                                                                               |
| T09 | Preserve       | A missing field is blank with "This field is not set"; an explicit `null` is a typed value. Keep missing, null, empty string, false and zero distinguishable. Do not equate a blank display string with absent data.                                                                                                                |
| T10 | Preserve       | Table arrays summarize as `array[N]`. Objects use the shared formatter; tree containers use their own summaries. Preserve full-value access through document views; truncation must not become data loss.                                                                                                                           |
| T11 | Preserve       | Native text selection inside cells remains possible, without accidentally starting editing or invoking a document action.                                                                                                                                                                                                           |
| T12 | Improve        | Cell content and field names are data, never HTML. Render React text safely; expose tooltip/type information on keyboard focus as well as hover, without duplicate announcements.                                                                                                                                                   |

**Approved RDG disposition for T06/T12 (2026-11-27):** keep the visual type glyph, but mark it
decorative. For a defined value, put the full BSON type name before the value as visually hidden
text so the focused gridcell's accessible name includes, for example, `Int32 7`; do not add a Tab
stop. Remove the BSON type hover Tooltip under D8 because the type is now readable as text. The
missing-field `"This field is not set"` label/Tooltip behavior is unchanged. This is an appended
implementation disposition, not a rewrite of the legacy baseline above or a spoken-screen-reader
verification claim.

Primary sources:
[table](../../../../src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTable.tsx),
[type styles](../../../../src/webviews/documentdb/collectionView/components/resultsTab/dataViewPanelTable.scss),
[type labels](../../../../src/webviews/utils/slickgrid/typeToDisplayString.ts),
[table shaping](../../../../src/utils/slickgrid/mongo/toSlickGridTable.ts),
[value formatting](../../../../packages/documentdb-js-schema-analyzer/src/ValueFormatters.ts),
[type inference](../../../../packages/documentdb-js-schema-analyzer/src/BSONTypes.ts),
[Collection View](../../../../src/webviews/documentdb/collectionView/CollectionView.tsx).

## 2. Selection and document actions

| ID  | Classification | Contract                                                                                                                                                                                                                   |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | Preserve       | Single and multiple root documents can be selected. No selection disables Delete; View/Edit require exactly one selected row. Add remains available under its existing command rules.                                      |
| S02 | Preserve       | Keep selected document indexes and canonical BSON/EJSON root identifiers synchronized with the current rows. Sorting, paging, deleting or replacing results must never redirect an action to another document.             |
| S03 | Preserve       | View/Edit open the existing document workflow; the current table is **not** an inline database editor. Add and multi-document Delete remain host-owned operations, including their existing errors and confirmations.      |
| S04 | Preserve       | After acknowledged deletion, remove the deleted rows locally and clear selection. Do not unnecessarily reload/reset widths or focus.                                                                                       |
| S05 | Preserve       | Leaving/unmounting the table clears selection. Returning must not leave toolbar actions pointing at invisible old rows.                                                                                                    |
| S06 | Improve        | Separate focused/active cell from selected documents. Arrow navigation must not silently change a multi-document deletion target. Announce selection and provide keyboard multi-selection.                                 |
| S07 | Improve        | Use stable row identities and column keys for callbacks. Current timestamp-suffixed presentation IDs are not durable document identities; `x-objectid` carries the actual EJSON identifier.                                |
| S08 | Follow-up      | A checkbox column/select-all is desirable, but **not current working behavior**: explicitly disabled because dynamic column replacement broke it. Define select-all as the current loaded page, not the entire collection. |

Evidence: `DataViewPanelTable.onSelectedRowsChanged` and its cleanup;
`CollectionView.handleDeleteDocumentRequest`, `handleViewDocumentRequest`,
`handleEditDocumentRequest`; [document toolbar](../../../../src/webviews/documentdb/collectionView/components/toolbar/ToolbarDocumentManipulation.tsx);
`ClusterSession.deleteDocuments`.

**Adapter hazard:** current row objects mix document fields with `id` and `x-objectid` metadata.
The shaper itself records a collision TODO. Keep metadata separate in a neutral view model rather
than introducing another reserved user-field name. Do not use display strings as database IDs.
Test null/zero/false/empty-string and composite `_id` values: the current shaper's `if (doc._id)`
is a pre-existing truthiness limitation, not an approved behavior to reproduce.

## 3. Tree view is a separate release gate

| ID  | Classification | Contract                                                                                                                                                                                                                              |
| --- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R01 | Preserve       | Retain Table / Tree / JSON view switching. Tree is not dispensable because the table migrates successfully. JSON remains the existing Monaco view.                                                                                    |
| R02 | Preserve       | Arbitrary parent/child hierarchy with Field, Value and Type columns. Each document has a synthetic root labelled by its `_id`, with the document fields underneath, including `_id`.                                                  |
| R03 | Preserve       | Nodes initially collapsed; visible hierarchy, indentation and an obvious expand/collapse affordance. Current indentation is 15 px; exact pixels are less important than intelligible hierarchy.                                       |
| R04 | Preserve       | Nested objects show `{...}`. Arrays show `(elements: N)`; elements are materialized only for arrays of **at most 10** elements (the comparison is `<= 10`, despite the comment saying "less than"). Larger arrays retain their count. |
| R05 | Improve        | Keyboard expand/collapse, parent/child movement, visible focus, `aria-expanded` and correct hierarchy semantics. These are acceptance requirements, not verified claims about today's SlickGrid implementation.                       |
| R06 | Preserve       | Tree does not gain a separate server query, sort order or filter merely because a new component offers them. The current component enables filtering internally for tree rendering but hides the filter row and disables sorting.     |
| R07 | Improve        | Virtualize large expanded trees; keep focus meaningful when a parent collapses or data refreshes. Do not simply render every nested field in the DOM.                                                                                 |

Evidence:
[tree component](../../../../src/webviews/documentdb/collectionView/components/resultsTab/DataViewPanelTree.tsx),
[tree shaping](../../../../src/utils/slickgrid/mongo/toSlickGridTree.ts).
`react-data-grid`'s `TreeDataGrid` groups records by keys; it is **not** a drop-in reader of this
`parentId` document hierarchy. Its separate TreeView example demonstrates application-owned
flattening/expansion, not a complete arbitrary-depth accessible document tree.

## 4. Surrounding workflows and layout

| ID  | Classification | Contract                                                                                                                                                                                                                               |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W01 | Preserve       | Server-side filter, projection, sort, skip and limit remain in the query layer. The grid displays the current page; no accidental page-local replacement of database semantics.                                                        |
| W02 | Preserve       | First/previous/next page, page-size choices 10/50/100/500 and current page label. Query execution and page-size changes reset to page one as today. Query limit continues to cap the result window.                                    |
| W03 | Preserve       | Schema accumulation/shared completion data continue to work across results. Column-policy improvements must not be hidden inside a grid-library swap.                                                                                  |
| W04 | Preserve       | First-load skeleton, loading indicator, completion/empty-result announcements and user-visible host errors. Empty results still leave the query and navigation UI usable.                                                              |
| W05 | Improve        | Column resizing works reliably with pointer and keyboard; widths survive ordinary result updates according to an explicit policy. Container/side-panel resizing works without clipping the last row or introducing page-wide overflow. |
| W06 | Preserve       | Virtualized browsing of wide and long pages, horizontal scrolling and min-width protection. Measure against the current grid; "React-native" alone does not establish a performance improvement.                                       |
| W07 | Improve        | Light, dark and VS Code high-contrast themes, focus visibility, browser zoom and Windows forced colors. Map grid variables to VS Code/Fluent tokens; a grid with its own CSS is not automatically Fluent-themed.                       |
| W08 | Preserve       | Documents/Indexes/Query Insights tabs, query editor, cancellation, import/export commands and document editors continue independently. Do not confuse a grid's visible-row export with the extension's collection export service.      |
| W09 | Improve        | Keep focus by logical cell identity when possible after refresh. If that field/row disappears, move to a predictable surviving cell and announce the change. Never leave focus on a removed DOM node.                                  |

Evidence: `CollectionView`, `ClusterSession.find` and `getCurrentPageAsTable`,
[paging toolbar](../../../../src/webviews/documentdb/collectionView/components/toolbar/ToolbarViewNavigation.tsx),
[current theme](../../../../src/webviews/slickgrid.scss).
The table currently sets a 100 px minimum and enables SlickGrid autosizing; retaining usability is
the contract, not forcing every width to reset on each render.

## 5. Existing tests are a starting point, not parity proof

The table-shaping tests currently have three cases: root, one nested level, two nested levels.
The tree-shaping tests have single-document and multi-document cases. Neither suite proves
interaction, focus, type indicators, pointer resizing or screen-reader behavior.
The production browser fixture contains two simple rows and asserts SlickGrid-specific styles
(including a 7 px resize handle); those are implementation smoke checks, not migration contracts.

Keep the shaping tests. Add grid-neutral callback/selection/formatting contracts before replacing
the renderer, and change old CSS smoke assertions only alongside equivalent behavior checks.

## 6. Required migration evidence

Unchecked items below are **future work**; none was executed by this research task.

- [ ] A mixed-type page: every BSON enum member, explicit null, absent field, empty string, false,
      zero, long Unicode strings, escaped field names and values that look like HTML.
- [ ] Heterogeneous results with at least 50 columns; fields appear/disappear after queries,
      projection, paging and drilling two levels; `_id` remains associated with the root document.
- [ ] Select one/many rows, then reorder columns, resize, refresh, delete, change page and switch
      view; View/Edit/Delete always receive the correct canonical IDs.
- [ ] Step in by mouse and keyboard; step out and jump breadcrumbs; do not drill into scalar,
      array or `_id` cells. A missing nested object must not remove its document row.
- [ ] Deep tree, multiple roots, empty objects/arrays, arrays of 0/10/11 elements, nested arrays,
      and a very large array. Keyboard collapse returns focus to the appropriate ancestor.
- [ ] 1,000-row stress fixture (beyond the current UI's 500-row page choice), 50+ columns and a
      large expanded tree; measure first usable render, scroll responsiveness, DOM counts, memory
      trend and production JS/CSS size against the current build under the same conditions.
- [ ] Pointer resize, double-click fit where offered, keyboard resize, horizontal scroll,
      narrow panel, sidebar resize and zoom in light/dark/high-contrast themes.
- [ ] Keyboard-only full journey; NVDA and Windows Narrator in installed VS Code. Verify names,
      value/type descriptions, virtualized row/column indexes, selection announcements, no keyboard
      trap, refresh focus and nested-cell actions. Browser accessibility snapshots are supplementary.
- [ ] Existing find/query, paging, add/view/edit/delete, JSON view, import/export, Indexes and
      Query Insights journeys still work. No new CSP exceptions or runtime errors.

## 7. Deliberately not current functionality

Column picker/reorder, grid/header/context menus and checkbox selection are explicitly disabled
in the table. Sorting is currently a query-editor operation, not a table-header operation.
Focused-cell clipboard copying needs a defined value contract; selecting text is not the same
feature. Inline editing, bulk paste, fill handles and array drill-in are new features, not parity
requirements. Evaluate them separately rather than letting grid defaults enable database writes.
