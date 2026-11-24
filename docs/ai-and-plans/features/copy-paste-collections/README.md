---
feature: copy-paste-collections
kind: notes
status: active
created: 2026-09-16
code:
    - src/commands/copyIndexes/**
    - src/commands/pasteCollection/**
    - src/commands/pasteIndexes/**
    - src/services/CopyPasteBufferService.ts
    - src/services/taskService/data-api/**
    - packages/vscode-ext-tasks-data-transfer/src/tasks/copy-and-paste/**
    - src/services/taskService/tasks/copy-indexes/**
---

# Copy and Paste Collections

**Status:** active

> This feature knowledge base starts here. The implementation predates this folder; the shared
> task and transfer packages and the extension-specific adapters each have implementation guides.
> The earlier index-copy plan and its durable decisions have been absorbed here.

Copy and Paste Collections transfers documents between collections as a background task. It can
also recreate secondary indexes before document transfer begins. The document data plane is split
into source and target abstractions; index copying uses one task-level `CollectionIndexCopier`
implemented for the DocumentDB API.

The same copier also supports dedicated index-only copy and paste. Users can mark one ordinary
secondary index or all copyable secondary indexes from an Indexes node, then paste them into an
existing collection without transferring documents.

## Existing documentation

These implementation guides accompany the shared packages and the DocumentDB extension:

- [Task package](../../../../packages/vscode-ext-tasks/README.md) — task lifecycle, resource
  tracking, progress, and cancellation
- [Transfer package](../../../../packages/vscode-ext-tasks-data-transfer/README.md) — the Copy and
  Paste task, document readers, writers, batching, retry, and conflict handling
- [Task Service integration](../../../../src/services/taskService/README.md) and
  [DocumentDB API adapters](../../../../src/services/taskService/data-api/README.md) — extension
  wiring and provider-specific code
- [Indexes implementation README](../../../../src/services/taskService/data-api/indexes/README.md) —
  current index-copy behavior and code map
- [Copy and Paste user guide](../../../user-manual/copy-and-paste.md) — user-visible workflow and
  behavior

These guides describe the implementation. This feature folder records durable intent and
rationale. Code and tests remain authoritative for current behavior.

## Implemented index behavior

- The wizard offers index copying separately from document conflict handling.
- Source indexes are counted only after the user selects **Copy indexes**; document-only paste never
  reads the index catalog.
- Collection paste refuses the index-copy option when the source contains TTL or unique indexes;
  those document-affecting definitions require the separately confirmed dedicated index flow.
- The source catalog count includes the built-in `_id` index, but `_id` is excluded from the copy
  operation and its progress totals.
- Non-document-affecting indexes are copied sequentially after target creation and before document
  streaming. The copier denies TTL and unique indexes by default as an execution-time backstop.
- Equivalent definitions are skipped regardless of name and server-generated catalog versions.
  Same-key option conflicts are skipped rather than duplicated. A conflicting name on a different
  key receives deterministic `_copy`, `_copy_2`, and later suffixes.
- Supported DocumentDB API options, including vector index options, are preserved. Builds always
  request background creation, and `hidden` is applied separately after creation rather than copied
  as a creation option. Other server-normalized index shapes are not yet proven to round-trip.
- Creation failures fail the task before document transfer. Cancellation keeps indexes already
  created and prevents document transfer.
- Progress, result counts, diagnostics, telemetry, and a cancellation-aware completion pause are
  reported by the task and copier.
- Each paste wizard shares a purpose-specific `copyOperationCorrelationId` with its task
  initialization and execution events; Paste Indexes also records confirmed scope and selection
  size on the wizard event.
- Dedicated Copy Index uses one stable index name or an immutable selected-name subset; Copy
  Indexes retains a live parent scope until paste-time loading, then freezes the resolved names
  through confirmation and task execution.
- Mixed tree selections may be invoked from any selected index row; `_id` and non-copyable search
  entries are ignored while ordinary selected indexes are retained.
- Search catalog entries without ordinary keys remain visible but are classified as not copyable.
  The parent confirmation itemizes known exclusions, including `_id`; search exclusions are
  best-effort when the platform does not support their catalog API.
- Dedicated Paste Indexes targets an existing collection, scopes unique and TTL warnings to the
  selected indexes, and reports determinate index-by-index task progress.
- A successful dedicated paste leaves the copied-index buffer intact so the same selection can be
  pasted into more than one target. Another copy replaces it; Cancel Copy or stale validation
  clears it.
- Index-copy notifications link to the published copy-and-paste guide through **Learn More** without
  clearing the copied selection.

## Code map

- `src/commands/pasteCollection/**` — wizard choices, source index counting, component construction,
  task registration, and tree annotations
- `src/commands/copyIndexes/**` — stable source selection and copy notification
- `src/commands/pasteIndexes/**` — source classification, validation, confirmation, task registration,
  target annotation, and refresh
- `src/services/CopyPasteBufferService.ts` — transient copied-index state and command context
- `packages/vscode-ext-tasks-data-transfer/src/tasks/copy-and-paste/**` — orchestration, ordering,
  progress, telemetry, and resource declarations
- `src/services/taskService/tasks/copy-indexes/**` — dedicated index-only progress, telemetry, and
  resource declarations
- `packages/vscode-ext-tasks-data-transfer/src/data-api/**` — source and target abstractions,
  batching, retry, conflict handling, and the index-copy contract
- `src/services/taskService/data-api/readers/**` and `writers/**` — DocumentDB API implementations
- `src/services/taskService/data-api/indexes/**` — current DocumentDB API index discovery,
  comparison, naming, creation, and visibility handling

## Architecture

The current and intended boundaries are described in [design.md](./design.md). The important split
is:

- document transfer uses a `DocumentReader` source and `StreamingDocumentWriter` target;
- task lifecycle, progress, cancellation, and telemetry remain in `CopyPasteCollectionTask`;
- index copying uses one optional `CollectionIndexCopier` supplied to the task;
- dedicated index copy supplies the same copier with an optional source-name restriction;
- `CopyIndexesTask` uses the shared `CollectionEndpoint` descriptor and has no DocumentDB client or
  credential-cache dependency; the concrete copier validates the source again during execution;
- copyability classification remains above the copier, over the user-visible catalog;
- the first copier remains DocumentDB API-specific and owns both source and target index behavior.

The single copier is a deliberate scope choice, not a claim that indexes are portable. If
cross-database index migration becomes a product requirement, this boundary must be revisited before
adding translation between database families. Another database can supply its own same-family copier
without changing this interface. See [decision 0002](./decisions.md#0002--use-one-optional-collectionindexcopier-at-the-task-boundary).

The task validation refactor and its verification are recorded in
[05 - Index-copy provider boundary](./iterations/05-index-copy-provider-boundary.md).

## Decisions

Durable decisions are recorded in [decisions.md](./decisions.md). Entries 0004–0011 preserve the
behavioral decisions that originally lived in the obsolete root-level index-copy plan.

## Open gaps

- Cross-database document transfer needs concrete reader/writer implementations and provider-aware
  construction. Cross-database index migration is separately deferred by decision 0003.

## Reading order

1. This README
2. [design.md](./design.md)
3. [decisions.md](./decisions.md)
4. The package and extension implementation guides linked above
