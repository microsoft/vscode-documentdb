/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProgressMonitoringService } from '../services/ProgressMonitoringService';
import { TaskService, type ITask } from '../services/TaskService';

/**
 * Example utility demonstrating how to use the ProgressMonitoringService
 * for monitoring long-running operations.
 */
export class ProgressMonitoringExample {
    /**
     * Creates a sample task that simulates processing documents and monitors its progress.
     * This demonstrates how to integrate progress monitoring into existing operations.
     */
    public static async createAndMonitorSampleTask(taskName: string, totalItems: number = 100): Promise<ITask> {
        // Create a new task
        const task = TaskService.createTask(taskName);

        // Start monitoring the task (this will log to ext.outputChannel)
        ProgressMonitoringService.startMonitoring(task.id);

        // Start the task
        task.start();

        // Simulate processing items with progress updates
        // In a real scenario, this would be your actual long-running operation
        const simulateProcessing = async (): Promise<void> => {
            try {
                task.updateProgress(0, totalItems);

                for (let i = 0; i < totalItems; i++) {
                    // Check if task was aborted
                    if (task.abortController.signal.aborted) {
                        return; // Task was stopped, exit gracefully
                    }

                    // Simulate some work (e.g., processing a document)
                    await this.simulateWorkItem();

                    // Update progress
                    task.updateProgress(i + 1);

                    // Simulate occasional errors (for demonstration)
                    if (i === Math.floor(totalItems * 0.7) && Math.random() < 0.1) {
                        throw new Error('Simulated processing error');
                    }
                }

                // Mark task as completed
                task.complete();
            } catch (error) {
                // Handle errors
                task.setError(error instanceof Error ? error : new Error('Unknown error'));
            }
        };

        // Start the processing (don't await here to return the task immediately)
        void simulateProcessing();

        return task;
    }

    /**
     * Demonstrates how to monitor an existing operation that might take time.
     * This pattern can be applied to existing functions like importDocuments, exportDocuments, etc.
     */
    public static monitorExistingOperation<T>(
        operationName: string,
        operation: (progressCallback: (processed: number, total?: number) => void) => Promise<T>,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            // Create task for monitoring
            const task = TaskService.createTask(operationName);
            ProgressMonitoringService.startMonitoring(task.id);

            task.start();

            // Create progress callback
            const progressCallback = (processed: number, total?: number): void => {
                task.updateProgress(processed, total);
            };

            // Execute the operation
            operation(progressCallback)
                .then((result) => {
                    task.complete();
                    resolve(result);
                })
                .catch((error) => {
                    const taskError = error instanceof Error ? error : new Error('Operation failed');
                    task.setError(taskError);
                    reject(taskError);
                })
                .finally(() => {
                    // Clean up the task after a delay to allow final logs
                    setTimeout(() => {
                        TaskService.removeTask(task.id);
                    }, 5000);
                });
        });
    }

    /**
     * Simulates a work item taking some time to process.
     */
    private static async simulateWorkItem(): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, 10 + Math.random() * 20); // 10-30ms random delay
        });
    }
}