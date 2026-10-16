---
feature: copy-paste-collections
kind: iteration
status: active
created: 2026-09-18
code:
    - src/services/taskService/data-api/indexes/CollectionIndexCopier.ts
    - src/services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier.ts
    - src/services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier.test.ts
    - src/services/taskService/tasks/copy-indexes/CopyIndexesTask.ts
    - src/services/taskService/tasks/copy-indexes/CopyIndexesTask.test.ts
---

# Index-copy provider boundary

## Request and decision

The operator wants the task stack reusable by other databases that provide their own handlers and
connectors. Copying between different database families is not planned. The specific request was to
let the injected DocumentDB index copier own connection handling and source validation, so the
dedicated index-copy task does not perform authentication checks.

Keep `CollectionIndexCopier` as the task contract. The command supplies a concrete
`DocumentDbCollectionIndexCopier`, but the task only consumes the interface. Another database can
supply a different implementation for copying within its own family.

## Implementation

- **Validation moved, not removed.** `DocumentDbCollectionIndexCopier.copyIndexes()` checks source
  credential availability and collection existence before acquiring the target client. It rereads the
  source catalog and validates selected names before target catalog access or index creation. This
  protects against a source disappearing after wizard confirmation. These checks are not an atomic
  snapshot; later server-side changes still surface through the database operation.
- **Task remains orchestration-only.** `CopyIndexesTask` retains lifecycle, resource tracking,
  cancellation, progress, and generic failure/result reporting. Its initialization records the
  correlation ID without accessing a database. It no longer imports `CredentialCache`,
  `ClustersClient`, or the concrete copier's endpoint type.
- **Endpoint descriptors are shared.** `CollectionEndpoint` lives beside the copier interface.
  `DocumentDbCollectionEndpoint` remains a compatibility alias for existing construction sites.
- **Cancellation covers validation.** An already-aborted copy does not acquire clients. Cancelling
  while collection validation is pending rejects the wait without accessing the target. The source
  server request itself is not forcibly cancelled. Existing index-by-index cancellation is unchanged.
- **Errors remain actionable.** The previous localized source errors now originate in the copier.
  Their names are `SourceConnectionUnavailableError` and `SourceCollectionNotFoundError`. The task
  preserves the cause and reports the name through `indexCopyError`, with `indexCopyFailed=true`.
  These are execution failures rather than initialization failures; the index task no longer emits
  the initialization-only `sourceClusterDisconnected` and `sourceCollectionNotFound` flags.

## Alternatives and limits

A separate injected validator was rejected because the copier already owns the endpoints and
database access. A new initialization method on the copier interface would impose a two-call
protocol without adding useful functionality. Binding the task directly to the concrete copier would
prevent other providers from supplying their own implementation. A portable index model or separate
index reader/writer pair is unnecessary without cross-family translation.

Wizard checks remain for early feedback and copied-selection cleanup. `getSourceIndexSummary()`
retains its source-only behavior. Collection copies also use this copier, so their index phase gains
the execution-time check, but `CopyPasteCollectionTask` still has its existing DocumentDB-specific
source validation and metadata collection. Removing those dependencies is a separate change.

## Verification

The focused copier and index-task suites pass: 43 tests. Coverage includes a disconnected source,
a collection deleted after summary loading, validation failure before target access, cancellation
during validation and catalog reads, provider-free task initialization, and generic failure reporting.
Existing tests retain progress, selection, TTL/unique safeguards, and index creation behavior.

## Outcome

The affected copier, task, and copy/paste command suites pass: 106 tests across 13 suites, run with
`npx jest --no-coverage --runInBand` against those paths. `npm run build` and `git diff --check` also
passed. No live database authentication or integration testing was performed.
