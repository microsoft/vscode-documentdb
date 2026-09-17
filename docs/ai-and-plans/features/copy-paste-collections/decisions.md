---
feature: copy-paste-collections
kind: decisions
status: active
created: 2026-09-16
---

# Copy and Paste Collections Decisions

> Durable architecture and behavior decisions for collection copy/paste. Entries 0004–0011 were
> preserved from the original root-level index-copy plan when this feature folder was established.

| #    | Decision                                                       | Status              | Changed from the proposal?                                           | Date       | PR   |
| ---- | -------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- | ---------- | ---- |
| 0001 | Keep implementation documentation beside the Task Service code | Accepted            | Added by the maintainer after recalling the historical documentation | 2026-09-16 | —    |
| 0002 | Use one optional `CollectionIndexCopier` at the task boundary  | Accepted            | Chosen after rejecting the more elaborate migration pipeline         | 2026-09-16 | —    |
| 0003 | Defer a portable index model until cross-database migration    | Accepted            | Simplified from the proposed reader/planner/writer architecture      | 2026-09-16 | —    |
| 0004 | Keep index processing bounded and sequential                   | Accepted            | Migrated from the original implementation plan                       | 2026-09-16 | —    |
| 0005 | Copy indexes before document streaming                         | Accepted            | Migrated from the original implementation plan                       | 2026-09-16 | —    |
| 0006 | Exclude the built-in `_id` index                               | Superseded by D0012 | Migrated from the original implementation plan                       | 2026-09-16 | —    |
| 0007 | Compare definitions before names                               | Accepted            | Migrated from the original implementation plan                       | 2026-09-16 | —    |
| 0008 | Preserve index creation failures                               | Accepted            | Migrated from the original implementation plan                       | 2026-09-16 | —    |
| 0009 | Count indexes only after the user chooses to copy them         | Accepted            | Migrated from the original implementation plan                       | 2026-09-16 | —    |
| 0010 | Do not roll back indexes after cancellation                    | Accepted            | Migrated from the original implementation plan                       | 2026-09-16 | —    |
| 0011 | Keep the index completion pause presentation-only              | Accepted            | Migrated from the original implementation plan                       | 2026-09-16 | —    |
| 0012 | Include `_id` in the source catalog count                      | Accepted            | Supersedes the counting portion of decision 0006                     | 2026-09-17 | —    |
| 0013 | Keep copyability classification in the presentation layer      | Accepted            | Reversed an earlier draft that placed it in the copier               | 2026-09-17 | #930 |
| 0014 | Express all indexes as an omitted name restriction             | Accepted            | Simplified an earlier discriminated copier selection                 | 2026-09-17 | #930 |
| 0015 | Classify copyability from the presence of an index key         | Accepted            | Avoids incomplete vendor-specific type checks                        | 2026-09-17 | #930 |
| 0016 | Keep exclusion reasons generic                                 | Accepted            | Avoids coupling behavior to Atlas-specific terminology               | 2026-09-17 | #930 |
| 0017 | Scope confirmation detail to the user's selection              | Accepted            | Whole-catalog detail was rejected for single-index copy              | 2026-09-17 | #930 |
| 0018 | Remove the unsupported search-index placeholder                | Accepted            | Removed a promise for work that is not planned                       | 2026-09-17 | #930 |
| 0019 | Name notification cancellation Cancel Copy                     | Accepted            | Replaced the misleading Undo label                                   | 2026-09-17 | #930 |
| 0020 | Store copied indexes in CopyPasteBufferService                 | Accepted            | Rejected adding more global extension state                          | 2026-09-17 | #930 |
| 0021 | Do not roll back buffer state after a setContext failure       | Accepted            | Rejected handling an unreachable production failure                  | 2026-09-17 | #930 |
| 0022 | Keep copied index state after a successful paste               | Accepted            | Matches reusable collection-copy behavior                            | 2026-09-17 | #930 |
| 0023 | Use a dedicated task for index-only copy                       | Accepted            | Rejected reusing document-transfer orchestration                     | 2026-09-17 | #930 |
| 0024 | Preserve collection-copy behavior while adapting contracts     | Accepted            | Rejected count and prompt-order redesigns                            | 2026-09-17 | #930 |

