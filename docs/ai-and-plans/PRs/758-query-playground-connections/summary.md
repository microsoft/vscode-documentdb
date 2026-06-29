# PR Summary — Query Playground connections across save / reopen + Connect picker

> PR: [microsoft/vscode-documentdb#758](https://github.com/microsoft/vscode-documentdb/pull/758)
> Iterative working summary of what was implemented and **why**. The "why" is the
> point of this doc — it captures the constraints and design forks so future
> reviews/analysis don't have to re-derive them.

## Goal

Make a Query Playground's connection (the cluster + database it runs against) **survive
the things that previously silently dropped it**, and give the user a first-class way to
(re)connect a playground when no connection is in context.

## Background — the original problem

`PlaygroundService` binds each `.documentdb.js` document to a `PlaygroundConnection`
(stable `clusterId` + `databaseName` + display/tree context) in an **in-memory map keyed
by the document URI string**. Query execution reads that binding to know where to run.

Because the key is the URI and the map is never persisted, the binding is lost whenever:

- **untitled → file** — saving a scratch playground to disk (scheme/path changes),
- **file → file (Save As)** — re-saving under a new name (path changes), or
- **reopening a saved playground in a new VS Code session** — the map starts empty.

In every case the file opens **disconnected** with no obvious recovery, which is confusing
because the document looks identical to when it worked.

## Two distinct sub-problems, two mechanisms

The same-session URI change and the cross-session reopen are **fundamentally different**
and cannot share one solution:

| Sub-problem                           | Is there state to recover from?                                                           | Mechanism                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| untitled→file, Save As (same session) | **Yes** — the source document is still open and still holds the connection                | Content-correlated **transfer at save time**              |
| Reopen in a fresh session             | **No** — the process restarted; both the binding map _and_ the credential cache are empty | Must be an **actionable affordance** (the Connect picker) |

> **Key realization that shaped the design:** after a real restart there is nothing in
> memory to reconnect _to_ (credentials are gone too), so persistence (a Memento) or an
> in-file hint would be the _only_ ways to auto-restore — both were explicitly ruled out
> as too heavy / user-visible. That leaves an **actionable connect** as the only viable
> path for the cross-session case, which is why the bulk of this PR is a good picker UX
> rather than a persistence layer.

## What changed (by area)

| Area                                                  | Change                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PlaygroundService.transferConnectionToSavedFile`     | On save of a `file:` playground, find the still-open source playground whose content matches and re-key its connection onto the saved URI. Guards: skip if the saved file is already bound; require **exactly one** content match (ambiguity guard for "Save All"); size-gate via `offsetAt`-based length before any `getText()`. | Covers untitled→file and Save As without persistence, using the only reliable correlation available at that moment: content, while the source is still open. Save (not open) is used because a freshly-created file's model is still **empty** for ~150 ms after `onDidOpen`.                                     |
| New `pickTreeNode` (`utils/pickItem/pickTreeNode.ts`) | A generic, reusable quick pick that **browses the live Connections tree** (folders → clusters → databases) by repeatedly calling the tree's own `getChildren`.                                                                                                                                                                    | Reuses folder nesting, ordering, icons, and **connect/auth-on-expand** instead of re-implementing them; avoids eagerly connecting to clusters the user didn't choose. Mirrors vscode-cosmosdb's `pickWorkspaceResource` shape.                                                                                    |
| `playground.connect` command (`connectDatabase.ts`)   | Prompts via `pickTreeNode` (leaf = `treeItem_database`) and binds the playground. Wired to the previously dead-end **"Not connected" CodeLens and StatusBar**.                                                                                                                                                                    | Turns the always-visible disconnected indicator into a one-click connect — the primary recovery path for the cross-session case.                                                                                                                                                                                  |
| Connect-on-run (`executePlaygroundCode.ts`)           | Running an **unconnected** playground now launches the connect picker and continues the run on success (cancel = no-op).                                                                                                                                                                                                          | The most contextual moment to ask for a connection is when the user actually tries to use one; replaces a dead-end info message.                                                                                                                                                                                  |
| Switch-database modal (`connectDatabase.ts`)          | Clicking the connection lens **while connected** opens a modal offering to switch databases. The existing binding is only replaced **after** a new database is selected.                                                                                                                                                          | Lets users repoint a playground, while guaranteeing that **aborting the picker preserves the current connection** (no "disconnect first, then maybe fail to pick").                                                                                                                                               |
| In-session restore (`PlaygroundService`)              | A **non-persistent** in-memory "last binding per URI" map survives document _close_; on reopen within the same session the binding is restored **iff** the target cluster still has live credentials (`CredentialCache.hasCredentials`). Cleared on explicit `removeConnection` and on dispose.                                   | Cheap quality-of-life win for close→reopen in one session. Deliberately **not** persistence (no Memento, no file mutation), so it is neither approach "A" nor "C"; a true restart correctly falls through to the Connect affordance. Never reads the document body, so it is immune to the empty-model open race. |

## Dual-ID compliance

All cache/credential lookups use the stable **`clusterId`** (never `treeId`), per the
repo's dual-ID rule, so bindings keep working when a connection is moved between folders.
`PlaygroundConnection` stores `clusterId`; the picker reads it from the selected
`DatabaseItem`'s `cluster.clusterId`.

## Picker UX decisions (and why)

These were iterated with the maintainer; the rationale matters for future tweaks:

- **Loading indicator** — picks are passed to `showQuickPick` as a _promise_ so the quick
  pick stays visible with a busy spinner while a level loads (a cluster connection can take
  seconds). Earlier the quick pick vanished during the wait, which read as a crash.
- **Tree-matching icons** — each pick carries the tree item's own `iconPath` (clusters,
  `symbol-folder` for folders, databases), so the picker looks like the tree.
- **Host as a second line (`getDetail`)** — connections show their host(s) so two
  same-named connections are distinguishable; `matchOnDetail` makes it searchable.
- **Uniform two-line rows** — every selectable row has a `detail` (folders → `Folder`,
  databases → `Database`, clusters → host/`Cluster`) to avoid a ragged mix of one- and
  two-line rows.
- **Navigation** — after trying a bottom-anchored Back/Exit-with-grouping layout (modeled
  on the Azure credentials browser) it felt heavier to navigate, so the final form is the
  simplest: **Back pinned to the top** followed by a separator, **no Exit** (Esc cancels),
  **no group headers** — relying on the tree's natural folders-before-connections order.

## Telemetry

- `documentdb.pickTreeNode` — `source` (caller), `leafContextValue`, `outcome`
  (`picked` | `cancelled` | `empty`), measurements `stepCount` / `maxDepth`. Added so we can
  see whether/how the reusable picker is actually used across features.
- `playground.connect` and `playground.connectOnRun` — outcome of the connect flows.

## Testing

- `pickTreeNode.test.ts` — drill-down, leaf return, exclusion of action/placeholder nodes,
  icon and detail passthrough, Back/empty/no-connections states, flat folders-first order,
  and cancellation.
- `PlaygroundService.test.ts` — save-time transfer (untitled→file, Save As, ambiguity and
  size guards) and in-session restore (restore when credentials present, no restore when
  absent or after explicit removal).
- Full Jest suite, lint, and TypeScript build are green.

## Out of scope / explicitly not done

- **No persisted binding store** (Memento) and **no in-file connection hint** — both
  rejected as too heavy or user-visible; the cross-session case is handled by the Connect
  affordance instead.
- The picker does **not** auto-run anything on connect; it only restores/sets the binding.
