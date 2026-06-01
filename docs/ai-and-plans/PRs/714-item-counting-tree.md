# PR #714: Show item counts on tree nodes (indexes, collections)

**Branch:** `dev/tnaum/item-counting-tree`
**Base:** `main`
**Date:** 2026-06-01
**PR URL:** https://github.com/microsoft/vscode-documentdb/pull/714
**Commits:** 4 on top of `main`

---

## Why

Issues #658 and #659 requested showing collection counts on database nodes and index counts on the Indexes folder node. Multiple community PRs were submitted (#671, #675, #691, #692, #701) but none could be merged: the primary contributor (P-r-e-m-i-u-m) never accepted the Contributor License Agreement despite repeated requests, and the other contributor (hanhan761) submitted duplicates of the same work. All five PRs were closed with friendly comments explaining that the functionality is being bundled into an internal effort that includes accessibility improvements and consistent formatting.

The core idea from the community PRs (background count loading with tree refresh) was sound. This PR reimplements it from scratch with several improvements: a visual count prefix with an accessibility opt-out, cursor-based counting for large databases, and the `nameOnly` optimization for `listDatabases`.

---

## What was done

### Commit 1: Show index count on Indexes tree item

- Cached index results in `IndexesItem` via a promise-dedup pattern (`getIndexes()` / `indexesPromise` / `cachedIndexes`) so the background count load and the subsequent `getChildren()` expansion share a single `listIndexes` + `listSearchIndexesForAtlas` round-trip.
- Added `loadIndexCount()` as a fire-and-forget entry point called from `CollectionItem.getChildren()`.
- Added `invalidateChildrenCache()` on `IndexesItem`, hooked into the `wrapItemInStateHandling` refresh path in `BaseExtendedTreeDataProvider` so user-initiated refreshes clear stale caches without wiping caches populated by a count-refresh notification (guarded by `isRefreshingIndexCount` + `queueMicrotask`).
- Added `documentDB.accessibility.hideCountPrefix` setting and `getCountPrefix()` utility.
- Applied the count prefix to existing document count descriptions on `CollectionItem`.
- Added 3 unit tests for the async index loading contract.

### Commit 2: Show collection count on database tree items

- Added `loadCollectionCount()` / `fetchAndUpdateCount()` / `getCollections()` on `DatabaseItem`, following the same caching and promise-dedup pattern as `IndexesItem`.
- Triggered from `ClusterItemBase.getChildren()` when database nodes are created.
- Added collection count to the database tooltip.
- Added 5 unit tests.

### Commit 3: Cursor-based collection count and nameOnly for listDatabases

- Added `ClustersClient.countCollections(dbName, limit)` which opens a `listCollections` cursor with `nameOnly: true` and `batchSize(limit + 1)`, iterates at most `limit + 1` items, then closes the cursor early. Returns `{ count, hasMore }`.
- Simplified `DatabaseItem`: dropped the collection cache entirely (no longer shared between count and expansion), `fetchAndUpdateCount` now calls the lightweight `countCollections`. When `hasMore` is true, the description shows "N+". When the user expands the node, `getChildren()` calls the full `listCollections` and updates the count to the exact value.
- Switched `ClustersClient.listDatabases()` to use `nameOnly: true`. The `sizeOnDisk` field was never read by any caller. The `empty` field, used only to filter out an empty `admin` database, is still present in `nameOnly` results from the server.
- Added `COLLECTION_COUNT_LIMIT` constant (set to 50).
- Updated tests to verify cursor-based counting, idempotency, "N+" display, and exact count on expansion.

### Commit 4: Bumped COLLECTION_COUNT_LIMIT from 5 to 50

The limit was set to 5 during development for easy manual testing. Final value is 50.

---

## UX decisions and rationale

### No text suffix on index and collection counts

The Indexes folder node already has "Indexes" as its label. Adding "indexes" as a suffix would stutter: "Indexes .. 4 indexes". For database nodes, the tree hierarchy (you are inside a database explorer, looking at database nodes) provides sufficient context. The bare number is clear.

Document counts keep the "docs" suffix because the estimate formatting (`~`, `K`, `M`) makes the value look like a measurement that needs a unit. Without "docs", a description like `~1.2K` on a node called "users" could mean anything.

### Two middle dots (U+2027) as visual separator

The prefix `\u2027\u2027 ` (two hyphenation points plus a space) serves as a subtle visual separator between the node label and the count. It is:

- **Subtle but visible.** VS Code already renders descriptions in a muted secondary color. The dots add just enough separation to signal "this is metadata" without competing with the label.
- **Lightweight.** Heavier separators like `|`, parentheses, or brackets draw too much attention for ancillary information. Counts are a glanceable hint, not primary content.
- **Collision-free.** Parentheses conflict with decorators. Brackets look like array syntax. A pipe looks like a UI divider. Two small dots do not collide with anything in the VS Code tree UI.
- **Disambiguation.** When node names end with numbers (e.g., `logs2024`), the dots prevent the count from running into the name: `logs2024  .. 3` vs `logs2024  3`.

The prefix is cosmetic and can be hidden via `documentDB.accessibility.hideCountPrefix` for users who prefer a cleaner view or use screen readers.

### Cursor-based counting for collections

A database might contain thousands of collections. The previous approach (shared `listCollections` cache between count and expansion) would materialize the entire list just to show a number. The cursor-based approach fetches at most 51 lightweight `nameOnly` documents and closes the cursor early. For the vast majority of databases (fewer than 50 collections), the user sees the exact count. For outliers, the "50+" indicator is honest about the approximation.

When the user actually expands the node, `getChildren()` calls the full `listCollections` (which returns `type`, `shardKey`, and other metadata needed for tooltips and context) and updates the description to the exact count.

### nameOnly for listDatabases

The `sizeOnDisk` field from `listDatabases` was defined in `DatabaseItemModel` but never read by any consumer (tree items, tooltips, commands, or the shell completion provider). Switching to `nameOnly: true` reduces the response payload.

---

## Files changed

| File | Purpose |
|---|---|
| `src/constants.ts` | `COUNT_PREFIX`, `COLLECTION_COUNT_LIMIT` |
| `src/utils/countPrefix.ts` | `getCountPrefix()` utility |
| `src/documentdb/ClustersClient.ts` | `countCollections()` method, `listDatabases` nameOnly |
| `src/tree/BaseExtendedTreeDataProvider.ts` | `invalidateChildrenCache` hook |
| `src/tree/documentdb/IndexesItem.ts` | Index caching, `loadIndexCount()`, count description |
| `src/tree/documentdb/CollectionItem.ts` | Count prefix on document count description |
| `src/tree/documentdb/DatabaseItem.ts` | Collection count loading, "N+" display |
| `src/tree/documentdb/ClusterItemBase.ts` | Trigger `loadCollectionCount()` on database creation |
| `src/tree/documentdb/IndexesItem.test.ts` | 3 async index loading tests |
| `src/tree/documentdb/DatabaseItem.test.ts` | 5 cursor-based collection count tests |
| `package.json` | `documentDB.accessibility.hideCountPrefix` setting |
| `l10n/bundle.l10n.json` | New localization keys |

---

## Acknowledgments

The core idea of background count loading with `notifyChildrenChanged` originated from community contributor @P-r-e-m-i-u-m in PRs #671 and #675. Their caching approach and the fire-and-forget pattern informed the architecture used here. The PRs could not be merged due to an unresolved Contributor License Agreement, but the contribution is acknowledged in the closing comments on those PRs.
