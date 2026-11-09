---
feature: task-packages
kind: notes
status: active
created: 2026-11-05
code:
    - src/services/taskService/**
    - src/commands/pasteCollection/**
    - src/commands/pasteIndexes/**
---

# Task Service and Data Transfer Packages

**Status:** planning · **Created:** 2026-11-05

> Extract the Task Service and the database-neutral document transfer engine from this extension
> into two shareable npm packages, so another VS Code extension can run the same copy-and-paste
> task over its own database without forking the code.

## Motivation

The Task Service was built a long time ago as a small framework: it registers and runs background
tasks, reports their progress in VS Code notifications, and blocks destructive operations on
resources that a running task uses. On top of it sits a document transfer engine (readers, a
streaming writer, adaptive batching, throttle recovery) and the Copy and Paste Collection task.
The engine was designed to be database independent from the start; only the readers, writers and
index copier for the DocumentDB API are database specific.

This extension covers DocumentDB and Azure Cosmos DB for MongoDB (RU). Another team will do the
same work for **Azure Cosmos DB for NoSQL** in `microsoft/vscode-cosmosdb`, where RU throttling is
the normal case rather than an edge case. Without shared packages, that team either rebuilds
throttle recovery, batching, keep-alive and the task UI, or copies them and the two copies drift.
That has already happened once: the webview theming layer existed as a near-identical fork in
`vscode-cosmosdb` before [`@microsoft/vscode-ext-webview-fluentui`](../webview-fluentui-package/README.md)
converged it. A code search of `vscode-cosmosdb` on 2026-11-05 found no copy of the Task Service,
so this time the second consumer is planned rather than an existing fork.

The current code cannot be published as is. Every file imports `vscode`, the extension's `ext`
globals, or `@microsoft/vscode-azext-utils` telemetry, and the engine's throttle recovery assumes
ordered, MongoDB-style partial writes. Extraction therefore starts with in-place refactors.

## Target shape

Two packages, named as a family, following the existing package conventions (ESM only, subpath
exports, peers for shared runtime dependencies, no product strings, no telemetry backend):

| Package                                     | Root entry (`.`)                                                                       | Subpaths                                                                   |
| ------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `@microsoft/vscode-ext-tasks`               | Task lifecycle, registry, resource conflict rules, injected logger/telemetry/strings   | `./vscode`: progress notifications, conflict modal, lifecycle log observer |
| `@microsoft/vscode-ext-tasks-data-transfer` | Reader/writer contracts and engine: buffering, batching, retry, keep-alive, statistics | `./copy-collection`: the database-neutral Copy and Paste Collection task   |

The second package has the first as a required peer. Product UX, the DocumentDB adapters and all
product glue stay in this extension. See [design.md](./design.md) for the full boundary.

## Code map (today)

- `src/services/taskService/taskService.ts`, `taskServiceResourceTracking.ts`: task core
- `src/services/taskService/UI/**`, `resourceUsageHelper.ts`: VS Code presentation
- `src/services/taskService/data-api/**`: the engine and the DocumentDB API adapters
- `src/services/taskService/tasks/**`: Copy and Paste Collection, Copy Indexes, a demo task
- `src/commands/pasteCollection/**`, `src/commands/pasteIndexes/**`: wizards and task assembly
- `src/documentdb/ClustersExtension.ts`: attaches progress reporting, lifecycle logging, and the
  product-specific survey completion subscriber at activation

## Related documentation

- [Task Service README](../../../../src/services/taskService/README.md) and
  [Data API README](../../../../src/services/taskService/data-api/README.md): implementation
  detail, partly outdated (see [design.md §2](./design.md#2-findings-that-affect-extraction))
- [copy-paste-collections](../copy-paste-collections/README.md): the feature this engine serves
- [webview-ext-package](../webview-ext-package/README.md) and
  [webview-fluentui-package](../webview-fluentui-package/README.md): the package precedents this
  plan follows

## Decisions

Recorded in [decisions.md](./decisions.md).

## Timeline

| Date       | PR  | What changed                         | Docs                                                                   |
| ---------- | --- | ------------------------------------ | ---------------------------------------------------------------------- |
| 2026-11-05 | —   | Analysis, package structure and plan | [iterations/01-extraction-plan.md](./iterations/01-extraction-plan.md) |

## Open questions

- How long finished tasks stay in the registry. Today they stay until the extension restarts.
- Whether registering a task should check resource conflicts. Today only destructive commands do.
- Partition key support and the meaning of `GenerateNewIds` for Azure Cosmos DB for NoSQL. To be
  settled in the contract review with the NoSQL team.
- Publishing: there is no publish workflow for the `@microsoft/vscode-ext-*` packages today.

## Reading order

1. This README
2. [design.md](./design.md)
3. [decisions.md](./decisions.md)
4. [iterations/01-extraction-plan.md](./iterations/01-extraction-plan.md)
