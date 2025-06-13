/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the status of a task
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
    /** Current progress value (0-100) */
    percentage: number;
    /** Optional message describing current operation */
    message?: string;
    /** Number of items processed */
    processedCount?: number;
    /** Total number of items to process */
    totalCount?: number;
}

/**
 * Core Task interface that all tasks must implement
 */
export interface Task {
    /** Unique identifier for the task */
    readonly id: string;
    /** Current status of the task */
    readonly status: TaskStatus;
    /** Current progress information */
    readonly progress: TaskProgress;
    /** Error information if the task failed */
    readonly error?: Error;

    /**
     * Execute the task
     * @returns Promise that resolves when the task completes
     */
    execute(): Promise<void>;

    /**
     * Cancel the task if it's running
     */
    cancel(): void;

    /**
     * Subscribe to progress updates
     * @param callback Function to call on progress updates
     * @returns Disposable to unsubscribe
     */
    onProgress(callback: (progress: TaskProgress) => void): { dispose(): void };

    /**
     * Subscribe to status changes
     * @param callback Function to call on status changes
     * @returns Disposable to unsubscribe
     */
    onStatusChange(callback: (status: TaskStatus) => void): { dispose(): void };
}