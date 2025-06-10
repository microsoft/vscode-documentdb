/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Task, TaskExecutionOptions, TaskProgress, TaskResult, TaskState } from '../services/taskService';

/**
 * A dummy task that simulates work using timeouts for demonstration purposes.
 * Total execution time is 10 seconds with progress reporting.
 */
export class DummyTask implements Task<string> {
    public readonly id = 'dummy-task';
    public readonly name = 'Dummy Task';

    private _state: TaskState = TaskState.NotStarted;
    private _progress = 0;

    public get state(): TaskState {
        return this._state;
    }

    public get progress(): number {
        return this._progress;
    }

    public async execute(options?: TaskExecutionOptions): Promise<TaskResult<string>> {
        if (this._state === TaskState.Running) {
            throw new Error('Task is already running');
        }

        this._setState(TaskState.Running, options);
        this._progress = 0;
        this._reportProgress(0, 'Starting dummy task...', options);

        try {
            // Simulate work with 10 steps, each taking 1 second
            const totalSteps = 10;
            const stepDuration = 1000; // 1 second per step

            for (let step = 0; step < totalSteps; step++) {
                // Check for abort signal before each step
                if (options?.abortSignal?.aborted) {
                    this._setState(TaskState.Aborted, options);
                    return {
                        success: false,
                        error: new Error('Task was aborted'),
                        finalState: TaskState.Aborted,
                    };
                }

                try {
                    // Wait for the step duration
                    await this._delay(stepDuration, options?.abortSignal);
                } catch (error) {
                    // If delay was aborted, task was aborted
                    this._setState(TaskState.Aborted, options);
                    return {
                        success: false,
                        error: error instanceof Error ? error : new Error('Task was aborted'),
                        finalState: TaskState.Aborted,
                    };
                }

                // Update progress after completing the step
                const currentProgress = ((step + 1) / totalSteps) * 100;
                this._progress = currentProgress;
                this._reportProgress(
                    currentProgress,
                    `Dummy task step ${step + 1} of ${totalSteps} completed`,
                    options,
                );
            }

            // Task completed successfully
            this._setState(TaskState.Completed, options);
            this._reportProgress(100, 'Dummy task completed successfully!', options);

            return {
                success: true,
                data: 'Dummy task completed successfully!',
                finalState: TaskState.Completed,
            };
        } catch (error) {
            this._setState(TaskState.Failed, options);
            return {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
                finalState: TaskState.Failed,
            };
        }
    }

    private _setState(state: TaskState, options?: TaskExecutionOptions): void {
        this._state = state;
        options?.onStateChange?.(state);
    }

    private _reportProgress(percentage: number, message: string, options?: TaskExecutionOptions): void {
        const progress: TaskProgress = {
            percentage,
            message,
            increment: percentage - this._progress,
        };
        options?.onProgress?.(progress);
    }

    private async _delay(ms: number, abortSignal?: AbortSignal): Promise<void> {
        if (abortSignal?.aborted) {
            throw new Error('Task was aborted');
        }

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (abortSignal?.aborted) {
                    reject(new Error('Task was aborted'));
                } else {
                    resolve();
                }
            }, ms);

            // Handle abort signal during timeout
            const abortHandler = () => {
                clearTimeout(timeout);
                reject(new Error('Task was aborted'));
            };

            if (abortSignal) {
                abortSignal.addEventListener('abort', abortHandler, { once: true });
            }
        });
    }
}