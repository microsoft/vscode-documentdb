---
area: index-management
kind: design
status: active
prs: [732]
created: 2026-07-17
code:
    - src/webviews/documentdb/indexView/**
verified: 2026-08-14
---
# PR #732: Index Management tab (Index Dashboard)

**Branch:** `dev/khelanmodi/index-management-ui`
**Base:** `main`
**PR URL:** https://github.com/microsoft/vscode-documentdb/pull/732

> This document is the consolidated design log for the PR. It records the
> **final decisions** first, then a **"tried and abandoned"** section that
> captures the ideas we experimented with, changed our minds on, and why — so a
> reader does not have to reconstruct the history from the diff.

---

## Why

The CollectionView could browse and query documents but offered no way to
inspect or manage a collection's indexes without dropping to a shell. This PR
adds an **Indexes** tab to the CollectionView that lists a collection's indexes
with their size and usage, and lets the user create, delete, hide, and unhide
them from the UI.

Guiding principle: **the 80% happy path**. Make the common index operations
discoverable and safe using only the server APIs already available to us
(`listIndexes`, `$indexStats`, `collStats`), and defer deep index-build
telemetry to a follow-up.

The index metadata (types, properties) is backed by the operator registry work
documented separately in this folder (`reference-01-documentdb-supported-indexes.md`,
`reference-02-operator-registry-scraper.md`).

The CollectionView chrome changes delivered with the dashboard are documented
in [CollectionView Toolbar / Tab Redesign](./design-collectionview-toolbar.md),
including the per-work-item implementation progress and validation checkpoints.

---

## What shipped (final decisions)

### 1. Index list, metrics, and detail view

- An **Indexes** tab in the CollectionView tab strip (between Documents and
  Query Insights), talking to a dedicated `mongoClusters.indexView.*` tRPC
  router. The router picks up the cluster / database / collection coordinates
  from the CollectionView's router context, so the tab needs no props of its own.
- A top **metrics row** summarizes the collection's indexes (mirrors the Query
  Insights layout).
- A **filter row** (free-text + quick toggles for hidden / unused) above a
  fluid, full-width table. Each row expands to a **detail card** with the key
  fields, usage, size, and any index-level options.
- Per-index **size** and **usage** are assembled on the extension side from
  `collStats` / `$indexStats` and returned as a flat `IndexRow`, so the React
  layer never handles wire-level command names.
- Size and usage values include compact **inline data bars** for visual
  comparison. Each metric uses a linear scale against the largest known value
  in the full loaded index set, so filtering rows never changes the scale. The
  bar has a fixed 32 px range, with a 20% minimum fill for positive values; a
  true zero remains empty and unavailable values show no bar. Values occupy a
  fixed, right-aligned text slot so every bar starts at the same position. The
  fill uses the VS Code accent colour and Fluent's medium corner radius. It is
  decorative (`aria-hidden`); the adjacent formatted value remains the
  accessible source of truth.
- **Name, Type, Properties, Size, and Usage are sortable**, one column at a
  time, using Fluent Table's native sort-header interaction and direction
  indicators. The default is **Name ascending** so a new index lands in a
  predictable place; clicking the active header toggles ascending/descending,
  and clicking another sortable header moves the single active sort there.
  Sort state is local to the mounted table and is not persisted in settings or
  storage. Expand and Actions remain non-sortable.
- Optimistic **Creating** rows participate in that same active sort; they are
  not pinned or independently alphabetized. `IndexTable` is the sole owner of
  display ordering. The placeholder retains every predictable submitted sort
  field (name, key/type, unique, sparse, TTL, partial-filter/collation presence)
  and starts usage at zero, so replacing it with the server row does not move it
  under the normal Name sort or under Type, Properties, and usually Usage.
  Size stays unavailable until the server reports it; when Size is the active
  sort, settling into the correct position is the one unavoidable correction
  because an index's built size cannot be predicted. Current filters remain
  authoritative and may hide the optimistic row; creation does not clear or
  bypass them.
- **Column widths remain fixed and non-resizable.** Type and Properties each
  use 130 px; Size and Usage each use 100 px; Expand and Actions stay compact.
  Name receives the remaining width with a 130 px minimum allocation, and its
  header stays on one line. Below the resulting 726 px table minimum, the
  existing list container scrolls horizontally. This keeps the layout
  predictable without adding resize state or custom width-balancing logic.

### 2. Create Index drawer, modeled on the driver API

- A Fluent **OverlayDrawer** pinned to the right edge. Its shape mirrors the
  driver's two-argument `createIndex(keys, options)` contract rather than a
  single flat "index type":
  - **Per-field key + type** (ascending / descending / text / 2dsphere / hashed)
    on each field row.
  - **Index-level options** (unique, sparse, TTL, name, partial filter,
    collation) kept separate, because they apply to the whole index.
- TTL is surfaced only when valid (a single-field b-tree index).
- The drawer opens on a **three-kind tab strip** — **Standard**, **Wildcard**,
  and **Vector** (a stub for a future iteration) — so each index family gets a
  focused form instead of one increasingly conditional one. Each kind keeps its
  own draft, so switching tabs never destroys another kind's work.
  - **Standard** carries the per-field keys and index-level options described
    above.
  - **Wildcard** offers a **scope** (all fields `$**`, or fields below a scoped
    `path.$**`) with a live generated-key preview, plus an optional
    include/exclude **projection**. The projection is a schema-aware field list
    that serializes to `{ field: 0 | 1 }`, and is offered **only on the
    all-fields `$**`key** because the server rejects a projection on a scoped
key. An empty scoped path collapses to`$\*\*`, so a blank path never errors.
  - **Vector** is a placeholder tab; creation is intentionally not wired yet.
- Rarely-needed options (partial filter, collation) live on a pushed
  **Advanced** sub-page. Standard and Wildcard each keep an independent Advanced
  draft, matching the rule that the three kinds behave like separate dialogs.
- A **Preview as JSON** sub-page (same push/back navigation as Advanced) renders
  the assembled `createIndex(...)` specification read-only in a fill-height
  Monaco editor, so the user can review the exact key/options before creating.
- The same assembled payload feeds three actions: create directly, or hand the
  built `createIndex(...)` command off to a **playground** or the **interactive
  shell**.
- **Fresh vs. preserved form (final rule):** opening the drawer for a create
  starts from a **clean form**, _unless_ the previous close asked to preserve it.
  Preserve is requested on an accidental **cancel** (don't lose work) and on a
  **failed submit** (so the user can retry). A **successful** create leaves the
  form clear, so the next open is empty. This lives in `IndexesTab` as a
  `preserveFormRef` gate that bumps the drawer's `resetSignal` at open time (see
  the abandoned-experiment note on why this moved from close-time).
- **Lone field row:** with a single field there is nothing to delete, so the row
  shows a **Clear field** (reset) button that empties that row; once a second
  field exists, every row (including the first) shows the enabled **Remove
  field** delete button.

### 3. Advanced section: plain, relaxed-JSON editors (no false smartness)

- The partial filter and collation inputs are **Monaco editors that reuse the
  shared `documentdb-query` language** through a dedicated `EditorType.Json` tag
  (same language id, same JavaScript Monarch tokenizer, same bracket handling).
- For that tag, completions and hover docs are **intentionally suppressed** —
  relaxed-JSON highlighting and bracket auto-closing, nothing more.
- Raw text is parsed **loosely** on the host with `@mongodb-js/shell-bson-parser`
  (`ParseMode.Loose`) — the same parser the find / project / sort editors use —
  so unquoted keys, single quotes, and BSON constructors work end to end.
- Each field starts with `{  }` and shows a small always-visible worked example
  above the editor; a blank object (`{}` / whitespace) is treated as "not set".

**Why JSON-only, not autocompletion:** a partial filter is genuinely a query
filter and _could_ later get find-style completions; collation is a fixed-schema
object that is not a query at all. Rather than ship half-smart completions that
imply more intelligence than exists — or block relaxed input behind a strict
`JSON.parse` — these are honest "just JSON" inputs for now. The `EditorType.Json`
seam is additive: a future iteration can promote the partial filter to a smarter
type without touching this plain base.

### 4. Safe, host-side confirmations (unified across webview + tree view)

- **Delete, Hide, and Unhide all confirm through one shared modal dialog**
  (`confirmIndexAction` in `src/utils/dialogs/confirmIndexAction.ts`). The body
  lists the index name (and collection, when known), its **size** and **usage** —
  one per line — plus a short effect note, with a `Delete` / `Hide` / `Unhide`
  action and `Cancel`.
- The **same helper backs the tree-view commands** (`index.dropIndex`,
  `index.hideIndex`, `index.unhideIndex`), so the Explorer tree shows the
  identical dialog as the webview.
- The tree `IndexItem` only carries the raw index definition, so the tree
  commands fetch size + usage **on demand** at confirm time via
  `getIndexConfirmationStats` (`src/commands/index.shared/`), reusing the same
  `collStats` / `$indexStats` calls and formatters. Both calls are optional and
  wrapped in try/catch; on failure (or an unsupported tier) the field shows a dash.
- All three mutations report a `cancelled` result so the webview can skip its
  success toast and refresh when the user backs out.
- **Known tradeoff:** unifying on this modal means tree-view **delete** no longer
  honors the configurable word/challenge confirmation style. Deliberate, for
  consistency with hide/unhide; revisit if a stronger typed confirmation for
  destructive delete is wanted.

### 5. Row status: a single spinner vocabulary

- Each row carries a leading status indicator:
  - **Ready** — a green `CheckmarkCircleFilled` Fluent icon.
  - **Building** — a spinner with a "Building index" tooltip, driven by the
    `building` flag `$indexStats` already reports (present only while a build is
    in progress); surfaced on `IndexStats` and mapped to `IndexRow.state`.
  - **Creating** — an optimistic, client-only row shown the instant a create is
    submitted, reconciled to the server's actual name on success and dropped once
    the real index appears. Actions are disabled on this placeholder.
- **Transient delete / hide / unhide** reuse the **same spinner** (in place of
  the ready check) for a short minimum window, so a fast server operation is
  still perceptible. There is no separate "row tint" concept (see abandoned).
- While anything is building or creating, the tab **re-polls** on a short
  interval (recursive `setTimeout`, not `setInterval`, so polls never overlap)
  and stops as soon as nothing is active, so a build resolves to "ready" without
  a manual refresh.
- The list **skeleton is reserved for the first load only**. Later refreshes and
  mutations update rows in place (a thin top progress bar is the refresh cue) —
  reloading into a skeleton on every change was too noisy (same lesson as the
  CollectionView data grid).

### 6. Create submit + reveal flow

- The drawer closes **immediately** on submit — a foreground build can outlast
  any reasonable hold, and the optimistic "Creating…" row already reflects the
  in-flight create. The result is handled in the background: a success toast, or
  a modal error dialog (with the form preserved for retry).
- A newly created index is **scrolled into view only if off-screen**
  (`scrollIntoView({ block: 'nearest' })`). The scroll is **deferred to after
  paint with a one-frame retry** because the target is a just-inserted,
  alphabetically-sorted optimistic row that may not be laid out (or may still be
  reconciling its name) on the render where the request first fires; running the
  scroll immediately hit a stale layout and did nothing. `behavior: 'smooth'`
  makes an actual scroll perceptible.

### 7. Readable JSON previews

- `formatShellJson` (`indexView/utils/format.ts`) renders option objects as
  compact shell-style literals — `{ locale: 'en', strength: 2 }` instead of
  `{"locale":"en","strength":2}` — unquoting identifier keys, single-quoting
  strings, spacing braces / commas. Display-only; falls back to `JSON.stringify`
  for exotic types.
- Applied to the **detail card** (partial filter, collation, wildcard
  projection) and to the **Properties column badge tooltips** (`Partial`,
  `Collation`, `Wildcard`). The wildcard projection — previously carried on
  `IndexRow` but never rendered — is now surfaced in both places.
- Intentionally **not** applied to the raw index definition opened via
  `openIndexDefinition`, which shows exact server JSON on purpose.

### 8. Smaller polish

- **Empty Properties cell** renders nothing for a plain index (no options),
  instead of an em-dash placeholder.
- **Accessibility:** key badges use the shared focusable-badge pattern with
  tooltips spelling out the field name and index type in words (an up arrow reads
  as "ascending"), so glyphs are not the only cue.
- **Layout/scroll fix:** the tab used to fill `100vh` while nested in the
  CollectionView's own clipped `100vh` flex column, pushing the footer count out
  of reach. It now fills the _remaining_ height (`flex: 1 1 auto; min-height: 0`),
  the list body is the single scroll region, and the "Showing X of Y" count sits
  inside that scroll area.

---

## Tried and abandoned (and why)

We iterated on the UX several times. These are the notable changes of mind, kept
here so the final code does not look arbitrary:

- **Wildcard as an Advanced toggle with a destructive confirmation → its own
  tab.** Wildcard first lived _inside_ Advanced as a switch that, when enabled,
  replaced the Standard field rows with `$**` and cleared the incompatible
  options (unique / sparse / TTL). Because that silently discarded the user's
  Standard draft, it needed a host-side confirmation modal
  (`confirmEnableWildcardIndex`) spelling out exactly what would be replaced and
  cleared. Folding a second index _shape_ into the Standard form made both the
  form and its validation conditional and forced that warning dialog. We split
  the drawer into explicit **Standard / Wildcard / Vector** tabs with per-kind
  drafts; switching kinds is now non-destructive, so the confirmation dialog, its
  `confirmEnableWildcardIndex` tRPC procedure/schema, and the impact-details type
  were all deleted.

- **Raw JSON box for the wildcard projection → structured include/exclude
  editor.** The projection could have stayed a relaxed-JSON editor like partial
  filter / collation. Instead it is an **Include / Exclude** choice plus a
  schema-aware field list, because the include-vs-exclude rule (you cannot mix
  them except `_id`), the "$\*\* key only" restriction, and the whole-subtree
  semantics are easy to get wrong by hand. A mode-aware hint spells out that a
  listed path covers every field nested under it.

- **Manual body `padding-bottom` → native `DrawerFooter` spacing.** The footer
  began as a custom `<div>` with a `border-top`; the scrolling body had no bottom
  padding, so content butted against that divider, and we added a 32 px
  `padding-bottom` to the body to compensate. Swapping the div for Fluent's
  **`DrawerFooter`** (which brings its own top padding) made that manual padding
  redundant — stacked, the two produced a ~44 px gap that was most obvious under
  the fill-height JSON preview. We removed the manual padding and let the native
  footer own the body-to-footer gap.

- **Row background tint for touched rows → spinner.** We first highlighted
  created / deleted / hidden / unhidden rows with an accented background tint (a
  200 ms fade-in). Once creating/building already showed a spinner, the tint was
  a second, redundant vocabulary. Dropped it and reused the **spinner** for all
  transient states; the ready state stays a green check. Simpler and consistent.

- **Delete via the settings-style word/challenge confirmation → unified modal.**
  Delete originally used `getConfirmationAsInSettings` (word / challenge / click)
  while hide/unhide used a detailed modal. Two confirmation styles for three
  similar actions read inconsistently, and delete's dialog lacked the size/usage
  detail. We unified on **one modal** (`confirmIndexAction`) for all three, in
  both the webview and the tree. Accepted tradeoff: delete loses the configurable
  typed confirmation (noted above).

- **Drawer close on `min(2s, settle)` grace race → immediate close.** We briefly
  held the drawer open until the create settled or a 2 s grace elapsed, whichever
  came first. Since a foreground build can take much longer and the optimistic
  "Creating…" row already communicates progress, holding the drawer added nothing.
  The drawer now closes **immediately**; the result is handled in the background.

- **Clear-the-form-on-success at close time → reset at open time.** The form was
  cleared by bumping a `resetSignal` in the create **success** handler (which
  fires while the drawer is already closed). That left a gap: reopening quickly
  could still show stale values, and a late reset could wipe the form while the
  user was looking at it. We moved the decision to **drawer-open time**, gated by
  `preserveFormRef` (preserve after cancel/failure, fresh after success). More
  predictable, and it fixed the "reopen shows old data" report.

- **Immediate `scrollIntoView` on create → deferred (rAF) with retry.** The
  reveal appeared to do nothing because it ran against a stale layout for the
  just-inserted/renamed row. Deferring to after paint (plus a one-frame retry and
  smooth behavior) made it reliable. We kept `block: 'nearest'` on purpose so a
  row that is already visible is never yanked.

- **Live inline JSON validation + ghost/placeholder text → neither.** An earlier
  advanced editor validated JSON as the user typed and used Monaco ghost text for
  the example. Ghost text double-rendered on remount and is poor for a screen
  reader; live validation nagged while typing and fought the relaxed-JSON goal.
  We removed both: the example is a plain always-visible line, and malformed JSON
  surfaces **once**, at create time, as an error.

- **A dedicated index `EditorType` → plain `EditorType.Json` on the shared
  language.** We considered a bespoke editor type/language for index options.
  Reusing the existing `documentdb-query` language with a plain `Json` tag (and
  suppressed completions) was far less code and left a clean seam for future
  smart completions.

- **Colour-coded type badges → one neutral tint.** Per-type colours (e.g.
  Wildcard → orange "severe", Hashed → red "danger") implied those indexes were
  problematic and encoded category by colour (inaccessible). Every type now uses
  one neutral tint; the label (and card icon) carries the meaning.

- **Em-dash placeholder for an empty Properties cell → nothing.** The `—`
  placeholder added visual noise for the common plain-index case; the cell is now
  simply empty.

- **Fluent resizable columns → fixed widths.** We upgraded to Fluent UI
  `9.74.4` and prototyped `useTableColumnSizing_unstable` from the Resizable
  Columns preview. The default `autoFitColumns` mode keeps the table inside its
  container by redistributing every drag across other columns; with seven
  columns, fixed Expand/Actions controls, and badge content, the grabbed edge
  did not track the pointer predictably and neighboring columns changed too
  aggressively. Disabling auto-fit made direct dragging predictable, but
  required Fluent's non-native flex-table mode and allowed the table to grow
  into horizontal overflow. During the prototype, our header truncation CSS
  also exposed Fluent's internal `resize: horizontal` on sortable header
  buttons, producing browser-native diagonal resize grips; that artifact was
  fixable with `resize: none`, but underscored the extra styling and behavior we
  would own around an unstable API. A controlled compromise (resize the target
  plus one designated flexible column) would require custom sizing logic. That
  additional implementation, accessibility, persistence, and testing work is
  not worth it for this low-traffic feature, so we retained the simpler fixed
  table and horizontal overflow only below its minimum usable width.

---

## Dev-tooling discovery: the ResizeObserver overlay & a CSP `unsafe-eval` gotcha

Focusing the Create Index drawer's field-name Combobox sometimes popped the
webpack dev-server error overlay with `ResizeObserver loop completed with
undelivered notifications`. Chasing that produced a genuinely useful discovery
about dev tooling under the webview's Content Security Policy. Recording the full
arc because we changed approach three times and briefly broke rendering.

**What the warning actually is.** `ResizeObserver` callbacks run after layout,
before paint. If a callback resizes an observed element, the browser re-observes;
to avoid an in-frame infinite loop it **defers** the remaining notifications to
the next frame and emits this non-fatal `ErrorEvent`. Nothing is dropped — the
layout still converges a frame later. It is emitted by Fluent UI's popup
positioning (`@fluentui/react-positioning` → Floating UI `autoUpdate`), which
observes the trigger + popup and repositions on resize. A one-shot on popup-open
is benign; only a _continuous, every-frame_ stream is a real loop (jank / pegged
CPU). Blip vs. runaway differ only by **rate**, not message.

**It was only ever a dev-server overlay**, not a VS Code notification: our
`webpack.config.views.js` sets `devServer.client.overlay`, and that client hooks
`window` 'error'. Production ships no dev server, so users never see it.

**Attempts (in order):**

1. **Global `window` 'error' swallow** (capture phase, `stopImmediatePropagation`
   - `preventDefault` on `/^ResizeObserver loop/`). Worked, but it was an
     app-wide, prod-shipping suppressor that also hid the message from the devtools
     console — heavier and blunter than the problem.
2. **`overlay.runtimeErrors` _function_ filter** — the natural per-error hook.
   **This broke rendering entirely.** See the gotcha below.
3. **Final: `overlay.runtimeErrors: false`** (a boolean) + a **dev-only rate
   detector**. The runtime-error overlay is off (so the benign blip never shows),
   compile error/warning overlays stay, the raw message still reaches the devtools
   console, and `installResizeObserverLoopDetector` (installed behind
   `process.env.NODE_ENV !== 'production'`, dead-code-eliminated from production)
   `console.warn`s once per burst if the rate crosses ~5/s — i.e. it stays silent
   for interaction blips and shouts only for a _real_ loop.

**The gotcha (the actual discovery): a _function_ dev-server option is
incompatible with the webview CSP.** webpack-dev-server evaluates `overlay`
on the **client**, but the config lives on the **server**, so it serializes the
option into the client's connection URL. A function can't travel as data, so it
is **stringified**:

```
…&overlay={"errors":true,"warnings":true,
  "runtimeErrors":"(error) => !/^ResizeObserver loop/.test(error.message)"}…
```

The client then rebuilds it with `new Function('return ' + str)()` (in
`decodeOverlayOptions`). The webview CSP is `script-src 'self' … 'nonce-…'` with
**no `'unsafe-eval'`**, so `new Function` throws
`EvalError: Evaluating a string as JavaScript violates … 'unsafe-eval'`. Because
that runs during the dev client's own bootstrap, the failure halts startup and
the **whole webview renders blank** — not merely "no overlay". A boolean/string
option travels as data and needs no eval, so it is safe; a function never is.

**Operational lesson that cost us time:** `webpack serve` reads
`webpack.config.views.js` **only at startup**. Editing the file, rebuilding app
code, or even `git checkout`-ing another commit does **not** re-read it — the
running server kept serving the eval-crashing client until `watch:views` was
fully **stopped and restarted**. When debugging dev-server behavior, restart the
server, don't just rebuild.

**Takeaways for future webview dev tooling:**

- Under the webview CSP (no `unsafe-eval`), **never pass a function to a
  dev-server option** that is delivered to the client (`overlay.runtimeErrors`,
  etc.); it becomes `new Function` and crashes the dev client. Prefer
  booleans/strings.
- A crashing dev-server client blanks the **whole** webview; a blank page with an
  `EvalError` in `decodeOverlayOptions` points at dev-server config, not app code.
- Dev-server config changes require a **full server restart**, not a rebuild.

---

## Follow-ups (not in this PR)

- **Per-build progress (percentage / elapsed time).** A `$currentOp` query
  against `admin` can expose `secs_running` and sometimes a `progress.done/total`
  fraction for an active `createIndexes` operation. It would layer on top of the
  ready/building/creating states as a best-effort, permission-tiered enhancement
  (needs the `inprog` privilege for full visibility, with a current-user
  fallback). Value vs. complexity is still under discussion — the ready/building
  signal already covers the common case.
- **Smart completions** for the partial filter, and schema-aware completions for
  collation, can build on the `EditorType.Json` seam.
- **`formatShellJson` on the playground/shell command preview** — a judgment call,
  since that text is meant to be pasteable shell.
- **Stronger typed confirmation for destructive delete** — if we want it back for
  delete without splitting the unified dialog style.
