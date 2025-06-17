/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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
     * Task is in the process of stopping.
     */
    Stopping = 'stopping',

    /**
     * Task has been stopped by user request.
     */
    Stopped = 'stopped',

    /**
     * Task has successfully finished its work.
     */
    Completed = 'completed',

    /**
     * Task has failed due to an error.
     */
    Failed = 'failed',
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
 * Event fired when a task's state changes.
 */
export interface TaskStateChangeEvent {
    readonly previousState: TaskState;
    readonly newState: TaskState;
    readonly taskId: string;
}

/**
 * Abstract base class for long-running tasks managed by the TaskService.
 *
 * This class implements the template method pattern to handle complex state
 * transitions and lifecycle management, allowing subclasses to focus solely
 * on their business logic.
 *
 * Tasks are created in the Pending state and must be explicitly started.
 * The base class guarantees proper state transitions and provides comprehensive
 * event support for real-time monitoring.
 *
 * Subclasses only need to implement the doWork() method with their
 * specific task logic.
 */
export abstract class Task extends vscode.EventEmitter<{
    onDidChangeState: [TaskStateChangeEvent];
    onDidChangeStatus: [TaskStatus];
}> {
    public readonly id: string;
    public abstract readonly type: string;
    public abstract readonly name: string;

    private _status: TaskStatus;
    private abortController: AbortController;

    /**
     * Event fired when the task's state changes (e.g., Running to Completed).
     * This event is guaranteed to capture all state transitions.
     */
    public readonly onDidChangeState = this.event<TaskStateChangeEvent>('onDidChangeState');

    /**
     * Event fired on any status update, including progress changes.
     * This is a more granular event that includes all updates.
     */
    public readonly onDidChangeStatus = this.event<TaskStatus>('onDidChangeStatus');

    /**
     * Creates a new Task instance.
     *
     * @param id Unique identifier for the task.
     */
    protected constructor(id: string) {
        super();
        this.id = id;
        this._status = {
            state: TaskState.Pending,
            progress: 0,
            message: vscode.l10n.t('Task created and ready to start'),
        };
        this.abortController = new AbortController();
    }

    /**
     * Gets the current status of the task.
     *
     * @returns A copy of the current TaskStatus.
     */
    public getStatus(): TaskStatus {
        return { ...this._status };
    }

    /**
     * Updates the task status and emits appropriate events.
     * This method is protected to prevent external manipulation of task state.
     *
     * @param state The new task state.
     * @param progress Optional progress value (0-100).
     * @param message Optional status message.
     * @param error Optional error object if the task failed.
     */
    protected updateStatus(state: TaskState, progress?: number, message?: string, error?: unknown): void {
        const previousState = this._status.state;

        this._status = {
            state,
            progress: progress ?? this._status.progress,
            message: message ?? this._status.message,
            error: error instanceof Error ? error : error ? new Error(String(error)) : undefined,
        };

        // Always emit the granular status change event
        this.fire('onDidChangeStatus', this.getStatus());

        // Emit state change event only if state actually changed
        if (previousState !== state) {
            this.fire('onDidChangeState', {
                previousState,
                newState: state,
                taskId: this.id,
            });
        }
    }

    /**
     * Updates only the progress value without changing the state.
     * Convenience method for progress updates during task execution.
     *
     * @param progress Progress value (0-100).
     * @param message Optional progress message.
     */
    protected updateProgress(progress: number, message?: string): void {
        this.updateStatus(this._status.state, progress, message);
    }

    /**
     * Starts the task execution.
     * This method implements the template method pattern, handling all state
     * transitions and error handling automatically.
     *
     * @returns A Promise that resolves when the task has been started (not when it completes).
     * @throws Error if the task is not in a valid state to start.
     */
    public async start(): Promise<void> {
        if (this._status.state !== TaskState.Pending) {
            throw new Error(vscode.l10n.t('Cannot start task in state: {0}', this._status.state));
        }

        this.updateStatus(TaskState.Initializing, 0, vscode.l10n.t('Initializing task...'));

        try {
            // Allow subclasses to perform initialization
            await this.onInitialize?.();

            this.updateStatus(TaskState.Running, 0, vscode.l10n.t('Task is running'));

            // Start the actual work asynchronously
            void this.runWork().catch((error) => {
                this.updateStatus(TaskState.Failed, this._status.progress, vscode.l10n.t('Task failed'), error);
            });
        } catch (error) {
            this.updateStatus(TaskState.Failed, 0, vscode.l10n.t('Failed to initialize task'), error);
            throw error;
        }
    }

    /**
     * Executes the main task work with proper error handling and state management.
     * This method is private to ensure proper lifecycle management.
     */
    private async runWork(): Promise<void> {
        try {
            await this.doWork(this.abortController.signal);

            // If not aborted, mark as completed
            if (!this.abortController.signal.aborted) {
                this.updateStatus(TaskState.Completed, 100, vscode.l10n.t('Task completed successfully'));
            }
        } catch (error) {
            // Only update to failed if not aborted
            if (!this.abortController.signal.aborted) {
                this.updateStatus(TaskState.Failed, this._status.progress, vscode.l10n.t('Task failed'), error);
            }
        }
    }

    /**
     * Requests a graceful stop of the task.
     * This method signals the task to stop via AbortSignal and updates the state accordingly.
     *
     * @returns A Promise that resolves when the stop request has been acknowledged.
     */
    public async stop(): Promise<void> {
        if (this.isFinalState()) {
            return;
        }

        this.updateStatus(TaskState.Stopping, this._status.progress, vscode.l10n.t('Stopping task...'));
        this.abortController.abort();

        // Allow subclasses to perform cleanup
        try {
            await this.onStop?.();
        } catch (error) {
            // Log but don't throw - we're stopping anyway
            console.error('Error during task stop:', error);
        }

        // Update to stopped state
        this.updateStatus(TaskState.Stopped, this._status.progress, vscode.l10n.t('Task stopped'));
    }

    /**
     * Performs cleanup for the task.
     * This should be called when the task is no longer needed.
     *
     * @returns A Promise that resolves when cleanup is complete.
     */
    public async delete(): Promise<void> {
        // Ensure task is stopped
        if (!this.isFinalState()) {
            await this.stop();
        }

        // Allow subclasses to perform cleanup
        try {
            await this.onDelete?.();
        } catch (error) {
            // Log but don't throw
            console.error('Error during task deletion:', error);
        }

        // Dispose of event emitter resources
        this.dispose();
    }

    /**
     * Checks if the task is in a final state (completed, failed, or stopped).
     */
    private isFinalState(): boolean {
        return [TaskState.Completed, TaskState.Failed, TaskState.Stopped].includes(this._status.state);
    }

    /**
     * Implements the actual task logic.
     * Subclasses must implement this method with their specific functionality.
     *
     * The implementation should:
     * - Check the abort signal periodically for long-running operations
     * - Call updateProgress() to report progress
     * - Throw errors for failure conditions
     *
     * @param signal AbortSignal that will be triggered when stop() is called.
     *               Check signal.aborted to exit gracefully.
     *
     * @example
     * protected async doWork(signal: AbortSignal): Promise<void> {
     *     const items = await this.loadItems();
     *
     *     for (let i = 0; i < items.length; i++) {
     *         if (signal.aborted) return;
     *
     *         await this.processItem(items[i]);
     *         this.updateProgress((i + 1) / items.length * 100);
     *     }
     * }
     */
    protected abstract doWork(signal: AbortSignal): Promise<void>;

    /**
     * Optional hook called during task initialization.
     * Override this to perform setup operations before the main work begins.
     */
    protected onInitialize?(): Promise<void>;

    /**
     * Optional hook called when the task is being stopped.
     * Override this to perform cleanup operations specific to stopping.
     */
    protected onStop?(): Promise<void>;

    /**
     * Optional hook called when the task is being deleted.
     * Override this to clean up resources like file handles or connections.
     */
    protected onDelete?(): Promise<void>;
}

