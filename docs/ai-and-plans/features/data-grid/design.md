---
feature: data-grid
kind: design
status: active
created: 2026-11-27
code:
  - src/utils/documentGrid/**
  - src/documentdb/ClusterSession.ts
  - src/webviews/documentdb/collectionView/CollectionView.tsx
  - src/webviews/documentdb/collectionView/collectionViewContext.ts
  - src/webviews/documentdb/collectionView/components/resultsTab/**
---

# Collection View Table and Tree

## Boundary and data flow

The Table and Tree use the exact-pinned `react-data-grid@7.0.0-beta.64` dependency. The root
`package.json` declares the VS Code engine as `^1.123.0` (minimum 1.123.0). `ClusterSession`
shapes fetched documents into the grid-neutral types in `src/utils/documentGrid/`; the React
components consume `TablePage` and `TreeNode` data rather than raw database documents.

`TablePage` contains the root `_id` column, the fields at the active nested path, and rows in
server order. Each cell has separate display text and BSON type metadata. `toTreeNodes` creates
stable hierarchical nodes from documents; `useTreeRows` sorts siblings by field name and exposes
only roots and descendants whose ancestors are expanded. The tree is application-owned rather
than RDG's `TreeDataGrid`, so it can represent arbitrary document nesting and the current array
expansion bound.

## Identity and action safety

Identity and action eligibility are distinct from whether a row can be browsed or selected:

- The projection must leave the root `_id` trustworthy. A partial `_id` projection or computed
  `_id` makes identity untrusted.
- A safe `_id` is serialized as canonical Extended JSON and must round-trip without changing
  representation. Unsupported or unsafe values are not action identities.
- IDs are counted within the current fetched page. A unique safe ID yields `id:<canonical-id>`;
  otherwise the row gets a page-position key (`pos:<index>`) and no `documentId`.
- All rows remain visible and selectable. Document actions resolve selected keys against the
  current `TablePage` and fail closed if a page/key is stale or any row lacks `documentId`.

This deliberately does not introduce cross-page or cross-shard uniqueness handling. It also
does not promise that duplicate IDs will be rejected by the database.

## Table interactions

Plain click selects one row; Ctrl/Cmd-click toggles it; Shift-click extends the selection. Space
toggles the focused row and Shift+Space extends from the selection anchor. Enter on a focused
object cell, or double-clicking that cell, steps into that field. The handler rejects stale pages,
the root `_id` column, `_id` fields, and non-object values before changing the nested path.

Level Up returns one level. The ancestor breadcrumb jumps to that level, and Root Level returns to
the document root. The localized help beside the navigation controls explains these actions.

Long cell values ellipsize independently of the BSON type indicator; the full value text remains
in the DOM, with no additional per-cell Tab stop. The packaged-workbench path for inspecting a
full value, especially when its row has no actionable ID, remains to be verified.

## Tree behavior and grid focus

The application builds a flattened visible hierarchy with path-based node keys. Arrays expand
only up to the existing ten-element bound. The Tree uses RDG's `DataGrid` with `role="treegrid"`,
per-row `aria-level` and `aria-expanded`; it does not offer row selection. Enter on an expandable
Field cell toggles it without moving focus. The named chevron button provides the pointer action.
The 24 px expander and matching leaf slot align field names. The Fluent chevron rotates 90 degrees
over 100 ms when motion is allowed; reduced-motion preference removes the transition. The Tree
fills the results area and reserves a stable scrollbar gutter.

RDG owns grid-cell navigation. Arrow keys move through visible cells; Tab and Shift+Tab traverse
cells and row boundaries. Focus capture synchronizes RDG's active position with the cell reached
by native Tab navigation. A popup gets Escape first. In Table, when rows are selected, the first
plain Escape clears the selection and keeps focus on the current grid cell; a second returns focus
to the enabled view picker. With no Table selection, and in Tree, plain Escape exits immediately.
After clearing a Table selection, Space selects only the focused row if desired. Ctrl+Space is
not a row-selection binding. Styling removes the remembered active-cell outline when that cell is
not focused, so only the currently focused control shows a focus ring. Tree Space remains
scrolling, not selection or expansion.

## Verification and limits

The Vite L2-dev scenario runner is used on demand, not in CI. Start `npm run watch:views`, open
`http://localhost:18080/scenarios/`, then use `/<view>/<scenario>/<theme>` (`dark`, `light`, or
`high-contrast`, with no query string). Fetch `/scenarios/run-all.js` and execute it outside the
page with a Playwright `page`; the runner drives typed steps, waits for `data-ready`, and reports
assertions, errors, and host calls. The complete recipe is in
[`build/verification/README.md`](../../../../build/verification/README.md#l2-dev-source-scenarios).

G2 follow-ups checked Tree sizing and scrolling, expander behavior and reduced motion, Table value
ellipsizing, and localized step-in/breadcrumb help in browser scenarios. Forced-colors browser
emulation was checked, including the Tree chevron against the grid cell. A9's isolated VSIX
install and activation on VS Code 1.123.0 passed; it did not exercise a live Collection View.
The exact stable-version Collection View interaction check and screen-reader manual checks were
not done. Windows contrast themes in a packaged workbench also remain unverified. See the
[execution plan](./iterations/02-rdg-execution-plan.md) for A9 evidence and remaining G2/G3b checks.

Out of scope are spreadsheet-style cell-range selection, Tree row selection, and cross-page/shard
duplicate-ID mitigation. See [decisions](./decisions.md) and the
[execution plan](./iterations/02-rdg-execution-plan.md) for accepted rationale and gate history.
