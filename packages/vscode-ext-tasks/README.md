# @microsoft/vscode-ext-tasks

Task lifecycle, resource tracking, and optional VS Code progress notifications for extensions.
This 0.x package is not published yet; the API may change after the planned NoSQL contract review.

The examples are type-checked during the package build, and repository tests check that the
snippets match the example files.

## A task

Implement `doWork`, honor the abort signal, and report progress through `updateProgress`:

<!-- example:basic-task -->
```typescript
import { Task } from '@microsoft/vscode-ext-tasks';

export class ExampleTask extends Task {
    public readonly type = 'example';
    public readonly name = 'Process items';

    public constructor(
        private readonly items: readonly string[],
        private readonly processItem: (item: string, signal: AbortSignal) => Promise<void>,
    ) {
        super();
    }

    protected async doWork(signal: AbortSignal): Promise<void> {
        for (const [index, item] of this.items.entries()) {
            if (signal.aborted) {
                return;
            }
            await this.processItem(item, signal);
            this.updateProgress(((index + 1) / this.items.length) * 100, `Processed ${index + 1} items`);
        }
    }
}
```
<!-- endexample -->

## Initialize and track resources

Use a stable connection or cluster ID, not a tree path that can change. Return every resource the
task uses. `onInitialize` runs before `doWork`; a failed initialization ends the task without
starting its work.

<!-- example:initialized-resource-task -->
```typescript
import {
    type ResourceDefinition,
    type ResourceTrackingTask,
    Task,
    type TaskOptions,
} from '@microsoft/vscode-ext-tasks';

export class ResourceTask extends Task implements ResourceTrackingTask {
    public readonly type = 'resource-task';
    public readonly name = 'Process collection';
    private items: readonly string[] = [];

    public constructor(
        private readonly resource: ResourceDefinition,
        private readonly loadItems: (signal: AbortSignal) => Promise<readonly string[]>,
        private readonly processItems: (items: readonly string[], signal: AbortSignal) => Promise<void>,
        options?: TaskOptions,
    ) {
        super(options);
    }

    public getUsedResources(): ResourceDefinition[] {
        return [this.resource];
    }

    protected async onInitialize(signal: AbortSignal): Promise<void> {
        this.items = await this.loadItems(signal);
    }

    protected async doWork(signal: AbortSignal): Promise<void> {
        if (!signal.aborted) {
            await this.processItems(this.items, signal);
        }
    }
}
```
<!-- endexample -->

## Registry, notifications, and conflict checks

Create one registry for the extension, attach its reporter before registering tasks, and dispose the
reporter on deactivation. The operation name passed to the conflict helper should already be
localized.

<!-- example:registry -->
```typescript
import {
    createTaskService,
    type Task,
    type TaskService,
    type TaskStatus,
    whenTerminal,
} from '@microsoft/vscode-ext-tasks';
import { checkCanProceedAndInformUser, createTaskProgressReportingService } from '@microsoft/vscode-ext-tasks/vscode';

export function createTaskHost(showOutput: () => void): { service: TaskService; dispose: () => void } {
    const service = createTaskService({ maxFinishedTasks: 20 });
    const reporter = createTaskProgressReportingService({ showOutput });
    reporter.attach(service);
    return { service, dispose: () => reporter.detach() };
}

export async function runTask(service: TaskService, task: Task): Promise<TaskStatus> {
    service.registerTask(task);
    await task.start();
    await whenTerminal(task);
    return task.getStatus();
}

export async function deleteCollection(
    service: TaskService,
    clusterId: string,
    databaseName: string,
    collectionName: string,
    operationName: string,
    performDelete: () => Promise<void>,
): Promise<boolean> {
    const resource = { clusterId, databaseName, collectionName };
    if (!(await checkCanProceedAndInformUser(service, resource, operationName))) {
        return false;
    }
    await performDelete();
    return true;
}
```
<!-- endexample -->

