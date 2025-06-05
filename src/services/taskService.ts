/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Enumeration of possible states a task can be in.
 */
export enum TaskState {
    /**
     * Task has been created but not yet started.
     */
    Pending = 'pending',

    /**
     * Task is initializing resources before beginning actual work.
     */
    Initializing = 'initializing',

    /**
     * Task is actively executing its core function.
     */
    Running = 'running',

    /**
     * Task has successfully finished its work.
     */
    Completed = 'completed',

    /**
     * Task encountered an error and could not complete successfully.
     */
    Failed = 'failed',

    /**
     * Task is in the process of stopping after receiving a stop request.
     */
    Stopping = 'stopping',

    /**
     * Task has been successfully stopped before completion.
     */
    Stopped = 'stopped',

    /**
     * Task is in the process of pausing its execution.
     */
    Pausing = 'pausing',

    /**
     * Task execution is temporarily suspended and can be resumed.
     */
    Paused = 'paused',

    /**
     * Task is in the process of resuming from a paused state.
     */
    Resuming = 'resuming',
}

/**
 * Represents the status of a task at a given point in time.
 */
export interface TaskStatus {
    /**
     * The current state of the task.
     */
    state: TaskState;

    /**
     * Optional progress indicator, typically from 0-100.
     */
    progress?: number;

    /**
     * Optional status message describing the current task activity.
     */
    message?: string;

    /**
     * Optional error object if the task failed.
     */
    error?: unknown;
}

/**
 * Represents a long-running task managed by the TaskService.
 *
 * When created, a task should be initialized with the default state of TaskState.Pending.
 * Tasks must be explicitly started via the start() method to begin execution.
 */
export interface Task {
    /**
     * Unique identifier for the task, set at construction.
     */
    readonly id: string;

    /**
     * Type identifier for the task, e.g., 'copy-paste-collection', 'schema-analysis'.
     */
    readonly type: string;

    /**
     * User-friendly name/description of the task.
     */
    readonly name: string;

    /**
     * Retrieves the current status of the task.
     *
     * @returns The current TaskStatus.
     */
    getStatus(): TaskStatus;

    /**
     * Initiates the task execution.
     *
     * @returns A Promise that resolves when the task is started.
     */
    start(): Promise<void>;

    /**
     * Requests a graceful stop of the task.
     *
     * @returns A Promise that resolves when the task has acknowledged the stop request.
     */
    stop(): Promise<void>;

    /**
     * Performs cleanup for the task.
     * The TaskService will call this before removing the task from its tracking.
     *
     * @returns A Promise that resolves when cleanup is complete.
     */
    delete(): Promise<void>;
}

/**
 * Represents a task that supports pause and resume operations.
 *
 * Implementation of pause and resume methods is optional for tasks.
 * A task that implements this interface indicates it can be paused during execution
 * and later resumed from the point it was paused.
 */
export interface PausableTask extends Task {
    /**
     * Temporarily suspends the task execution while preserving its state.
     *
     * @returns A Promise that resolves when the task has successfully paused.
     */
    pause(): Promise<void>;

    /**
     * Resumes task execution from the point it was paused.
     *
     * @returns A Promise that resolves when the task has successfully resumed.
     */
    resume(): Promise<void>;

    /**
     * Indicates whether the task supports pause and resume operations.
     *
     * @returns True if the task can be paused and resumed, false otherwise.
     */
    canPause(): boolean;
}

/**
 * Service for managing long-running tasks within the extension.
 */
export interface TaskService {
    /**
     * Registers a pre-constructed task instance with the engine.
     * The task's `id` must be unique.
     *
     * @param task The task instance to register.
     * @throws Error if a task with the same ID is already registered.
     */
    registerTask(task: Task): void;

    /**
     * Retrieves a registered task by its ID.
     *
     * @param id The ID of the task.
     * @returns The task instance, or undefined if not found.
     */
    getTask(id: string): Task | undefined;

    /**
     * Lists all currently registered tasks.
     *
     * @returns An array of task instances.
     */
    listTasks(): Task[];

    /**
     * Unregisters a task and calls its delete() method.
     * This effectively removes the task from the engine's management.
     *
     * @param id The ID of the task to delete.
     * @throws Error if the task is not found or if deletion fails.
     */
    deleteTask(id: string): Promise<void>;

