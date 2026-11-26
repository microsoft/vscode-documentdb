---
feature: data-grid
kind: research
status: active
created: 2026-11-26
verified: 2026-11-26
code:
  - src/webviews/documentdb/collectionView/**
  - src/utils/slickgrid/**
---

# React Data Grid: current capabilities and inexpensive additions

Companion to [the migration report](./migration-research.md).
This assesses **`react-data-grid`**, not Fluent UI's similarly named `DataGrid`.
The former `adazzle/react-data-grid` GitHub location now redirects to
[`Comcast/react-data-grid`](https://github.com/Comcast/react-data-grid).

## 1. Version matters more than the beta label alone

On **2026-11-26**, the latest GitHub release and the preconfigured npm registry's `latest` are
**[7.0.0-beta.64](https://github.com/Comcast/react-data-grid/releases/tag/v7.0.0-beta.64)**,
published 2026-11-05. The npm `beta` dist-tag still points to beta.58; do not install `@beta`
assuming it means the newest release. Pin the evaluated version explicitly.

The [beta.64 package](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/package.json)
is MIT licensed, declares React/React DOM `^19.2` peers and no runtime `dependencies`.
Our `~19.2.4` peers are compatible. That does not make the feature bundle weight zero: the grid,
CSS and any adapters still have to be measured in our production build.

The beta API **has changed** since the partner's original integration; using a mature integration
does not exempt us from version-specific adaptation. Verified release milestones:

| Version | Published | Changes that matter to an adopter |
| --- | --- | --- |
| [beta.59](https://github.com/Comcast/react-data-grid/releases/tag/v7.0.0-beta.59) | 2025-12-04 | The partner's original migration version, also mentioned in our September removal plan. It already requires React/React DOM `^19.2`; its API differs from beta.64. |
| [beta.60](https://github.com/Comcast/react-data-grid/releases/tag/v7.0.0-beta.60) | 2026-07-09 | Made rows focusable and removed the focus sink; changed selected-position terminology to active-position; reworked frozen shadows and added start/end column pinning. Significant focus/API evolution, not only dependency updates. See [Comcast/react-data-grid#3963](https://github.com/Comcast/react-data-grid/pull/3963), [Comcast/react-data-grid#3979](https://github.com/Comcast/react-data-grid/pull/3979), [Comcast/react-data-grid#4034](https://github.com/Comcast/react-data-grid/pull/4034). |
| [beta.61](https://github.com/Comcast/react-data-grid/releases/tag/v7.0.0-beta.61) | 2026-07-14 | Packaging fix removes a dangling `ecij` import after the build-tool change: [Comcast/react-data-grid#4100](https://github.com/Comcast/react-data-grid/pull/4100). This is the partner's current exact pin, incorporating the preceding focus/API changes. |
| [beta.62](https://github.com/Comcast/react-data-grid/releases/tag/v7.0.0-beta.62) | 2026-10-19 | React Compiler build work; cross-window support; tree parent focus on Left Arrow. See [Comcast/react-data-grid#4161](https://github.com/Comcast/react-data-grid/pull/4161), [Comcast/react-data-grid#4194](https://github.com/Comcast/react-data-grid/pull/4194), [Comcast/react-data-grid#4202](https://github.com/Comcast/react-data-grid/pull/4202). |
| [beta.63](https://github.com/Comcast/react-data-grid/releases/tag/v7.0.0-beta.63) | 2026-10-25 | Broad naming changes, event cancellation fixes, PageUp/PageDown fixes, and grouping API changes (`rowGrouper` to `getRowGroupKey`, `groupIdGetter` to `getGroupId`). See [Comcast/react-data-grid#3967](https://github.com/Comcast/react-data-grid/pull/3967), [Comcast/react-data-grid#4217](https://github.com/Comcast/react-data-grid/pull/4217), [Comcast/react-data-grid#4159](https://github.com/Comcast/react-data-grid/pull/4159). |
| beta.64 | 2026-11-05 | `rowKeyGetter` becomes `getRowKey`; keyboard resize ends on keyup/blur; selection-update and frozen-cell scrolling fixes; forced-colors support; editor/resize/reduced-motion accessibility fixes. See [Comcast/react-data-grid#4261](https://github.com/Comcast/react-data-grid/pull/4261), [Comcast/react-data-grid#4249](https://github.com/Comcast/react-data-grid/pull/4249), [Comcast/react-data-grid#4239](https://github.com/Comcast/react-data-grid/pull/4239), [Comcast/react-data-grid#4247](https://github.com/Comcast/react-data-grid/pull/4247), [Comcast/react-data-grid#4244](https://github.com/Comcast/react-data-grid/pull/4244), [Comcast/react-data-grid#4246](https://github.com/Comcast/react-data-grid/pull/4246). |

Current upstream main was also checked at
[`d6942fd6`](https://github.com/Comcast/react-data-grid/tree/d6942fd60d1cf1045442055b7fff231c351d21a0)
(2026-11-25), but the capabilities below are grounded in **released beta.64** source/docs, not
assumed available from unreleased main.

### The partner's runtime warning needs a version-specific check

[microsoft/vscode-cosmosdb#3449](https://github.com/microsoft/vscode-cosmosdb/pull/3449)
records a reason to pin beta.61: beta.63 renamed a header-renderer type and was reported to use
`getOrInsertComputed`, unavailable in their runtime. Treat that as the partner's recorded
compatibility constraint, **not proof that beta.64 requires that method**.
Upstream [Comcast/react-data-grid#4227](https://github.com/Comcast/react-data-grid/pull/4227)
explicitly replaced the grouping implementation's `getOrInsertComputed` with `get`/`set`, and is
included in beta.63's release notes. The tagged beta.63 and beta.64 `TreeDataGrid.tsx` show that
replacement (the method name remains in an explanatory comment).

This is a mismatch between the partner's rationale and the inspected upstream source, not a basis
for declaring the newer package safe. Check the actual published bundle and run it inside our
minimum supported VS Code/Electron runtime before choosing the final pin. A published-bundle
inspection was not completed; direct npmjs.org access is not permitted. Use approved artifact
sources/tooling for that gate. Runtime compatibility was not established by this research.

## 2. What is actually cheap?

Effort below is **incremental after a parity-complete table migration**, not an estimate for the
migration itself. XS = a prop/default plus styling/checks; S = a small renderer/state callback;
M = a separate behavior design or cross-layer integration. These are engineering judgments, not
time commitments. All new user-facing features remain follow-up work under #1101's scope.

| Opportunity | Effort | Built-in support and remaining work | Important limit |
| --- | --- | --- | --- |
| Reliable pointer **and keyboard** column resize | XS | Set `resizable: true`; header Ctrl/Meta+Left/Right changes width. The handle supports pointer capture and double-click `max-content` fitting. | Verify in VS Code, not just the demo. Fitting virtualized content is not a guarantee of inspecting every value in the database. Core resizing is also a migration acceptance requirement, not merely a bonus. |
| Pin `_id` while scrolling wide results | XS | `frozen: 'start'` (or `true`) on the identifier column. beta.64 also supports `'end'` for a trailing action column. | Frozen columns consume space in narrow panels. This was possible in SlickGrid too, but is not enabled in our current table. |
| Remember manual widths and reset them | S | `columnWidths` plus `onColumnWidthsChange` gives controlled width state. Add a reset action. | Key by field/path and reconcile disappearing columns. In-session retention is cheap; durable per-collection persistence needs an explicit storage policy. |
| Checkbox multi-selection and select current page | S | `SelectColumn`, `selectedRows`, `onSelectedRowsChange` and `getRowKey`. | Integrate command enablement and canonical IDs; specify "current page". Do not count checked/focused cells as selected documents. |
| Copy focused cell's **displayed** value | S | `onCellCopy` supplies the logical row/column and clipboard event. Write text with the existing clipboard route if needed. | Current payload has display values: arrays are `array[N]`. Copying canonical BSON/EJSON or raw nested data needs additional host data and is **not** the same cheap feature. |
| Keyboard step-in and an explicit object-cell affordance | S | `renderCell`, `onCellDoubleClick`, `onCellKeyDown` and active-position hooks. | Custom DocumentDB behavior, not a built-in JSON explorer. Preserve event/default navigation and accessible names. Keyboard equivalence belongs in parity. |
| Better datatype badge/icon plus full description | S | Render a small React value/type component with existing type metadata. | Do not discard UUID/BSON distinctions or encode type only in color. An icon font/CSS pseudo-element alone is not an accessible name. |
| Column drag/reorder | S | `draggable: true` and `onColumnsReorder` provide native interaction; apply the new column order in state. | Actions must use field keys, never old column indexes. Supply a keyboard alternative if exposing reorder. Persistence is separate. |
| Hide/show columns and reset layout | S-M | Keep a full column model and pass a filtered visible list; add a small Fluent menu. | There is no turnkey column-picker prop in the cited API. Distinguish presentation hiding from server projection; never hide `_id` metadata from document actions. |
| Wrap long values / larger or variable rows | S | Row-height options and custom cell rendering/styles. | Test virtualization, truncation, density and keyboard visibility. Arbitrarily measuring all document heights is not free. |
| Empty-results content | XS | `renderers.noRowsFallback`. | Keep query controls and existing empty/loading announcements; avoid redundant announcements. |
| Read-only cell context actions | S-M | `onCellContextMenu` plus a Fluent menu; reuse View/Edit/Copy/Step in handlers. | The menu, its focus lifecycle and keyboard invocation are application code, not an included polished menu component. |

Sources for the table:
[beta.64 README/API](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/README.md),
[column types](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/src/types.ts),
[header/resize implementation](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/src/HeaderCell.tsx),
[DataGrid callbacks](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/src/DataGrid.tsx),
[controlled reordering example](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/website/routes/ColumnsReordering.tsx).

**Suggested inexpensive follow-up bundle:** pin `_id`, display-value copy, checkbox selection,
width retention/reset, and a type-aware cell renderer. Reorder/hide can follow once key-based
actions and column reconciliation are proven. None is automatically enabled by changing imports.

## 3. Available library features that are not cheap database features

| Feature | Why it is not just a switch for us |
| --- | --- |
| Header sorting / multi-sort | The grid supplies sort state and gestures; the application supplies ordering. Sorting only the loaded page would misleadingly differ from the query editor's server sort. Integrate with query execution, paging, BSON comparisons and refresh semantics. |
| Grouping / summary rows | `TreeDataGrid` groups records by column values, and summary rows display application-computed values. A loaded page is not the whole collection. Labels and scope must be truthful. |
| Inline editing | Editors and `onRowsChange` do not implement database validation, BSON round-tripping, optimistic concurrency, `_id` restrictions, write errors or undo. Keep the existing document editor initially. |
| Paste / fill handle / spreadsheet bulk changes | `onCellPaste` and `onFill` can return changed local rows. Safe database writes, validation and confirmation remain ours. Do not enable them implicitly. `TreeDataGrid` does not support fill. |
| Whole-collection export | Grid examples can serialize rendered/application rows; they do not replace our host-side collection export, query window or BSON serialization. |
| Arbitrary nested document tree | `TreeDataGrid` takes `groupBy` and `getRowGroupKey`, not our `parentId` tree. It groups data rather than interpreting object/array fields. |
| Full accessible context/column/filter menu system | Event hooks and renderers are available, but a complete menu/filter product is not provided by those hooks. |

The upstream
[TreeView example](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/website/routes/TreeView.tsx)
uses ordinary `DataGrid` with application-managed flattened children, expansion and cell controls.
It demonstrates feasibility, not a ready-made arbitrary-depth document explorer with complete
treegrid semantics. Porting it without tree keyboard/ARIA work would be a regression.

## 4. Accessibility and integration caveats

The built-in keyboard model includes arrows, Home/End, Ctrl/Meta+Home/End, PageUp/PageDown,
Tab boundaries, Shift+Space row selection and keyboard header resizing. These are a stronger
starting point than rebuilding a grid from bare HTML, **not proof our custom cells are accessible**.

beta.64's forced-colors work is particularly relevant to Windows users. Its PR explicitly notes
that browser emulation is not a real Windows contrast-theme check. Custom overrides of
`--rdg-selection-color` and `--rdg-checkbox-focus-color` can override forced-color values; scope
ordinary theme overrides appropriately and verify with the actual OS theme.

Keep the grid's own stylesheet and adapt its variables to VS Code tokens. It is not themed
automatically by our `VSCodeFluentProvider`. The README flags a Lightning CSS `light-dark()`
minification issue with Vite 8+; inspect our actual build path and packaged CSS before adding a
workaround. Do not add a build change merely because another application's build needed it.

The current grid has its own memoization expectations: keep column arrays stable, update rows
immutably and retain unchanged row objects. Replacing SlickGrid removes its particular imperative
event binding; it does not eliminate every possible stale closure, focus bug or expensive rerender.

**Version recommendation:** evaluate beta.64 as the primary spike pin and compare against the
partner's exact pinned version documented in the main report. Adopt it only after parity,
accessibility and packaging gates pass. Partner experience on an older beta does not establish
that newer renamed APIs or fixes have already been battle-tested there.
