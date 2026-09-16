---
feature: connections-tree
kind: notes
status: active
prs: [714, 726]
verified: 2026-08-14
code:
    - src/tree/connections-view/**
    - src/services/connectionStorageService.ts
    - src/services/storageService.ts
---

# Connections Tree

**Status:** shipped · **Verified:** 2026-08-14

> Two rounds of work on the Connections view: what the tree shows per node, and how fast it loads.

The Connections view is the extension's primary tree. This area collects the work that changed what
its nodes display and how the connection list is loaded from storage.

## Code map

- `src/tree/connections-view/**` — the view, its items, and per-node decorations
- `src/services/connectionStorageService.ts`, `src/services/storageService.ts` — persistence and the
  in-memory wrapping around it

## Related skills

- [.github/skills/tree-cluster-architecture](../../../../.github/skills/tree-cluster-architecture/SKILL.md)
  — **read this first.** It owns the required patterns for cluster tree items, the dual-ID rule
  (`treeId` for tree paths, `clusterId` for cache keys), provider lookup, and the regression tests
  that protect them.

## Architecture (intent — code is authoritative for behavior)

The durable rules for this area live in the `tree-cluster-architecture` skill rather than here, so
they are loaded when an agent is actually editing tree code. This area holds the _why_ behind two
specific behaviors:

- **Item counts on tree nodes** are opt-in and bounded. The UX rationale for where counts appear,
  and where they deliberately do not, is in the item-counting iteration.
- **Connection load is not a storage read per node.** The storage-load work separates what is
  wrapped in memory from what is read on demand, and says so explicitly, because the previous shape
  made the cost invisible.

## Timeline

| Date       | PR   | What changed                                       | Docs                                                                                                                                           |
| ---------- | ---- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-06-01 | #714 | Item counts on tree nodes (indexes, collections)   | [01-item-counting-tree.md](./iterations/01-item-counting-tree.md), [review](./iterations/01-item-counting-tree-review.md)                      |
| —          | #726 | Faster connection load; clearer in-memory wrapping | [02-storage-load-optimization.md](./iterations/02-storage-load-optimization.md), [review](./iterations/02-storage-load-optimization-review.md) |

## Decisions

No separate `decisions.md`. Each iteration carries its own "UX decisions and rationale" section plus
a review with resolutions.

## Open gaps

Follow-ups are recorded at the end of each iteration's review document.

## Reading order for newcomers

1. [.github/skills/tree-cluster-architecture](../../../../.github/skills/tree-cluster-architecture/SKILL.md)
2. This README
3. The specific iteration you need provenance for
