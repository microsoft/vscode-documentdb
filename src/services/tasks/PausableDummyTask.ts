/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TaskState, type PausableTask, type TaskStatus } from '../taskService';

/**
 * A pausable task implementation that extends the dummy task concept with pause/resume functionality.
 * 
 * This task runs for 10 seconds with 1-second progress intervals and demonstrates:
 * - Basic task state transitions
 * - Progress reporting
 * - Abort signal handling
 * - Pause and resume functionality
 * - State preservation across pause/resume cycles
 */
export class PausableDummyTask implements PausableTask {
    private static _instanceCounter = 0;

    public readonly id: string;
    public readonly type: string = 'pausable-dummy-task';
    public readonly name: string;

    private _status: TaskStatus;
    private _abortController: AbortController | undefined;
    private _progressInterval: NodeJS.Timeout | undefined;
    private _startTime: number | undefined;
    private _pausedTime: number = 0; // Total time spent paused
    private _pauseStartTime: number | undefined;

    constructor(name?: string) {
        PausableDummyTask._instanceCounter++;
        this.id = `pausable-dummy-task-${PausableDummyTask._instanceCounter}`;
        this.name = name ?? `Pausable Dummy Task ${PausableDummyTask._instanceCounter}`;
        
        this._status = {
            state: TaskState.Pending,
            progress: 0,
            message: 'Pausable task created and ready to start'
        };
    }

    public getStatus(): TaskStatus {
        return { ...this._status };
    }

    public canPause(): boolean {
        return this._status.state === TaskState.Running;
    }

    public async start(): Promise<void> {
        if (this._status.state !== TaskState.Pending) {
            throw new Error(`Cannot start task in state: ${this._status.state}`);
        }

        this._abortController = new AbortController();

        this._status = {
            state: TaskState.Initializing,
            progress: 0,
            message: 'Initializing pausable task...'
        };

        // Brief initialization delay to simulate setup
        await this._delay(100);

        if (this._abortController?.signal.aborted) {
            await this._handleAbort();
            return;
        }

        this._status = {
            state: TaskState.Running,
            progress: 0,
            message: 'Pausable task execution started'
        };

        this._startTime = Date.now();
        
        this._startProgressLoop();
    }

    public async stop(): Promise<void> {
        if (this._status.state === TaskState.Completed || 
            this._status.state === TaskState.Failed ||
            this._status.state === TaskState.Stopped) {
            return; // Already in terminal state
        }

        this._status = {
            ...this._status,
            state: TaskState.Stopping,
            message: 'Stopping pausable task...'
        };

        this._abortController?.abort();
        await this._cleanup();

        this._status = {
            state: TaskState.Stopped,
            progress: this._status.progress,
            message: 'Pausable task was stopped'
        };
    }

    public async pause(): Promise<void> {
        if (this._status.state !== TaskState.Running) {
            throw new Error(`Cannot pause task in state: ${this._status.state}`);
        }

        this._status = {
            ...this._status,
            state: TaskState.Pausing,
            message: 'Pausing task...'
        };

        await this._delay(50); // Brief delay to simulate pause processing

        this._pauseStartTime = Date.now();
        
        if (this._progressInterval) {
            clearInterval(this._progressInterval);
            this._progressInterval = undefined;
        }

        this._status = {
            ...this._status,
            state: TaskState.Paused,
            message: `Task paused at ${this._status.progress}% progress`
        };
    }

    public async resume(): Promise<void> {
        if (this._status.state !== TaskState.Paused) {
            throw new Error(`Cannot resume task in state: ${this._status.state}`);
        }

        this._status = {
            ...this._status,
            state: TaskState.Resuming,
            message: 'Resuming task...'
        };

        await this._delay(50); // Brief delay to simulate resume processing

        // Update paused time tracking
        if (this._pauseStartTime) {
            this._pausedTime += Date.now() - this._pauseStartTime;
            this._pauseStartTime = undefined;
        }

        this._status = {
            ...this._status,
            state: TaskState.Running,
            message: `Task resumed from ${this._status.progress}% progress`
        };

        this._startProgressLoop();
    }

    public async delete(): Promise<void> {
        await this.stop();
        await this._cleanup();
    }

    private _startProgressLoop(): void {
        this._progressInterval = setInterval(() => {
            if (this._abortController?.signal.aborted) {
                void this._handleAbort();
                return;
            }

            // Calculate elapsed time excluding paused time
            const totalElapsed = Date.now() - (this._startTime ?? Date.now());
            const currentPausedTime = this._pauseStartTime ? 
                this._pausedTime + (Date.now() - this._pauseStartTime) : 
                this._pausedTime;
            const activeElapsed = totalElapsed - currentPausedTime;
            
            const progress = Math.min(100, Math.floor((activeElapsed / 10000) * 100)); // 10 seconds = 100%

            this._status = {
                state: TaskState.Running,
                progress,
                message: `Processing... ${progress}% complete`
            };

            if (progress >= 100) {
                this._status = {
                    state: TaskState.Completed,
                    progress: 100,
                    message: 'Pausable task completed successfully'
                };
                void this._cleanup();
            }
        }, 1000); // Update every second
    }

    private async _handleAbort(): Promise<void> {
        await this._cleanup();
        this._status = {
            state: TaskState.Stopped,
            progress: this._status.progress ?? 0,
            message: 'Pausable task was aborted'
        };
    }

    private async _cleanup(): Promise<void> {
        if (this._progressInterval) {
            clearInterval(this._progressInterval);
            this._progressInterval = undefined;
        }
        this._abortController = undefined;
        this._pauseStartTime = undefined;
    }

    private async _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}