/**
 * Service for managing long-running tasks within the extension.
 *
 * Provides centralized task management with comprehensive event support
 * for monitoring task lifecycle and status changes.
 */
export interface TaskService {
    /**
     * Registers a new task with the service.
     * The task must have a unique ID.
     *
     * @param task The task to register.
     * @throws Error if a task with the same ID already exists.
     */
    registerTask(task: Task): void;

    /**
     * Retrieves a task by its ID.
     *
     * @param id The unique identifier of the task.
     * @returns The task if found, undefined otherwise.
     */
    getTask(id: string): Task | undefined;

    /**
     * Lists all currently registered tasks.
     *
     * @returns An array of all registered tasks.
     */
    listTasks(): Task[];

    /**
     * Deletes a task from the service.
     * This will call the task's delete() method for cleanup.
     *
     * @param id The unique identifier of the task to delete.
     * @returns A Promise that resolves when the task has been deleted.
     * @throws Error if the task is not found.
     */
    deleteTask(id: string): Promise<void>;

    /**
     * Event fired when a new task is registered.
     * Use this to update UI or start monitoring a new task.
     */
    readonly onDidRegisterTask: vscode.Event<Task>;

    /**
     * Event fired when a task is deleted.
     * The event provides the task ID that was deleted.
     */
    readonly onDidDeleteTask: vscode.Event<string>;

