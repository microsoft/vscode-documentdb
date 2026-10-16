/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { isTerminalState, TaskState, type Task, type TaskService } from '../taskService';

/**
 * Interface for managing progress reporting of tasks.
 */
export interface TaskProgressReportingService {
    /**
     * Attaches the reporting service to a TaskService instance.
     * This will start monitoring all tasks registered with the service.
     * @param taskService The TaskService instance to monitor.
     */
    attach(taskService: TaskService): void;

    /**
     * Detaches from the TaskService and cleans up all active progress notifications.
     */
    detach(): void;

    /**
     * Gets the current set of task IDs being monitored.
     * @returns Array of task IDs with active progress notifications.
     */
    getActiveReports(): string[];
}

/**
 * Context for tracking progress of a single task.
 */
interface ProgressContext {
    progress: vscode.Progress<{ message?: string; increment?: number }>;
    token: vscode.CancellationToken;
    interval?: NodeJS.Timeout;
    previousProgress?: number;
    task: Task;
    resolve?: () => void;
    reject?: (reason?: unknown) => void;
}

/**
 * Implementation of TaskProgressReportingService that manages progress notifications
 * for all registered tasks in the TaskService.
 */
class TaskProgressReportingServiceImpl implements TaskProgressReportingService {
    private taskService?: TaskService;
    private activeReports = new Map<string, ProgressContext>();
    private subscriptions: vscode.Disposable[] = [];

    public attach(taskService: TaskService): void {
        if (this.taskService) {
            this.detach();
        }

        this.taskService = taskService;

        // Subscribe to TaskService events
        this.subscriptions.push(
            taskService.onDidRegisterTask((task) => {
                this.startMonitoringTask(task);
            }),
            taskService.onDidDeleteTask((taskId) => {
                this.stopMonitoringTask(taskId);
            }),
            taskService.onDidChangeTaskState((event) => {
                this.handleTaskStateChange(event.taskId, event.newState);
            }),
        );

        // Start monitoring existing tasks
        const existingTasks = taskService.listTasks();
        for (const task of existingTasks) {
            this.startMonitoringTask(task);
        }
    }

    public detach(): void {
        // Clean up all active progress notifications
        for (const [taskId] of Array.from(this.activeReports.keys())) {
            this.stopMonitoringTask(taskId);
        }

        // Dispose of all subscriptions
        for (const subscription of this.subscriptions) {
            subscription.dispose();
        }
        this.subscriptions = [];
        this.taskService = undefined;
    }

    public getActiveReports(): string[] {
        return Array.from(this.activeReports.keys());
    }

    private startMonitoringTask(task: Task): void {
        if (this.activeReports.has(task.id)) {
            return; // Already monitoring
        }

        const status = task.getStatus();

        // Only start monitoring if task is not in a final state
        if (isTerminalState(status.state)) {
            return;
        }

        const progressOptions: vscode.ProgressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: task.name,
            cancellable: true,
        };

