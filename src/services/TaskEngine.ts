/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Status of a task in the Task Engine
 */
export enum TaskStatus {
    Pending = 'pending',
    Initializing = 'initializing',
    Running = 'running',
    Completed = 'completed',
    Failed = 'failed',
}

/**
 * Base interface for all tasks managed by the Task Engine
 */
export interface Task {
    /**
     * Unique identifier for the task
     */
    readonly id: string;

    /**
     * Current status of the task
     */
    readonly status: TaskStatus;

    /**
     * Optional error information if the task failed
     */
    readonly error?: Error;

    /**
     * Progress information (0-100)
     */
    readonly progress: number;

    /**
     * Optional message describing current operation
     */
    readonly progressMessage?: string;

    /**
     * Execute the task
     */
    execute(): Promise<void>;

    /**
     * Cancel the task (if possible)
     */
    cancel(): Promise<void>;
}

/**
 * Base abstract class for implementing tasks
 */
export abstract class TaskBase implements Task {
    private _status: TaskStatus = TaskStatus.Pending;
    private _error?: Error;
    private _progress: number = 0;
    private _progressMessage?: string;
    private _cancelled: boolean = false;

    constructor(public readonly id: string) {}

    public get status(): TaskStatus {
        return this._status;
    }

    public get error(): Error | undefined {
        return this._error;
    }

    public get progress(): number {
        return this._progress;
    }

    public get progressMessage(): string | undefined {
        return this._progressMessage;
    }

    public get cancelled(): boolean {
        return this._cancelled;
    }

    /**
     * Execute the task. This method handles status transitions and error handling.
     */
    public async execute(): Promise<void> {
        if (this._status !== TaskStatus.Pending) {
            throw new Error(`Task ${this.id} cannot be executed in status ${this._status}`);
        }

        try {
            this.setStatus(TaskStatus.Initializing);
            await this.initialize();

            if (this._cancelled) {
                this.setStatus(TaskStatus.Failed);
                this.setError(new Error('Task was cancelled'));
                return;
            }

            this.setStatus(TaskStatus.Running);
            await this.run();

            if (this._cancelled) {
                this.setStatus(TaskStatus.Failed);
                this.setError(new Error('Task was cancelled'));
                return;
            }

            this.setStatus(TaskStatus.Completed);
            this.setProgress(100, 'Completed');
        } catch (error) {
            this.setStatus(TaskStatus.Failed);
            this.setError(error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }

    /**
     * Cancel the task
     */
    public async cancel(): Promise<void> {
        this._cancelled = true;
        try {
            await this.onCancel();
        } catch (error) {
            // Log cancellation errors but don't throw
            console.error(`Error during task cancellation: ${error}`);
        }
    }

    /**
     * Initialize the task (counting, validation, etc.)
     */
    protected abstract initialize(): Promise<void>;

    /**
     * Run the main task logic
     */
    protected abstract run(): Promise<void>;

    /**
     * Handle task cancellation
     */
    protected async onCancel(): Promise<void> {
        // Override in subclasses if needed
    }

    /**
     * Update task status
     */
    protected setStatus(status: TaskStatus): void {
        this._status = status;
    }

    /**
     * Update task progress
     */
    protected setProgress(progress: number, message?: string): void {
        this._progress = Math.max(0, Math.min(100, progress));
        this._progressMessage = message;
    }

    /**
     * Set task error
     */
    protected setError(error: Error): void {
        this._error = error;
    }

    /**
     * Check if task should abort due to cancellation
     */
    protected checkCancellation(): void {
        if (this._cancelled) {
            throw new Error('Task was cancelled');
        }
    }
}