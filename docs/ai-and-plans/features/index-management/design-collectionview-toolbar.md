---
area: index-management
kind: design
status: active
prs: [732]
created: 2026-07-21
code:
    - src/webviews/documentdb/indexView/**
verified: 2026-08-14
---

# CollectionView Toolbar / Tab Redesign

**Branch:** `dev/khelanmodi/index-management-ui`
**PR:** #732 — Index Management tab (Index Dashboard)

> Working document for rearranging the CollectionView chrome so the **tab strip
> (Documents / Indexes / Query Insights) becomes the first row**, and the row
> above it becomes a **tab-specific action bar** that only shows what is relevant
> to the selected tab.

---

## 0. Problem statement

The CollectionView started life as a single-purpose **document browser**, so its
chrome was laid out for that one job: a primary toolbar on top, the query editor
below it, and only then the content. As the view grew to host **multiple tabs**
(Documents, then Query Insights, now Indexes in PR #732), that original ordering
no longer fits:

- **The toolbar sits above the tabs**, so a user sees the actions _before_ they
  see (or choose) the context those actions belong to. The tab strip — the thing
  that actually determines what the user is looking at — is buried in the middle
  of the stack.
- **Row 1 mixes general and tab-specific controls.** Only the leading primary
  button is tab-aware (Find Query ↔ Create Index); everything else
  (Import / Export / Copy / Paste / Playground / Shell) is rendered on **every**
  tab regardless of relevance.
- **Query-centric actions leak onto the Indexes tab**, where Copy / Paste /
  Playground / Shell — and arguably Import / Export — are meaningless, adding
  visual noise and implying capabilities that don't apply.
- **The grouping reads backwards.** Because the toolbar precedes the tabs, the
  toolbar has to reach _down_ into whichever tab is active (via `selectedTab`
  props and window `CustomEvent`s) to stay in sync, instead of each tab simply
  owning its own action bar.

**Goal:** reorder the chrome so the **tab strip comes first**, and the row
beneath it is a **contextual action bar scoped to the active tab** — showing only
the actions that make sense for Documents, Indexes, or Query Insights
respectively.

---

## 1. Current layout (as shipped on this branch)

The CollectionView renders a fixed vertical stack. Reading top → bottom in
[CollectionView.tsx](../../../../src/webviews/documentdb/collectionView/CollectionView.tsx):

```
┌──────────────────────────────────────────────────────────────────────┐
│ (A) Primary toolbar  ─ ToolbarMainView (div .toolbarMainView)          │  ← ROW 1
│      ├─ ToolbarQueryOperations   (tab-specific leading button + AI + Refresh)
│      └─ ToolbarSecondaryActions  (Import / Export | Copy / Paste / Playground / Shell)
├──────────────────────────────────────────────────────────────────────┤
│ (B) QueryEditor      ─ filter / project / sort editors (+ collapsible AI row)
│                        Hidden on the Indexes tab.                       │
├──────────────────────────────────────────────────────────────────────┤
│ (C) TabList          ─ Documents | Indexes | Query Insights (PREVIEW)   │  ← ROW 2 (tabs)
├──────────────────────────────────────────────────────────────────────┤
│ (D) Tab-specific content (switches on selectedTab)                      │  ← ROW 3
│      tab_result       → resultsActionBar + results grid + table nav
│      tab_indexes      → IndexesTab (metrics + list + create drawer)
│      tab_queryInsights→ QueryInsightsMain
└──────────────────────────────────────────────────────────────────────┘
```

### (A) Primary toolbar — `ToolbarMainView`

Two Fluent `Toolbar`s side by side. Split into a **general** part and a
**tab-specific** part today:

**`ToolbarQueryOperations`** (the leading, partly tab-aware group):

| Control                                  | Shown when                                  | Function                                                                                |
| ---------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Find Query** (primary, `PlayRegular`)  | Documents + Query Insights                  | Executes the find query from the editor, resets to page 1.                              |
| **Create Index** (primary, `AddRegular`) | Indexes                                     | Dispatches `OPEN_CREATE_INDEX_EVENT`; `IndexesTab` opens the create drawer.             |
| **Generate** (toggle, `Sparkle*`)        | all tabs, only if `enableAIQueryGeneration` | Toggles the collapsible AI query-generation row in the editor.                          |
| **Refresh** (`ArrowClockwiseRegular`)    | all tabs                                    | Documents/Insights: re-runs current query. Indexes: dispatches `REFRESH_INDEXES_EVENT`. |

So the **only tab-specific swap today is the leading primary button**
(Find Query ↔ Create Index). Everything else in this toolbar is general.

**`ToolbarSecondaryActions`** (always rendered, tab-agnostic — an `Overflow`
container that collapses into a `…` menu when narrow):

| Group | Item           | Function                                          |
| ----- | -------------- | ------------------------------------------------- |
| data  | **Import**     | Import documents from JSON.                       |
| data  | **Export**     | Export entire collection / current query results. |
| query | **Copy**       | Copy current query to clipboard.                  |
| query | **Paste**      | Paste a find query into the editors.              |
| query | **Playground** | Open current query in a Query Playground.         |
| query | **Shell**      | Open current query in an Interactive Shell.       |

> ⚠️ These are all **document/query-centric** actions, yet they currently stay
> visible on the **Indexes** tab where Copy/Paste/Playground/Shell (and arguably
> Import/Export) have no meaning.

### (B) QueryEditor

Filter / project / sort Monaco editors + a collapsible AI-generation row
(visible when `isAiRowVisible`). Rendered for `tab_result` and
`tab_queryInsights`; **hidden for `tab_indexes`** (`selectedTab !== 'tab_indexes'`).

### (C) TabList (tabs)

`Documents` · `Indexes` · `Query Insights` (with a `PREVIEW` badge). Tab switches
fire a `tabChanged` telemetry event.

### (D) Tab-specific content

**`tab_result` (Documents):**

- `resultsActionBar` (a flex row):
  - `ToolbarViewNavigation` — pagination (first / prev / next, page-size dropdown).
  - `ToolbarDocumentManipulation` — Add / Edit / View / Delete document.
  - `ViewSwitcher` — Table / Tree / JSON view toggle.
- `resultsDisplayArea` — the grid (`DataViewPanelTable` / `Tree` / `JSON`).
- `ToolbarTableNavigation` — extra table controls (Table view only).

**`tab_indexes` (Indexes):** `IndexesTab`

- Thin `ProgressBar` while loading/refreshing.
- `IndexMetricsRow` — summary metric cards (mirrors Query Insights first row).
- `IndexList` — filter row + index details table (create / delete / hide / unhide).
- `CreateIndexDrawer` — opened by the Create Index primary button.

**`tab_queryInsights` (Query Insights):** `QueryInsightsMain`

- Metrics row, efficiency analysis, query-plan summary, optimization cards, etc.
- Relies on the QueryEditor above it (query is run, then insights are shown).

---

## 2. Summary per tab — what's shown & what it does

### Documents (`tab_result`)

- **Purpose:** browse / query documents and edit them.
- **Needs from row 1:** Find Query, Generate (AI), Refresh, Import, Export, Copy,
  Paste, Playground, Shell — plus the QueryEditor.
- **Own second row:** view navigation (pagination), document CRUD, view switcher.

### Indexes (`tab_indexes`)

- **Purpose:** inspect / manage a collection's indexes.
- **Needs from row 1:** Create Index, Refresh. (Import/Export/Copy/Paste/
  Playground/Shell and the QueryEditor are **not** relevant here.)
- **Own second row:** index metrics + list filter (today these live inside the
  tab body, not in a toolbar).

### Query Insights (`tab_queryInsights`)

- **Purpose:** analyze the performance of the current query.
- **Needs from row 1:** Find Query, Generate (AI), Refresh — plus the QueryEditor
  (the query being analyzed). Copy/Paste/Playground/Shell are arguably useful.
- **Own second row:** none today (the tab body is self-contained).

---

## 3. Approved design direction

**Goal:** make the **tab strip the first row**, and turn the row beneath it into
a **contextual action bar** scoped to the selected tab.

```
┌──────────────────────────────────────────────────────────────────────┐
│ (1) TabList          ─ Documents | Indexes | Query Insights (PREVIEW)   │  ← now FIRST
├──────────────────────────────────────────────────────────────────────┤
│ (2) Tab-specific action bar (contextual toolbar for the active tab)     │  ← was ROW 1
├──────────────────────────────────────────────────────────────────────┤
│ (3) QueryEditor      ─ only for tabs that use a query (Documents / Insights)
├──────────────────────────────────────────────────────────────────────┤
│ (4) Tab body                                                            │
└──────────────────────────────────────────────────────────────────────┘
```

### What belongs in row (2) per tab — decided

| Tab                | Row (2) contents (final)                                                              |
| ------------------ | ------------------------------------------------------------------------------------- |
| **Documents**      | Find Query · Generate · Refresh ‖ Import · Export ‖ Copy · Paste · Playground · Shell |
| **Indexes**        | Create Index · Refresh — nothing else                                                 |
| **Query Insights** | Find Query · Generate · Refresh ‖ Copy · Paste · Playground · Shell                   |

Decisions:

1. **Documents `resultsActionBar` stays put.** Pagination, document CRUD, and the
   view switcher remain a sub-bar inside the Documents tab body (directly above
   the grid) — they do **not** merge into row (2).
2. **Indexes row (2) is minimal:** only **Create Index** and **Refresh**. All
   query-centric secondary actions (Copy / Paste / Playground / Shell) **and**
   Import / Export are dropped on this tab.
3. **QueryEditor stays gated** to query-driven tabs (Documents, Query Insights) —
   same condition as today, just relocated below the tabs.
4. **Preserve the `Overflow` collapsing behavior** of the secondary actions when
   they move into the contextual bar.
5. **Treat everything below the selected tab as one tab panel.** The contextual
   action bar, optional Query Editor, and tab body belong to the active tab and
   are exposed as one accessible `tabpanel`.
6. **Keep the contextual row compact and the same height on every tab.** The
   Indexes toolbar intentionally leaves unused horizontal space; it does not
   need filler actions or a larger treatment to balance the row.
7. **Keep primary actions visible.** Find Query / Create Index, Generate, and
   Refresh never enter the overflow menu. Only secondary actions may overflow.
8. **Make Refresh's scope explicit.** The visible label stays `Refresh`, while
   the tooltip and accessible name describe what the active tab refreshes.
9. **Use one ownership model.** Documents and Query Insights share a reusable
   query action bar. Indexes owns its action bar and calls its create / refresh
   handlers directly; it no longer communicates through window-level custom
   events.

### Refresh meaning per tab

| Tab                | Visible label | Tooltip and accessible name      | Behavior                                                |
| ------------------ | ------------- | -------------------------------- | ------------------------------------------------------- |
| **Documents**      | Refresh       | Rerun the last executed query    | Executes `activeQuery`, not unsaved edits               |
| **Indexes**        | Refresh       | Refresh indexes                  | Reloads index metadata and metrics                      |
| **Query Insights** | Refresh       | Refresh query and query insights | Reruns the active query and resets/reloads its analysis |

The distinction between **Find Query** and **Refresh** is intentional. Find
Query reads the current Query Editor values; Refresh reruns the last executed
query. The more specific tooltip prevents users from assuming the two commands
are interchangeable.

---

## 4. Screen renders

These diagrams describe information hierarchy and responsive behavior, not
exact pixel dimensions. `[...]` is a labeled command, `[icon]` is an icon-only
command with a tooltip and accessible name, and `[...] v` opens a menu.

### 4.1 Documents — wide panel

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Documents        Indexes        Query Insights  PREVIEW                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Find Query]  [Generate]  [Refresh]     [Import v] [Export v]  [Copy] [Paste]│
│                                                    [Playground] [Shell]       │
├──────────────────────────────────────────────────────────────────────────────┤
│ Filter  { status: 'active' }                                                 │
│ Project { name: 1, status: 1 }                 Sort { updatedAt: -1 }         │
├──────────────────────────────────────────────────────────────────────────────┤
│ [First] [Prev]  Page 1  [Next]  [25 v]   [Add] [Edit] [View] [Delete]       │
│                                                     Table | Tree | JSON       │
├──────────────────────────────────────────────────────────────────────────────┤
│ _id                  name                    status            updatedAt       │
│ 65f...               Build pipeline          active            2026-07-21      │
│ 65e...               Test deployment         paused            2026-07-20      │
│                                                                              │
│                         document results                                     │
└──────────────────────────────────────────────────────────────────────────────┘
```

The query action bar operates on the editor and collection. The lower results
action bar stays adjacent to the grid because pagination, CRUD, and view mode
operate on the displayed result set.

### 4.2 Indexes — wide panel

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Documents        Indexes        Query Insights  PREVIEW                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Create Index]  [Refresh]                                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ Total Indexes        Total Size          Total Usage         Unused Indexes  │
│ 8                    12.4 MB             145.2K              2               │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Filter indexes................................] [Hidden] [Unused] [Clear]   │
├──────────────────────────────────────────────────────────────────────────────┤
│   Name                    Type       Properties       Size       Usage   Actions│
│ > _id_                    Single                       4 KB       82K     [ ][ ]│
│ > status_1                Single     Hidden          18 KB        0     [ ][ ]│
│ > tenant_1_createdAt_-1   Compound   Unique         2.1 MB      63K     [ ][ ]│
│                                                                              │
│                        Showing 3 of 8 indexes                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

The empty space after Refresh is deliberate. Import, Export, Copy, Paste,
Playground, and Shell are absent because they describe documents or the query
editor, neither of which is present on this tab. Index filtering remains next
to the index table because it changes the list, not the collection itself.

### 4.3 Query Insights — wide panel

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Documents        Indexes        Query Insights  PREVIEW                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ [Find Query]  [Generate]  [Refresh]           [Copy] [Paste] [Playground]    │
│                                                               [Shell]        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Filter  { tenantId: 'contoso', status: 'active' }                            │
│ Project { status: 1 }                          Sort { updatedAt: -1 }         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Execution time       Documents examined    Documents returned    Index used  │
│ 42 ms                1,204                 24                    status_1    │
├──────────────────────────────────────────────────────────────────────────────┤
│ Query plan summary                                                          │
│ IXSCAN → FETCH                                      Efficient                 │
├──────────────────────────────────────────────────────────────────────────────┤
│ Optimization findings and recommendations                                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

Import and Export are omitted. Query handoff actions remain because inspecting
or continuing the analyzed query in a playground or shell is a coherent next
step.

### 4.4 Narrow panel behavior

The tab strip remains the first row and may use Fluent's normal horizontal tab
overflow behavior if the labels no longer fit. The contextual action row does
not wrap. Primary commands stay visible; secondary commands collapse by the
existing priority order into one `More actions` menu.

```text
Documents / Query Insights                 Indexes
┌──────────────────────────────────────┐   ┌──────────────────────────────────────┐
│ Documents  Indexes  Insights        │   │ Documents  Indexes  Insights        │
├──────────────────────────────────────┤   ├──────────────────────────────────────┤
│ [Find] [Generate] [Refresh]  [+4 ...]│   │ [Create Index] [Refresh]            │
├──────────────────────────────────────┤   ├──────────────────────────────────────┤
│ Query Editor                         │   │ Metrics (responsive 2 x 2 / 1 x 4)  │
├──────────────────────────────────────┤   ├──────────────────────────────────────┤
│ Active tab content                   │   │ Filter controls                      │
│                                      │   │ < horizontally scrollable table >   │
└──────────────────────────────────────┘   └──────────────────────────────────────┘
```

At narrow widths, labels may shorten visually only where an established
responsive component already does so. Accessible names and tooltips retain the
full command meaning. The Index table keeps its existing minimum width and
horizontal scroll behavior.

---

## 5. Component ownership and semantics

### 5.1 Selected-tab structure

`CollectionView` continues to own `selectedTab` and renders one active panel:

```text
CollectionView
├─ ProgressBar / Announcer
├─ TabList
└─ Active TabPanel
   ├─ Documents
   │  ├─ QueryActionBar (Documents variant)
   │  ├─ QueryEditor
   │  ├─ ResultsActionBar
   │  ├─ ResultsDisplayArea
   │  └─ ToolbarTableNavigation (Table view only)
   ├─ IndexesTab
   │  ├─ IndexActionBar
   │  ├─ IndexMetricsRow
   │  ├─ IndexListFilterBar
   │  ├─ IndexTable
   │  └─ CreateIndexDrawer
   └─ Query Insights
      ├─ QueryActionBar (Insights variant)
      ├─ QueryEditor
      └─ QueryInsightsMain
```

This is a visual and semantic ownership boundary. It does not require all tab
state to move into `CollectionView`.

### 5.2 Toolbar components

- Refactor `ToolbarMainView` into a query-focused contextual action bar,
  retaining the shared handlers for Find Query, Generate, Refresh, Copy, Paste,
  Playground, and Shell.
- Give the toolbar an explicit variant such as `documents` or `queryInsights`.
  The variant controls whether Import / Export are present and supplies the
  correct Refresh accessible description.
- Render the Index action bar inside `IndexesTab`. Its buttons call
  `openCreateDialog` and `refresh('manual')` directly.
- Remove `OPEN_CREATE_INDEX_EVENT`, `REFRESH_INDEXES_EVENT`, and their
  `window.addEventListener` / `dispatchEvent` bridges after direct handlers are
  in place.
- Keep the primary command group in the fixed grid column and the secondary
  `Overflow` toolbar in `minmax(0, 1fr)`. The overflow toolbar remains
  right-aligned on wide panels.
- Add a distinct accessible label to each toolbar: `Document actions`, `Index
actions`, or `Query Insights actions`.

### 5.3 Component naming and refactoring

The current names reflect where controls used to appear rather than what they
do. `ToolbarMainView`, for example, will no longer be the main row and is not a
view. The redesign should adopt domain-first names that remain accurate when
components move.

#### Naming rules

1. Start with the domain or object being acted on: `CollectionQuery`,
   `Document`, `Index`, or `TableFieldPath`.
2. Use **Toolbar** only when a component renders one semantic Fluent `Toolbar`.
3. Use **ActionBar** when a component composes multiple toolbars, menus, or
   control groups into one visual row.
4. Avoid positional words such as `Main`, `Secondary`, or `Top`; position can
   change without behavior changing.
5. Avoid `View` when the component is an action surface rather than content.
6. Keep private helper names concise, but name exported components for clarity
   at call sites.

#### Recommended names and alternatives

| Current / planned name                  | Recommended name                | Good alternatives                                    | Rationale                                                                                                           |
| --------------------------------------- | ------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ToolbarMainView`                       | `CollectionQueryActionBar`      | `CollectionQueryToolbar`, `ContextualQueryActionBar` | It composes more than one Fluent toolbar and serves query-capable Collection View tabs.                             |
| `ToolbarMainViewProps`                  | `CollectionQueryActionBarProps` | `QueryActionBarProps`                                | Keeps the public type paired with the exported component.                                                           |
| `ToolbarQueryOperations`                | `QueryExecutionToolbar`         | `QueryPrimaryToolbar`, `QueryExecutionActions`       | Contains Find Query, Generate, and Refresh: the query execution lifecycle.                                          |
| `ToolbarSecondaryActions`               | Split by domain; see below      | `QueryUtilityToolbar`, `CollectionQueryTools`        | “Secondary” says only where actions rank, not what they do, and currently mixes document transfer with query tools. |
| Document Import / Export group          | `DocumentTransferActions`       | `DocumentDataActions`, `DocumentImportExportActions` | Names the Documents-only responsibility without implying query scope.                                               |
| Copy / Paste / Playground / Shell group | `QueryUtilityActions`           | `QueryToolsActions`, `QueryWorkflowActions`          | These commands edit, copy, or hand off the current query but do not execute it.                                     |
| `OverflowMenuButton`                    | `CollectionMoreActionsMenu`     | `QueryMoreActionsMenu`, `OverflowedActionsMenu`      | Describes the user-facing menu rather than the Fluent overflow mechanism.                                           |
| planned `IndexActionBar`                | `IndexManagementToolbar`        | `IndexActionsToolbar`, `IndexToolbar`                | It renders one toolbar and contains collection-level index management commands.                                     |
| `.toolbarMainView`                      | `.collectionQueryActionBar`     | `.contextualActionBar`, `.tabActionBar`              | Removes obsolete positional naming; use `.tabActionBar` only for genuinely shared layout rules.                     |
| `.resultsActionBar`                     | `.documentResultsActionBar`     | `.documentsActionBar`, `.resultsControls`            | Makes clear that these controls belong only to Documents results.                                                   |

**Recommended naming set for this redesign:**

```text
CollectionQueryActionBar
├─ QueryExecutionToolbar
├─ DocumentTransferActions       (Documents variant only)
├─ QueryUtilityActions
└─ CollectionMoreActionsMenu

IndexesTab
└─ IndexManagementToolbar
```

`CollectionQueryActionBar` takes an explicit
`variant: 'documents' | 'queryInsights'`. Prefer `variant` over `selectedTab`:
the child needs to know which presentation and command set to render, not own or
interpret the parent's tab state. Do not include an `indexes` variant; Indexes
owns `IndexManagementToolbar` directly.

The two secondary domain groups can remain private components in the same file
at first. Split them into separate files only if their tests, hooks, or handler
logic become independently substantial. Avoid creating one file per two-button
group solely for naming purity.

#### Related component names

The following existing names can be improved, but their renaming is optional
for this redesign because their behavior does not need to change:

| Current name                  | Preferred eventual name     | Why                                                                             |
| ----------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| `ToolbarViewNavigation`       | `DocumentPaginationToolbar` | It changes result pages and page size, not generic view navigation.             |
| `ToolbarDocumentManipulation` | `DocumentActionsToolbar`    | Covers Add, View, Edit, and Delete without the awkward “manipulation” term.     |
| `ToolbarTableNavigation`      | `TableFieldPathToolbar`     | Navigates nested document field paths in Table View.                            |
| `ViewSwitcher`                | `ResultsViewSelector`       | Selects Table / Tree / JSON representations of the result set.                  |
| `QueryInsightsMain`           | `QueryInsightsTab`          | The file and role already describe a complete tab body; “Main” adds no meaning. |

Do not extract a new `DocumentsTab` during this rearrangement unless moving the
JSX reveals a small, stable prop boundary. `CollectionView` currently owns many
document handlers and result states; forcing them through a large prop object
would increase churn without improving the toolbar redesign. A later state
ownership refactor can make that extraction worthwhile.

#### Refactoring sequence

1. Rename the exported `ToolbarMainView` API and file to
   `CollectionQueryActionBar` before changing its branches. This makes call-site
   intent clear during the rest of the work.
2. Replace `selectedTab` with the narrower `variant` prop and delete the Indexes
   branch.
3. Rename `ToolbarQueryOperations` to `QueryExecutionToolbar`.
4. Split the old `ToolbarSecondaryActions` render into
   `DocumentTransferActions` and `QueryUtilityActions`, while keeping one shared
   Fluent `Overflow` owner and one `CollectionMoreActionsMenu` so measurement
   and priority behavior do not fragment.
5. Add `IndexManagementToolbar` inside `IndexesTab`, then remove the custom
   events.
6. Rename CSS classes only after the component move so each selector is changed
   once.
7. Treat the related result-control renames above as a separate mechanical
   commit or follow-up; do not mix them into behavioral toolbar changes unless
   they materially simplify the edited call sites.

### 5.4 Tab semantics and focus

- Give each `Tab` a stable ID and associate the active panel using
  `aria-labelledby`.
- Render the active content in an element with `role="tabpanel"`; do not create
  multiple visible tab panels or nest tab panels.
- Preserve Fluent TabList keyboard behavior. After arrow-key tab selection,
  focus remains on the selected tab rather than moving automatically into the
  toolbar or editor.
- Do not remount shared query state solely because the user switches between
  Documents and Query Insights. Typed but unexecuted editor values must survive
  the switch.
- Keep visible command text within the accessible name. Icon-only commands need
  a complete `aria-label` and a keyboard-accessible tooltip.
- Loading progress remains decorative where an Announcer or other status text
  communicates completion.

### 5.5 Visual treatment

- Use the normal VS Code / Fluent surface; do not add cards around the TabList
  or contextual action bar.
- Add at most one subtle separator below the tabs or contextual bar to clarify
  hierarchy. Avoid double borders between adjacent rows.
- Use the same `small` Fluent Toolbar size on all three tabs so switching tabs
  does not move the body vertically.
- Replace the current negative inline TabList margin and inline Query Insights
  label layout with named SCSS classes.
- Keep the existing 10 px spacing rhythm and dynamic VS Code theme tokens.

---

## 6. Implementation plan

### Step 1 — Establish the tab-panel layout

1. Move `TabList` ahead of the current toolbar and Query Editor in
   `CollectionView`.
2. Introduce one active tab-panel wrapper below the TabList.
3. Associate each selected tab and panel with stable `id` / `aria-labelledby`
   values.
4. Move the current Documents result controls and Query Insights body into the
   corresponding conditional panel composition without changing their data
   behavior.
5. Remove the inline `marginTop: '-10px'` and replace it with explicit SCSS
   spacing.

**Checkpoint:** keyboard switching changes the active panel, focus stays on the
tab, and Query Editor values survive Documents ↔ Query Insights switching.

### Step 2 — Make the query action bar contextual

1. Rename `ToolbarMainView` to the recommended
   `CollectionQueryActionBar` (or document the chosen alternative before
   implementation) and rename its props type with it.
2. Replace `selectedTab` with
   `variant: 'documents' | 'queryInsights'`; the component does not accept an
   Indexes variant.
3. Rename the primary group to `QueryExecutionToolbar` and split the secondary
   render by responsibility into `DocumentTransferActions` and
   `QueryUtilityActions` under one shared Overflow owner.
4. Keep Find Query, Generate, and Refresh in the non-overflowing primary group.
5. Render Import and Export only for Documents.
6. Render Copy, Paste, Playground, and Shell for Documents and Query Insights.
7. Pass tab-specific Refresh tooltip / accessible-name text while preserving
   the existing refresh behavior.
8. Keep secondary-item overflow priorities and group dividers correct when the
   data group is absent on Query Insights.

**Checkpoint:** every tab exposes only the commands in the approved command
matrix, and only secondary commands enter the overflow menu.

### Step 3 — Give Indexes direct action ownership

1. Add a small `IndexManagementToolbar` at the start of `IndexesTab`.
2. Wire Create Index directly to `openCreateDialog`.
3. Wire Refresh directly to `refresh('manual')` and preserve the current manual
   loading skeleton / refresh-age behavior.
4. Remove the Indexes branch from the shared query toolbar.
5. Delete the create / refresh custom-event constants and both listener effects
   once no callers remain.

**Checkpoint:** Create Index and Refresh work after repeated tab switches, and
no query or document actions render on Indexes.

### Step 4 — Normalize layout and responsive behavior

1. Replace `.toolbarMainView` with `.collectionQueryActionBar`; extract only
   genuinely shared row sizing into `.tabActionBar` if the Index toolbar needs
   the same rule.
2. Preserve the CSS Grid constraint required by Fluent `Overflow`:
   `auto minmax(0, 1fr)`.
3. Give the Index action bar the same minimum height and vertical spacing as the
   query action bars without stretching its two buttons.
4. Prevent toolbar wrapping and retain the current right-aligned overflow menu.
5. Confirm the Index list remains the only scrolling region within Indexes and
   retains horizontal scrolling below its table minimum.

**Checkpoint:** switching tabs does not shift the body vertically, controls do
not overlap, and all content remains reachable at narrow widths.

### Step 5 — Accessibility and content pass

1. Add toolbar labels for Document, Index, and Query Insights actions.
2. Verify visible labels are contained in accessible names for voice control.
3. Give each Refresh command its scoped description from the table above.
4. Verify icon-only actions and overflowed menu equivalents expose the same
   meaning.
5. Check tab, toolbar, editor, body, and drawer traversal in keyboard order.
6. Check high-contrast themes and 200% zoom for focus visibility and clipping.

**Checkpoint:** the active panel is announced with its tab name, toolbar purpose
is distinguishable, and no command depends on color or icon shape alone.

### Step 6 — Localization and focused tests

1. Localize new toolbar labels and Refresh descriptions.
2. Add or update component tests for the per-tab command matrix and direct Index
   handlers where the current webview test setup supports them.
3. Add a regression check that Query Insights excludes Import / Export while
   retaining query handoff actions.
4. Add a regression check that primary actions stay outside overflow.
5. Run the repository completion sequence: localization, formatting, linting,
   full Jest tests, and build.

---

## 7. Acceptance criteria

### Information architecture

- The TabList is the first persistent control row in Collection View.
- The active tab's contextual action bar appears immediately below it.
- Documents retains its separate results action bar directly above the grid.
- Index filtering remains directly above the index table.

### Commands

- Documents shows all document and query commands in the approved matrix.
- Indexes shows only Create Index and Refresh.
- Query Insights shows query commands but not Import or Export.
- Find Query uses current editor values; Refresh reruns the last executed query.
- Create Index and Index Refresh use direct React handlers, not window events.

### Responsive behavior

- Find Query / Create Index, Generate when enabled, and Refresh remain visible.
- Secondary actions overflow in priority order into one menu.
- No contextual toolbar wraps onto an unplanned second row.
- The layout works at approximately 600, 800, and 1200 CSS px, at 200% zoom,
  and in a narrow split-editor column.
- Switching tabs does not cause a vertical layout jump.

### Accessibility

- Tabs and the active tab panel have an explicit programmatic relationship.
- Arrow-key tab switching retains focus on the selected tab.
- Each toolbar has a unique accessible label.
- Every icon-only command has an accessible name and keyboard-reachable tooltip.
- Visible labels are included verbatim in accessible names.
- Focus order follows the visual order: tabs → contextual actions → editor when
  present → tab-local controls → content.

### Visual quality

- The redesign uses existing Fluent and VS Code theme tokens.
- There are no nested cards or decorative containers around navigation/actions.
- The Indexes toolbar's unused horizontal space remains intentionally empty.
- Light, dark, and high-contrast themes retain readable separators, states, and
  focus indicators.

---

## 8. Files involved

| File                                                                                                                                                                                                           | Planned role                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [CollectionView.tsx](../../../../src/webviews/documentdb/collectionView/CollectionView.tsx)                                                                                                                    | Owns selected tab, renders TabList first, and composes the single active tab panel. |
| [CollectionQueryActionBar.tsx](../../../../src/webviews/documentdb/collectionView/components/toolbar/CollectionQueryActionBar.tsx)                                                                             | Reusable Documents / Query Insights query action bar.                               |
| [ToolbarViewNavigation.tsx](../../../../src/webviews/documentdb/collectionView/components/toolbar/ToolbarViewNavigation.tsx) · ToolbarDocumentManipulation.tsx · ViewSwitcher.tsx · ToolbarTableNavigation.tsx | Remain Documents-local result controls; behavior is unchanged.                      |
| [IndexesTab.tsx](../../../../src/webviews/documentdb/indexView/IndexesTab.tsx)                                                                                                                                 | Owns `IndexManagementToolbar` and calls create / refresh handlers directly.         |
| [IndexManagementToolbar.tsx](../../../../src/webviews/documentdb/indexView/components/IndexManagementToolbar.tsx)                                                                                              | Renders the Indexes-only Create Index and Refresh toolbar.                          |
| [constants.ts](../../../../src/webviews/documentdb/indexView/constants.ts)                                                                                                                                     | Drops create / refresh custom-event constants after direct wiring.                  |
| [QueryInsightsTab.tsx](../../../../src/webviews/documentdb/collectionView/components/queryInsightsTab/QueryInsightsTab.tsx)                                                                                    | Remains the Query Insights body below shared query controls.                        |
| [collectionView.scss](../../../../src/webviews/documentdb/collectionView/collectionView.scss)                                                                                                                  | Defines tab-panel, contextual toolbar, spacing, separator, and overflow layout.     |
| [indexView.scss](../../../../src/webviews/documentdb/indexView/indexView.scss)                                                                                                                                 | Aligns IndexActionBar height / spacing with other contextual toolbars.              |
| [bundle.l10n.json](../../../../l10n/bundle.l10n.json)                                                                                                                                                          | Receives generated strings for toolbar labels and scoped Refresh descriptions.      |

---

## 9. Deliberate non-goals

- Do not merge Documents result controls into the contextual query action bar.
- Do not add Index filtering or row actions to the top contextual bar.
- Do not add Import / Export to Query Insights without a separately designed
  export scope.
- Do not persist the selected tab or toolbar overflow state as part of this
  redesign.
- Do not redesign Query Editor, Index metrics, Index table columns, or Query
  Insights cards while rearranging the Collection View chrome.
- Do not introduce a global action registry or new shared state solely to route
  the two Index commands; direct ownership is simpler and more testable.

---

## 10. Implementation progress

Implementation started on 2026-07-21. Each row is delivered as an individual
commit so the layout, behavior, and accessibility changes remain independently
reviewable.

| Work item                                   | Status   | Implementation note                                                                                                                                                                                                                                                                     |
| ------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Establish the tab-panel layout           | Complete | The TabList is now the first row, with stable tab/panel IDs and one active `tabpanel`. Query state remains owned by `CollectionView`.                                                                                                                                                   |
| 2. Make the query action bar contextual     | Complete | `CollectionQueryActionBar` now takes a Documents/Query Insights variant. Import and Export render only for Documents; both query tabs retain one shared Overflow owner for query utilities. Refresh retains last-executed-query semantics with scoped descriptions.                     |
| 3. Give Indexes direct action ownership     | Complete | `IndexesTab` now renders `IndexManagementToolbar`; Create Index calls `openCreateDialog` and Refresh calls `refresh('manual')` directly. The window-level custom events and listeners were removed.                                                                                     |
| 4. Normalize layout and responsive behavior | Complete | Query actions use `.collectionQueryActionBar` with the required `auto minmax(0, 1fr)` grid; all contextual rows share `.tabActionBar` sizing. The Indexes-only top offset was removed, tabs can scroll horizontally, and Documents retains `.documentResultsActionBar`.                 |
| 5. Accessibility and content pass           | Complete | The tab list and every semantic toolbar have distinct labels; tabs and the active panel are explicitly associated. Refresh names are scoped, visible command text remains in accessible names, Preview avoids duplicate announcement, and icon-only utilities retain keyboard tooltips. |
| 6. Localization and focused tests           | Complete | Added SSR component coverage for all three command sets, pinned query actions, and direct Index button handlers. New labels and Refresh descriptions are included in generated localization, and this log is linked from the consolidated PR design document.                           |

### Completion validation (2026-07-21)

- `npm run l10n` — passed; 1,685 localization keys generated.
- `npm run prettier-fix` — passed with no resulting changes.
- `npm run lint` — passed.
- `npx jest --no-coverage` — passed: 162 suites, 2,683 tests, 4 snapshots.
- `npm run build` — passed for all workspaces and the extension.

---

## 11. UX finalization, full-bleed chrome & SCSS refactor (2026-07-22)

Follow-up pass after the tab redesign landed. Focus areas: pixel alignment across
the three tabs, a proper full-width header band, keeping keyboard **focus
indicators visible**, and a readability refactor of
[collectionView.scss](../../../../src/webviews/documentdb/collectionView/collectionView.scss)
(naming + Fluent design tokens). No behavior changed — this is layout, theming,
and structure only.

### 11.1 Edge alignment across all three tabs

The primary buttons didn't share a left edge: **Find Query** (Documents / Query
Insights) sat ~4px inboard of **Create Index** (Indexes). Cause: the query
toolbars are Fluent `Toolbar`s nested inside a 10px-gutter wrapper, and Fluent
adds its own intrinsic horizontal padding _on top_; the Index toolbar carries the
gutter directly, so it had no extra offset.

Fix — zero the intrinsic padding of the toolbars _inside_ the action bars so their
first/last controls land exactly on the shared 10px gutter:

```scss
.collectionQueryActionBar .fui-Toolbar,
.resultsActionBar .fui-Toolbar {
    padding-inline: 0;
}
```

Find Query, the Documents results-navigation row, and Create Index now begin on
one vertical line, and their right edges line up with the data gutter.

### 11.2 Full-width header band (full-bleed)

VS Code injects `body { padding: 0 20px }` into every webview, which inset the
whole view — so the new tab-strip background stopped ~20px short of the window
edges. The view is now full-bleed, robust to the exact body-padding value:

```scss
.collectionView {
    margin-inline: calc(50% - 50vw);
}
```

The header band (`.collectionTabList`) fills that width using **Fluent neutral
aliases** so it tracks the theme:

- `--colorNeutralBackground2` — the band shade
- `--colorNeutralStroke2` + `--strokeWidthThin` (1px) — the bottom separator
- `--colorNeutralBackground1` — the view surface, which also paints the reclaimed
  edge strips so they match the theme instead of the raw editor background

### 11.3 Accessibility — keeping focus indicators visible

This was the subtle part. Twice the **tab focus outline got cropped** — first on
the left, then on the top — once the view was pulled to the window edges:

- The view **clips** its overflow (to suppress a 1px cumulative-rounding
  scrollbar), so a focus ring drawn at `x=0` / `y=0` is cut.
- Nothing renders **above** the webview's own top edge, so no amount of
  clip-margin can rescue a ring sitting at `y=0` — the tabs genuinely have to sit
  a few px down.

Rather than hardcode "4px", the allowance is **derived from the Fluent focus
stroke width**, so it scales if the theme thickens the outline:

```scss
// ~4px today (2 × 2px); grows if --strokeWidthThick grows
$tab-focus-inset: calc(2 * var(--strokeWidthThick));
```

It is reserved on **all four sides** of the content, and the band **re-escapes**
it with a matching negative margin so its background still spans edge-to-edge:

```scss
.collectionTabList {
    margin-inline: calc(-1 * #{$tab-focus-inset}); // escape → background reaches the edges
    padding-inline: $tab-focus-inset; // re-inset → tabs align with the content
    padding-top: $tab-focus-inset; // clear the webview's top edge
}
```

Overflow was also switched from `hidden` to `clip` + `overflow-clip-margin`, which
still kills the rounding scrollbar but lets focus rings **bleed a few px past the
view's edges** instead of being clipped. Net effect: the WCAG _focus-visible_
affordance on the tabs is never truncated, at any theme or zoom.

### 11.4 Toolbar top spacing

A 4px gap between the tab strip and the primary toolbar was added as **`margin-top`
on `.primaryActionBar`** (not padding): the toolbar vertically centers its buttons,
so padding would be half-absorbed by the centering, whereas margin shows the full
gap. It is documented inline as a single tweakable knob.

### 11.5 SCSS refactor — naming & Fluent tokens

Successive agents had accreted layout rules with mixed hardcoded values and opaque
names. The file was reorganized (section banners, regions ordered top→bottom,
global helpers grouped, dead `.row-separator` removed) and the layout regions
renamed for clarity:

| Before                      | After               | Why                                        |
| --------------------------- | ------------------- | ------------------------------------------ |
| `.tabActionBar`             | `.primaryActionBar` | The tab's main toolbar row.                |
| `.tabActionToolbar`         | `.actionBarToolbar` | A Fluent `Toolbar` _inside_ an action bar. |
| `.documentResultsActionBar` | `.resultsActionBar` | Shorter; it's the results-navigation row.  |

They now read as a family: `primaryActionBar` (shared row chrome) →
`actionBarToolbar` (toolbars within it) → `collectionQueryActionBar` /
`resultsActionBar` (the two layout variants). Renames were applied to every call
site (`CollectionView.tsx`, `CollectionQueryActionBar.tsx`,
`IndexManagementToolbar.tsx`); the tests assert on aria-labels / behavior, not
class names, so none broke.

**Fluent spacing tokens.** The hardcoded px were replaced with **Fluent UI v9
design tokens** — `--spacingHorizontal*` / `--spacingVertical*`, `--strokeWidth*`,
`--colorNeutral*` — which `FluentProvider` injects as CSS variables. They keep
spacing consistent and follow the theme:

- `10px` → `--spacingHorizontalMNudge` / `--spacingVerticalMNudge`
- `6px` → `--spacingHorizontalSNudge`, `4px` → `--spacingHorizontalXS`,
  `2px` → `--spacingVerticalXXS`, `8px` → `--spacingVerticalS`
- `1px` border → `--strokeWidthThin`

`calc()` was kept deliberately sparse — only four remain, each with a concrete
reason (the full-bleed `50% - 50vw`, the focus-derived inset, and two _negative_
offsets that mirror a positive token they cancel: the band escape and the pager's
row-gap pullback). Values that are plain spacing constants are tokens with no
calc. Control heights (e.g. `min-height: 32px`) stay as px — they are not spacing
and have no matching token, and px scale with zoom anyway.

### 11.6 Visual checks

- **Left edges** of Find Query / Create Index / the results-nav row / the Monaco
  filter box and the tab labels all land on the shared gutter; **right edges**
  align with the data gutter.
- **Header band** spans the full window width and reaches the top; shade and
  separator render correctly in light, dark, and high-contrast themes (Fluent
  neutral aliases).
- **Keyboard focus** was tabbed through the tab strip and toolbars — the tab
  focus outline is fully visible on every side (no left/top crop), including at
  200% zoom.
- **Monaco filter box** border lines up with the Find Query button above it.
- **Query Insights** cards align to the same gutter as the action bar.

### Completion validation (2026-07-22)

- `npm run prettier-fix` — passed.
- `npm run lint` — passed (only the pre-existing ESLint v10 `eslint-env` warning).
- `npm run build` — passed (TypeScript).
- `npx jest --no-coverage` — passed: 162 suites, 2,683 tests, 4 snapshots.
- Webview webpack (`watch:views`) — compiled successfully (SCSS validated).
- `npm run l10n` not required: no user-facing strings were added, changed, or
  removed in this pass (SCSS + class-name only).

## 12. Theme-adaptive neutral surfaces & loading skeletons (2026-07-22)

Picking `--colorNeutralBackground2` for the tab band (§11.2) surfaced a broader
gap: Fluent's neutral ramp does not track the VS Code theme. This section covers
the fix, which lives in `src/webviews/theme/themeGenerator.ts` and therefore
benefits every webview, not just the collection view. Tracked as issue
[#811](https://github.com/microsoft/vscode-documentdb/issues/811).

### 12.1 Problem

The adaptive themes are built from `createLightTheme` / `createDarkTheme`, whose
**neutral ramp is a fixed gray**. `themeGenerator.ts` previously only remapped
`colorNeutralBackground1` and the `colorNeutralForeground1/2` families onto VS
Code variables. Everything else on the ramp kept the stock gray, so on themes
whose editor background is tinted (Solarized, Nord, a red theme, high-contrast,
…) these surfaces drifted out of tune:

- the **tab band** and the **index list's odd rows** (`colorNeutralBackground2`),
- every **opaque loading skeleton** (`colorNeutralStencil1` / `Stencil2`).

### 12.2 Neutral surface overrides

A shared `adaptiveNeutralSurfaces` map is spread into both the light and dark
adaptive themes (the VS Code variables are already theme-appropriate, so the same
expressions serve both). Each value falls back through progressively more common
surface tokens for themes that leave the ideal one undefined:

- `colorNeutralBackground2` (+ `Hover` / `Pressed` / `Selected`) →
  `--vscode-tree-tableOddRowsBackground` → `--vscode-sideBar-background` →
  `--vscode-editorWidget-background` (interaction states additionally consider
  the list hover / selection colors).
- `colorNeutralStroke2` → `--vscode-panel-border` → `--vscode-widget-border` →
  `--vscode-editorWidget-border`.

### 12.3 Loading skeletons

Fluent's `SkeletonItem` chooses its stencil tokens by `appearance`:

| appearance             | tokens                                         | behavior                                                              |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `opaque` (default)     | solid `colorNeutralStencil1` + `Stencil2`      | Paints an opaque fill over the card → fixed gray, ignores the theme.  |
| `translucent`          | `colorNeutralStencil1Alpha` (over transparent) | Composites a black/white overlay over the themed card → already adapts. |

The **results grid** ([`LoadingAnimationTable.tsx`](../../../../src/webviews/documentdb/collectionView/components/resultsTab/LoadingAnimationTable.tsx))
and the **index list** ([`IndexTableSkeleton.tsx`](../../../../src/webviews/documentdb/indexView/components/indexList/IndexTableSkeleton.tsx))
already pass `appearance="translucent"` and looked correct. The **metrics** and
**query-insights** skeletons used the default `opaque` and rendered gray.

For the `opaque` path we could **not** reuse solid VS Code tokens: structural
surfaces (`editorWidget` / `sideBar` background) can be far darker than the card,
and hover / selection overlays can resolve to a saturated accent — both overshoot
the gentle look. Instead we mimic what `translucent` does and paint **faint alpha
overlays** that composite over the card, split by theme kind so the direction is
right (darken on light, lighten on dark), matching Fluent's own translucent
`*Alpha` scale. Held in `lightSkeletonStencils` / `darkSkeletonStencils`:

- light: `Stencil1 = rgba(0, 0, 0, 0.07)`, `Stencil2 = rgba(0, 0, 0, 0.1)`
- dark: `Stencil1 = rgba(255, 255, 255, 0.07)`, `Stencil2 = rgba(255, 255, 255, 0.1)`

`Stencil1` is the resting base; `Stencil2` is the slightly stronger sweep band.
The values are kept low because the `opaque` appearance layers a base fill under
the animated sweep, so the two compose. The translucent `*Alpha` variants are
left at Fluent's defaults (that path already composites correctly).

### 12.4 Skeleton unification (`appearance="translucent"`)

With the stencils theme-aware, the remaining inconsistency was that the metrics /
query-insights skeletons still rendered as a solid `opaque` fill while the results
and index skeletons use `translucent`. To unify the look, the following were
switched to `appearance="translucent"` (Fluent's `SkeletonItem` accepts the prop
directly, so the two un-wrapped items take it inline; the rest set it on their
`<Skeleton>` wrapper):

- `metricsRow/MetricBase.tsx` — the single render point for every metric
  (`Count`/`Generic`/`Ratio`/`Time` all delegate to it), so this also covers the
  index dashboard's Total Indexes / Size / Usage / Unused cards.
- `summaryCard/CellBase.tsx` — summary-cell value placeholder.
- `summaryCard/custom/PerformanceRatingCell.tsx` — rating skeleton.
- `queryPlanSummary/QueryPlanSummary.tsx` — the four stage/shard skeletons.
- `QueryInsightsTab.tsx` — the Stage 1 loading card skeleton.

Every skeleton in the webviews now shares the same gentle, background-tinted
shimmer. The §12.3 stencil overrides remain as the theme-tracking baseline for any
`opaque` skeleton that is not (or cannot be) made translucent.

### 12.5 Validation

- `npm run prettier-fix` / `npm run lint` — passed (only the pre-existing ESLint
  v10 `eslint-env` warning).
- `npm run build` — passed (TypeScript).
- `npx jest --no-coverage` — passed.
- Visually confirmed on a tinted (red) theme: the tab band, alternating rows and
  all skeletons pick up the theme instead of stock gray.
