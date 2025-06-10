/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the current state of a task execution.
 */
export enum TaskState {
    NotStarted = 'not-started',
    Running = 'running',
    Paused = 'paused',
    Completed = 'completed',
    Aborted = 'aborted',
    Failed = 'failed',
}

/**
 * Progress information for a task.
 */
export interface TaskProgress {
    /**
     * Progress as a percentage (0-100).
     */
    readonly percentage: number;

    /**
     * Optional message describing the current step.
     */
    readonly message?: string;

    /**
     * Optional increment value for progress reporting.
     */
    readonly increment?: number;
}

/**
 * Result of a task execution.
 */
export interface TaskResult<T = unknown> {
    /**
     * Whether the task completed successfully.
     */
    readonly success: boolean;

    /**
     * The result data if successful.
     */
    readonly data?: T;

    /**
     * Error information if failed.
     */
    readonly error?: Error;

    /**
     * Final state of the task.
     */
    readonly finalState: TaskState;
}

/**
 * Options for task execution.
 */
export interface TaskExecutionOptions {
    /**
     * AbortController signal to cancel the task.
     */
    readonly abortSignal?: AbortSignal;

    /**
     * Progress reporting callback.
     */
    readonly onProgress?: (progress: TaskProgress) => void;

    /**
     * State change callback.
     */
    readonly onStateChange?: (state: TaskState) => void;
}

/**
 * Base interface for all tasks.
 */
export interface Task<T = unknown> {
    /**
     * Unique identifier for the task.
     */
    readonly id: string;

    /**
     * Human-readable name for the task.
     */
    readonly name: string;

    /**
     * Current state of the task.
     */
    readonly state: TaskState;

    /**
     * Current progress (0-100).
     */
    readonly progress: number;

    /**
     * Execute the task with the given options.
     */
    execute(options?: TaskExecutionOptions): Promise<TaskResult<T>>;
}

/**
 * Interface for pausable tasks.
 */
export interface PausableTask<T = unknown> extends Task<T> {
    /**
     * Whether the task can be paused in its current state.
     */
    readonly canPause: boolean;

    /**
     * Whether the task can be resumed in its current state.
     */
    readonly canResume: boolean;

    /**
     * Pause the task execution.
     */
    pause(): void;

    /**
     * Resume the task execution.
     */
    resume(): void;
}

/**
 * Task service for managing task execution.
 */
export class TaskService {
    private readonly _tasks = new Map<string, Task>();

    /**
     * Register a task with the service.
     */
    public registerTask(task: Task): void {
        this._tasks.set(task.id, task);
    }

    /**
     * Unregister a task from the service.
     */
    public unregisterTask(taskId: string): void {
        this._tasks.delete(taskId);
    }

    /**
     * Get a task by its ID.
     */
    public getTask(taskId: string): Task | undefined {
        return this._tasks.get(taskId);
    }

    /**
     * Get all registered tasks.
     */
    public getAllTasks(): Task[] {
        return Array.from(this._tasks.values());
    }

    /**
     * Execute a task by its ID.
     */
    public async executeTask<T>(taskId: string, options?: TaskExecutionOptions): Promise<TaskResult<T> | undefined> {
        const task = this._tasks.get(taskId);
        if (!task) {
            return undefined;
        }

        return (await task.execute(options)) as TaskResult<T>;
    }
}

/**
 * Singleton instance of the task service.
 */
export const taskService = new TaskService();