> Entries below are semantically immutable. Append a new decision rather than rewriting an old one,
> and record a reversal as a new entry plus a status change in the table.

**Status vocabulary:** `Proposed` · `Open` · `Accepted` · `Accepted (modified)` · `Deferred` ·
`Superseded by D#` · `Rejected`

## 0001 — Keep implementation documentation beside the Task Service code

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** maintainer

### Question

Should creating a feature knowledge base move or replace the existing Task Service and Data API
READMEs?

### Decision

No. Keep implementation-oriented documentation beside the Task Service code. Add an indexes README
in `data-api/indexes/` following the same convention. Use this feature folder for durable intent,
architecture decisions, and future iteration history, with links in both directions.

### Reasoning

The colocated READMEs are the established entry point for contributors working in the Task Service.
Moving them would break that useful proximity and erase the historical documentation pattern. The
feature knowledge base answers a different question: why boundaries and constraints were chosen.

### Consequence

Some topics appear in both places at different levels. The local README describes current code;
this folder records intent. If they conflict, code wins for behavior and the active feature documents
win for intent.

## 0002 — Use one optional `CollectionIndexCopier` at the task boundary

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** architecture review

### Question

What index dependency should `CopyPasteCollectionTask` receive instead of the current pair of
concrete `DocumentDbIndexService` instances?

### Decision

Receive one optional `CollectionIndexCopier`. The copier owns the complete source-to-target index
operation, including counting, discovery, comparison, collision handling, creation, and any
post-creation state changes. Its first implementation is specific to the DocumentDB API.

### Reasoning

The task needs to coordinate an optional phase and report its outcome; it does not need to understand
index definitions. One operation-level dependency gives the task a small contract, preserves the
existing bounded sequential algorithm, and keeps provider-specific index semantics together.

Making the dependency optional preserves an important behavior: choosing document-only paste does
not read the source index catalog. Counting remains a separate method because the wizard performs it
only after the user selects index copying. That method returns the count together with the names of
unique and TTL indexes so the confirmation can warn about their document-copy consequences without
reading the catalog twice.

### Rejected alternatives

- **Keep `source.copyIndexesTo(target)`.** This leaves concrete database types in the task contract
  and makes the source service responsible for invoking private behavior on another service.
- **Give the task generic index readers and writers.** This forces the task or a shared layer to own
  comparison and translation semantics before the product needs them.
- **Introduce source reader, migration planner, and target writer now.** This supports future
  cross-database translation but adds capabilities, intermediate models, and failure categories that
  have no current consumer.

### Consequence

The first copier can copy only between endpoints understood by that implementation. This is accepted
scope, not an extensibility claim. Decision 0003 defines when the boundary must be revisited.

## 0003 — Defer a portable index model until cross-database index migration is required

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** maintainer correction to the proposed architecture

### Question

Should the feature introduce an `IndexCatalogReader`, `IndexMigrationPlanner`,
`IndexCatalogWriter`, and portable index artifact now so that different database families can copy
indexes between each other later?

### Decision

No. Do not introduce a portable index representation or migration pipeline now. Implement the
simple `CollectionIndexCopier` boundary for the supported DocumentDB API operation.

Revisit this decision if cross-database index migration becomes an approved product requirement.
That revisit must happen before implementing unlike source and target providers behind the copier.

### Reasoning

Index portability is not merely a source/target API problem. Database families differ in expression
indexes, partial predicates, included columns, collations, visibility, text and vector semantics,
naming limits, and creation behavior. A portable model designed without a concrete second provider
would either expose DocumentDB API concepts under generic names or discard information prematurely.

The document stream does not create the same problem because document content is opaque to the task.
Indexes require semantic translation, capability negotiation, and explicit lossy or unsupported
outcomes. Those contracts should be designed from an actual cross-database use case.

