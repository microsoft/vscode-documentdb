/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PausableTask, TaskExecutionOptions, TaskProgress, TaskResult, TaskState } from '../services/taskService';

/**
 * A pausable task that simulates work with the ability to pause and resume execution.
 * Similar to DummyTask but with pause/resume capabilities.
 */
export class PausableTaskImpl implements PausableTask<string> {
    public readonly id = 'pausable-task';
    public readonly name = 'Pausable Task';

    private _state: TaskState = TaskState.NotStarted;
    private _progress = 0;
    private _currentStep = 0;
    private _isPauseRequested = false;
    private _pauseResolve?: () => void;

    public get state(): TaskState {
        return this._state;
    }

    public get progress(): number {
        return this._progress;
    }

    public get canPause(): boolean {
        return this._state === TaskState.Running;
    }

    public get canResume(): boolean {
        return this._state === TaskState.Paused;
    }

    public pause(): void {
        if (this.canPause) {
            this._isPauseRequested = true;
        }
    }

    public resume(): void {
        if (this.canResume && this._pauseResolve) {
            this._setState(TaskState.Running);
            this._pauseResolve();
            this._pauseResolve = undefined;
        }
    }

    public async execute(options?: TaskExecutionOptions): Promise<TaskResult<string>> {
        if (this._state === TaskState.Running) {
            throw new Error('Task is already running');
        }

        // Reset state if starting fresh
        if (this._state !== TaskState.Paused) {
            this._currentStep = 0;
            this._progress = 0;
        }

        this._setState(TaskState.Running, options);
        this._isPauseRequested = false;

        try {
            // Simulate work with 10 steps, each taking 1 second
            const totalSteps = 10;
            const stepDuration = 1000; // 1 second per step

            // Continue from where we left off if resuming
            for (let step = this._currentStep; step < totalSteps; step++) {
                // Check for abort signal
                if (options?.abortSignal?.aborted) {
                    this._setState(TaskState.Aborted, options);
                    return {
                        success: false,
                        error: new Error('Task was aborted'),
                        finalState: TaskState.Aborted,
                    };
                }

                // Check for pause request
                if (this._isPauseRequested) {
                    this._setState(TaskState.Paused, options);
                    this._reportProgress(
                        this._progress,
                        `Pausable task paused at step ${step + 1} of ${totalSteps}`,
                        options,
                    );

                    // Wait for resume
                    await new Promise<void>((resolve) => {
                        this._pauseResolve = resolve;
                    });

                    this._isPauseRequested = false;

                    // Check abort signal again after resume
                    if (options?.abortSignal?.aborted) {
                        this._setState(TaskState.Aborted, options);
                        return {
                            success: false,
                            error: new Error('Task was aborted'),
                            finalState: TaskState.Aborted,
                        };
                    }
                }

                // Wait for the step duration
                await this._delay(stepDuration, options?.abortSignal);

                // Check again after delay in case abort was signaled during delay
                if (options?.abortSignal?.aborted) {
                    this._setState(TaskState.Aborted, options);
                    return {
                        success: false,
                        error: new Error('Task was aborted'),
                        finalState: TaskState.Aborted,
                    };
                }

                // Update progress and current step
                this._currentStep = step + 1;
                const currentProgress = (this._currentStep / totalSteps) * 100;
                this._progress = currentProgress;
                this._reportProgress(
                    currentProgress,
                    `Pausable task step ${this._currentStep} of ${totalSteps} completed`,
                    options,
                );
            }

            // Task completed successfully
            this._setState(TaskState.Completed, options);
            this._reportProgress(100, 'Pausable task completed successfully!', options);

            return {
                success: true,
                data: 'Pausable task completed successfully!',
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
        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                resolve();
            }, ms);

            // Handle abort signal
            if (abortSignal) {
                const abortHandler = () => {
                    clearTimeout(timeout);
                    reject(new Error('Operation was aborted'));
                };

                if (abortSignal.aborted) {
                    clearTimeout(timeout);
                    reject(new Error('Operation was aborted'));
                    return;
                }

                abortSignal.addEventListener('abort', abortHandler, { once: true });

                // Clean up the abort listener when the timeout completes
                setTimeout(() => {
                    abortSignal.removeEventListener('abort', abortHandler);
                }, ms);
            }
        });
    }
}