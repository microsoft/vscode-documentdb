# Copy-and-Paste Index Support: Plan, Progress, and Decisions

## Plan

- Add a dedicated index API under the task service data API.
- Show the number of copyable secondary indexes in a new paste-wizard choice.
- Copy selected indexes before any documents.
- Preserve index names where possible, skip equivalent definitions, and suffix colliding names.
- Fail the task if an index cannot be created.
- Report index progress, diagnostics, and telemetry.
- Update user documentation and cover the behavior with unit tests.

## Progress

- **Done:** Added a bounded, non-streaming index read/create service for DocumentDB API collections.
- **Done:** Excluded the collection's built-in `_id` index from the copyable count.
- **Done:** Added definition comparison, equivalent-index skipping, and deterministic `_copy` name suffixes.
- **Done:** Added the index-count choice and confirmation details to the paste wizard.
- **Done:** Added index copying as the first running task phase, before document streaming.
- **Done:** Added task failure propagation, output-channel diagnostics, and telemetry counts.
- **Done:** Deferred index counting until index copy is selected; count failures stop the paste flow, while document-only paste does not read indexes.
- **Done:** Made cancellation reporting explicit when indexes were partially created.
- **Done:** Added a five-second presentation delay after creating indexes so completion is visible.
- **Done:** Added focused tests for counts, skips, names, collisions, ordering, and failures.
- **Done:** Regenerated localization, formatted the repository, passed lint, passed all Jest tests, and passed the TypeScript build.

## Decisions

### Use one dedicated DocumentDB index service

Index definitions stay inside `data-api/indexes/DocumentDbIndexService`. The generic document reader and writer contracts remain unchanged because cross-platform index migration is out of scope.

### Keep index processing bounded and non-streaming

Index lists are read as small arrays and created sequentially. Typical collections have 5–10 indexes, and even the uncommon upper-end case of roughly 64 indexes does not justify streaming complexity.

### Copy indexes in the running phase

The target collection is ensured during task initialization. Indexes are then copied at the start of task work, before document streaming, which permits visible task progress while preserving the required ordering.

### Do not copy the built-in `_id` index

Every target collection already has this index. Excluding it gives the user an accurate count of secondary indexes that can actually be copied.

### Compare definitions before names

An equivalent target definition is skipped regardless of its name. If only the preferred name collides, the source definition is created with `_copy`, `_copy_2`, and subsequent deterministic suffixes.

### Preserve failures

Index creation errors are not treated as skips. They fail the copy-and-paste task before document transfer begins and are recorded in the extension output channel and telemetry.

### Count indexes only when copying them

The wizard asks whether to copy indexes before reading them. Choosing index copy reads the secondary-index count and stops the paste flow if that read fails. Choosing document-only paste avoids the index API entirely.

### Do not roll back indexes on cancellation

Cancellation stops before the next index and then stops the task before document transfer. Indexes already created remain on the target; the output channel and telemetry report this partial state. Automatic rollback was rejected because it could remove an index that another actor created concurrently.

### Keep the completion pause presentation-only

After at least one index is created, the task displays an index-complete message for five seconds. The delay is cancellation-aware and does not run when every definition was already present.
