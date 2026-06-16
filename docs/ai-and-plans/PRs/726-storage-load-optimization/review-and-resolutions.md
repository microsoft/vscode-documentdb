# PR #726 — Storage Risk Review and Resolutions

PR: https://github.com/microsoft/vscode-documentdb/pull/726
Branch: `dev/tnaum/storeage-optimization`
Focus: storage-load optimization paths that run during extension activation, especially edge cases that could hide, lose, or corrupt connection data.

This document tracks every risk identified during review of PR #726 and what was actually done about it. Severities reflect the post-reassessment view.

## Severity Scale

- **Critical**: likely data loss/corruption for a broad supported path, or no practical recovery.
- **High**: user-visible data disappearance, missed migration, or corruption risk on a supported but narrower path.
- **Medium**: correctness risk, persistent inconsistency, or misleading state that can hide data or cause bad follow-on behavior.
- **Low**: maintainability, documentation, or edge-case behavior with limited user impact.

---

## Findings From The Initial Review

### Accepted product decision: removal of the Azure Databases import path

The PR removes the first-access import from the Azure Databases extension storage. The team has accepted this as a product decision. Recovery for users with un-imported legacy connections is manual; release notes must call this out.

**Resolution: accepted, no code change. Tracked only in the PR description and release notes.**

### High (revised from Medium): Orphan cleanup is marked complete before the orphan pass finishes, then future launches skip it

The previous code started `cleanupOrphanedItems()` fire-and-forget and immediately wrote the cleanup-completed marker. An interrupted/failed orphan pass would leave orphans behind while every future activation skipped the entire cleanup flow, including orphan cleanup. Because `getAllItems` returns orphans but the tree filters on `parentId`, orphans are effectively invisible to users — they read as "missing data" with no UI-driven recovery.

**Resolution — fixed via option B (await before marker).**

