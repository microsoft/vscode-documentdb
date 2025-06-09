/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the possible states of a task.
 */
export enum TaskState {
    Initializing = 'initializing',
    Running = 'running',
    Completed = 'completed',
    Failed = 'failed',
    Stopped = 'stopped',
}

/**
 * Interface for a task that can be monitored.
 */
export interface ITask {
    readonly id: string;
    readonly name: string;
    state: TaskState;
    progress: number; // 0-100
    totalItems: number;
    processedItems: number;
    error?: Error;
    readonly abortController: AbortController;

    /**
     * Starts the task.
     */
    start(): void;

    /**
     * Stops the task if it's running.
     */
    stop(): void;

    /**
     * Updates the task progress.
     */
    updateProgress(processedItems: number, totalItems?: number): void;

    /**
     * Sets an error for the task.
     */
    setError(error: Error): void;

    /**
     * Marks the task as completed.
     */
    complete(): void;
}

/**
 * Basic task implementation for progress monitoring.
 */
export class Task implements ITask {
    public state: TaskState = TaskState.Initializing;
    public progress: number = 0;
    public totalItems: number = 0;
    public processedItems: number = 0;
    public error?: Error;
    public readonly abortController: AbortController = new AbortController();

    constructor(
        public readonly id: string,
        public readonly name: string,
    ) {}

    public stop(): void {
        if (this.state === TaskState.Running || this.state === TaskState.Initializing) {
            this.state = TaskState.Stopped;
            this.abortController.abort();
        }
    }

    public updateProgress(processedItems: number, totalItems?: number): void {
        this.processedItems = processedItems;
        if (totalItems !== undefined) {
            this.totalItems = totalItems;
        }
        this.progress = this.totalItems > 0 ? Math.round((this.processedItems / this.totalItems) * 100) : 0;
    }

    public setError(error: Error): void {
        this.error = error;
        this.state = TaskState.Failed;
    }

    public complete(): void {
        this.state = TaskState.Completed;
        this.progress = 100;
    }

    public start(): void {
        this.state = TaskState.Running;
    }
}

/**
 * Service for managing tasks that can be monitored for progress.
 */
export class TaskServiceImpl {
    private readonly tasks = new Map<string, ITask>();

    /**
     * Creates a new task and registers it with the service.
     */
    public createTask(name: string): ITask {
        const id = this.generateTaskId();
        const task = new Task(id, name);
        this.tasks.set(id, task);
        return task;
    }

    /**
     * Retrieves a task by its ID.
     */
    public getTask(taskId: string): ITask | undefined {
        return this.tasks.get(taskId);
    }

    /**
     * Gets all currently tracked tasks.
     */
    public getAllTasks(): ITask[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Removes a task from tracking.
     */
    public removeTask(taskId: string): boolean {
        return this.tasks.delete(taskId);
    }

    /**
     * Gets all running tasks.
     */
    public getRunningTasks(): ITask[] {
        return this.getAllTasks().filter(task => 
            task.state === TaskState.Running || task.state === TaskState.Initializing
        );
    }

    /**
     * Stops all running tasks.
     */
    public stopAllTasks(): void {
        this.getRunningTasks().forEach(task => task.stop());
    }

    private generateTaskId(): string {
        return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Export a singleton instance
export const TaskService = new TaskServiceImpl();