    /**
     * Pauses a task if it implements the PausableTask interface.
     *
     * @param id The ID of the task to pause.
     * @throws Error if the task is not found, does not support pausing, or if pausing fails.
     */
    pauseTask(id: string): Promise<void>;

    /**
     * Resumes a paused task if it implements the PausableTask interface.
     *
     * @param id The ID of the task to resume.
     * @throws Error if the task is not found, does not support resuming, or if resuming fails.
     */
    resumeTask(id: string): Promise<void>;

    /**
     * Checks if a task supports pause and resume operations.
     *
     * @param id The ID of the task to check.
     * @returns True if the task supports pause and resume, false otherwise.
     * @throws Error if the task is not found.
     */
    isTaskPausable(id: string): boolean;
}

/**
 * Private implementation of TaskService that manages long-running task operations
 * within the extension.
 *
 * Tasks are registered with unique IDs and can be retrieved individually,
 * listed, or deleted when complete.
 *
 * This class cannot be instantiated directly - use the exported TaskService singleton instead.
 */
class TaskServiceImpl implements TaskService {
    private tasks: Map<string, Task> = new Map();

    /**
     * Implementation of TaskService.registerTask that adds a task to the task manager.
     *
     * @param task The task instance to register.
     * @throws Error if a task with the same ID is already registered.
     */
    public registerTask(task: Task): void {
        if (this.tasks.has(task.id)) {
            throw new Error(`Task with ID '${task.id}' already exists`);
        }
        this.tasks.set(task.id, task);
    }

    /**
     * Implementation of TaskService.getTask that retrieves a task by its ID.
     *
     * @param id The ID of the task.
     * @returns The task instance, or undefined if not found.
     */
    public getTask(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    /**
     * Implementation of TaskService.listTasks that returns all registered tasks.
     *
     * @returns An array of all registered task instances.
     */
    public listTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    /**
     * Implementation of TaskService.deleteTask that unregisters a task and calls its delete() method.
     *
     * @param id The ID of the task to delete.
     * @throws Error if the task is not found or if deletion fails.
     */
    public async deleteTask(id: string): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) {
            throw new Error(`Task with ID '${id}' not found`);
        }

        try {
            await task.delete();
            this.tasks.delete(id);
        } catch (error) {
            throw new Error(`Failed to delete task '${id}'`, { cause: error });
        }
    }

    /**
     * Implementation of TaskService.pauseTask that pauses a pausable task.
     *
     * @param id The ID of the task to pause.
     * @throws Error if the task is not found, does not support pausing, or if pausing fails.
     */
    public async pauseTask(id: string): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) {
            throw new Error(`Task with ID '${id}' not found`);
        }

        if (!this.isPausableTask(task)) {
            throw new Error(`Task with ID '${id}' does not support pause operation`);
        }

        try {
            await task.pause();
        } catch (error) {
            throw new Error(`Failed to pause task '${id}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Implementation of TaskService.resumeTask that resumes a paused task.
     *
     * @param id The ID of the task to resume.
     * @throws Error if the task is not found, does not support resuming, or if resuming fails.
     */
    public async resumeTask(id: string): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) {
            throw new Error(`Task with ID '${id}' not found`);
        }

        if (!this.isPausableTask(task)) {
            throw new Error(`Task with ID '${id}' does not support resume operation`);
        }

        try {
            await task.resume();
        } catch (error) {
            throw new Error(`Failed to resume task '${id}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Implementation of TaskService.isTaskPausable that checks if a task supports pause and resume operations.
     *
     * @param id The ID of the task to check.
     * @returns True if the task supports pause and resume, false otherwise.
     * @throws Error if the task is not found.
     */
    public isTaskPausable(id: string): boolean {
        const task = this.tasks.get(id);
        if (!task) {
            throw new Error(`Task with ID '${id}' not found`);
        }

        return this.isPausableTask(task);
    }

    /**
     * Helper method to check if a task implements the PausableTask interface.
     *
     * @param task The task to check.
     * @returns True if the task is pausable, false otherwise.
     */
    private isPausableTask(task: Task): task is PausableTask {
        return (
            'pause' in task &&
            'resume' in task &&
            'canPause' in task &&
            typeof (task as PausableTask).pause === 'function' &&
            typeof (task as PausableTask).resume === 'function' &&
            typeof (task as PausableTask).canPause === 'function'
        );
    }
}

/**
 * Singleton instance of the TaskService for managing long-running tasks.
 */
export const TaskService = new TaskServiceImpl();
