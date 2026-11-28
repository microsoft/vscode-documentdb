---
feature: data-grid
kind: research
status: active
created: 2026-11-26
verified: 2026-11-26
code:
  - src/webviews/documentdb/collectionView/components/resultsTab/**
  - src/utils/slickgrid/**
  - src/webviews/slickgrid.scss
  - package.json
---

# Grid options: SlickGrid 11 versus React Data Grid

Decision support for [#1101](https://github.com/microsoft/vscode-documentdb/issues/1101).
This document **re-evaluates** the first-pass recommendation in
[migration-research.md](./migration-research.md), adding two inputs that the first pass did not
weigh: **project health and governance**, and a stated future requirement for
**mouse rectangular cell-range selection with copy to Excel**.

No prototype was built. Everything below is source, release, issue and commit evidence collected
on 2026-11-26. Package metadata came from GitHub and the environment's preconfigured registry;
direct npmjs.org access was not used.

## TL;DR

> **Superseded (third pass, 2026-11-26):** the operator then made accessibility a hard requirement,
> ruled out forking, and judged a custom tree manageable. Under those rules the current
> recommendation is **migrate to React Data Grid (exact-pinned beta)**; see
> [grid-scorecard.md](./grid-scorecard.md). Range selection is buildable on RDG beta.64 without a
> fork. The second-pass reasoning below is kept as history.

**Second-pass recommendation: upgrade to SlickGrid 11 (`slickgrid-react` 11.x) and restructure our
integration behind a grid-neutral boundary, rather than migrate to React Data Grid now.**

The first pass leaned towards React Data Grid (RDG) mainly because our partner extension uses it.
Re-weighed against our own requirements:

1. **Cell-range selection is the deciding factor.** SlickGrid ships mouse-drag rectangular
   selection, Shift+arrow keyboard range extension, _simultaneous_ row selection for document
   actions, and Excel-compatible TSV copy behind one option. RDG has **no** range selection; the
   request has been open since 2020, a community PR since 2022, and one consumer
   (pgAdmin) **forked RDG** to get it. With RDG we would build and own this feature entirely.
2. **The maintenance-risk difference is smaller than the beta label suggests.** Both projects
   are effectively maintained by one person. SlickGrid's maintainer is more active, ships stable
   semver releases with migration guides, and has one open issue. RDG has been in 7.0 pre-release
   for **7.7 years** (alpha since 2019-03, beta since 2021-07), renames APIs between betas, and
   our partner has pinned to an older beta to avoid churn.
3. **SlickGrid's accessibility work since our pinned 9.13 is substantial**, and much of it
   landed _after_ the partner's March 2026 evaluation of v10. Our partner's rejection of SlickGrid
   is therefore partly out of date.
4. **What we give up** is real: a React-idiomatic grid, alignment with the partner, a smaller
   dependency, and some of the partner's accessibility validation. These are listed honestly in §6.

The recommendation is **conditional** on an accessibility gate (§7). If SlickGrid 11 fails that
gate on keyboard or screen-reader behaviour in the packaged extension, the decision should be
revisited, with the range-selection cost of RDG made explicit.

## 1. Requirements used for this evaluation

| Requirement                                                                                             | Source                                       |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| No functional loss (step-in, BSON type indicators, tree, multi-row document actions, paging)            | [migration-parity.md](./migration-parity.md) |
| Fix known accessibility problems and unreliable column resizing                                         | #1101, #263                                  |
| **Future: drag a rectangle of cells with the mouse, then copy to clipboard in an Excel-pasteable form** | Operator, 2026-11-26                         |
| Control over selection semantics (cells vs rows vs documents)                                           | Operator, 2026-11-26                         |
| Migration effort is not a constraint                                                                    | Operator, 2026-11-26                         |
| Long-term maintainability; the beta status of RDG is a concern                                          | Operator, 2026-11-26                         |

Because effort is not a constraint, it is not used as a tie-breaker anywhere below.

## 2. Project health and governance

Counts cover **2025-11-26 to 2026-11-26** unless noted. Commit counts come from the GitHub
commits API (default branch); issue/PR counts come from GitHub search.

|                                        | **SlickGrid** ([ghiscoding/slickgrid-universal](https://github.com/ghiscoding/slickgrid-universal))                                            | **React Data Grid** ([Comcast/react-data-grid](https://github.com/Comcast/react-data-grid))                                                               |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                                  | Personal account (`ghiscoding`)                                                                                                                | Comcast organisation                                                                                                                                      |
| Lead maintainer                        | Ghislain B. (`ghiscoding`, plus `ghiscoding-SE` work account); profile lists **Schneider Electric**                                            | Nicolas Stepien (`nstepien`); no affiliation listed                                                                                                       |
| Second-most-active human               | `zewa666` (Vildan Softic): 9 commits in 12 months                                                                                              | `amanmahajan7` (Aman Mahajan, **FreeWheel/Comcast**): 9 commits in 12 months                                                                              |
| Human commits, last 12 months          | ~1,025, of which `ghiscoding` **~1,009 (98%)**                                                                                                 | ~162, of which `nstepien` **152 (94%)**                                                                                                                   |
| Merged PRs, last 12 months             | 616 (18 not from the lead or bots)                                                                                                             | 295 (10 not from the lead or bots)                                                                                                                        |
| Issues opened / closed, last 12 months | 31 / 33                                                                                                                                        | 12 / 10                                                                                                                                                   |
| Open issues today                      | **1**                                                                                                                                          | **47**                                                                                                                                                    |
| Latest release                         | **11.0.0 stable**, 2026-11-10                                                                                                                  | **7.0.0-beta.64**, 2026-11-05                                                                                                                             |
| Last stable release                    | 11.0.0 (2026-11-10)                                                                                                                            | **5.0.4 (2018-11-14)**                                                                                                                                    |
| Pre-release span                       | none; major versions ship stable                                                                                                               | 7.0.0-alpha.0 2019-03-19, beta.0 2021-07-22, still beta                                                                                                   |
| Release style                          | Stable semver, roughly one major per 6–9 months (9.0 2025-05, 10.0 2026-03, 11.0 2026-11), per-framework migration guides, AI migration skills | Frequent betas; breaking renames between betas (e.g. `rowKeyGetter`→`getRowKey` in beta.64, `rowGrouper`→`getRowGroupKey` in beta.63); release notes only |
| Licence                                | MIT (licence text; GitHub reports `NOASSERTION` because of the extra attribution header)                                                       | MIT (same GitHub reporting quirk)                                                                                                                         |
| Stars / forks                          | 181 / 49 (the wrappers predate the monorepo; the original 6pac/SlickGrid lineage is much larger)                                               | 7,690 / 2,202                                                                                                                                             |
| Runtime dependencies                   | `slickgrid-react` pulls 6 `@slickgrid-universal/*` packages plus `dequal`                                                                      | none                                                                                                                                                      |

### What this means

- **Bus factor is ≈1 for both.** Comcast's organisational ownership of RDG does not translate
  into a team: over the last year one person wrote 94% of human commits, and the Comcast-affiliated
  contributor wrote 9. SlickGrid's single maintainer is backed by an employer that appears to use
  the grid (a dedicated work account contributes). Neither situation is a guarantee.
- **Responsiveness favours SlickGrid.** One open issue versus 47; a lead who closes issues at
  about the rate they arrive. RDG's most-requested missing feature (see §3) has had a reviewed
  community PR waiting since 2022, with public comments complaining about the lack of response.
- **The beta concern is about API stability, not abandonment.** RDG is actively developed
  (React Compiler, forced-colours support, accessibility fixes in October–November 2026), and
  beta.64 is tagged `latest`. But there is no stable contract: our partner
  [pinned exactly to beta.61](https://github.com/microsoft/vscode-cosmosdb/pull/3449) and has
  not moved, partly because newer betas renamed types. Adopting RDG means accepting a moving API
  with no deprecation policy, possibly for years more.
- **SlickGrid's churn is real but managed.** Three majors in 18 months, each with breaking
  changes, but with migration guides and stable releases between them. Upgrading 9 → 11 is a
  bounded, documented exercise; staying current afterwards is roughly one migration per year.

## 3. Cell-range selection and Excel copy (the new requirement)

### SlickGrid: built in

- **Hybrid selection model** (since 9.10, sole model from 10.0):
  `enableSelection: true, selectionOptions: { selectionType: 'mixed' }` supports **cell ranges
  and row selection in the same grid**. `rowSelectColumnIds` designates which columns select whole
  rows, so a document-selection column and free cell-range selection can coexist.
  Source: [`slickHybridSelectionModel.ts`](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/packages/common/src/extensions/slickHybridSelectionModel.ts),
  [row-selection docs](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/frameworks/slickgrid-react/docs/grid-functionalities/row-selection.md).
- **Mouse rectangle** via
  [`slickCellRangeSelector.ts`](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/packages/common/src/extensions/slickCellRangeSelector.ts)
  and visual feedback via `slickCellRangeDecorator.ts`.
- **Keyboard range extension** in the same model: Shift+arrows, Shift+Home/End,
  Ctrl+Shift+arrows/Home/End.
- **Excel copy**: `enableExcelCopyBuffer: true` registers
  [`slickCellExternalCopyManager.ts`](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/packages/common/src/extensions/slickCellExternalCopyManager.ts);
  Ctrl+C copies the selected range as tab-separated text that Excel pastes as cells.
  `copyToClipboard()` can be called from a toolbar or context-menu command, and
  `exportWithFormatter` chooses formatted versus raw values per column
  ([docs](https://github.com/ghiscoding/slickgrid-universal/blob/v11.0.0/frameworks/slickgrid-react/docs/grid-functionalities/excel-copy-buffer.md)).
- v11's [ghiscoding/slickgrid-universal#2906](https://github.com/ghiscoding/slickgrid-universal/pull/2906)
  keeps `aria-selected` synchronised on selected cells.

**Our remaining work:** decide what a copied BSON cell contains (display string, EJSON, or the
raw value) and supply it through the copy manager's value hooks; route the clipboard write through
the webview's permitted path; make the paste direction read-only (no accidental writes); and keep
document actions bound to the row-selection column rather than to arbitrary cell ranges.

### React Data Grid: not provided

- beta.64 has a single **active cell** plus a **selected rows** set. There is no range concept in
  [`DataGrid.tsx`](https://github.com/Comcast/react-data-grid/blob/v7.0.0-beta.64/src/DataGrid.tsx);
  `onCellCopy` supplies only the active cell.
- Requests: [Comcast/react-data-grid#2260](https://github.com/Comcast/react-data-grid/issues/2260)
  (open since 2020-12, 22 reactions),
  [Comcast/react-data-grid#2753](https://github.com/Comcast/react-data-grid/issues/2753) (2021),
  [Comcast/react-data-grid#3609](https://github.com/Comcast/react-data-grid/issues/3609) (2024).
  Older range-selection support existed in early 7.0 canaries and was dropped
  ([Comcast/react-data-grid#1930](https://github.com/Comcast/react-data-grid/issues/1930)).
- Community implementation [Comcast/react-data-grid#2865](https://github.com/Comcast/react-data-grid/pull/2865)
  has been **open since 2022-03-26** (50 reactions). Recent comments ask maintainers for a timeline
  without response. A participant answered a 2024 request with "this is something you're gonna
  have to implement yourself."
- pgAdmin [forked RDG](https://github.com/pgadmin-org/react-data-grid) and applied that PR to get
  range selection (stated in a 2024-07-31 PR comment).

**Our work with RDG:** implement range state, mouse drag with auto-scroll across a virtualised
viewport, Shift+arrow extension, hit-testing that survives column virtualisation, frozen columns
and resizing, decoration CSS (including forced colours), `aria-selected` on cells, TSV serialisation
and clipboard handling — and keep it working across beta API renames. This is a feature-sized
project in itself, not an incremental hook. Forking RDG, as pgAdmin did, trades that for owning a
fork of a moving beta.

Cosmos DB's integration does not help here: it has row selection only.

**Without a fork:** beta.64 exposes enough public API (`onCellMouseDown`, a custom
`renderers.renderCell` wrapping the exported `Cell`, `onCellKeyDown`, `onCellCopy`) to build range
selection outside the library, which pgAdmin's older base could not. Estimated 500–700 lines plus
tests, about 2–3 developer-weeks, plus a check on every beta upgrade. Details and the scored
comparison are in [grid-scorecard.md](./grid-scorecard.md#can-we-build-range-selection-on-rdg-without-forking).

## 4. Accessibility

|                                          | SlickGrid 11                                                                                                                                | RDG beta.64                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Grid semantics                           | `role=grid`, row/rowgroup structure on headers (10.10), `aria-rowcount`/`aria-colcount` (10.0), `aria-sort` and `aria-selected` sync (11.0) | Native `role=grid`/`treegrid`, row/column indexes under virtualisation                                   |
| Keyboard navigation                      | Cell navigation, Tab into headers/menus, Enter/Space sort, refined focus sink (10.2)                                                        | Comprehensive documented model: arrows, Home/End, PageUp/Down, Tab boundaries, Shift+Space row selection |
| Keyboard column resize                   | **Not found** in the documented keyboard model. Pointer resize fixed in 10.5/10.10/11.0                                                     | **Yes**: Ctrl/Meta+Left/Right on a header                                                                |
| Tree keyboard                            | Space/Left/Right expand and collapse (10.2)                                                                                                 | `TreeDataGrid` only for grouping; an arbitrary tree is application code                                  |
| Forced colours (Windows contrast themes) | Not established                                                                                                                             | Explicit support added in beta.64                                                                        |
| Independent validation                   | None found for v10/v11                                                                                                                      | Partner reviewer reported three screen-reader bugs fixed on the beta.59 integration                      |
| History                                  | Partner rejected v9 for accessibility; most of the a11y work above landed _after_ that bake-off                                             | Accessibility is a design goal of the library                                                            |

**Assessment:** RDG is ahead on a documented keyboard model, keyboard column resizing and forced
colours. SlickGrid has closed much of the gap and has a stronger tree story. Neither has been
tested by us. A keyboard alternative for column resizing would be our work on SlickGrid
(for example a Fluent header-menu "Resize column…" dialog, as Cosmos DB built anyway on RDG).

## 5. Feature coverage against our requirements

Ratings: **Built-in** = configuration only; **Hooks** = library provides events/renderers, we
write moderate code; **Ours** = we build it.

| Capability                                                | SlickGrid 11                                                                    | RDG beta.64                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Dynamic columns, virtualised rows and columns             | Built-in                                                                        | Built-in                                                                 |
| BSON value plus type indicator                            | Hooks (formatter returning classes/text, as today)                              | Hooks (React `renderCell`)                                               |
| Object-cell step-in with keyboard equivalent              | Hooks (`onDblClick` + key handler)                                              | Hooks (`onCellDoubleClick` + `onCellKeyDown`)                            |
| Multi-row document selection                              | Built-in (checkbox column, Ctrl/Shift click)                                    | Built-in checkbox column; Cosmos built click/Shift/Ctrl selection itself |
| **Rectangular cell-range selection (mouse and keyboard)** | **Built-in**                                                                    | **Ours** (or fork)                                                       |
| **Copy range to Excel**                                   | **Built-in**                                                                    | **Ours**                                                                 |
| Rows and cell ranges selected together                    | Built-in (`selectionType: 'mixed'`)                                             | Ours                                                                     |
| Arbitrary-depth document tree                             | **Built-in** tree data (`parentId`), already used today                         | **Ours** (TreeDataGrid groups by key; not a document tree)               |
| Pointer column resize                                     | Built-in (several 2026 fixes)                                                   | Built-in                                                                 |
| Keyboard column resize                                    | Ours (menu/dialog)                                                              | Built-in                                                                 |
| Pin `_id` column                                          | Built-in (`pinning`, v11)                                                       | Built-in (`frozen`)                                                      |
| Column reorder / picker / header menu / context menu      | Built-in (currently disabled by us)                                             | Reorder built-in; picker and menus are ours                              |
| Export visible rows (CSV/Excel)                           | Built-in plugins                                                                | Ours                                                                     |
| Theming                                                   | SCSS/CSS variables; a **Fluent theme** exists since v10, Fluent icon set in v11 | CSS variables with `light-dark()`; we map to VS Code tokens              |
| React integration                                         | Imperative wrapper; refs for handlers (stale-closure pattern)                   | Native React props and renderers                                         |
| Bundle weight                                             | Heavier; already isolated in its own lazy chunk                                 | Lighter, zero runtime dependencies                                       |

## 6. What each path gives up

### Choosing SlickGrid 11

- **Not React-idiomatic.** The imperative wrapper keeps the ref-based handler pattern, the explicit
  `renderGrid()` workaround and SlickGrid-specific DOM. A cleaner integration reduces but does not
  remove this.
- **Diverges from the partner.** No shared code or bug fixes with Cosmos DB's grid. Mitigation:
  the partner's integration is mostly app-specific anyway (selection, header menu, tree,
  theme); its transferable lessons are behavioural tests (§4 of the migration report), which apply
  to either library.
- **Annual migrations.** Expect a v12 (the v11 notes already announce deferred CSS anchor
  positioning and Sanitizer API work).
- **Heavier bundle and a second theme system**, partially offset by the Fluent theme.
- **Keyboard column resizing and forced colours** must be added or verified by us.

### Choosing React Data Grid

- **Cell-range selection and Excel copy become a project we own**, with no upstream path in sight.
- **Arbitrary document tree becomes ours**, as it did for the partner.
- **Indefinite beta.** Breaking renames between betas; pinning to avoid them, as the partner does,
  forgoes later accessibility fixes.
- **Larger open-issue backlog and slow review of community contributions.**
- **No export, column picker, header/context menu built-ins.**

## 7. Recommended path and the gate that could reverse it

1. **Introduce the grid-neutral boundary first** (the existing plan's G1/G2): neutral result
   shapes, `ResultsTable`/`ResultsTree` interfaces, canonical document identity separate from row
   index, field-keyed (not index-keyed) step-in. This is valuable for either library and keeps a
   later swap possible.
2. **Upgrade 9.13 → 10 → 11** following both migration guides. Explicitly configure
   `enableSelection` with `selectionType: 'row'` to preserve today's behaviour, then evaluate
   `'mixed'`.
3. **Accessibility gate (decisive):** in packaged VS Code with NVDA and Narrator, verify table and
   tree keyboard navigation, header reachability, row-count announcements, selection
   announcements, focus retention after refresh, and the three bugs the partner reported
   ([microsoft/vscode-cosmosdb#2926](https://github.com/microsoft/vscode-cosmosdb/issues/2926),
   [microsoft/vscode-cosmosdb#2929](https://github.com/microsoft/vscode-cosmosdb/issues/2929),
   [microsoft/vscode-cosmosdb#2930](https://github.com/microsoft/vscode-cosmosdb/issues/2930))
   against SlickGrid 11. Add a keyboard path to column resizing. Check Windows contrast themes.
   **If SlickGrid 11 cannot meet this gate with reasonable application-side fixes, switch to
   RDG** and plan range selection as its own work item.
4. **Resizing gate:** reproduce our current resizing complaints on 9.13, then confirm they are gone
   on 11 (handle hit-box fix, auto-scroll fixes). If not, record why.
5. **Then the range-selection feature:** enable `'mixed'` selection with a dedicated row-selection
   column for document actions, `enableExcelCopyBuffer`, and a defined BSON copy format.

Because effort is not a constraint, the stronger long-term alternative to evaluate if the gate
fails is not "RDG as-is" but "RDG plus an owned range-selection layer" — and that should be costed
before committing.

## 8. What the first pass got wrong or under-weighted

- It treated **partner alignment** as a strong reason to migrate. The partner's grid code is
  largely application-specific; the shareable value is mainly lessons and tests.
- It did not consider **range selection**, which is a decisive capability gap.
- It did not assess **governance**: "Comcast organisation" suggested a team; the commit record
  shows one maintainer, the same risk profile as SlickGrid but with a larger backlog and no stable
  release.
- It noted that SlickGrid improved, but still treated the partner's March 2026 rejection as
  current. Most of SlickGrid's accessibility work landed after that evaluation.

The [no-loss contract](./migration-parity.md) is unaffected and applies to either path.