- Commit: [`4b6c8b54`](https://github.com/microsoft/vscode-documentdb/pull/726/commits/4b6c8b54644e345edb5beb7645bb5f95476e2b29)
- Change: `cleanupOrphanedItems()` is now awaited inside `resolvePostMigrationErrors` before the cleanup-completed marker is written. `callWithTelemetryAndErrorHandling` still swallows exceptions, so a thrown orphan-cleanup error simply prevents the marker write and the next activation retries the full pass.
- Trade-off vs. option A (split markers): pushes orphan-cleanup latency onto the activation critical path. Acceptable because orphan counts are reliably small on established installs and the cleanup is gated behind the schema-version marker anyway (one-time cost).
- Replied in Copilot thread: https://github.com/microsoft/vscode-documentdb/pull/726#discussion_r3344433030

### High (revised from Medium): `getItems` defensive copy is shallow and still shares nested `properties`

The cache returns new item objects and cloned `secrets` arrays, but `properties` is shared by reference. `ConnectionStorageService.reconstructStoredItemFromSecrets` returns the same `properties` reference, and `wrapV2AsCurrent` / `updateParentId` mutate it.

**Resolution — deferred; treated as a non-issue in current code, documented for future maintainers.**

Audit of every mutating site on returned `properties`:

1. **`wrapV2AsCurrent`** sets `properties.type = ItemType.Connection`. The assignment is **idempotent** — it always writes the same value the first time and a no-op thereafter. No user-visible effect on cached snapshots.
2. **`updateParentId`** mutates `properties.parentId` and **immediately** awaits `save()`, which invalidates the cache. The window between mutation and cache eviction is a single synchronous block + one awaited `push` — too narrow for any realistic concurrent reader to observe the mutated value as "persisted".
3. **No other consumer in the current codebase mutates `properties` on a read result.** Tree providers, `getChildren`, `getPath`, `isNameDuplicateInParent`, `collectStorageStats` are all read-only.

The risk is purely latent: a future consumer that mutates `properties` without an immediate `save()` would silently corrupt the cache. Since `structuredClone` on every read carries a measurable cost on the activation critical path (exactly what this PR is optimizing), the decision is to **not** clone today and revisit if a mutating consumer is added.

Action item for follow-up (not blocking merge): add a one-line note to `StorageImpl.getItems` warning that `properties` is shared and callers must not mutate it. To be done if any future PR introduces a new consumer.

### Low: Cache TTL starts at load creation, not successful resolution

Confirmed but not blocking. The TTL window can be effectively zero when `SecretStorage` is slow — the exact scenario the cache exists for. Trivial one-line fix is available (reassign timestamp after resolution).

**Resolution — accepted as-is for now.** Ten seconds is a comfortable safety margin for the activation read-storm, and increasing it to ~20 s would be a much cheaper change than rewriting the timestamp logic if the perf gap is ever measured. Will revisit if telemetry shows slow-storage installs missing the cache window.

---

## Additional Findings From Reassessment (Not In The Initial Copilot Review)

### High: Concurrent first callers of `getStorageService` get the service before cleanup finishes

`getStorageService` previously assigned `this._storageService` **before** awaiting `resolvePostMigrationErrors`. A second concurrent caller arriving in the same tick (tree providers, URI handler, stats hook all fire during activation) would see the field truthy, return immediately, and read dirty data — duplicate-param connections, invalid CS rows, orphans — while cleanup was still running. The new `getItems` cache then served that dirty snapshot to later readers for up to TTL.

**Resolution — fixed via option A (bootstrap promise).**

- Commit: [`ea95be18`](https://github.com/microsoft/vscode-documentdb/pull/726/commits/ea95be188e696b1e963432ae19365959ac999f0b)
- Change: `getStorageService()` caches a single in-flight `_bootstrap: Promise<Storage>`; all external callers `await` the same promise. `_storageService` is published **only after** `resolvePostMigrationErrors` and `collectStorageStats` complete.
- To avoid re-entrant deadlock during bootstrap, the cleanup helpers (`resolvePostMigrationErrors`, `cleanupOrphanedItems`, `collectStorageStats`, and the inner cleaners) now receive the `Storage` instance as a parameter instead of calling `getStorageService` themselves. A new private `loadAllItemsFromService` helper is shared between `getAllItems` and the cleanup helpers.
- PR comment: https://github.com/microsoft/vscode-documentdb/pull/726#issuecomment-4610403090

### Medium: `resolvePostMigrationErrors` cleaner-pass invariant is implicit

The three cleaners share a single pre-cleanup `items` snapshot loaded once per zone. They're currently safe because they operate on disjoint categories (folders / connections / invalid CS), but a future cleaner that depends on mutations made by a previous cleaner would silently see stale data.

**Resolution — explicit invariant added.**

- Commit: [`d9dd080b`](https://github.com/microsoft/vscode-documentdb/pull/726/commits/d9dd080b0ba67c89d3121bc5edb4b81940f1cf51)
- Change: comment block above the cleaner loop documenting that the `items` array is the pre-cleanup snapshot and that cleaners must not depend on each other's mutations. The next person extending the pass must either preserve the disjoint-category contract or rebuild the array between cleaners (cheap thanks to the per-workspace cache).
- PR comment: https://github.com/microsoft/vscode-documentdb/pull/726#issuecomment-4610403112

### Medium: Cache TTL ignores SecretStorage `onDidChange`

VS Code's `SecretStorage` exposes `onDidChange`, which fires when another window or extension mutates a secret. Pre-PR, every read hit SecretStorage so cross-window edits were always visible. Post-PR, two windows on the same profile could disagree on connection contents for up to the TTL window.

**Resolution — subscribed to `onDidChange`.**

- Commit: [`2acace99`](https://github.com/microsoft/vscode-documentdb/pull/726/commits/2acace990eda1c9b09d768c1c3b40482d39f8cdf)
- Change: `StorageImpl` constructor subscribes to `ext.secretStorage.onDidChange`. When a changed key belongs to this storage namespace (`${storageName}/${workspace}/.../secrets`), the workspace's cache entry is dropped. Unrelated secret churn is ignored. The subscription is registered through `ext.context.subscriptions` for proper disposal.
- PR comment: https://github.com/microsoft/vscode-documentdb/pull/726#issuecomment-4610403096

### Low: Orphan loop deletes invalidate the cache per item

Within the orphan loop, every `delete` invalidates the workspace cache and the next outer-iteration `getAllItems` re-reads from storage. The cache provides no benefit *during* this loop.

**Resolution — skipped intentionally.** With the bootstrap fix (#High above), no external readers race the orphan loop, so the per-delete invalidation costs nothing in practice — the next iteration *needs* to re-read anyway because deletes have happened. No throughput regression vs. the pre-PR baseline. The original "Low" rating was generous; on reflection there is no real waste to fix.

### Low: `StorageImpl.delete` clears the cache before deleting secrets

Considered and intentionally left as-is. The current ordering keeps the cache consistent with the most recent committed state visible to consumers; rearranging it would not improve correctness.

**Resolution — no change, deliberately.**

---

## Copilot Reviewer Thread Status

| Thread | Status | Linked commit |
| --- | --- | --- |
| [r3344433030](https://github.com/microsoft/vscode-documentdb/pull/726#discussion_r3344433030) — orphan cleanup gating | **Resolved by code** | [`4b6c8b54`](https://github.com/microsoft/vscode-documentdb/pull/726/commits/4b6c8b54644e345edb5beb7645bb5f95476e2b29) |
| [r3344433066](https://github.com/microsoft/vscode-documentdb/pull/726#discussion_r3344433066) — `STORAGE_CLEANUP_VERSION` as schema counter | Open (Low, maintainability) | — |
| [r3344433094](https://github.com/microsoft/vscode-documentdb/pull/726#discussion_r3344433094) — commit-count doc drift | Outdated by subsequent commits | — |
| [r3344688042](https://github.com/microsoft/vscode-documentdb/pull/726#discussion_r3344688042) — TTL start time | Accepted as-is (Low) | — |
| [r3344688104](https://github.com/microsoft/vscode-documentdb/pull/726#discussion_r3344688104) — shallow defensive copy | Deferred, see High finding above | — |

---

## Summary

| Severity | Finding | Status |
| --- | --- | --- |
| High | Orphan cleanup marker race | Fixed ([`4b6c8b54`](https://github.com/microsoft/vscode-documentdb/pull/726/commits/4b6c8b54644e345edb5beb7645bb5f95476e2b29)) |
| High | `getItems` shallow copy of `properties` | Deferred — no current mutating consumer, documented |
| High | Concurrent `getStorageService` race | Fixed ([`ea95be18`](https://github.com/microsoft/vscode-documentdb/pull/726/commits/ea95be188e696b1e963432ae19365959ac999f0b)) |
| Medium | Cleaner-pass invariant implicit | Documented ([`d9dd080b`](https://github.com/microsoft/vscode-documentdb/pull/726/commits/d9dd080b0ba67c89d3121bc5edb4b81940f1cf51)) |
| Medium | Cross-window SecretStorage changes ignored | Fixed ([`2acace99`](https://github.com/microsoft/vscode-documentdb/pull/726/commits/2acace990eda1c9b09d768c1c3b40482d39f8cdf)) |
| Low | TTL start time | Accepted as-is |
| Low | Orphan loop per-delete invalidation | Skipped (no real cost with bootstrap fix) |
| Low | `delete` cache-clear ordering | No change, deliberate |
