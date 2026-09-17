---
feature: copy-paste-collections
kind: decisions
status: active
created: 2026-09-16
---

# Copy and Paste Collections Decisions

> Durable architecture and behavior decisions for collection copy/paste. Entries 0004–0011 were
> preserved from the original root-level index-copy plan when this feature folder was established.

| #    | Decision                                                       | Status   | Changed from the proposal?                                            | Date       | PR |
| ---- | -------------------------------------------------------------- | -------- | --------------------------------------------------------------------- | ---------- | -- |
| 0001 | Keep implementation documentation beside the Task Service code | Accepted | Added by the maintainer after recalling the historical documentation | 2026-09-16 | —  |
| 0002 | Use one optional `CollectionIndexCopier` at the task boundary   | Accepted | Chosen after rejecting the more elaborate migration pipeline          | 2026-09-16 | —  |
| 0003 | Defer a portable index model until cross-database migration     | Accepted | Simplified from the proposed reader/planner/writer architecture        | 2026-09-16 | —  |
| 0004 | Keep index processing bounded and sequential                    | Accepted | Migrated from the original implementation plan                        | 2026-09-16 | —  |
| 0005 | Copy indexes before document streaming                          | Accepted | Migrated from the original implementation plan                        | 2026-09-16 | —  |
| 0006 | Exclude the built-in `_id` index                                | Accepted | Migrated from the original implementation plan                        | 2026-09-16 | —  |
| 0007 | Compare definitions before names                                | Accepted | Migrated from the original implementation plan                        | 2026-09-16 | —  |
| 0008 | Preserve index creation failures                                | Accepted | Migrated from the original implementation plan                        | 2026-09-16 | —  |
| 0009 | Count indexes only after the user chooses to copy them           | Accepted | Migrated from the original implementation plan                        | 2026-09-16 | —  |
| 0010 | Do not roll back indexes after cancellation                     | Accepted | Migrated from the original implementation plan                        | 2026-09-16 | —  |
| 0011 | Keep the index completion pause presentation-only               | Accepted | Migrated from the original implementation plan                        | 2026-09-16 | —  |

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

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** original index-copy implementation

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

**Status:** Accepted · **Date:** 2026-09-16 · **Raised by:** original index-copy implementation
### Decision

Do not count or copy the source collection's built-in `_id` index.

### Reasoning

Every target collection already has this index. Excluding it makes the wizard count describe only
secondary indexes that can actually be recreated.

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