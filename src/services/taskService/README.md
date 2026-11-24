# Task Service integration

The generic task core and optional VS Code presentation live in
[`@microsoft/vscode-ext-tasks`](../../../packages/vscode-ext-tasks/README.md). The document
transfer engine and collection-copy task live in
[`@microsoft/vscode-ext-tasks-data-transfer`](../../../packages/vscode-ext-tasks-data-transfer/README.md).
This directory contains the DocumentDB extension's host wiring, adapters, and extension-only tasks.

## Extension wiring

- [`extension/taskServiceInstance.ts`](./extension/taskServiceInstance.ts) creates the shared
  registry and progress reporter. [`ClustersExtension.ts`](../../documentdb/ClustersExtension.ts)
  attaches the reporter and lifecycle log observer during activation.
- [`extension/extensionTaskOptions.ts`](./extension/extensionTaskOptions.ts) supplies the logger,
  telemetry runner, and localized core strings. The adjacent presentation, transfer, and copy-task
  string modules provide the other localized strings and host callbacks.
- Collection paste constructs the shared copy task in
  [`ExecuteStep.ts`](../../commands/pasteCollection/ExecuteStep.ts). The extension keeps its own
  [DocumentDB API adapters](./data-api/README.md), source validation, and wizard.
- [`CopyIndexesTask.ts`](./tasks/copy-indexes/CopyIndexesTask.ts) and
  [`DemoTask.ts`](./tasks/DemoTask.ts) are extension-only tasks.
- Delete and remove commands check the shared registry before destructive operations. Registration
  itself does not reject resource conflicts.

See the [UI integration notes](./UI/README.md) for tree annotations and
[Task Packages](../../../docs/ai-and-plans/features/task-packages/README.md) for design and
rationale.
