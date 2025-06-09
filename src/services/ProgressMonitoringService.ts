/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { ext } from '../extensionVariables';
import { type ITask, TaskService, TaskState } from './TaskService';

/**
 * Service for monitoring task progress and writing updates to the output channel.
 * This is intended for debugging purposes only.
 */
export class ProgressMonitoringServiceImpl {
    private readonly monitoringIntervals = new Map<string, NodeJS.Timeout>();
    private readonly monitoringInterval = 1000; // 1 second

    /**
     * Starts monitoring a task and writes progress updates to the output channel.
     */
    public startMonitoring(taskId: string): void {
        // Stop any existing monitoring for this task
        this.stopMonitoring(taskId);

        const task = TaskService.getTask(taskId);
        if (!task) {
            ext.outputChannel.appendLog(
                l10n.t('Progress monitoring: Cannot start monitoring task {taskId} - task not found', { taskId })
            );
            return;
        }

        // Log task start
        ext.outputChannel.appendLog(
            l10n.t('Progress monitoring: Task "{taskName}" ({taskId}) started', {
                taskName: task.name,
                taskId: task.id,
            })
        );

        // Set up periodic monitoring
        const interval = setInterval(() => {
            this.logTaskProgress(task);

            // Stop monitoring if task is no longer active
            if (this.isTaskComplete(task)) {
                this.stopMonitoring(taskId);
            }
        }, this.monitoringInterval);

        this.monitoringIntervals.set(taskId, interval);

        // Monitor for abort signals
        if (task.abortController.signal) {
            task.abortController.signal.addEventListener('abort', () => {
                ext.outputChannel.appendLog(
                    l10n.t('Progress monitoring: Task "{taskName}" ({taskId}) was aborted', {
                        taskName: task.name,
                        taskId: task.id,
                    })
                );
                this.stopMonitoring(taskId);
            });
        }
    }

    /**
     * Stops monitoring a specific task.
     */
    public stopMonitoring(taskId: string): void {
        const interval = this.monitoringIntervals.get(taskId);
        if (interval) {
            clearInterval(interval);
            this.monitoringIntervals.delete(taskId);

            const task = TaskService.getTask(taskId);
            if (task) {
                this.logTaskCompletion(task);
            }
        }
    }

    /**
     * Stops monitoring all tasks.
     */
    public stopAllMonitoring(): void {
        for (const taskId of this.monitoringIntervals.keys()) {
            this.stopMonitoring(taskId);
        }
    }

    /**
     * Gets the IDs of all currently monitored tasks.
     */
    public getMonitoredTaskIds(): string[] {
        return Array.from(this.monitoringIntervals.keys());
    }

    /**
     * Checks if a task is currently being monitored.
     */
    public isMonitoring(taskId: string): boolean {
        return this.monitoringIntervals.has(taskId);
    }

    /**
     * Logs the current progress of a task to the output channel.
     */
    private logTaskProgress(task: ITask): void {
        const progressPercentage = task.progress;
        const processedItems = task.processedItems;
        const totalItems = task.totalItems;

        let progressMessage: string;
        if (totalItems > 0) {
            progressMessage = l10n.t(
                'Progress monitoring: Task "{taskName}" - {progress}% ({processed}/{total} items) - Status: {status}',
                {
                    taskName: task.name,
                    progress: progressPercentage.toString(),
                    processed: processedItems.toString(),
                    total: totalItems.toString(),
                    status: task.state,
                }
            );
        } else {
            progressMessage = l10n.t(
                'Progress monitoring: Task "{taskName}" - {progress}% - Status: {status}',
                {
                    taskName: task.name,
                    progress: progressPercentage.toString(),
                    status: task.state,
                }
            );
        }

        ext.outputChannel.appendLog(progressMessage);

        // Log errors if present
        if (task.error) {
            ext.outputChannel.appendLog(
                l10n.t('Progress monitoring: Task "{taskName}" error: {error}', {
                    taskName: task.name,
                    error: task.error.message,
                })
            );
        }
    }

    /**
     * Logs task completion to the output channel.
     */
    private logTaskCompletion(task: ITask): void {
        let completionMessage: string;

        switch (task.state) {
            case TaskState.Completed:
                completionMessage = l10n.t('Progress monitoring: Task "{taskName}" completed successfully', {
                    taskName: task.name,
                });
                break;
            case TaskState.Failed:
                completionMessage = l10n.t('Progress monitoring: Task "{taskName}" failed', {
                    taskName: task.name,
                });
                if (task.error) {
                    completionMessage += ` - ${task.error.message}`;
                }
                break;
            case TaskState.Stopped:
                completionMessage = l10n.t('Progress monitoring: Task "{taskName}" was stopped', {
                    taskName: task.name,
                });
                break;
            default:
                completionMessage = l10n.t('Progress monitoring: Task "{taskName}" ended with status: {status}', {
                    taskName: task.name,
                    status: task.state,
                });
                break;
        }

        ext.outputChannel.appendLog(completionMessage);
    }

    /**
     * Checks if a task is complete (finished, failed, or stopped).
     */
    private isTaskComplete(task: ITask): boolean {
        return (
            task.state === TaskState.Completed ||
            task.state === TaskState.Failed ||
            task.state === TaskState.Stopped
        );
    }

    /**
     * Disposes of all monitoring intervals.
     */
    public dispose(): void {
        this.stopAllMonitoring();
    }
}

// Export a singleton instance
export const ProgressMonitoringService = new ProgressMonitoringServiceImpl();