    /**
     * Event fired when any task's status changes.
     * This aggregates status changes from all registered tasks,
     * providing a single subscription point for monitoring all task activity.
     */
    readonly onDidChangeTaskStatus: vscode.Event<{ taskId: string; status: TaskStatus }>;

    /**
     * Event fired when a task's state changes.
     * This provides detailed information about the state transition.
     */
    readonly onDidChangeTaskState: vscode.Event<TaskStateChangeEvent>;
}

/**
 * Private implementation of TaskService that manages long-running task operations
 * within the extension.
 *
 * This implementation provides comprehensive event support for both individual
 * tasks and aggregated task monitoring.
 */
class TaskServiceImpl
    extends vscode.EventEmitter<{
        onDidRegisterTask: [Task];
        onDidDeleteTask: [string];
        onDidChangeTaskStatus: [{ taskId: string; status: TaskStatus }];
        onDidChangeTaskState: [TaskStateChangeEvent];
    }>
    implements TaskService
{
    private readonly tasks = new Map<string, Task>();
    private readonly taskSubscriptions = new Map<string, vscode.Disposable[]>();

    public readonly onDidRegisterTask = this.event<Task>('onDidRegisterTask');
    public readonly onDidDeleteTask = this.event<string>('onDidDeleteTask');
    public readonly onDidChangeTaskStatus = this.event<{ taskId: string; status: TaskStatus }>('onDidChangeTaskStatus');
    public readonly onDidChangeTaskState = this.event<TaskStateChangeEvent>('onDidChangeTaskState');

    public registerTask(task: Task): void {
        if (this.tasks.has(task.id)) {
            throw new Error(vscode.l10n.t('Task with ID {0} already exists', task.id));
        }

        // Subscribe to task events and aggregate them
        const subscriptions: vscode.Disposable[] = [
            task.onDidChangeStatus((status) => {
                this.fire('onDidChangeTaskStatus', { taskId: task.id, status });
            }),
            task.onDidChangeState((e) => {
                this.fire('onDidChangeTaskState', e);
            }),
        ];

        this.tasks.set(task.id, task);
        this.taskSubscriptions.set(task.id, subscriptions);

        // Notify listeners about the new task
        this.fire('onDidRegisterTask', task);
    }

    public getTask(id: string): Task | undefined {
        return this.tasks.get(id);
    }

    public listTasks(): Task[] {
        return Array.from(this.tasks.values());
    }

    public async deleteTask(id: string): Promise<void> {
        const task = this.tasks.get(id);
        if (!task) {
            throw new Error(vscode.l10n.t('Task with ID {0} not found', id));
        }

        // Clean up event subscriptions
        const subscriptions = this.taskSubscriptions.get(id);
        if (subscriptions) {
            subscriptions.forEach((sub) => sub.dispose());
            this.taskSubscriptions.delete(id);
        }

        // Delete the task (this will stop it if needed)
        await task.delete();
        this.tasks.delete(id);

        // Notify listeners
        this.fire('onDidDeleteTask', id);
    }
}

/**
 * Singleton instance of the TaskService for managing long-running tasks.
 */
export const TaskService = new TaskServiceImpl();