### Revisit shape

When the trigger occurs, consider splitting the copier into:

1. source index catalog extraction;
2. translation and migration planning against target capabilities;
3. target index creation;
4. explicit `create`, `already exists`, `lossy`, and `unsupported` plan outcomes.

Same-family copies should retain a native representation for full fidelity. Cross-family copies
should use an explicit semantic representation rather than assuming native definitions are portable.

### Consequence

`CollectionIndexCopier` must not be advertised as a cross-database index API. Cross-database
document transfer can evolve independently through `DocumentReader` and `StreamingDocumentWriter`.

## 0004 — Keep index processing bounded and sequential

**Status:** Superseded by D0012 · **Date:** 2026-09-16 · **Raised by:** original index-copy implementation

### Decision

Read each index catalog into a bounded array and create indexes sequentially.

### Reasoning

Collections typically have 5–10 indexes, with uncommon upper-end cases around 64. Streaming would
add lifecycle complexity without meaningful memory savings. Sequential creation gives progress,
cancellation, name allocation, and failure handling deterministic ordering.

## 0005 — Copy indexes before document streaming

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** original index-copy implementation

### Decision

Ensure the target collection during task initialization, then copy indexes as the first running task
phase before streaming documents.

### Reasoning

Index creation requires an existing target. Running it as a visible task phase preserves ordering
and progress reporting. A failure can stop the operation before any documents are transferred.

### Consequence

TTL indexes are active while documents stream and may delete already-expired documents as they
arrive. Unique indexes may reject writes when pasted documents conflict with existing values or
when conflict handling generates new `_id` values. The confirmation names any source TTL and unique
indexes so the user can proceed or restart without index copying; index ordering remains unchanged.

## 0006 — Exclude the built-in `_id` index

**Status:** Superseded by D0012 · **Date:** 2026-09-16 · **Raised by:** original index-copy implementation

### Decision

Do not count or copy the source collection's built-in `_id` index.

### Reasoning

Every target collection already has this index. Excluding it makes the wizard count describe only
secondary indexes that can actually be recreated.

The copy exclusion remains in force. Decision 0012 supersedes only the wizard counting behavior.

## 0007 — Compare definitions before names

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** original index-copy implementation

### Decision

Skip an equivalent target definition regardless of its name. If only the preferred name collides,
create the source definition using `_copy`, `_copy_2`, and later deterministic suffixes.

Mutable visibility and build-time background behavior are not part of definition identity. A newly
created hidden index is created first and hidden afterward.

### Reasoning

Names do not determine whether an index provides the same behavior. Comparing definitions first
avoids redundant indexes, while deterministic suffixes preserve both differently defined indexes
when their names happen to collide.

## 0008 — Preserve index creation failures

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** original index-copy implementation

### Decision

Do not reinterpret index creation errors as skips. Record diagnostics and telemetry, then fail the
copy/paste task before document transfer begins.

### Reasoning

Silently continuing would report a successful collection copy with a materially different indexing
configuration. Explicit failure preserves the user's choice to copy indexes.

## 0009 — Count indexes only after the user chooses to copy them

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** maintainer requirement

### Decision

Ask whether to copy indexes before reading the source index catalog. Count indexes only after the
user selects **Copy indexes**. A count failure stops that flow; document-only paste does not call the
index API.

### Reasoning

Index discovery is unnecessary work and an unnecessary failure mode when the user wants only
documents. The ordering also keeps index access aligned with explicit user intent.

## 0010 — Do not roll back indexes after cancellation

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** original index-copy implementation

### Decision

Cancellation stops before the next index and prevents document transfer. Indexes already created
remain on the target, and diagnostics and telemetry report the partial result.

### Reasoning

Automatic rollback could remove an index created concurrently by another actor or otherwise race
with target changes. Leaving completed indexes is safer and makes cancellation monotonic.

## 0011 — Keep the index completion pause presentation-only

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** original index-copy implementation

### Decision

After at least one index is created, briefly display the completion state before document streaming.
The delay is cancellation-aware and does not run when every source definition was already present.

