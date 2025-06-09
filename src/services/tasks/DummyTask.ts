/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TaskState, type Task, type TaskStatus } from '../taskService';

/**
 * A dummy task implementation that demonstrates basic task interface usage.
 * 
 * This task runs for 10 seconds with 1-second progress intervals and demonstrates:
 * - Basic task state transitions
 * - Progress reporting
 * - Abort signal handling
 */
export class DummyTask implements Task {
    private static _instanceCounter = 0;

    public readonly id: string;
    public readonly type: string = 'dummy-task';
    public readonly name: string;

    private _status: TaskStatus;
    private _abortController: AbortController | undefined;
    private _progressInterval: NodeJS.Timeout | undefined;
    private _startTime: number | undefined;

    constructor(name?: string) {
        DummyTask._instanceCounter++;
        this.id = `dummy-task-${DummyTask._instanceCounter}`;
        this.name = name ?? `Dummy Task ${DummyTask._instanceCounter}`;
        
        this._status = {
            state: TaskState.Pending,
            progress: 0,
            message: 'Task created and ready to start'
        };
    }

    public getStatus(): TaskStatus {
        return { ...this._status };
    }

    public async start(): Promise<void> {
        if (this._status.state !== TaskState.Pending) {
            throw new Error(`Cannot start task in state: ${this._status.state}`);
        }

        this._abortController = new AbortController();

        this._status = {
            state: TaskState.Initializing,
            progress: 0,
            message: 'Initializing task...'
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
            message: 'Task execution started'
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
            message: 'Stopping task...'
        };

        if (this._abortController) {
            this._abortController.abort();
        }
        await this._cleanup();

        this._status = {
            state: TaskState.Stopped,
            progress: this._status.progress,
            message: 'Task was stopped'
        };
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

            const elapsed = Date.now() - (this._startTime ?? Date.now());
            const progress = Math.min(100, Math.floor((elapsed / 10000) * 100)); // 10 seconds = 100%

            this._status = {
                state: TaskState.Running,
                progress,
                message: `Processing... ${progress}% complete`
            };

            if (progress >= 100) {
                this._status = {
                    state: TaskState.Completed,
                    progress: 100,
                    message: 'Task completed successfully'
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
            message: 'Task was aborted'
        };
    }

    private async _cleanup(): Promise<void> {
        if (this._progressInterval) {
            clearInterval(this._progressInterval);
            this._progressInterval = undefined;
        }
        this._abortController = undefined;
    }

    private async _delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}