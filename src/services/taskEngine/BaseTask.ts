/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Task, TaskStatus, type TaskProgress } from './Task';

/**
 * Base implementation of the Task interface providing common functionality
 */
export abstract class BaseTask implements Task {
    private _status: TaskStatus = TaskStatus.Pending;
    private _progress: TaskProgress = { percentage: 0 };
    private _error?: Error;
    private readonly _progressCallbacks: Array<(progress: TaskProgress) => void> = [];
    private readonly _statusCallbacks: Array<(status: TaskStatus) => void> = [];

    constructor(public readonly id: string) {}

    public get status(): TaskStatus {
        return this._status;
    }

    public get progress(): TaskProgress {
        return this._progress;
    }

    public get error(): Error | undefined {
        return this._error;
    }

    public abstract execute(): Promise<void>;

    public abstract cancel(): void;

    public onProgress(callback: (progress: TaskProgress) => void): { dispose(): void } {
        this._progressCallbacks.push(callback);
        return {
            dispose: () => {
                const index = this._progressCallbacks.indexOf(callback);
                if (index !== -1) {
                    this._progressCallbacks.splice(index, 1);
                }
            },
        };
    }

    public onStatusChange(callback: (status: TaskStatus) => void): { dispose(): void } {
        this._statusCallbacks.push(callback);
        return {
            dispose: () => {
                const index = this._statusCallbacks.indexOf(callback);
                if (index !== -1) {
                    this._statusCallbacks.splice(index, 1);
                }
            },
        };
    }

    protected updateStatus(status: TaskStatus): void {
        if (this._status !== status) {
            this._status = status;
            this._statusCallbacks.forEach((callback) => callback(status));
        }
    }

    protected updateProgress(progress: TaskProgress): void {
        this._progress = { ...progress };
        this._progressCallbacks.forEach((callback) => callback(this._progress));
    }

    protected setError(error: Error): void {
        this._error = error;
        this.updateStatus(TaskStatus.Failed);
    }
}