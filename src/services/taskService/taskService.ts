/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import {
    hasResourceConflict,
    type ResourceDefinition,
    type ResourceTrackingTask,
    type TaskInfo,
} from './taskServiceResourceTracking';

/**
 * Enumeration of possible states a task can be in.
 */
export enum TaskState {
    /**
     * Task has been created but not yet started.
     */
    Pending = 'Pending',

    /**
     * Task is initializing resources before beginning actual work.
     */
    Initializing = 'Initializing',

    /**
     * Task is actively executing its core function.
     */
    Running = 'Running',

    /**
     * Task is in the process of stopping.
     */
    Stopping = 'Stopping',

    /**
     * Task has been stopped by user request.
     */
    Stopped = 'Stopped',

    /**
     * Task has successfully finished its work.
     */
    Completed = 'Completed',

    /**
     * Task has failed due to an error.
     */
    Failed = 'Failed',
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
 * Checks if the given task state is terminal (task has finished and won't change).
 * Terminal states are: Completed, Failed, or Stopped.
 *
 * @param state The task state to check
 * @returns true if the state is Completed, Failed, or Stopped
 */
export function isTerminalState(state: TaskState): boolean {
    return state === TaskState.Completed || state === TaskState.Failed || state === TaskState.Stopped;
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
 *
 * ## Telemetry Integration
 *
 * This class provides automatic telemetry collection for task lifecycle and performance.
 * Two telemetry events are generated per task:
 * - `taskService.taskInitialization` - covers the initialization phase
 * - `taskService.taskExecution` - covers the main work execution phase
 *
 * ### Telemetry Naming Convention
 *
 * **Base Class Properties (Task framework):**
 * - Use `task_` prefix for all base class properties and measurements
 * - Examples: `task_id`, `task_type`, `task_state`, `task_duration`
 * - These are automatically added by the base class
 *
 * **Implementation Properties (Domain-specific):**
 * - Use natural domain names without prefixes
 * - Examples: `sourceCollectionSize`, `conflictResolution`, `documentsProcessed`
 * - Add these in your `doWork()` and `onInitialize()` implementations using the context parameter
 *
 * This ensures no naming conflicts while keeping implementation telemetry clean and query-friendly.
 */
export abstract class Task {
    public readonly id: string;
    public abstract readonly type: string;
    public abstract readonly name: string;

    private _status: TaskStatus;
    private abortController: AbortController;

    // Event emitters for the events
    private readonly _onDidChangeState = new vscode.EventEmitter<TaskStateChangeEvent>();
    private readonly _onDidChangeStatus = new vscode.EventEmitter<TaskStatus>();

    /**
     * Event fired when the task's state changes (e.g., Running to Completed).
     * This event is guaranteed to capture all state transitions.
     */
    public readonly onDidChangeState = this._onDidChangeState.event;

    /**
     * Event fired on any status update, including progress changes.
     * This is a more granular event that includes all updates.
     */
    public readonly onDidChangeStatus = this._onDidChangeStatus.event; /**
     * Creates a new Task instance with an auto-generated unique ID.
     */
    protected constructor() {
        this.id = crypto.randomUUID();
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
    } /**
     * Updates the task status and emits appropriate events.
     * This method is protected to prevent external manipulation of task state.
     *
     * @param state The new task state.
     * @param message Optional status message.
     * @param progress Optional progress value (0-100). Only applied if state is Running.
     * @param error Optional error object if the task failed.
     */
    protected updateStatus(state: TaskState, message?: string, progress?: number, error?: unknown): void {
        const previousState = this._status.state;

        // Only update progress if we're in a running state or transitioning to running
        const newProgress = state === TaskState.Running && progress !== undefined ? progress : this._status.progress;
        this._status = {
            state,
            progress: newProgress,
            message: message ?? this._status.message,
            error: error instanceof Error ? error : error ? new Error(JSON.stringify(error)) : undefined,
        };

        // Always emit the granular status change event
        this._onDidChangeStatus.fire(this.getStatus());

        // Emit state change event only if state actually changed
        if (previousState !== state) {
            this._onDidChangeState.fire({
                previousState,
                newState: state,
                taskId: this.id,
            });

            // Centralized logging for final state transitions
            if (state === TaskState.Completed) {
                const msg = this._status.message ?? '';
                ext.outputChannel.appendLine(
                    vscode.l10n.t("✓ Task '{taskName}' completed successfully. {message}", {
                        taskName: this.name,
                        message: msg,
                    }),
                );
            } else if (state === TaskState.Stopped) {
                const msg = this._status.message ?? '';
                ext.outputChannel.appendLine(
                    vscode.l10n.t("■ Task '{taskName}' was stopped. {message}", {
                        taskName: this.name,
                        message: msg,
                    }),
                );
            } else if (state === TaskState.Failed) {
                const msg = this._status.message ?? '';
                const err = this._status.error instanceof Error ? this._status.error.message : '';
                // Include error details if available
                const detail = err ? ` ${vscode.l10n.t('Error: {0}', err)}` : '';
                // Use .error() to ensure task failure is always visible regardless of log level
                ext.outputChannel.error(
                    vscode.l10n.t("! Task '{taskName}' failed. {message}", {
                        taskName: this.name,
                        message: `${msg}${detail}`.trim(),
                    }),
                );
            }
        }
    }

    /**
     * Updates progress and message during task execution.
     * This is a convenience method that only works when the task is running.
     * If called when the task is not running, the update is ignored to prevent race conditions.
     *
     * @param progress Progress value (0-100).
     * @param message Optional progress message.
     */
    protected updateProgress(progress: number, message?: string): void {
        // Only allow progress updates when running to prevent race conditions
        if (this._status.state === TaskState.Running) {
            this.updateStatus(TaskState.Running, message, progress);
        }
        // Silently ignore progress updates in other states to prevent race conditions
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

        ext.outputChannel.appendLine(vscode.l10n.t("○ Task '{taskName}' initializing...", { taskName: this.name }));

        this.updateStatus(TaskState.Initializing, vscode.l10n.t('Initializing task...'), 0);

        try {
            // Allow subclasses to perform initialization with telemetry
            await callWithTelemetryAndErrorHandling('taskService.taskInitialization', async (context) => {
                // Add base task properties with task_ prefix
                context.telemetry.properties.task_id = this.id;
                context.telemetry.properties.task_type = this.type;
                context.telemetry.properties.task_name = this.name;
                context.telemetry.properties.task_phase = 'initialization';

                await this.onInitialize?.(this.abortController.signal, context);

                // Record initialization completion
                context.telemetry.properties.task_initializationCompleted = 'true';
            });

            // Check if abort was requested during initialization
            if (this.abortController.signal.aborted) {
                this.updateStatus(TaskState.Stopping, vscode.l10n.t('Task stopped during initialization'));
                // Let runWork handle the final state transition
                void this.runWork().catch((error) => {
                    this.updateStatus(TaskState.Failed, vscode.l10n.t('Task failed'), 0, error);
                });
                return;
            }

            this.updateStatus(TaskState.Running, vscode.l10n.t('Task is running'), 0);
            ext.outputChannel.appendLine(vscode.l10n.t("► Task '{taskName}' starting...", { taskName: this.name }));

            // Start the actual work asynchronously
            void this.runWork().catch((error) => {
                this.updateStatus(TaskState.Failed, vscode.l10n.t('Task failed'), 0, error);
            });
        } catch (error) {
            this.updateStatus(TaskState.Failed, vscode.l10n.t('Failed to initialize task'), 0, error);
            throw error;
        }
    }

    /**
     * Executes the main task work with proper error handling and state management.
     * This method is private to ensure proper lifecycle management.
     */
    private async runWork(): Promise<void> {
        await callWithTelemetryAndErrorHandling('taskService.taskExecution', async (context: IActionContext) => {
            // Add base task properties with task_ prefix
            context.telemetry.properties.task_id = this.id;
            context.telemetry.properties.task_type = this.type;
            context.telemetry.properties.task_name = this.name;
            context.telemetry.properties.task_phase = 'execution';

            try {
                await this.doWork(this.abortController.signal, context);

                // Determine final state based on abort status
                if (this.abortController.signal.aborted) {
                    context.telemetry.properties.task_final_state = 'stopped';
                    // Preserve current progress message to show what was accomplished before stopping
                    const currentMessage = this._status.message;
                    const stoppedMessage = currentMessage
                        ? vscode.l10n.t('Task stopped. {0}', currentMessage)
                        : vscode.l10n.t('Task stopped');
                    this.updateStatus(TaskState.Stopped, stoppedMessage);
                } else {
                    context.telemetry.properties.task_final_state = 'completed';
                    this.updateStatus(TaskState.Completed, vscode.l10n.t('Task completed successfully'), 100);
                }
            } catch (error) {
                // Suppress the default error notification from callWithTelemetryAndErrorHandling
                // because TaskProgressReportingService shows its own notification with a "Show Output" button
                context.errorHandling.suppressDisplay = true;

                // Add error information to telemetry
                context.telemetry.properties.task_error = error instanceof Error ? error.message : 'Unknown error';

                // Determine final state based on abort status
                if (this.abortController.signal.aborted) {
                    context.telemetry.properties.task_final_state = 'stopped';
                    // Preserve current progress message to show what was accomplished before stopping
                    const currentMessage = this._status.message;
                    const stoppedMessage = currentMessage
                        ? vscode.l10n.t('Task stopped. {0}', currentMessage)
                        : vscode.l10n.t('Task stopped');
                    this.updateStatus(TaskState.Stopped, stoppedMessage);
                } else {
                    context.telemetry.properties.task_final_state = 'failed';
                    this.updateStatus(TaskState.Failed, vscode.l10n.t('Task failed'), 0, error);
                }
                throw error;
            }
        });
    }

    /**
     * Requests a graceful stop of the task.
     * This method signals the task to stop via AbortSignal and updates the state accordingly.
     * The final state transition to Stopped will be handled by runWork() when it detects the abort signal.
     *
     * This method returns immediately after signaling the stop request. The actual stopping
     * is handled asynchronously by the running task when it detects the abort signal.
     */
    public stop(): void {
        if (this.isFinalState()) {
            return;
        }
        this.updateStatus(TaskState.Stopping, vscode.l10n.t('Stopping task...'));
        this.abortController.abort();

        // Note: The actual state transition to Stopped will be handled by runWork()
        // when it detects the abort signal and completes gracefully
    }

    /**
     * Performs cleanup for the task.
     * This should be called when the task is no longer needed.
     *
     * @returns A Promise that resolves when cleanup is complete.
     */ public async delete(): Promise<void> {
        // Ensure task is stopped
        if (!this.isFinalState()) {
            this.stop();
        }

        // Allow subclasses to perform cleanup
        try {
            await this.onDelete?.();
        } catch (error) {
            // Log but don't throw
            console.error('Error during task deletion:', error);
        } // Dispose of event emitter resources
        this._onDidChangeState.dispose();
        this._onDidChangeStatus.dispose();
    }

    /**
     * Checks if the task is in a final state (completed, failed, or stopped).
     */
    private isFinalState(): boolean {
        return isTerminalState(this._status.state);
    }

    /**
     * Implements the actual task logic.
     * Subclasses must implement this method with their specific functionality.
     *
     * The implementation should:
     * - Check the abort signal periodically for long-running operations
     * - Call updateProgress() to report progress updates (safe to call anytime)
     * - Throw errors for failure conditions
     * - Handle cleanup when signal.aborted becomes true
     * - Use the optional context parameter to add task-specific telemetry properties and measurements
     *
     * @param signal AbortSignal that will be triggered when stop() is called.
     *               Check signal.aborted to exit gracefully and perform cleanup.
     * @param context Optional telemetry context for adding task-specific properties and measurements.
     *                Use natural domain names (no prefixes) for implementation-specific data.
     *
     * @example
     * protected async doWork(signal: AbortSignal, context?: IActionContext): Promise<void> {
     *     // Add task-specific telemetry
     *     if (context) {
     *         context.telemetry.properties.sourceCollectionSize = this.sourceSize.toString();
     *         context.telemetry.measurements.documentsProcessed = 0;
     *     }
     *
     *     const items = await this.loadItems();
     *
     *     for (let i = 0; i < items.length; i++) {
     *         if (signal.aborted) {
     *             // Perform any necessary cleanup here
     *             await this.cleanup();
     *             return;
     *         }
     *
     *         await this.processItem(items[i]);
     *         this.updateProgress((i + 1) / items.length * 100, `Processing item ${i + 1}`);
     *
     *         // Update telemetry measurements
     *         if (context) {
     *             context.telemetry.measurements.documentsProcessed = i + 1;
     *         }
     *     }
     * }
     */
    protected abstract doWork(signal: AbortSignal, context?: IActionContext): Promise<void>;

    /**
     * Optional hook called during task initialization.
     * Override this to perform setup operations before the main work begins.
     *
     * @param signal AbortSignal that will be triggered when stop() is called.
     *               Check signal.aborted to exit initialization early if needed.
     * @param context Optional telemetry context for adding initialization-specific properties and measurements.
     *                Use natural domain names (no prefixes) for implementation-specific data.
     */
    protected onInitialize?(signal: AbortSignal, context?: IActionContext): Promise<void>;

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

    /**
     * Gets all tasks that are currently using resources that conflict with the specified resource.
     * Only checks tasks that are currently in non-final states (Pending, Initializing, Running, Stopping).
     *
     * @param resource The resource to check for usage conflicts
     * @returns Array of conflicting task information
     */
    getConflictingTasks(resource: ResourceDefinition): TaskInfo[];

    /**
     * Finds all tasks that conflict with any of the given cluster IDs.
     * Performs simple equality matching between the provided clusterIds and
     * the clusterIds used by running tasks.
     *
     * @param clusterIds - Array of cluster IDs (clusterIds/storageIds) to check
     * @returns Array of conflicting tasks (deduplicated by taskId)
     */
    findConflictingTasksForConnections(clusterIds: string[]): TaskInfo[];

    /**
     * Gets all resources currently in use by all active tasks.
     * Useful for debugging or advanced UI features.
     * Only includes tasks that are currently in non-final states.
     *
     * @returns Array of task resource usage information
     */
    getAllUsedResources(): Array<{ task: TaskInfo; resources: ResourceDefinition[] }>;
}

/**
 * Private implementation of TaskService that manages long-running task operations
 * within the extension.
 *
 * This implementation provides comprehensive event support for both individual
 * tasks and aggregated task monitoring.
 */
class TaskServiceImpl implements TaskService {
    private readonly tasks = new Map<string, Task>();
    private readonly taskSubscriptions = new Map<string, vscode.Disposable[]>();

    // Event emitters for the service events
    private readonly _onDidRegisterTask = new vscode.EventEmitter<Task>();
    private readonly _onDidDeleteTask = new vscode.EventEmitter<string>();
    private readonly _onDidChangeTaskStatus = new vscode.EventEmitter<{ taskId: string; status: TaskStatus }>();
    private readonly _onDidChangeTaskState = new vscode.EventEmitter<TaskStateChangeEvent>();

    public readonly onDidRegisterTask = this._onDidRegisterTask.event;
    public readonly onDidDeleteTask = this._onDidDeleteTask.event;
    public readonly onDidChangeTaskStatus = this._onDidChangeTaskStatus.event;
    public readonly onDidChangeTaskState = this._onDidChangeTaskState.event;

    public registerTask(task: Task): void {
        if (this.tasks.has(task.id)) {
            throw new Error(vscode.l10n.t('Task with ID {0} already exists', task.id));
        } // Subscribe to task events and aggregate them
        const subscriptions: vscode.Disposable[] = [
            task.onDidChangeStatus((status) => {
                this._onDidChangeTaskStatus.fire({ taskId: task.id, status });
            }),
            task.onDidChangeState((e) => {
                this._onDidChangeTaskState.fire(e);
            }),
        ];

        this.tasks.set(task.id, task);
        this.taskSubscriptions.set(task.id, subscriptions); // Notify listeners about the new task
        this._onDidRegisterTask.fire(task);
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
            subscriptions.forEach((sub) => {
                sub.dispose(); // Explicitly ignore the return value
            });
            this.taskSubscriptions.delete(id);
        }

        // Delete the task (this will stop it if needed)
        await task.delete();
        this.tasks.delete(id); // Notify listeners
        this._onDidDeleteTask.fire(id);
    }

    public getConflictingTasks(resource: ResourceDefinition): TaskInfo[] {
        const conflictingTasks: TaskInfo[] = [];

        // Only check tasks that are not in final states
        const activeTasks = Array.from(this.tasks.values()).filter((task) => {
            const status = task.getStatus();
            return ![TaskState.Completed, TaskState.Failed, TaskState.Stopped].includes(status.state);
        });

        for (const task of activeTasks) {
            // Check if task implements resource tracking
            if ('getUsedResources' in task && typeof (task as ResourceTrackingTask).getUsedResources === 'function') {
                const usedResources = (task as ResourceTrackingTask).getUsedResources();

                // Check if any of the task's resources conflict with the requested resource
                const hasConflict = usedResources.some((usedResource) => hasResourceConflict(resource, usedResource));

                if (hasConflict) {
                    conflictingTasks.push({
                        taskId: task.id,
                        taskName: task.name,
                        taskType: task.type,
                    });
                }
            }
        }

        return conflictingTasks;
    }

    public getAllUsedResources(): Array<{ task: TaskInfo; resources: ResourceDefinition[] }> {
        const result: Array<{ task: TaskInfo; resources: ResourceDefinition[] }> = [];

        // Only include tasks that are not in final states
        const activeTasks = Array.from(this.tasks.values()).filter((task) => {
            const status = task.getStatus();
            return ![TaskState.Completed, TaskState.Failed, TaskState.Stopped].includes(status.state);
        });

        for (const task of activeTasks) {
            // Check if task implements resource tracking
            if ('getUsedResources' in task && typeof (task as ResourceTrackingTask).getUsedResources === 'function') {
                const resources = (task as ResourceTrackingTask).getUsedResources();

                if (resources.length > 0) {
                    result.push({
                        task: {
                            taskId: task.id,
                            taskName: task.name,
                            taskType: task.type,
                        },
                        resources,
                    });
                }
            }
        }

        return result;
    }

    public findConflictingTasksForConnections(clusterIds: string[]): TaskInfo[] {
        if (clusterIds.length === 0) {
            return [];
        }

        const clusterIdSet = new Set(clusterIds);
        const conflictingTasks: TaskInfo[] = [];
        const addedTaskIds = new Set<string>();

        const allUsedResources = this.getAllUsedResources();
        for (const { task, resources } of allUsedResources) {
            if (addedTaskIds.has(task.taskId)) {
                continue;
            }

            for (const resource of resources) {
                if (resource.clusterId && clusterIdSet.has(resource.clusterId)) {
                    conflictingTasks.push(task);
                    addedTaskIds.add(task.taskId);
                    break;
                }
            }
        }

        return conflictingTasks;
    }
}

/**
 * Singleton instance of the TaskService for managing long-running tasks.
 */
export const TaskService = new TaskServiceImpl();