### Reasoning

Index creation can complete between progress-notification refreshes. A short presentation delay
makes the phase visible without changing database behavior or delaying no-op copies.

## 0012 — Include `_id` in the source catalog count

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** maintainer

### Decision

Include the built-in `_id` index in the source index count shown by the paste wizard. Continue to
exclude it from the set of indexes recreated on the target and from copy progress totals.

### Reasoning

Users expect the displayed count to match the collection's complete index catalog. Omitting the
built-in index makes the count consistently appear one lower than the count they can inspect.

## 0013 — Keep index copyability classification in the presentation layer

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** architecture review

### Question

Should `CollectionIndexCopier` classify every catalog entry shown in the tree?

### Decision

No. Classify `IndexItemModel` values in the tree, commands, and Paste Indexes wizard. Keep the
copier limited to ordinary driver index definitions it can compare and create.

### Reasoning

An earlier draft put classification in the copier because one shared decision point looked tidy.
It produced two concrete defects: the copier needed a second search-catalog read unrelated to its
creation algorithm, and one predicate could not be typed across the tree's `IndexItemModel` and the
driver's `IndexDescriptionInfo`. The tree owns a growing presentation superset; the provider-neutral
copier should not change whenever that superset gains another display-only entry.

### Consequence

The copier never reads search indexes. The wizard's exclusion report is advisory, while the
ordinary source catalog used by the copier remains authoritative for work.

## 0014 — Express all indexes as an omitted name restriction

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** contract review

### Question

Should the copier accept an explicit `{ kind: 'all' }` selection?

### Decision

No. `sourceIndexNames: undefined` means every copyable secondary index; a readonly name array means
only those indexes.

### Reasoning

An explicit all variant and an omitted restriction described the same request and doubled the
contract test matrix. The presentation buffer still uses a discriminated scope because it must
remember whether the user selected one live child or the live parent.

### Consequence

Collection copy and parent index copy omit the list. Single-index copy supplies one name.

## 0015 — Classify copyability from the presence of an index key

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** catalog-shape review

### Question

How should presentation code identify entries the ordinary index copier cannot create?

### Decision

Treat an exact `_id` key as built in and any entry without `key` as not copyable. Do not classify on
`type === 'search'`.

### Reasoning

Atlas also reports `vectorSearch`, so a search-only type check silently accepts unsupported entries.
Absence of `key` matches the creation boundary and keeps ordinary DocumentDB vector indexes, which
have a key and `cosmosSearchOptions`, copyable.

### Consequence

`IndexItemModel.type` includes `vectorSearch`, but type is used for explanation rather than the copy
decision.

## 0016 — Keep exclusion reasons generic

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** extensibility review

### Question

Should the exclusion enum name Atlas Search directly?

### Decision

Use `builtInId` and `notCopyable`. Render the concrete catalog type separately.

### Reasoning

The same structural exclusion can apply to future non-Atlas catalog entries. Encoding a vendor in
the reason would make otherwise generic command behavior depend on where the entry originated.

### Consequence

Messages can say search or vector search while control flow remains provider-neutral.

## 0017 — Scope confirmation detail to the user's selection

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** product review

### Question

Should a single-index confirmation show whole-catalog counts and unrelated exclusions?

### Decision

No. Show only the selected index and warnings that apply to it. Parent copy shows copyable and total
catalog counts, readable copyable names, and every known exclusion.

### Reasoning

The user selected one index, not its siblings. Whole-catalog detail makes the operation appear wider
than it is. Parent copy needs the denominator and exclusions because it represents a catalog-wide
request.

### Consequence

Single-index stale validation fails instead of silently shrinking the selection. Parent exclusion
reporting remains best-effort when search discovery is unavailable.

## 0018 — Remove the unsupported search-index placeholder

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** UX review

### Question

What should replace the `Support coming soon` child under keyless entries?

### Decision

Remove it, make keyless entries non-expandable, and explain non-copyability in the row and tooltip.

### Reasoning

