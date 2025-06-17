/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Task } from '../taskService';

/**
 * A dummy task implementation that demonstrates the Task abstract class.
 * This task simulates work by using timeouts and provides progress updates over a 10-second duration.
 *
 * The base class handles all state management, allowing this implementation
 * to focus solely on the business logic.
 */
export class DummyTask extends Task {
    public readonly type: string = 'dummy-task';
    public readonly name: string;

    /**
     * Creates a new DummyTask instance.
     *
     * @param id Unique identifier for the task.
     * @param name User-friendly name for the task.
     */
    constructor(id: string, name: string) {
        super(id);
        this.name = name;
    }

    /**
     * Implements the main task logic with progress updates.
     * The base class handles all state transitions and error handling.
     *
     * @param signal AbortSignal to check for stop requests.
     */
    protected async doWork(signal: AbortSignal): Promise<void> {
        const totalSteps = 10;
        const stepDuration = 1000; // 1 second per step

        for (let step = 0; step < totalSteps; step++) {
            // Check for abort signal
            if (signal.aborted) {
                return;
            }

            // Simulate work
            await this.sleep(stepDuration);

            // Update progress
            const progress = ((step + 1) / totalSteps) * 100;
            this.updateProgress(
                progress,
                vscode.l10n.t('Processing step {0} of {1}', step + 1, totalSteps),
            );
        }
    }

    /**
     * Optional initialization logic.
     * Called by the base class during start().
     */
    protected async onInitialize(): Promise<void> {
        console.log(`Initializing task: ${this.name}`);
        // Could perform resource allocation, connection setup, etc.
    }

    /**
     * Optional cleanup logic when stopping.
     * Called by the base class during stop().
     */
    protected async onStop(): Promise<void> {
        console.log(`Stopping task: ${this.name}`);
        // Could close connections, save state, etc.
    }

    /**
     * Optional cleanup logic when deleting.
     * Called by the base class during delete().
     */
    protected async onDelete(): Promise<void> {
        console.log(`Deleting task: ${this.name}`);
        // Could clean up temporary files, release resources, etc.
    }

    /**
     * Helper method to create a delay.
     *
     * @param ms Delay in milliseconds.
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
            this.status.state === TaskState.Completed ||
            this.status.state === TaskState.Failed ||
            this.status.state === TaskState.Stopped
        ) {
            return; // Already finished or stopped
        }

        if (this.status.state === TaskState.Stopping) {
            return; // Already stopping
        }

        // Signal the task to stop
        this.updateStatus(TaskState.Stopping, this.status.progress, 'Stop requested...');
        this.abortController.abort();

        // Return immediately after signaling - actual stopping happens in executeTask
        return Promise.resolve();
    }

    /**
     * Performs cleanup for the task.
     *
     * @returns A Promise that resolves when cleanup is complete.
     */
    public async delete(): Promise<void> {
        // Stop the task first if it's still running
        if (this.status.state === TaskState.Running || this.status.state === TaskState.Initializing) {
            await this.stop();
        }

        // Clean up any remaining timeouts
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }

        // Reset abort controller
        this.abortController = new AbortController();
    }

    /**
     * Executes the main task logic with progress updates.
     * This method runs asynchronously and is responsible for updating the task state.
     *
     * @returns A Promise that resolves when task execution is complete.
     */
    private async executeTask(): Promise<void> {
        const totalDuration = 10000; // 10 seconds
        const updateInterval = 500; // Update every 500ms
        const totalSteps = totalDuration / updateInterval;
        let currentStep = 0;

        const executeStep = (): void => {
            // Check if abort was requested
            if (this.abortController.signal.aborted) {
                // Handle the abort and update state to Stopped
                if (this.timeoutId) {
                    clearTimeout(this.timeoutId);
                    this.timeoutId = undefined;
                }

                // Only update to Stopped if we're in Stopping state
                // This handles the case where stop() was called
                if (this.status.state === TaskState.Stopping) {
                    this.updateStatus(TaskState.Stopped, this.status.progress, 'Task stopped by user request');
                }
                return;
            }

            currentStep++;
            const progress = Math.round((currentStep / totalSteps) * 100);
            const message = `Processing step ${currentStep} of ${totalSteps}...`;

            this.updateStatus(TaskState.Running, progress, message);

            if (currentStep >= totalSteps) {
                this.updateStatus(TaskState.Completed, 100, 'Task completed successfully');
                return;
            }

            // Schedule next step
            this.timeoutId = setTimeout(executeStep, updateInterval);
        };

        // Start the execution loop
        executeStep();
    }

    /**
     * Updates the task status and progress.
     *
     * @param state The new task state.
     * @param progress Optional progress value (0-100).
     * @param message Optional status message.
     * @param error Optional error object.
     */
    private updateStatus(state: TaskState, progress?: number, message?: string, error?: unknown): void {
        this.status = {
            state,
            progress,
            message,
            error,
        };
    }

    /**
     * Helper method to create a delay using Promise.
     *
     * @param ms Delay in milliseconds.
     * @returns A Promise that resolves after the specified delay.
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }
}
