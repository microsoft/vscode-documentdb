/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PausableTask, TaskState, TaskStatus } from '../taskService';

/**
 * A pausable task implementation that demonstrates the PausableTask interface.
 * This task simulates work by using timeouts and provides progress updates over a 10-second duration.
 * It supports pausing and resuming operations while maintaining state between pauses.
 */
export class DummyPausableTask implements PausableTask {
    public readonly id: string;
    public readonly type: string = 'pausable-task';
    public readonly name: string;

    private status: TaskStatus;
    private abortController: AbortController; // For stopping
    private timeoutId: NodeJS.Timeout | undefined;
    private currentStep: number = 0;
    private readonly totalSteps: number = 20; // 10 seconds / 500ms = 20 steps
    private readonly updateInterval: number = 500; // Update every 500ms

    /**
     * Flag that signals when a pause is requested.
     *
     * This boolean flag is used instead of another AbortController because:
     * 1. Pause/resume is conceptually different from stopping - it's a temporary suspension,
     *    not a termination
     * 2. It's more intuitive to toggle a boolean flag for a pause/resume cycle than to
     *    create a new AbortController each time we resume
     * 3. The flag can be easily reset without creating new objects
     */
    private pauseRequested: boolean = false;

    /**
     * Function that resolves the pause Promise when resume is called.
     *
     * When the task is paused, it awaits a Promise that will only resolve
     * when resume() is called. This function reference is stored so that
     * the resume() method can trigger the resolution.
     */
    private resumeResolver: (() => void) | null = null;

    /**
     * Creates a new PausableTask instance.
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
            message: 'Pausable task created and ready to start',
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

        this.updateStatus(TaskState.Initializing, 0, 'Initializing pausable task...');

        // Simulate initialization delay
        await this.sleep(100);

        if (this.abortController.signal.aborted) {
            this.updateStatus(TaskState.Stopped, 0, 'Task was aborted during initialization');
            return;
        }

        this.updateStatus(TaskState.Running, 0, 'Starting pausable task execution...');

        // Start the task execution asynchronously without awaiting it
        void this.executeTaskAsync().catch((error) => {
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

        // Clear any pending timeout
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }

        // Return immediately after signaling - actual stopping happens in executeNextStep
        return Promise.resolve();
    }

    /**
     * Temporarily suspends the task execution while preserving its state.
     * This method only signals the task to pause and returns after acknowledging the request.
     * The task's execution logic is responsible for detecting this signal and updating
     * the state to TaskState.Paused when the pause is complete.
     *
     * @returns A Promise that resolves when the pause request has been acknowledged.
     */
    public async pause(): Promise<void> {
        if (this.status.state !== TaskState.Running) {
            throw new Error(`Cannot pause task in state: ${this.status.state}`);
        }

        // Signal that a pause is requested by setting the flag.
        // The executeTaskAsync method periodically checks this flag and will
        // transition to the paused state when it detects the flag is set.
        this.pauseRequested = true;

        // Update status to indicate pausing in progress
        this.updateStatus(TaskState.Pausing, this.status.progress, 'Pause requested...');

        // Clear any pending timeout to prevent new steps while pausing
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }

        // Return immediately after signaling - actual pausing happens in executeTaskAsync
        return Promise.resolve();
    }

    /**
     * Resumes task execution from the point it was paused.
     * This method signals the task to resume and returns after acknowledging the request.
     *
     * @returns A Promise that resolves when the resume request has been acknowledged.
     */
    public async resume(): Promise<void> {
        if (this.status.state !== TaskState.Paused) {
            throw new Error(`Cannot resume task in state: ${this.status.state}`);
        }

        // Update status to indicate resuming in progress
        this.updateStatus(TaskState.Resuming, this.status.progress, 'Resume requested...');

        // Signal the execution to continue by calling the resolver function.
        // This resolves the Promise that executeTaskAsync is awaiting while paused.
        if (this.resumeResolver) {
            const resolver = this.resumeResolver;
            this.resumeResolver = null;
            resolver();
        }

        // Return immediately after signaling - actual resuming happens in the task execution
        return Promise.resolve();
    }

    /**
     * Indicates whether the task supports pause and resume operations.
     *
     * @returns True since this task always supports pause and resume.
     */
    public canPause(): boolean {
        return true;
    }

    /**
     * Performs cleanup for the task.
     *
     * @returns A Promise that resolves when cleanup is complete.
     */
    public async delete(): Promise<void> {
        // Stop the task first if it's still running
        if (
            this.status.state === TaskState.Running ||
            this.status.state === TaskState.Initializing ||
            this.status.state === TaskState.Paused
        ) {
            await this.stop();
        }

        // Clean up any remaining timeouts
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = undefined;
        }

        // Reset state
        this.currentStep = 0;
        this.abortController = new AbortController();
    }

    /**
     * Asynchronous wrapper for the task execution.
     * This method orchestrates the entire task execution from start to finish.
     */
    private async executeTaskAsync(): Promise<void> {
        try {
            while (this.currentStep < this.totalSteps) {
                // Check if abort was requested
                if (this.abortController.signal.aborted) {
                    // Only update to Stopped if we're in Stopping state
                    if (this.status.state === TaskState.Stopping) {
                        this.updateStatus(TaskState.Stopped, this.status.progress, 'Task stopped by user request');
                    }
                    return;
                }

                // Check if pause was requested
                if (this.pauseRequested && this.status.state === TaskState.Pausing) {
                    // At this point, the task has detected the pause request and will
                    // transition to the Paused state. This happens asynchronously after
                    // the pause() method has already returned to the caller.

                    // Update state to fully paused
                    this.updateStatus(
                        TaskState.Paused,
                        this.status.progress,
                        `Task paused at step ${this.currentStep} of ${this.totalSteps}`,
                    );

                    // Reset the pause request flag for the next potential pause
                    this.pauseRequested = false;

                    // Create a promise that will resolve when resume() is called.
                    // This effectively suspends the task execution until resume() is called.
                    await new Promise<void>((resolve) => {
                        this.resumeResolver = resolve;
                    });

                    // When we get here, resume() has been called and the resumeResolver
                    // function has been invoked. The state was already set to Resuming
                    // in the resume() method.

                    // Update status back to running
                    this.updateStatus(
                        TaskState.Running,
                        this.status.progress,
                        `Task resumed from step ${this.currentStep} of ${this.totalSteps}`,
                    );
                }

                // Execute the current step
                this.currentStep++;
                const progress = Math.round((this.currentStep / this.totalSteps) * 100);
                const message = `Processing step ${this.currentStep} of ${this.totalSteps}...`;

                this.updateStatus(TaskState.Running, progress, message);

                if (this.currentStep >= this.totalSteps) {
                    this.updateStatus(TaskState.Completed, 100, 'Pausable task completed successfully');
                    return;
                }

                // Wait for the update interval before processing next step
                await this.sleep(this.updateInterval);
            }
        } catch (error) {
            // Handle any unexpected errors
            this.updateStatus(
                TaskState.Failed,
                this.status.progress,
                `Task failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
                error,
            );
        }
    }

    /**
     * Executes the next step in the task progression.
     * This method is no longer used, as we've switched to a more direct async implementation
     * to better handle pause/resume logic.
     */
    private executeNextStep(): void {
        // Implementation left for compatibility but not used
        // The executeTaskAsync method now handles the execution flow
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