The placeholder promised unplanned work and created an expand affordance with no useful content.
The tooltip can explain the current limitation without implying a roadmap commitment.

### Consequence

Keyless catalog entries remain visible and informative but have no empty child node.

## 0019 — Name notification cancellation Cancel Copy

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** product wording review

### Question

Should the notification action be called Undo?

### Decision

No. Use **Cancel Copy** for both index and collection copy notifications.

### Reasoning

No database write has occurred, so Undo suggests destructive rollback. Cancel Copy accurately names
the transient state being discarded.

### Consequence

The existing collection telemetry property retains its historical meaning even though the visible
label changes.

## 0020 — Store copied indexes in CopyPasteBufferService

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** state-ownership review

### Question

Where should transient copied-index state live?

### Decision

Use a typed singleton service that stores stable source descriptors and a copied scope, clones on
write and read, and exclusively synchronizes `documentdb.hasCopiedIndexes`.

### Reasoning

Adding `ext.copiedIndexes` repeats the collection flow's unstable tree-node storage. A clipboard
name implies operating-system clipboard data, while a selection name conflicts with current tree
selection. CopyPasteBufferService describes the actual transient typed state.

### Consequence

The index buffer contains `clusterId`, never `treeId` or tree nodes. Collection state remains
independent until a separate migration is approved.

## 0021 — Do not roll back buffer state after a setContext failure

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** reliability review

### Question

Should `setIndexes` roll back state if VS Code's built-in `setContext` command rejects?

### Decision

No. Set state, await `setContext`, and test correct key wiring rather than artificial rollback.

### Reasoning

`setContext` is an in-process built-in with no I/O or key validation. Rejection means the built-in
command registry itself is unavailable, a state where extension operation is already broken. A
rollback test could only encode a mock-only branch; exact menu-key tests catch the reachable wiring
failure.

### Consequence

All buffer mutations are awaited, and package tests bind Paste Indexes to the same key.

## 0022 — Keep copied index state after a successful paste

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** workflow review

### Question

Should a successful paste consume the copied-index selection?

### Decision

No. Keep it until another index copy replaces it, Cancel Copy clears it, or stale-source validation
clears it.

### Reasoning

Users may paste the same selection into several targets, and collection copy already behaves as a
reusable marker. Consuming it would require repeating source selection for each target.

### Consequence

Successful task execution never calls `clearIndexes`.

## 0023 — Use a dedicated task for index-only copy

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** task architecture review

### Question

Should index-only paste reuse `CopyPasteCollectionTask`?

### Decision

No. Add `CopyIndexesTask` and reuse `Task`, resource tracking, progress reporting, and
`CollectionIndexCopier`.

### Reasoning

The collection task also owns target creation, document counting, conflict policy, streaming, and a
document-transition delay. Reusing it would add irrelevant lifecycle and obscure determinate index
progress.

### Consequence

The dedicated task targets existing collections, reports index-by-index percentages, and declares
both collections as stable resources. The execute step owns live tree annotation and refresh.

## 0024 — Preserve collection-copy behavior while adapting contracts

**Status:** Accepted · **Date:** 2026-09-17 · **Raised by:** regression review

### Question

How much of the existing collection workflow should change while adding dedicated index copy?

### Decision

Limit changes to the shared options contract, result naming, neutral prompt text, notification
labels, command-palette hiding, and required caller adaptations. Preserve document and index
ordering, counts, warnings, progress, target creation, conflicts, failures, and cancellation.

### Reasoning

Changing `SourceIndexSummary.count` to an `_id`-free count was rejected because Paste Collection
displays that value directly; decision 0012 remains in force. Moving index counting before the
choice was rejected because documents-only copy must not read indexes; decision 0009 is reaffirmed.
Adding presentation classification to collection copy would require a new round trip solely for
display. The factual word “all” could be removed without any of those behavioral changes.

### Consequence

Collection copy omits `sourceIndexNames` and remains independent from the index buffer. Its known
catalog-count mismatch with search indexes is documented but deferred.
