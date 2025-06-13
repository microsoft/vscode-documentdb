/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Possible states for a task
 */
export enum TaskStatus {
    Pending = 'pending',
    Initializing = 'initializing',
    Running = 'running',
    Completed = 'completed',
    Failed = 'failed',
}

/**
 * Progress information for a task
 */
export interface TaskProgress {
    /**
     * Number of completed units of work
     */
    completed: number;

    /**
     * Total number of units of work (-1 if unknown)
     */
    total: number;

    /**
     * Optional progress message
     */
    message?: string;
}

/**
 * Base interface for all tasks managed by the Task Engine
 */
export interface Task {
    /**
     * Unique identifier for this task
     */
    readonly id: string;

    /**
     * Human-readable description of the task
     */
    readonly description: string;

    /**
     * Current status of the task
     */
    readonly status: TaskStatus;

    /**
     * Current progress of the task (undefined if not available)
     */
    readonly progress?: TaskProgress;

    /**
     * Error information if the task failed
     */
    readonly error?: Error;

    /**
     * Execute the task
     * @returns Promise that resolves when the task is complete
     */
    execute(): Promise<void>;

    /**
     * Cancel the task if it's running
     * @returns Promise that resolves when the task is cancelled
     */
    cancel(): Promise<void>;

    /**
     * Subscribe to task status changes
     * @param callback Function to call when status changes
     * @returns Function to unsubscribe
     */
    onStatusChange(callback: (task: Task) => void): () => void;

    /**
     * Subscribe to task progress updates
     * @param callback Function to call when progress updates
     * @returns Function to unsubscribe
     */
    onProgressChange(callback: (task: Task) => void): () => void;
}