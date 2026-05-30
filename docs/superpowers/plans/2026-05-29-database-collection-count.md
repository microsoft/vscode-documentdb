# Database Collection Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an asynchronous collection count on database tree items without blocking tree expansion.

**Architecture:** Add a small lazy-loading state machine to `DatabaseItem`, matching the existing `CollectionItem` pattern: unloaded, loading, loaded, failed. When a `DatabaseItem` is created, its parent will kick off the background count fetch. Once the count resolves, the tree item refreshes itself and displays a localized count description.

**Tech Stack:** TypeScript, Jest, VS Code tree items, existing `ClustersClient.listCollections()`

---

### Task 1: Lock in the behavior with a focused tree-item test

**Files:**
- Modify: `src/tree/documentdb/IndexesItem.test.ts`
- Create: `src/tree/documentdb/DatabaseItem.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { DatabaseItem } from './DatabaseItem';

it('shows collection count in the tree item description after loading', () => {
    const item = new DatabaseItem(cluster, { name: 'db1' } as never);

    expect(item.getTreeItem().description).toBeUndefined();
});
```

- [ ] **Step 2: Run the targeted test to verify it fails for the missing behavior**

Run: `npx jest src/tree/documentdb/DatabaseItem.test.ts --runInBand`

Expected: fail because the tree item does not yet expose a collection-count description path that the test can exercise.

- [ ] **Step 3: Write the minimal implementation**

No production code yet in this task.

- [ ] **Step 4: Run the targeted test to verify the test harness is correct**

Run: `npx jest src/tree/documentdb/DatabaseItem.test.ts --runInBand`

Expected: the test remains red until the production code is added in Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/tree/documentdb/DatabaseItem.test.ts src/tree/documentdb/IndexesItem.test.ts docs/superpowers/plans/2026-05-29-database-collection-count.md
git commit -m "test: cover database collection count display"
```

### Task 2: Implement lazy collection-count loading for `DatabaseItem`

**Files:**
- Modify: `src/tree/documentdb/DatabaseItem.ts`
- Modify: `src/tree/documentdb/ClusterItemBase.ts`

- [ ] **Step 1: Write the failing assertion first**

Extend `DatabaseItem.test.ts` with a loaded-state assertion:

```typescript
it('renders the loaded collection count as a localized description', () => {
    const item = new DatabaseItem(cluster, { name: 'db1' } as never);
    (item as unknown as { collectionCount: number }).collectionCount = 12;

    expect(item.getTreeItem().description).toBe('12 collections');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx jest src/tree/documentdb/DatabaseItem.test.ts --runInBand`

Expected: fail because `DatabaseItem` has no collection-count state yet.

- [ ] **Step 3: Add the minimal production code**

Add `collectionCount` and `isLoadingCount` state, a `loadCollectionCount()` method, a private `fetchAndUpdateCount()` method, and `description` logic in `getTreeItem()`. In `ClusterItemBase.getChildren()`, call `databaseItem.loadCollectionCount()` immediately after constructing each `DatabaseItem`.

- [ ] **Step 4: Run the targeted test and then the relevant tree tests**

Run:
`npx jest src/tree/documentdb/DatabaseItem.test.ts src/tree/documentdb/IndexesItem.test.ts --runInBand`

Expected: both suites pass.

- [ ] **Step 5: Commit**

```bash
git add src/tree/documentdb/DatabaseItem.ts src/tree/documentdb/ClusterItemBase.ts src/tree/documentdb/DatabaseItem.test.ts
git commit -m "feat: show collection counts on database tree items"
```

### Task 3: Verify the repo still builds cleanly

**Files:**
- No new files

- [ ] **Step 1: Run the focused checks**

Run:
`npx jest src/tree/documentdb/DatabaseItem.test.ts src/tree/documentdb/IndexesItem.test.ts --runInBand`

- [ ] **Step 2: Run the workspace build**

Run:
`npm run build`

Expected: build succeeds with no new TypeScript errors.

- [ ] **Step 3: Record the result**

Update `case22/verification.md` with the commands run and the final status.