`start()` resolves after initialization, not after the task finishes. Initialization failures
resolve `start()` with the task in `Failed` state; inspect `getStatus().error`. An invalid start
state rejects. Use `whenTerminal()` to wait for `Completed`, `Failed`, or `Stopped`, and check
the resulting status.

## API and host responsibilities

- The root entry exports `Task`, the registry, events, resource types, host options, and
  `whenTerminal`. The optional `/vscode` entry exports progress notifications, lifecycle logging,
  and the conflict warning; it requires the VS Code extension host.
- `registerTask` rejects duplicate task IDs, **not** resource conflicts. Call
  `getConflictingTasks` or the VS Code helper before a destructive operation. Resource matching
  is hierarchical and does not distinguish read and write access.
- The default finished-task retention limit is 20. Oldest finished tasks beyond the limit are
  evicted on a later registration, after terminal events are delivered; active tasks are not
  evicted. `deleteTask` also permits explicit removal; it requests a stop for an active task but
  does not wait for its work to finish before cleanup and event disposal. Wait for a terminal
  state before deletion if the caller needs to observe that state.
- `stop()` requests cancellation and returns before a running or initializing task reaches
  `Stopped`; use `whenTerminal()` to wait for it. Subclasses should check the supplied signal
  and release task-owned resources in `onDelete` when needed.
- Supply `TaskOptions` for the logger, telemetry runner, and localized task strings. The default
  logger is a no-op and default strings are English. Registry, progress, and conflict strings
  are supplied separately; `showOutput` controls whether failures offer an output button.
- These packages are ESM. A CommonJS host must load them with `await import(...)` inside an async
  function. The `/vscode` entry additionally needs `vscode` from the extension host.

## For agents

1. Subclass `Task`, give it a stable type and a user-facing name, and put work in `doWork`.
   Check the signal during long operations. Use `onInitialize` and `onDelete` for setup and
   cleanup; do not call `updateStatus` to drive the state machine.
2. Implement `ResourceTrackingTask` where applicable. Use the same stable `clusterId` for task
   resources and destructive-action checks, including connection removal and database deletion.
3. Use one registry across callers; attach a reporter and optionally the lifecycle log observer.
   Inject logging, telemetry, localized strings, and the output callback from the host. Do not
   call `vscode.l10n.t` from package code.
4. Preserve telemetry event names `taskService.taskInitialization` and
   `taskService.taskExecution`, and their existing `task_` properties when integrating with an
   existing telemetry backend.
5. Test initialization failure, cancellation, terminal-state waiting, resource conflicts, and
   notification wiring. The task and resource-tracking tests linked below are useful precedents.

## Reference implementations

The links below point to an immutable development snapshot. Before publishing, replace the
snapshot with a release tag containing these files.

- [Task lifecycle and registry](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/packages/vscode-ext-tasks/src/taskService.ts) and
  [lifecycle tests](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/packages/vscode-ext-tasks/src/taskService.test.ts)
- [Resource tracking](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/packages/vscode-ext-tasks/src/taskServiceResourceTracking.ts) and
  [resource tests](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/packages/vscode-ext-tasks/src/taskServiceResourceTracking.test.ts)
- [Host singleton and reporter](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/services/taskService/extension/taskServiceInstance.ts),
  [activation wiring](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/documentdb/ClustersExtension.ts),
  [telemetry runner and task strings](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/services/taskService/extension/extensionTaskOptions.ts),
  and [presentation strings](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/services/taskService/extension/extensionPresentationStrings.ts)
- Conflict checks for [collection deletion](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/commands/deleteCollection/deleteCollection.ts),
  [database deletion](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/commands/deleteDatabase/deleteDatabase.ts),
  and [connection removal](https://github.com/microsoft/vscode-documentdb/blob/c6fb89af1099dd8a09f47fd7aecb2b67bb493877/src/commands/removeConnection/removeConnection.ts)