        vscode.window.withProgress(progressOptions, (progress, token) => {
            return new Promise<void>((resolve, reject) => {
                const progressContext: ProgressContext = {
                    progress,
                    token,
                    task,
                    previousProgress: 0,
                };

                this.activeReports.set(task.id, progressContext);

                // Handle cancellation
                if (token.isCancellationRequested) {
                    task.stop();
                }

                token.onCancellationRequested(() => {
                    task.stop();
                });

                // Set up initial progress display
                this.updateProgressDisplay(task.id);

                // Set up polling for Running state
                this.setupProgressPolling(task.id);

                // Store resolve function for later use
                progressContext.resolve = resolve;
                progressContext.reject = reject;
            });
        });
    }

    private stopMonitoringTask(taskId: string): void {
        const context = this.activeReports.get(taskId);
        if (!context) {
            return;
        }

        // Clear polling interval if exists
        if (context.interval) {
            clearInterval(context.interval);
        }

        // Resolve the progress promise
        if (context.resolve) {
            context.resolve();
        }

        this.activeReports.delete(taskId);
    }

    private handleTaskStateChange(taskId: string, newState: TaskState): void {
        const context = this.activeReports.get(taskId);

        if (newState === TaskState.Stopping) {
            // When user cancels, VS Code dismisses the progress dialog
            // We need to create a new one for the stopping state
            if (context && context.token.isCancellationRequested) {
                // Get the task and create a new stopping progress
                const task = this.taskService?.getTask(taskId);

                if (task) {
                    // Clean up the old context
                    this.stopMonitoringTask(taskId);
                    this.showStoppingProgress(task);
                }
                return;
            }

            // If not cancelled by user, just update the existing progress
            if (context) {
                context.progress.report({
                    message: vscode.l10n.t('Stopping task...'),
                });
                // Clear any running intervals since we're stopping
                if (context.interval) {
                    clearInterval(context.interval);
                    context.interval = undefined;
                }
            }
            return;
        }

        if (!context) {
            return;
        }

        if (isTerminalState(newState)) {
            // Show final notification and clean up
            this.showFinalNotification(context.task, newState);
            this.stopMonitoringTask(taskId);
        } else {
            // Update progress display for non-final states
            this.updateProgressDisplay(taskId);
            this.setupProgressPolling(taskId);
        }
    }

    private showStoppingProgress(task: Task): void {
        const progressOptions: vscode.ProgressOptions = {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Stopping {0}', task.name),
            cancellable: false,
        };

        vscode.window.withProgress(progressOptions, (progress, token) => {
            return new Promise<void>((resolve) => {
                const progressContext: ProgressContext = {
                    progress,
                    token,
                    task,
                    previousProgress: 0,
                    resolve,
                };

                this.activeReports.set(task.id, progressContext);

                // Show stopping message
                progress.report({
                    message: vscode.l10n.t('Stopping task...'),
                });

                // No polling needed - wait for the final state
            });
        });
    }

    private updateProgressDisplay(taskId: string): void {
        const context = this.activeReports.get(taskId);
        if (!context) {
            return;
        }

        const status = context.task.getStatus();

        if (status.state === TaskState.Running && status.progress !== undefined) {
            // Calculate increment for running state
            const currentProgress = status.progress;
            const increment = currentProgress - (context.previousProgress || 0);
            context.previousProgress = currentProgress;

            context.progress.report({
                message: status.message,
                increment: increment > 0 ? increment : undefined,
            });
        } else {
            // For non-running states, show indefinite progress
            context.progress.report({
                message: status.message,
            });
        }
    }

    private setupProgressPolling(taskId: string): void {
        const context = this.activeReports.get(taskId);
        if (!context) {
            return;
        }

        // Clear existing interval
        if (context.interval) {
            clearInterval(context.interval);
            context.interval = undefined;
        }

        const status = context.task.getStatus();

        // Only set up polling for Running state
        if (status.state === TaskState.Running) {
            context.interval = setInterval(() => {
                if (!this.taskService) {
                    return;
                }

                const task = this.taskService.getTask(taskId);
                if (!task) {
                    this.stopMonitoringTask(taskId);
                    return;
                }

                const currentStatus = task.getStatus();
                if (currentStatus.state !== TaskState.Running) {
                    // State changed, clear polling
                    if (context.interval) {
                        clearInterval(context.interval);
                        context.interval = undefined;
                    }
                    return;
                }

                this.updateProgressDisplay(taskId);
            }, 1000); // Poll every second
        }
    }

    private showFinalNotification(task: Task, state: TaskState): void {
        const status = task.getStatus();

        switch (state) {
            case TaskState.Completed:
                void vscode.window.showInformationMessage(vscode.l10n.t('{0} completed successfully', task.name));
                break;
            case TaskState.Stopped:
                void vscode.window.showInformationMessage(vscode.l10n.t('{0} was stopped', task.name));
                break;
            case TaskState.Failed:
                void vscode.window
                    .showErrorMessage(
                        vscode.l10n.t(
                            '{0} failed: {1}',
                            task.name,
                            status.error instanceof Error ? status.error.message : 'Unknown error',
                        ),
                        vscode.l10n.t('Show Output'),
                    )
                    .then((choice) => {
                        if (choice === vscode.l10n.t('Show Output')) {
                            ext.outputChannel.show();
                        }
                    });
                break;
        }
    }
}

/**
 * Singleton instance of the TaskProgressReportingService for managing task progress notifications.
 */
export const TaskProgressReportingService = new TaskProgressReportingServiceImpl();
