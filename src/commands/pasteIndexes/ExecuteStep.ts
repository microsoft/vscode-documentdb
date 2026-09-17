import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { CopyIndexesTask } from '../../services/taskService/tasks/copy-indexes/CopyIndexesTask';
import { isTerminalState, TaskService, type Task } from '../../services/taskService/taskService';
import { type PasteIndexesWizardContext } from './PasteIndexesWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<PasteIndexesWizardContext> {
    public priority: number = 100;

    public async execute(context: PasteIndexesWizardContext): Promise<void> {
        const task = new CopyIndexesTask(
            {
                source: context.source,
                target: context.target,
                sourceIndexNames: context.sourceIndexNames,
            },
            context.indexCopier,
        );
        TaskService.registerTask(task);
        this.annotateTarget(context.targetIndexesId, task);

        const subscription = task.onDidChangeState((event) => {
            if (isTerminalState(event.newState)) {
                ext.state.notifyChildrenChanged(context.targetIndexesId);
                subscription.dispose();
            }
        });

        try {
            await task.start();
        } catch (error) {
            subscription.dispose();
            throw error;
        }
    }

    public shouldExecute(): boolean {
        return true;
    }

    private annotateTarget(targetIndexesId: string, task: Task): void {
        void ext.state.runWithTemporaryDescription(
            targetIndexesId,
            vscode.l10n.t('Pasting...'),
            () =>
                new Promise<void>((resolve) => {
                    const subscription = task.onDidChangeState((event) => {
                        if (isTerminalState(event.newState)) {
                            subscription.dispose();
                            resolve();
                        }
                    });
                }),
            true,
        );
    }
}