# PR #714 Review: Show item counts on tree nodes

**PR:** https://github.com/microsoft/vscode-documentdb/pull/714
**Branch:** `dev/tnaum/item-counting-tree`
**Base:** `main`
**Review date:** 2026-06-01

## Scope

Reviewed the local codebase, the PR summary in `docs/ai-and-plans/PRs/714-item-counting-tree.md`, the diff against `origin/main`, and Copilot reviewer feedback fetched from GitHub review threads.

Focused Jest validation was run with:

```bash
npx jest src/tree/documentdb/DatabaseItem.test.ts src/tree/documentdb/IndexesItem.test.ts --runInBand --no-coverage
```

Result: 2 suites passed, 17 tests passed.

## Findings

### Medium: `nameOnly` database listing breaks the empty-admin filter

**Location:** `src/documentdb/ClustersClient.ts`, around the `listDatabases({ nameOnly: true })` call and the `databaseInfo.empty` filter.

`ClustersClient.listDatabases()` now calls `listDatabases({ nameOnly: true })`, but the existing filter still relies on `databaseInfo.empty` to hide an empty `admin` database. The MongoDB API `nameOnly` output returns only database names, so `empty` is unavailable and the filter becomes ineffective.

Impact: an empty `admin` database can reappear in the tree, regressing existing behavior.

This is an additional finding from my review, not from Copilot.

Suggested fix: either remove the `nameOnly` optimization here, use a server-side filter that preserves intended behavior, or update the empty-admin handling so it no longer depends on a field omitted by `nameOnly`.

### Medium: databases with zero collections do not show `0`

**Location:** `src/tree/documentdb/DatabaseItem.ts`, `getTreeItem()` description condition.

`getTreeItem()` only sets the description when `collectionCount > 0`. That hides a valid count of zero, despite the feature requirement to show zero collections. It also creates a mismatch with the tooltip, which displays any numeric collection count.

Impact: the PR does not satisfy the zero-count requirement and users cannot distinguish "not loaded" from "loaded and empty" on database nodes.

Copilot comment references:

- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268073
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268284
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333727712

Suggested fix: change the condition to display any numeric `collectionCount`, including `0`.

### Medium: background capped count can overwrite exact expanded count

**Location:** `src/tree/documentdb/DatabaseItem.ts`, interaction between `fetchAndUpdateCount()` and `getChildren()`.

`getChildren()` updates `collectionCount` to the exact `collections.length` after fetching the full collection list. A concurrently running background `countCollections()` call can resolve afterward and overwrite that exact value with the capped result, such as `50+`.

Impact: users can expand a database, momentarily get an exact count, then see it regress to an approximate capped count.

Copilot comment reference:

- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268646

Suggested fix: track whether the count is exact, or guard the background update so it cannot replace an already-known exact count with a capped/older result.

### Medium: collection-count loading starts unbounded requests per database

**Location:** `src/tree/documentdb/ClusterItemBase.ts`, database mapping that calls `databaseItem.loadCollectionCount()` for every database.

When a cluster has many databases, `getChildren()` immediately starts one background `countCollections()` request per database. There is no concurrency limiter or queue, unlike document-count loading in `CollectionItem`.

Impact: large clusters can produce a burst of concurrent metadata cursors, increasing load on the backend and potentially competing with foreground tree expansion or user operations.

Copilot comment references:

- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268249
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268432
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333727801

Suggested fix: add a small per-cluster concurrency limiter for collection-count requests, similar to the existing document-count limiter.

### Low: failed count loads retry on future item instances

**Locations:**

- `src/tree/documentdb/DatabaseItem.ts`, `collectionCount` failure path.
- `src/tree/documentdb/IndexesItem.ts`, `indexCount` failure path.

On count-load failure, both implementations reset the count to `undefined`. That lets future item instances or refreshes retry known-failing metadata requests. `CollectionItem.documentCount` uses `null` as a failed-load sentinel, which avoids repeated retries while still hiding the description.

Impact: low, because each item instance generally avoids duplicate in-flight work. Still, repeated refreshes/expansions against unsupported or consistently failing backends can keep re-hitting the backend.

Copilot comment references:

- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268139
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268169
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268313
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268344
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268198
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268224
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268374
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268406

Suggested fix: widen `collectionCount` and `indexCount` to `number | undefined | null`, and use `null` as the failed-load sentinel.

## Copilot comments assessed as no issue

### None/Nit: `wrapItemInStateHandling` callback return value

**Location:** `src/tree/BaseExtendedTreeDataProvider.ts`, callback passed to `wrapItemInStateHandling()`.

Copilot flagged that the callback no longer returns `this.refresh(child)`. The `TreeElementStateManager.wrapItemInStateHandling` type accepts a callback returning `void`, and the implementation ignores the callback return value. I do not consider this a functional issue.

Copilot comment reference:

- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333727761

### None/Outdated: localization churn comments

**Location:** `l10n/bundle.l10n.json`.

Copilot flagged repeated changes to a "user-assigned identity" localization key. Those comments are outdated for the current branch. The current diff only adds the new `"Collections": "Collections"` localization entry.

Copilot comment references:

- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268474
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268513
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268545
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268567
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268591
- https://github.com/microsoft/vscode-documentdb/pull/714#discussion_r3333268612

## Summary

I would address the four Medium findings before merging. The Low finding is worth fixing while touching the same code, mostly for consistency with the existing lazy-count pattern. The focused Jest tests pass, but the current test coverage does not cover the zero-count display case, the exact-vs-capped race, the empty-admin `nameOnly` behavior, or unbounded database count concurrency.
