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

**Status:** proposal, high level. Ordered work items with pointers to the research; interfaces,
file layouts and test lists are deliberately left to the next planning iteration. Tracks
[#1101](https://github.com/microsoft/vscode-documentdb/issues/1101).

**Basis:** the [grid scorecard](../grid-scorecard.md) recommendation (React Data Grid, exact-pinned
beta, accessibility as a hard gate) and the [no-loss contract](../migration-parity.md). The
sequence reuses the gates of the earlier [removal plan](../slickgrid-removal.md#5-the-plan-sequential)
(G1–G6) and the staged gates in
[migration-research.md §7](../migration-research.md#7-recommended-direction-and-staged-gates-first-pass-superseded),
re-ordered for an RDG decision.

## Guiding rules

These come from the operator's priorities in the research
([grid-scorecard.md, Our priorities](../grid-scorecard.md#our-priorities)) and apply to every item.

1. **Accessibility is a gate, not a score.** Keyboard navigation of table _and_ tree, verified with
   Narrator and NVDA in packaged VS Code, decides whether a phase is done
   ([#383](https://github.com/microsoft/vscode-documentdb/issues/383) is the Sev1 acceptance test).
2. **No functional loss.** Every _preserve_ and _improve_ row in
   [migration-parity.md](../migration-parity.md) is in scope; _follow-up_ rows are not.
3. **Parity first, features after.** No optional feature (pinning, range selection, menus,
   editing) is enabled during the swap
   ([migration-parity.md §7](../migration-parity.md#7-deliberately-not-current-functionality)).
4. **No fork; exact pin.** Upstream `react-data-grid` only, exact version in manifest and lockfile
   ([react-data-grid-capabilities.md §1](../react-data-grid-capabilities.md#1-version-matters-more-than-the-beta-label-alone)).
5. **Grid-neutral boundary first.** Host shapes and the webview contract do not name the grid; this
   keeps SlickGrid 11 available as a fallback
   ([grid-scorecard.md, Conclusion](../grid-scorecard.md#conclusion)).
6. **Identity by key, never by index.** Documents by canonical root `_id`, columns by field path
   ([migration-parity.md §2, adapter hazard](../migration-parity.md#2-selection-and-document-actions);
   [migration-research.md §5, feature coupling](../migration-research.md#feature-coupling-worth-copying-carefully)).
7. **Learn from Cosmos DB's follow-ups; do not copy its code.** Its fixes become our day-one tests
   ([migration-research.md §4](../migration-research.md#4-evolution-after-migration)).

## Overview

| Phase | Items         | Ships to users?               | Exit gate                                               |
| ----- | ------------- | ----------------------------- | ------------------------------------------------------- |
| 0     | WI-0 – WI-1   | No                            | Decision recorded; exact version chosen                 |
| A     | WI-2 – WI-5   | Yes, no visible change        | Contract tests green on SlickGrid; baseline measured    |
| B     | WI-6 – WI-12  | Not yet (behind the boundary) | Table passes parity, performance and accessibility gate |
| C     | WI-13 – WI-15 | Not yet                       | Tree passes parity and accessibility gate               |
| D     | WI-16 – WI-18 | Yes                           | SlickGrid removed; full release gate                    |
| E     | F-1 – F-8     | Yes, one PR each              | Per feature                                             |

Phase A items can merge to `main` one by one while SlickGrid still ships. SlickGrid is not removed
until **both** table and tree pass
([migration-research.md §7](../migration-research.md#7-recommended-direction-and-staged-gates-first-pass-superseded)).

---

## Phase 0: decide and pin

### WI-0: record the grid decision

- **Goal:** turn the scorecard recommendation into an approved entry in a new `decisions.md` for
  this feature: React Data Grid, exact beta pin, tree built by us, reversal triggers.
- **Pointers:** [grid-scorecard.md, Conclusion](../grid-scorecard.md#conclusion) (what would reverse
  it); [grid-options-evaluation.md §6](../grid-options-evaluation.md#6-what-each-path-gives-up)
  (what each path gives up, i.e. the rejected alternative).
- **Gate:** operator approval. The rationale is the operator's; do not invent it.

### WI-1: version and runtime compatibility check

- **Goal:** choose the exact pin (beta.64 primary, Cosmos DB's beta.61 as reference) after checking
  the published bundle and running it in our minimum supported VS Code/Electron.
- **Covers:** the partner's `getOrInsertComputed` concern, the Lightning CSS `light-dark()`
  minification note for Vite 8+, CSP, packaged CSS emission (the partner's
  [microsoft/vscode-cosmosdb#3037](https://github.com/microsoft/vscode-cosmosdb/pull/3037) lesson).
- **Pointers:** [react-data-grid-capabilities.md §1](../react-data-grid-capabilities.md#the-partners-runtime-warning-needs-a-version-specific-check)
  and [§4](../react-data-grid-capabilities.md#4-accessibility-and-integration-caveats).
- **Constraint:** no direct npmjs.org access; use the approved registry and tooling.
- **Output:** the pinned version and a short beta-upgrade procedure (re-verify the APIs our
  renderers wrap; budget half a day to a day per upgrade).

## Phase A: grid-neutral groundwork (no visible change)

### WI-2: neutral host result shapes

- **Goal:** the host no longer knows which grid renders its data.
- **Scope:** move and rename `src/utils/slickgrid/**` (`toSlickGridTable`, `toSlickGridTree`,
  `CellValue`) and `src/webviews/utils/slickgrid/typeToDisplayString`; separate row metadata (row
  key, canonical root `_id`) from document fields instead of mixing `id`/`x-objectid` into rows;
  keep BSON formatting in the schema analyzer.
- **Pointers:** [slickgrid-removal.md G1](../slickgrid-removal.md#g1-make-the-host-grid-neutral-no-ui-change);
  parity T01, T02, T07, S07 and the adapter hazard in
  [migration-parity.md §2](../migration-parity.md#2-selection-and-document-actions)
  (falsy and composite `_id` cases).
- **Gate:** existing shaping tests pass with renames only; build.

### WI-3: internal table and tree contracts

- **Goal:** `DataViewPanelTable` and `DataViewPanelTree` become SlickGrid-backed implementations of
  grid-neutral table and tree components; `slickgrid-react` is imported only behind them.
- **Scope highlights:** selection reported as canonical IDs; step-in reported by **field key**, not
  column index; loading and empty states; container sizing owned by the component.
- **Pointers:** [slickgrid-removal.md G2 and §2](../slickgrid-removal.md#g2-one-internal-grid-interface);
  [migration-research.md §6](../migration-research.md#6-what-we-must-not-lose).
- **Gate:** build; L2 Collection View scenario unchanged; quick visual check of both views.

### WI-4: behavior contracts and fixtures

- **Goal:** tests that describe today's behavior against the WI-3 contracts, green on SlickGrid
  before any swap.
- **Scope:** Vitest contract tests (selection, step-in, type display, missing versus `null`, tree
  shape) and browser scenario fixtures for `collectionView` (mixed BSON types, 50+ heterogeneous
  columns, deep nesting, arrays of 0/10/11 elements, 1,000 rows, HTML-looking values). Add the
  partner's regressions as tests: one selected row treated as none, stale results acting on another
  collection, Space-key scrolling, focusable `aria-hidden` controls.
- **Pointers:** [migration-parity.md §5–§6](../migration-parity.md#5-existing-tests-are-a-starting-point-not-parity-proof);
  [slickgrid-removal.md G3](../slickgrid-removal.md#g3-behavior-tests-before-the-swap);
  [migration-research.md §4](../migration-research.md#4-evolution-after-migration);
  `build/verification/browser/scenarios.ts` and the L2 runner in
  [build/verification/README.md](../../../../../build/verification/README.md).
- **Gate:** operator reviews the test list against the parity contract.

### WI-5: baseline measurements on SlickGrid

- **Goal:** numbers and observations to compare against, captured once.
- **Scope:** chunk size, first usable render, scroll responsiveness and DOM counts on the WI-4
  fixtures; a Narrator and NVDA pass of table and tree in packaged VS Code (the "before" for #383);
  a reproduction of today's resizing complaints, including header widths changing on paging.
- **Pointers:** [migration-parity.md §6](../migration-parity.md#6-required-migration-evidence);
  [grid-scorecard.md, Hands-on results](../grid-scorecard.md#hands-on-results);
  [slickgrid-update-assessment.md §4](../slickgrid-update-assessment.md#4-assessment).
- **Gate:** size and performance budgets agreed with the operator.

## Phase B: table on React Data Grid

Built behind the WI-3 contracts. How the two implementations coexist until Phase D (branch,
development switch or setting) is an open decision below.

### WI-6: dependency, build and theme foundation

- **Scope:** add the exact pin; give RDG its own lazy chunk beside the SlickGrid group in
  `vite.config.views.mjs`; extend the bundle inspection; map `--rdg-*` variables to VS Code tokens;
  forced colours and focus visibility (fixes our own
  [#775](https://github.com/microsoft/vscode-documentdb/issues/775)).
- **Pointers:** [react-data-grid-capabilities.md §4](../react-data-grid-capabilities.md#4-accessibility-and-integration-caveats);
  parity W07; [build/vite/README.md](../../../../../build/vite/README.md) (chunk groups);
  `build/verification/inspect.cjs`.

### WI-7: table core

- **Scope:** dynamic columns keyed by field path, minimum width, virtualization, container sizing,
  first-load skeleton and empty results, native text selection in cells, pointer and keyboard
  resize, and an explicit column-width retention policy across paging and schema changes.
- **Pointers:** parity T01, T09–T11, W04–W06, W09;
  [grid-scorecard.md category 7](../grid-scorecard.md#7-column-resizing-weight-2--slickgrid-6-rdg-8).

### WI-8: typed value cell

- **Scope:** BSON-aware value rendering plus an accessible type badge with a textual description
  (keyboard-reachable, not colour-only, not CSS `::before` text); keep UUID/legacy UUID and the
  Int32/Double/Decimal128/Long distinctions. Resolves
  [#382](https://github.com/microsoft/vscode-documentdb/issues/382).
- **Pointers:** parity T06–T10, T12; `packages/documentdb-js-schema-analyzer` value formatters.

### WI-9: document selection and actions

- **Scope:** row-selection gestures (click, Ctrl/Shift-click, Space/Shift+Space, Shift+arrows), the
  active cell kept separate from selected documents, selection announcements, command enablement,
  and invalidation on refresh, paging, deletion, view switch and unmount.
- **Pointers:** parity S01–S07; Cosmos DB's custom selection and its follow-up fixes
  ([migration-research.md §3](../migration-research.md#3-what-the-partner-migrated) and
  [§4](../migration-research.md#4-evolution-after-migration)).
- **Decision inside the item:** custom gestures (as Cosmos DB did) versus `SelectColumn` checkboxes.

### WI-10: step-in to nested objects

- **Scope:** double-click plus a keyboard equivalent and a visible affordance on object cells;
  breadcrumbs and Level up unchanged; predictable focus after stepping in or out; telemetry kept.
- **Pointers:** parity T03–T05; `CollectionView.handleStepInRequest`, `ToolbarTableNavigation`.

### WI-11: resizing without dragging

- **Scope:** a minimal header action offering "Resize column…" and "Fit to content", required by
  WCAG 2.5.7 on either grid ([#776](https://github.com/microsoft/vscode-documentdb/issues/776)).
  Limited to resizing; a general header menu is follow-up work.
- **Pointers:** [grid-scorecard.md, reported accessibility issues](../grid-scorecard.md#accessibility-issues-already-reported-against-our-grid);
  the partner's resize dialog in
  [microsoft/vscode-cosmosdb#2723](https://github.com/microsoft/vscode-cosmosdb/pull/2723).

### WI-12: table gate

- **Automated:** WI-4 contracts unchanged and green on RDG; L2 scenarios clean (no console errors,
  no CSP violations, no overflow at narrow width); bundle within the WI-5 budget.
- **Operator:** keyboard-only journey; Narrator and NVDA in packaged VS Code; light, dark, high
  contrast and Windows contrast themes; zoom; a real cluster with wide and deep data.

## Phase C: tree on React Data Grid

The highest-risk part. The RDG TreeView demo narrated well but could not be expanded from the
keyboard, and that behavior is ours to build
([grid-scorecard.md, Hands-on results](../grid-scorecard.md#hands-on-results)).

### WI-13: tree model and rendering

- **Scope:** application-owned flattened visible rows over the neutral tree shape, expansion state,
  Field/Value/Type columns using the WI-8 cell, synthetic `_id` roots, the arrays-of-at-most-10
  rule, virtualization of large expanded trees, no new sort or filter.
- **Pointers:** parity R01–R04, R06–R07; the upstream
  [TreeView example](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/website/routes/TreeView.tsx)
  and Cosmos DB's tree, as starting points only.

### WI-14: tree accessibility

- **Scope:** `treegrid` semantics; `aria-level`, `aria-expanded`, `aria-setsize`, `aria-posinset`;
  keyboard expand and collapse (Left/Right, Enter/Space); parent/child movement; focus moves to the
  ancestor on collapse and survives refresh.
- **Pointers:** parity R05, R07, W09; the treegrid target described for SlickGrid in
  [grid-scorecard.md, observed gaps](../grid-scorecard.md#what-we-observed-and-possible-paths).

### WI-15: tree gate

- Same shape as WI-12, plus the tree evidence in
  [migration-parity.md §6](../migration-parity.md#6-required-migration-evidence) (deep tree,
  multiple roots, empty containers, very large arrays, focus after keyboard collapse).

## Phase D: swap and clean up

### WI-16: switch and remove SlickGrid

- **Scope:** RDG implementations become the only ones. Remove `slickgrid-react`, `slickgrid.scss`
  and its use in `collectionView.scss`, the `slickgrid` chunk group and `optimizeDeps` entry,
  SlickGrid assertions in `build/verification/inspect.cjs` and the browser fixtures, and the
  stale-closure refs with their lint suppression. Recheck `allowSyntheticDefaultImports` and
  `useHideScrollbarsDuringResize`.
- **Pointers:** [slickgrid-removal.md §1](../slickgrid-removal.md#1-current-footprint-measured)
  and G5–G6; `git grep -i slickgrid` for the full set.

### WI-17: documentation

- **Scope:** this feature's README (current architecture), a `design.md` for the grid boundary, the
  SlickGrid notes in the [e2e testing strategy](../../e2e-testing/strategy.md) and
  `build/vite/README.md`, release notes; close #383, #382, #775 and #776 where verified.

### WI-18: release gate

- Case 2 verification from `.github/copilot-instructions.md`, the full
  [migration-parity.md §6](../migration-parity.md#6-required-migration-evidence) checklist in a
  packaged VSIX, and a before/after comparison with the WI-5 baseline.

## Phase E: follow-up features (after parity, one PR each)

Ordered by the operator's stated priorities. Effort figures are the research's judgments.

| ID  | Feature                                                       | Effort  | Pointer                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 | Pin `_id` by default                                          | XS      | [grid-scorecard.md, Planned additions](../grid-scorecard.md#planned-additions-after-the-grid-choice)                                                                                                                        |
| F-2 | Pin more columns from a header pin button                     | S       | same                                                                                                                                                                                                                        |
| F-3 | Cell-range selection (mouse and Shift+arrows) with Excel copy | 2–3 wks | [grid-scorecard.md, range selection without a fork](../grid-scorecard.md#can-we-build-range-selection-on-rdg-without-forking); settle the drag-versus-text-selection conflict                                               |
| F-4 | Context menu aware of the multi-selection                     | S–M     | [grid-scorecard.md, Planned additions](../grid-scorecard.md#planned-additions-after-the-grid-choice)                                                                                                                        |
| F-5 | Remember and reset column widths                              | S       | [react-data-grid-capabilities.md §2](../react-data-grid-capabilities.md#2-what-is-actually-cheap)                                                                                                                           |
| F-6 | Checkbox selection and select current page                    | S       | parity S08                                                                                                                                                                                                                  |
| F-7 | Column reorder and hide/show                                  | S–M     | [react-data-grid-capabilities.md §2](../react-data-grid-capabilities.md#2-what-is-actually-cheap)                                                                                                                           |
| F-8 | In-cell editing                                               | M+      | [grid-scorecard.md category 6](../grid-scorecard.md#6-in-cell-editing-weight-2--slickgrid-8-rdg-6); [capabilities §3](../react-data-grid-capabilities.md#3-available-library-features-that-are-not-cheap-database-features) |

Not planned: header sorting of the loaded page, grouping, paste/fill writes and visible-row export
([react-data-grid-capabilities.md §3](../react-data-grid-capabilities.md#3-available-library-features-that-are-not-cheap-database-features)).

## Cross-cutting

- **Beta upgrades:** each upgrade re-runs the WI-4 contracts, the accessibility journey and a check
  of the RDG APIs our renderers wrap (`Cell` prop spreading, `RenderCellProps`, mouse event args).
- **Reversal trigger:** if WI-12 or WI-15 fails for reasons inside RDG, or RDG stalls, the WI-3
  boundary lets SlickGrid 11 be re-evaluated
  ([grid-scorecard.md, Sensitivity](../grid-scorecard.md#sensitivity)).
- **SlickGrid contributions** (upstream issues or pull requests) are out of scope here
  ([grid-scorecard.md, How we could help](../grid-scorecard.md#how-we-could-help-slickgrid-pass-these-checks)).

## Open decisions for the next iteration

1. Exact pin: beta.64 or beta.61 (WI-1).
2. Coexistence during Phases B–C: long-lived branch, development-only switch, or user setting.
3. Row-selection model: custom gestures versus checkbox column (WI-9).
4. Keyboard step-in key and affordance (WI-10).
5. Column-width retention policy across paging, queries and step-in (WI-7).
6. Tree implementation: custom rows on `DataGrid` versus a separate accessible tree component
   behind the same contract (WI-13).
7. PR slicing: which items merge together, and which reach `main` before the swap.

# Outcome

Not started. Record progress inline against each work item as it lands.
