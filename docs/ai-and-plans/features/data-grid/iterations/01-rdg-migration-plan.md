---
feature: data-grid
kind: plan
status: active
created: 2026-11-26
code:
  - src/webviews/documentdb/collectionView/components/resultsTab/**
  - src/webviews/documentdb/collectionView/CollectionView.tsx
  - src/webviews/slickgrid.scss
  - src/webviews/utils/slickgrid/**
  - src/utils/slickgrid/**
  - src/documentdb/ClusterSession.ts
  - vite.config.views.mjs
  - build/verification/**
---

# Iteration 1: migrate the Collection View grid to React Data Grid

**Status:** accepted by the operator on 2026-11-26. High level: ordered work items with pointers to
the research; interfaces, file layouts and test lists are deliberately left to the next planning
iteration. Tracks
[#1101](https://github.com/microsoft/vscode-documentdb/issues/1101).

**Goal:** the migration itself, plus whatever the migration fixes on its own. Remaining
accessibility issues and new features are later iterations (see
[After this feature](#after-this-feature)).

**Basis:** the [grid scorecard](../grid-scorecard.md) recommendation (React Data Grid, exact-pinned
beta, accessibility as a hard gate) and the [no-loss contract](../migration-parity.md). The
[earlier removal plan](../slickgrid-removal.md#5-the-plan-sequential) assumed both grids would
ship side by side behind an interface, with an operator gate per stage. This plan drops that: it is
a straight replacement on a feature branch, verified mostly by automation.

## How the work is organised

- **One feature branch.** All work items merge into a `feature/` branch; the branch merges into
  `main` once, when the migration is complete and SlickGrid is gone. Nothing ships before that.
- **No coexistence.** SlickGrid is removed at the start, not the end. The Collection View may be
  broken between work items; there is no interface layer, switch or setting to keep both grids
  running.
- **Automation first.** The agent explores and verifies with Playwright against the L2-dev
  scenarios (`npm run watch:views`, `/scenarios/collectionView/...`, `run-all.js`; see
  [build/verification/README.md, L2-dev](../../../../../build/verification/README.md#l2-dev-source-scenarios)).
  Playwright covers rendering, ARIA structure, keyboard journeys, focus, selection, resizing,
  narrow widths, zoom, the three VS Code themes and emulated forced colours.
- **Three operator gates only:** approve the start (G1), a hands-on check once both views work
  (G2), and the final acceptance (G3). Only what automation cannot judge goes to the operator:
  real screen readers, Windows contrast themes, a real cluster and overall feel.
- **Native context menus.** Any grid menu uses VS Code's `webview/context` contribution with
  `data-vscode-context` on the target element, with commands executed on the host, as the Cluster
  Dashboard does ([cluster-dashboard decision 0016](../../cluster-dashboard/decisions.md#0016--row-context-menu-entries-run-on-the-host);
  `src/webviews/documentdb/clusterDashboard/clusterDashboardContextMenu.ts`). No Fluent or grid
  menus. This feature adds no menus; the rule applies to the later iterations.

## Guiding rules

From the operator's priorities in the research
([grid-scorecard.md, Our priorities](../grid-scorecard.md#our-priorities)).

1. **Accessibility is a gate, not a score.** Keyboard navigation of table _and_ tree
   ([#383](https://github.com/microsoft/vscode-documentdb/issues/383), Sev1) is the acceptance test.
2. **Replicate outcomes, not SlickGrid.** The scope is the [list below](#scope-what-the-migration-replicates),
   not the parity contract wholesale. Where RDG's default is good enough, take it. Tests assert
   what the user can do, never SlickGrid's DOM, classes, pixel values or timing.
3. **Parity first, features after**
   ([migration-parity.md §7](../migration-parity.md#7-deliberately-not-current-functionality)).
4. **No fork; exact pin** in manifest and lockfile
   ([react-data-grid-capabilities.md §1](../react-data-grid-capabilities.md#1-version-matters-more-than-the-beta-label-alone)).
5. **Identity by key, never by index.** Documents by canonical root `_id`, columns by field path
   ([migration-parity.md §2, adapter hazard](../migration-parity.md#2-selection-and-document-actions);
   [migration-research.md §5](../migration-research.md#feature-coupling-worth-copying-carefully)).
6. **Learn from Cosmos DB's follow-ups; do not copy its code.** Its fixes become our tests
   ([migration-research.md §4](../migration-research.md#4-evolution-after-migration)).

## Scope: what the migration replicates

The [no-loss contract](../migration-parity.md) inventories everything today's grid does. Much of it
is SlickGrid behavior nobody asked for. This list is what the plan **proposes** to carry over; the
operator confirms it at G1 (see [operator scope check](#operator-scope-check)). IDs in brackets
point to the contract.

**Must work** (named by the operator; keyboard support is part of the migration):

| ID  | Feature                                                                                                                                                                                           | Parity  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| M1  | Step into an object field across the whole page by double-clicking an object cell (`_id` and arrays are not step-in targets)                                                                      | T03     |
| M2  | Step out: Level up and jumps to any breadcrumb, including Root                                                                                                                                    | T04     |
| M3  | Paging: first/previous/next, page sizes 10/50/100/500, reset to page one on a new query. Owned by the app; the grid shows one page                                                                | W01–W02 |
| M4  | Tree view: Table/Tree/JSON switch; Field/Value/Type; one root per document labelled by `_id`; collapsed at start; `{...}` and `(elements: N)` summaries; arrays of at most 10 elements expandable | R01–R04 |
| M5  | Tree keyboard: expand/collapse, move between parent and child, `treegrid` semantics                                                                                                               | R05     |
| M6  | Table keyboard navigation between cells and headers (RDG default)                                                                                                                                 | #383    |
| M7  | A keyboard way to step in on object cells                                                                                                                                                         | T05     |

**Proposed to keep** (today's workflows break without them):

| ID  | Feature                                                                                                                | Parity            | Why                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------- |
| K1  | Select one or more documents; View/Edit need exactly one, Delete at least one                                          | S01, S03          | Toolbar document actions depend on it     |
| K2  | Actions always hit the right document: selection keyed by `_id`, cleared after delete, paging, refresh and view switch | S02, S04–S05, S07 | A wrong-document delete is data loss      |
| K3  | Columns come from the documents at the current level, heterogeneous documents allowed                                  | T01               | Without it the table cannot show the data |
| K4  | Root `_id` column stays visible at nested levels                                                                       | T02               | Shows which document a nested row is from |
| K5  | BSON-aware values (Int32/Long/Double/Decimal128, dates, ObjectId, UUID and legacy UUID), arrays as `array[N]`          | T07–T08, T10      | Plain JSON loses type information         |
| K6  | A missing field looks different from `null`                                                                            | T09               | Different data, different meaning         |
| K7  | A type indicator per cell, as today's short text (`i32`, `Ab`, …); a badge is F-9                                      | T06               | Existing, visible feature                 |
| K8  | Cell content is text, never HTML                                                                                       | T12               | Security; a React default                 |
| K9  | Loading state on first load, empty-results state                                                                       | W04               | Otherwise the view looks broken           |
| K10 | Follows VS Code light, dark and high-contrast themes                                                                   | W07               | Otherwise unreadable in some themes       |
| K11 | A 500-row page scrolls without noticeable lag (virtualization, RDG default)                                            | W06               | Largest page size offered                 |

**RDG default is enough** (no replication work, no dedicated tests):

| ID  | Today                                                      | Proposal                                                   |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| D1  | 100 px minimum width, autosized columns                    | RDG's initial widths and minimum                           |
| D2  | Pointer resize; widths reset on paging (a known complaint) | RDG resize; whatever width behaviour it gives across pages |
| D3  | No keyboard column resize                                  | RDG's Ctrl+Left/Right on a header                          |
| D4  | Custom active-cell and selection styling                   | RDG styling mapped to VS Code tokens                       |
| D5  | Text selection inside cells (T11)                          | Whatever RDG allows                                        |
| D6  | Focus after refresh (W09)                                  | RDG behaviour, unless keyboard use breaks                  |
| D7  | 15 px tree indentation, SlickGrid chevrons (R03)           | Any clear indentation and expander                         |
| D8  | Type-name tooltip on hover                                 | Optional if the type indicator is readable on its own      |
| D9  | No selection announcements (S06)                           | RDG grid semantics, no custom live regions                 |
| D10 | No forced-colours support                                  | RDG's built-in forced-colours support                      |

**Not carried over** (SlickGrid artefacts; not replicated and not tested): `typedTableCell type-*`
classes, the 7 px resize handle and other SlickGrid DOM details; the 100 ms selection debounce, the
manual `renderGrid()` and `ResizeObserver`, the hidden tree filter row; exact pixel values; a
before/after performance comparison with SlickGrid (K11 replaces it).

**Not in this feature:** fixing accessibility gaps the migration does not close by itself
(resizing without dragging, contrast bugs) and new features. Both are listed in
[After this feature](#after-this-feature).

### Operator scope check

Part of **G1**, before any test or code is written. The operator goes through the tables above and,
per row, keeps it, moves it to "RDG default", or drops it. The agent then sizes
WI-3's tests and the work items to the confirmed list: **M** and **K** rows get Playwright checks
of the user outcome; **D** rows get none beyond "nothing is broken". Record the confirmed list in
`decisions.md` (WI-0), so later reviews do not re-raise SlickGrid behaviors that were deliberately
dropped.

## Overview

| Step | Work items    | Who                | Ends with                                                        |
| ---- | ------------- | ------------------ | ---------------------------------------------------------------- |
| 0    | WI-0 – WI-1   | Agent, then **G1** | Scope confirmed, decision recorded, version pinned, branch ready |
| 1    | WI-2 – WI-4   | Agent              | Neutral data, tests and fixtures written, SlickGrid out          |
| 2    | WI-5 – WI-8   | Agent              | Table scope rows pass in Playwright                              |
| 3    | WI-9          | Agent, then **G2** | Tree scope rows pass; operator hands-on                          |
| 4    | WI-10 – WI-11 | Agent, then **G3** | Automated sweep, clean-up; acceptance; merge to `main`           |
| —    | —             | Later iterations   | Remaining accessibility issues, then new features                |

---

## Step 0: decide and pin

### WI-0: record the decision and create the branch

- **Goal:** an entry in a new `decisions.md` for this feature (React Data Grid, exact beta pin, tree
  built by us, reversal triggers), a second for the way of working above (feature branch, no
  coexistence, automation-first, native menus), and a third for the confirmed scope list. Create
  the `feature/` branch.
- **Pointers:** [grid-scorecard.md, Conclusion](../grid-scorecard.md#conclusion);
  [grid-options-evaluation.md §6](../grid-options-evaluation.md#6-what-each-path-gives-up) (the
  rejected alternative).

### WI-1: version and runtime check

- **Goal:** choose the exact pin (beta.64 primary, Cosmos DB's beta.61 as reference) from the
  published bundle and a smoke run in our minimum supported VS Code/Electron.
- **Covers:** the partner's `getOrInsertComputed` concern, the Lightning CSS `light-dark()` note,
  CSP, packaged CSS emission
  ([microsoft/vscode-cosmosdb#3037](https://github.com/microsoft/vscode-cosmosdb/pull/3037)).
- **Pointers:** [react-data-grid-capabilities.md §1](../react-data-grid-capabilities.md#the-partners-runtime-warning-needs-a-version-specific-check)
  and [§4](../react-data-grid-capabilities.md#4-accessibility-and-integration-caveats).
- **Constraint:** no direct npmjs.org access; use the approved registry.

**G1 (operator):** the [operator scope check](#operator-scope-check); approve the decision entries,
the pin and this plan; settle the open decisions marked _before G1_ below.

## Step 1: foundation

### WI-2: neutral host shapes and identity

- **Scope:** move and rename `src/utils/slickgrid/**` (`toSlickGridTable`, `toSlickGridTree`,
  `CellValue`) and `src/webviews/utils/slickgrid/typeToDisplayString`; separate row metadata (row
  key, canonical root `_id`) from document fields; keep BSON formatting in the schema analyzer;
  step-in addressed by field key.
- **Pointers:** [slickgrid-removal.md G1](../slickgrid-removal.md#g1-make-the-host-grid-neutral-no-ui-change);
  parity T01, T02, T07, S07 and the falsy/composite `_id` cases in
  [migration-parity.md §2](../migration-parity.md#2-selection-and-document-actions).
- **Check:** shaping unit tests updated and green.

### WI-3: fixtures and scenario tests

- **Scope:** Collection View L2-dev scenarios with fake host payloads (mixed BSON types, missing vs
  `null`, heterogeneous columns, deep nesting, arrays of 0/10/11 elements, a 500-row page,
  HTML-looking values, empty results). Playwright checks only for the confirmed **M** and **K**
  rows, written as user outcomes ("after stepping in, the breadcrumb shows the field and the rows
  show its sub-fields"), plus the partner's relevant regressions (one selected row treated as none,
  stale results acting on another collection). They fail until the new grid lands.
- **Pointers:** [migration-parity.md §5–§6](../migration-parity.md#5-existing-tests-are-a-starting-point-not-parity-proof);
  [migration-research.md §4](../migration-research.md#4-evolution-after-migration);
  `build/verification/browser/scenarios.ts`, `build/verification/browser/fixtures.ts`.

### WI-4: remove SlickGrid, add React Data Grid

- **Scope:** remove `slickgrid-react`, `slickgrid.scss` and its use in `collectionView.scss`, the
  `slickgrid` chunk group and `optimizeDeps` entry, SlickGrid assertions in
  `build/verification/inspect.cjs`, `prove-inspection.cjs` and fixtures, stale-closure refs and
  their lint suppression; recheck `allowSyntheticDefaultImports` and
  `useHideScrollbarsDuringResize`. Add the pinned dependency with its own lazy chunk, and the theme:
  `--rdg-*` mapped to VS Code tokens (K10, D4, D10).
- **Pointers:** [slickgrid-removal.md §1](../slickgrid-removal.md#1-current-footprint-measured);
  `git grep -i slickgrid`; [build/vite/README.md](../../../../../build/vite/README.md).
- **Check:** build and bundle inspection green; the views may render placeholders.

## Step 2: table

Each item ends when its WI-3 scenario checks pass in Playwright.

### WI-5: table core

- **Scope:** columns from the current level keyed by field path, root `_id` at nested levels,
  loading and empty states, keyboard navigation and virtualization; widths and resizing as RDG
  ships them. Paging keeps working (it is app-owned; the grid only has to accept a new page).
- **Scope list:** M3, M6, K3, K4, K9, K11; D1–D3, D5–D6.

### WI-6: typed value cell

- **Scope:** BSON-aware values, missing versus `null`, today's short type text, content rendered
  as text.
- **Scope list:** K5–K8; D8.
- **Pointers:** `packages/documentdb-js-schema-analyzer` formatters; today's labels in
  `typeToDisplayString`.

### WI-7: document selection and actions

- **Scope:** select one or more documents with mouse and keyboard; toolbar View/Edit/Delete enabled
  accordingly and acting on the selected `_id`s; selection cleared when the rows change. Use RDG's
  selection support where it is enough; the gesture set is the agent's proposal at G2.
- **Scope list:** K1–K2; D9.
- **Pointers:** Cosmos DB's selection and later fixes
  ([migration-research.md §3–§4](../migration-research.md#3-what-the-partner-migrated)).

### WI-8: step in and out

- **Scope:** double-click and a keyboard equivalent on object cells; breadcrumbs and Level up as
  today; telemetry kept.
- **Scope list:** M1–M2, M7.
- **Pointers:** `CollectionView.handleStepInRequest`, `ToolbarTableNavigation`.

## Step 3: tree

### WI-9: accessible document tree

The highest-risk item: the RDG TreeView demo narrated well but could not be expanded from the
keyboard ([grid-scorecard.md, Hands-on results](../grid-scorecard.md#hands-on-results)).

- **Scope:** flattened visible rows over the neutral tree shape, expansion state, Field/Value/Type
  columns with the WI-6 cell, synthetic `_id` roots, the arrays-of-at-most-10 rule; `treegrid`
  semantics (`aria-level`, `aria-expanded`), keyboard expand/collapse and parent/child movement,
  focus to the parent on collapse.
- **Scope list:** M4–M5; D7.
- **Pointers:** upstream
  [TreeView example](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/website/routes/TreeView.tsx)
  and Cosmos DB's tree as starting points only; the treegrid target in
  [grid-scorecard.md, observed gaps](../grid-scorecard.md#what-we-observed-and-possible-paths).

**G2 (operator, short):** both views in a dev build or packaged VSIX against a real cluster;
direction check on look, selection, step-in and the tree. A quick Narrator pass on the tree is
recommended here because it is the riskiest piece. Findings become fixes before Step 4.

## Step 4: harden and hand over

### WI-10: automated sweep

- **Scope:** every confirmed **M** and **K** row through Playwright: keyboard-only journeys for
  table and tree, step in and out, paging, selection and document actions; light, dark and
  high-contrast themes; no console errors or CSP violations; L1 and L3 VSIX checks. **D** rows only
  need to not be broken.
- **Output:** a short report of what was verified and what was not, for G3.

### WI-11: clean-up and documentation

- **Scope:** this feature's README and a `design.md` for the grid integration, SlickGrid notes in
  the [e2e testing strategy](../../e2e-testing/strategy.md) and `build/vite/README.md`, release
  notes.

**G3 (operator, final):** NVDA and Narrator in packaged VS Code, Windows contrast themes, a real
cluster with wide and deep data, then the Case 2 checks from `.github/copilot-instructions.md`.
Merge the feature branch into `main`. Comment on #383 and the other grid `a11y` issues with what
the migration fixed; whatever remains goes to the next iteration.

## After this feature

Two later iterations, each planned separately once the migration is merged.

### Next: remaining accessibility issues

Whatever the G3 screen-reader pass and the open `a11y` issues still show after the migration.
Known candidates today:

| Item                                         | Pointer                                                                                                                                                                             |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resizing without dragging (WCAG 2.5.7)       | [#776](https://github.com/microsoft/vscode-documentdb/issues/776); "Resize column…" and "Fit to content" from a native header context menu, width asked by the host in an input box |
| Focus indicator contrast                     | [#775](https://github.com/microsoft/vscode-documentdb/issues/775), unless RDG's default focus styling already fixes it                                                              |
| Type marker contrast                         | [#382](https://github.com/microsoft/vscode-documentdb/issues/382)                                                                                                                   |
| Selection announcements, focus after refresh | Parity S06, W09, if the G3 pass finds RDG's defaults insufficient                                                                                                                   |

### Later: new features

Ordered by the operator's stated priorities. Effort figures are the research's judgments.

| ID  | Feature                                                       | Effort  | Pointer                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | Pin `_id` by default                                          | XS      | [grid-scorecard.md, Planned additions](../grid-scorecard.md#planned-additions-after-the-grid-choice)                                                                                                                        |
| F-2 | Pin more columns from a header pin button                     | S       | same                                                                                                                                                                                                                        |
| F-3 | Cell-range selection (mouse and Shift+arrows) with Excel copy | 2–3 wks | [grid-scorecard.md, range selection without a fork](../grid-scorecard.md#can-we-build-range-selection-on-rdg-without-forking); settle the drag-versus-text-selection conflict                                               |
| F-4 | Native context menu aware of the multi-selection              | S       | `data-vscode-context` carries the selection summary; commands run on the host (see _How the work is organised_)                                                                                                             |
| F-5 | Remember and reset column widths                              | S       | [react-data-grid-capabilities.md §2](../react-data-grid-capabilities.md#2-what-is-actually-cheap)                                                                                                                           |
| F-6 | Checkbox selection and select current page                    | S       | parity S08                                                                                                                                                                                                                  |
| F-7 | Column reorder and hide/show                                  | S–M     | [react-data-grid-capabilities.md §2](../react-data-grid-capabilities.md#2-what-is-actually-cheap)                                                                                                                           |
| F-8 | In-cell editing                                               | M+      | [grid-scorecard.md category 6](../grid-scorecard.md#6-in-cell-editing-weight-2--slickgrid-8-rdg-6); [capabilities §3](../react-data-grid-capabilities.md#3-available-library-features-that-are-not-cheap-database-features) |
| F-9 | Type badge or icon instead of short type text                 | S       | [react-data-grid-capabilities.md §2](../react-data-grid-capabilities.md#2-what-is-actually-cheap)                                                                                                                           |

Not planned: header sorting of the loaded page, grouping, paste/fill writes and visible-row export
([react-data-grid-capabilities.md §3](../react-data-grid-capabilities.md#3-available-library-features-that-are-not-cheap-database-features)).

## Cross-cutting

- **Beta upgrades** re-run the WI-3 scenarios and a check of the RDG APIs our renderers wrap
  (`Cell` prop spreading, `RenderCellProps`, mouse event args); half a day to a day each.
- **Reversal trigger:** if the tree or selection cannot meet the accessibility gate for reasons
  inside RDG, stop and re-evaluate SlickGrid 11
  ([grid-scorecard.md, Sensitivity](../grid-scorecard.md#sensitivity)). The neutral shapes from WI-2
  keep that option open; the feature branch means `main` is never affected.
- **SlickGrid contributions** upstream are out of scope
  ([grid-scorecard.md, How we could help](../grid-scorecard.md#how-we-could-help-slickgrid-pass-these-checks)).

## Open decisions

_Before G1:_

1. Exact pin: beta.64 or beta.61 (WI-1).
2. Whether the Playwright scenario checks run only on demand by the agent, or are also added to CI.

_During the work (agent proposes, operator confirms at G2):_

3. Row-selection gestures (WI-7).

# Outcome

Not started. Record progress inline against each work item as it lands.
