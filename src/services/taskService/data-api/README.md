# DocumentDB API transfer adapters

The database-neutral reader, writer, retry engine, index contract, and collection-copy task live
in [`@microsoft/vscode-ext-tasks-data-transfer`](../../../../packages/vscode-ext-tasks-data-transfer/README.md).
This directory contains the DocumentDB API implementations and extension-specific assembly.

## Extension components

- [`DocumentDbDocumentReader.ts`](./readers/DocumentDbDocumentReader.ts) obtains a client lazily
  and implements source counting and streaming.
- [`DocumentDbStreamingWriter.ts`](./writers/DocumentDbStreamingWriter.ts) implements
  DocumentDB API bulk writes, conflict handling, error classification, and partial progress.
- [`DocumentDbCollectionIndexCopier.ts`](./indexes/DocumentDbCollectionIndexCopier.ts) copies
  supported index definitions; see the [index-copy notes](./indexes/README.md).
- [`ExecuteStep.ts`](../../../commands/pasteCollection/ExecuteStep.ts) assembles the adapters,
  optional index copier, host options, and shared copy task.

For generic adapter contracts, settings, retry behavior, and examples, use the package README
rather than the extension-specific implementations. Design rationale is in
[Task Packages](../../../../docs/ai-and-plans/features/task-packages/README.md).
