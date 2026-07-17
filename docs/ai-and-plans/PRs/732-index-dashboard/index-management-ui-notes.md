# PR #732: Index Management tab (Index Dashboard)

**Branch:** `dev/khelanmodi/index-management-ui`
**Base:** `main`
**Date:** 2026-07-17
**PR URL:** https://github.com/microsoft/vscode-documentdb/pull/732

---

## Why

The CollectionView could browse and query documents but offered no way to inspect
or manage a collection's indexes without dropping to a shell. This PR adds an
**Indexes** tab to the CollectionView that lists a collection's indexes with
their size and usage, and lets the user create, delete, hide, and unhide them
from the UI. The goal is the 80% happy path: make the common index operations
discoverable and safe, and defer deep index-build telemetry to a follow-up.

The index metadata (types, properties) is backed by the operator registry work
documented separately in this folder (`documentdb-supported-indexes.md`,
`operator-registry-scraper-updates.md`).

---

## What was done

### Index list, metrics, and detail view

- Added the **Indexes** tab to the CollectionView tab strip (between Documents
  and Query Insights). The tab talks to a dedicated `mongoClusters.indexView.*`
  tRPC router; the router picks up the cluster / database / collection
  coordinates from the CollectionView's router context, so the tab needs no
  props of its own.
- A top **metrics row** summarizes the collection's indexes (mirrors the Query
  Insights layout).
- A **filter row** (free-text + quick toggles for hidden / unused) sits above a
  fluid, full-width details table. Each row expands to a detail card showing the
  key fields, usage, size, and any index-level options.
- Per-index **size** and **usage** come from `collStats` / `$indexStats` assembled
  on the extension side and returned as a flat `IndexRow`, so the React layer
  never handles wire-level command names.
- A loading skeleton and an explicit refresh path (driven by the CollectionView
  toolbar via window events) keep the list current.

### Create Index drawer, modeled on the driver API

- The create experience is a Fluent **OverlayDrawer** pinned to the right edge.
  Its shape deliberately mirrors the driver's two-argument
  `createIndex(keys, options)` contract rather than a single flat "index type":
  - **Per-field key + type** (ascending / descending / text / 2dsphere / hashed)
    lives on each field row.
  - **Index-level options** (unique, sparse, TTL, name, partial filter,
    collation) are separate, because they apply to the whole index, not a field.
- TTL is surfaced only when it is actually valid (a single-field b-tree index),
  which keeps the form honest about what the server will accept.
- Rarely-needed options (partial filter expression, collation) live on a pushed
  **Advanced** sub-page rather than cluttering the main pane.
- The same assembled payload feeds three actions: create directly, or hand the
  built `createIndex(...)` command off to a **playground** or the **interactive
  shell** for users who prefer to run it themselves.

### Advanced section: plain, relaxed-JSON editors (no false smartness)

- The partial filter expression and collation inputs are **Monaco editors that
  reuse the shared `documentdb-query` language** — but through a new, dedicated
  `EditorType.Json` tag on that same language (same language id, same JavaScript
  Monarch tokenizer, same bracket handling).
- For that tag, completions and hover docs are **intentionally suppressed**. The
  editor gives relaxed-JSON highlighting and bracket auto-closing, and nothing
  more.
- Raw text is sent to the extension host, which parses it **loosely** with
  `@mongodb-js/shell-bson-parser` (`ParseMode.Loose`) — the same parser the
  find / project / sort editors rely on — so unquoted keys, single quotes, and
  BSON constructors all work end to end.
- Ghost/placeholder text was removed (it double-rendered on remount and is poor
  for accessibility). Instead each field starts with `{  }`, shows a small,
  always-visible worked example above the editor, and treats a blank object
  (`{}` / whitespace) as "not set" so it never falsely reports as configured.

**Reasoning for JSON-only (not autocompletion) in the advanced section:** a
partial filter is genuinely a query filter and *could* eventually get the same
field/operator completions as the find editor; collation is a fixed-schema
object that is not a query at all. Rather than ship half-smart completions that
imply more intelligence than exists — or block relaxed input behind a strict
`JSON.parse` — the advanced editors are honest "just JSON" inputs for now. The
`EditorType.Json` seam is additive: a future iteration can promote the partial
filter to a smarter type and give collation its own schema-aware completions
without touching this plain base. Live inline validation was dropped on purpose;
malformed JSON surfaces once, at create time, as an error rather than nagging
while the user types.

### Safe, host-side confirmations

- **Delete** now confirms on the extension host using the user's configured
  confirmation style (word / challenge / click) via `getConfirmationAsInSettings`,
  matching the tree-view "Delete index" command. The in-webview confirm dialog
  was removed.
- **Hide / Unhide** confirm through a modal VS Code dialog whose detail lists the
  index name, size, and usage (one per line) plus a short note about the effect,
  with a `Hide` / `Unhide` action and `Cancel`.
- All three mutations report a `cancelled` result so the webview can skip its
  success toast and refresh when the user backs out.

### Scrolling fix

- The tab filled `100vh` while nested inside the CollectionView's own `100vh`,
  clipped flex column — so it overflowed the bottom and pushed the list's footer
  count out of reach. The tab now fills the *remaining* height (`flex: 1 1 auto;
  min-height: 0`), the list body is the single scroll region, and the
  "Showing X of Y" count lives inside that scroll area so it is always reachable.

### Accessibility

- Key badges in the detail card use the shared focusable-badge pattern with
  tooltips that spell out the field name and index type in words (e.g. an up
  arrow reads as "ascending"), so the direction glyphs are not the only cue.

---

## Follow-ups (not in this PR)

- Index-build progress / status monitoring (whether an index is still building)
  is a natural next step and is being researched separately.
- Smart completions for the partial filter, and schema-aware completions for
  collation, can build on the `EditorType.Json` seam described above.
