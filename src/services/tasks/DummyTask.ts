/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Task, TaskState, TaskStatus } from '../taskService';

/**
 * A dummy task implementation that demonstrates the basic Task interface.
 * This task simulates work by using timeouts and provides progress updates over a 10-second duration.
 * It properly handles abort signals and can be used as a reference for implementing other tasks.
 */
export class DummyTask implements Task {
    public readonly id: string;
    public readonly type: string = 'dummy-task';
    public readonly name: string;

    private status: TaskStatus;
    private abortController: AbortController;
    private timeoutId: NodeJS.Timeout | undefined;

    /**
     * Creates a new DummyTask instance.
     *
     * @param id Unique identifier for the task.
     * @param name User-friendly name for the task.
     */
    constructor(id: string, name: string) {
        this.id = id;
        this.name = name;
        this.status = {
            state: TaskState.Pending,
            progress: 0,
            message: 'Task created and ready to start',
        };
        this.abortController = new AbortController();
    }

    /**
     * Gets the current status of the task.
     *
     * @returns The current TaskStatus.
     */
    public getStatus(): TaskStatus {
        return { ...this.status };
    }

    /**
     * Starts the task execution.
     * This method only initiates the task and returns immediately.
     * It does NOT wait for the task to complete.
     *
     * @returns A Promise that resolves when the task has been started (not when it completes).
     */
    public async start(): Promise<void> {
        if (this.status.state !== TaskState.Pending) {
            throw new Error(`Cannot start task in state: ${this.status.state}`);
        }

        this.updateStatus(TaskState.Initializing, 0, 'Initializing task...');

        // Simulate initialization delay
        await this.sleep(100);

        if (this.abortController.signal.aborted) {
            this.updateStatus(TaskState.Stopped, 0, 'Task was aborted during initialization');
            return;
        }

        this.updateStatus(TaskState.Running, 0, 'Starting task execution...');

        // Start the task execution asynchronously without awaiting it
        void this.executeTask().catch((error) => {
            this.updateStatus(
                TaskState.Failed,
                this.status.progress,
                `Task failed: ${error instanceof Error ? error.message : String(error)}`,
                error,
            );
        });

        // Return immediately after starting the task
        return Promise.resolve();
    }

    /**
     * Requests a graceful stop of the task.
     * This method only signals the task to stop and returns after acknowledging the request.
     * The task's execution logic is responsible for detecting this signal and updating the state.
     *
     * @returns A Promise that resolves when the stop request has been acknowledged.
     */
    public async stop(): Promise<void> {
        if (
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
