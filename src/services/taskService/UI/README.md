# Task Service UI Components

This folder contains optional UI services that integrate with the TaskService to provide visual feedback during task execution.

## Services

### TaskProgressReportingService

Displays VS Code notification progress dialogs for running tasks. Automatically attaches to the TaskService and monitors all registered tasks. Shows progress percentage, status messages, and allows task cancellation via the notification.

**Activation:** Automatically attached during extension initialization.

## Design Principles

1. **Separation from TaskService** - These services consume TaskService events but don't modify its core behavior
2. **Optional activation** - Not all tasks require all UI services
3. **Cleanup guarantee** - All visual indicators are cleared when tasks reach terminal states
4. **Throttled updates** - High-frequency updates are throttled to prevent excessive UI refreshes

---

## Tree View Annotations

A common requirement is to show temporary status on a tree view item while a task is running. The `ext.state.runWithTemporaryDescription` utility, combined with task state events, provides a clean way to achieve this.

The annotation is applied when the task starts and automatically removed when the task reaches a terminal state (Completed, Failed, or Stopped).

### Example: Annotating Nodes During Collection Paste

The following example from `pasteCollection/ExecuteStep.ts` shows how to annotate the source and target collection nodes in the tree view during a copy-paste operation.

```typescript
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { isTerminalState, type Task } from '../../services/taskService/taskService';

export class ExecuteStep extends AzureWizardExecuteStep<PasteCollectionWizardContext> {
    // ...

    public async execute(context: PasteCollectionWizardContext): Promise<void> {
        // ... task setup ...
        const task = new CopyPasteCollectionTask(config, reader, writer);
        TaskService.registerTask(task);

        // Set up tree annotations to show progress on source and target nodes
        // Annotations are automatically cleared when the task reaches a terminal state
        if (ext.copiedCollectionNode?.id) {
            void this.annotateNodeDuringTask(ext.copiedCollectionNode.id, vscode.l10n.t('Copying…'), task);
        }
        void this.annotateNodeDuringTask(context.targetNode.id, vscode.l10n.t('Pasting…'), task);

        void task.start();
    }

    /**
     * Annotates a tree node with a temporary description while the task is running.
     * The annotation is automatically cleared when the task reaches a terminal state.
     */
    private annotateNodeDuringTask(nodeId: string, label: string, task: Task): void {
        void ext.state.runWithTemporaryDescription(nodeId, label, () => {
            return new Promise<void>((resolve) => {
                const subscription = task.onDidChangeState((event) => {
                    if (isTerminalState(event.newState)) {
                        subscription.dispose();
                        resolve();
                    }
                });
            });
        });
    }

    // ...
}
```
