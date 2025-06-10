/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Task, type TaskExecutionOptions, type TaskProgress, type TaskResult, TaskState } from '../services/taskService';

/**
 * A dummy task that simulates work using timeouts for demonstration purposes.
 * Total execution time is configurable with progress reporting.
 */
export class DummyTask implements Task<string> {
    public readonly id = 'dummy-task';
    public readonly name = 'Dummy Task';

    private _state: TaskState = TaskState.NotStarted;
    private _progress = 0;
    private readonly _stepDuration: number;
    private readonly _totalSteps: number;

    constructor(stepDuration: number = 10, totalSteps: number = 10) {
        this._stepDuration = stepDuration; // Default 10ms for testing
        this._totalSteps = totalSteps;
    }

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
            for (let step = 0; step < this._totalSteps; step++) {
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
                    await this._delay(this._stepDuration, options?.abortSignal);
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
                const currentProgress = ((step + 1) / this._totalSteps) * 100;
                this._reportProgress(
                    currentProgress,
                    `Dummy task step ${step + 1} of ${this._totalSteps} completed`,
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
        const increment = percentage - this._progress;
        const progress: TaskProgress = {
            percentage,
            message,
            increment,
        };
        this._progress = percentage; // Update _progress after calculating increment
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