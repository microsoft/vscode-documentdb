---
feature: copy-paste-collections
kind: notes
status: active
created: 2026-09-16
code:
    - src/commands/pasteCollection/**
    - src/services/taskService/data-api/**
    - src/services/taskService/tasks/copy-and-paste/**
---

# Copy and Paste Collections

**Status:** active

> This feature knowledge base starts here. The implementation and its older technical documentation
> predate this folder. The implementation documentation remains beside the Task Service code, while
> the earlier index-copy plan and its durable decisions have been absorbed here.

Copy and Paste Collections transfers documents between collections as a background task. It can
also recreate secondary indexes before document transfer begins. The document data plane is split
into source and target abstractions; index copying uses one task-level `CollectionIndexCopier`
implemented for the DocumentDB API.

## Existing documentation

These documents remain where contributors historically maintained them:

- [Task Service architecture](../../../../src/services/taskService/README.md) — task lifecycle,
  resource tracking, progress, cancellation, and the Copy and Paste task
- [Data API architecture](../../../../src/services/taskService/data-api/README.md) — document reader,
  streaming writer, batching, retry, and conflict handling
- [Indexes implementation README](../../../../src/services/taskService/data-api/indexes/README.md) —
  current index-copy behavior and code map
- [Copy and Paste user guide](../../../user-manual/copy-and-paste.md) — user-visible workflow and
  behavior

The Task Service and Data API READMEs describe the implementation. This feature folder records
durable intent and rationale. Code and tests remain authoritative for current behavior.

## Implemented index behavior

- The wizard offers index copying separately from document conflict handling.
- Source indexes are counted only after the user selects **Copy indexes**; document-only paste never
  reads the index catalog.
- The built-in `_id` index is excluded from the count and copy operation.
- Indexes are copied sequentially after target creation and before document streaming.
- Equivalent definitions are skipped regardless of name. A conflicting name receives deterministic
  `_copy`, `_copy_2`, and later suffixes.
- Supported DocumentDB API options, including vector index options, are preserved. Builds always
  request background creation, and `hidden` is applied separately after creation rather than copied
  as a creation option. Other server-normalized index shapes are not yet proven to round-trip.
- Creation failures fail the task before document transfer. Cancellation keeps indexes already
  created and prevents document transfer.
- Progress, result counts, diagnostics, telemetry, and a cancellation-aware completion pause are
  reported by the task and copier.

## Code map

- `src/commands/pasteCollection/**` — wizard choices, source index counting, component construction,
  task registration, and tree annotations
- `src/services/taskService/tasks/copy-and-paste/**` — orchestration, ordering, progress, telemetry,
  and resource declarations
- `src/services/taskService/data-api/readers/**` — source document abstraction and DocumentDB API
  implementation
- `src/services/taskService/data-api/writers/**` — target streaming abstraction, batching, retry,
  conflict handling, and DocumentDB API implementation
- `src/services/taskService/data-api/indexes/**` — current DocumentDB API index discovery,
  comparison, naming, creation, and visibility handling

## Architecture

The current and intended boundaries are described in [design.md](./design.md). The important split
is:

- document transfer uses a `DocumentReader` source and `StreamingDocumentWriter` target;
- task lifecycle, progress, cancellation, and telemetry remain in `CopyPasteCollectionTask`;
- index copying uses one optional `CollectionIndexCopier` supplied to the task;
- the first copier remains DocumentDB API-specific and owns both source and target index behavior.

The single copier is a deliberate scope choice, not a claim that indexes are portable. If
cross-database index migration becomes a product requirement, this boundary must be revisited before
adding another implementation. See [decision 0002](./decisions.md#0002--use-one-optional-collectionindexcopier-at-the-task-boundary).

## Decisions

Durable decisions are recorded in [decisions.md](./decisions.md). Entries 0004–0011 preserve the
behavioral decisions that originally lived in the obsolete root-level index-copy plan.

## Open gaps

- Source validation and cluster metadata collection in `CopyPasteCollectionTask` still reach
  directly into DocumentDB infrastructure, so the complete task is less provider-neutral than its
  document data plane.
- The older Task Service and Data API READMEs do not yet show the index-copy phase in their diagrams
  or file trees.
- Cross-database document transfer needs concrete reader/writer implementations and provider-aware
  construction. Cross-database index migration is separately deferred by decision 0003.

## Reading order

1. This README
2. [design.md](./design.md)
3. [decisions.md](./decisions.md)
4. The existing Task Service and Data API READMEs for implementation detail