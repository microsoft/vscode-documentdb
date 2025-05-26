/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the status of a task at a given point in time.
 */
export interface TaskStatus {
    /**
     * The current state of the task.
     */
    state: 'pending' | 'initializing' | 'running' | 'completed' | 'failed' | 'stopping' | 'stopped';
    
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
            throw new Error(`Failed to delete task '${id}': ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

/**
 * Singleton instance of the TaskService for managing long-running tasks.
 */
export const TaskService = new TaskServiceImpl();