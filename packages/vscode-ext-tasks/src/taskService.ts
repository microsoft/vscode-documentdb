/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Disposable, type Event } from './events.js';
import {
    defaultTaskStrings,
    mergeStrings,
    type TaskLogger,
    type TaskOptions,
    type TaskStrings,
    type TaskTelemetryContext,
    type TaskTelemetryRunner,
} from './taskHost.js';
import {
    hasResourceConflict,
    type ResourceDefinition,
    type ResourceTrackingTask,
    type TaskInfo,
} from './taskServiceResourceTracking.js';

const noopLogger: TaskLogger = {
    appendLine: (): void => {},
    trace: (): void => {},
    debug: (): void => {},
    info: (): void => {},
    warn: (): void => {},
    error: (): void => {},
};

const defaultTelemetryRunner: TaskTelemetryRunner = async <T>(
    _eventName: string,
    callback: (context: TaskTelemetryContext) => Promise<T>,
): Promise<T> => callback({ telemetry: { properties: {}, measurements: {} } });

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
 * Resolves when the task reaches a terminal state, including if it has already finished.
 */
export function whenTerminal(task: Task): Promise<void> {
    if (isTerminalState(task.getStatus().state)) {
        return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
        const subscription = task.onDidChangeState(({ newState }) => {
            if (isTerminalState(newState)) {
                subscription.dispose();
                resolve();
            }
        });
    });
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

    protected readonly logger: TaskLogger;
    private readonly telemetry: TaskTelemetryRunner;
    private readonly strings: TaskStrings;

    private _status: TaskStatus;
    private abortController: AbortController;

    // Event emitters for the events
    private readonly _onDidChangeState = new Emitter<TaskStateChangeEvent>();
    private readonly _onDidChangeStatus = new Emitter<TaskStatus>();

    /**
     * Event fired when the task's state changes (e.g., Running to Completed).
     * This event is guaranteed to capture all state transitions.
     */
    public readonly onDidChangeState: Event<TaskStateChangeEvent> = this._onDidChangeState.event;

    /**
     * Event fired on any status update, including progress changes.
     * This is a more granular event that includes all updates.
     */
    public readonly onDidChangeStatus: Event<TaskStatus> = this._onDidChangeStatus.event; /**
     * Creates a new Task instance with an auto-generated unique ID.
     */
    protected constructor(options?: TaskOptions) {
        this.logger = options?.logger ?? noopLogger;
        this.telemetry = options?.telemetry ?? defaultTelemetryRunner;
        this.strings = mergeStrings(defaultTaskStrings, options?.strings);
        this.id = crypto.randomUUID();
        this._status = {
            state: TaskState.Pending,
            progress: 0,
            message: this.strings.taskCreated,
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
     * The returned Promise resolves once initialization is over, not when the task completes.
     * An initialization failure does not reject it: the task ends as Failed, with the original
     * error in `status.error`, and `doWork` is never called. This holds for any telemetry runner,
     * including one that swallows the callback's error and resolves with `undefined`.
     *
     * @returns A Promise that resolves when initialization is over.
     * @throws Error if the task is not in a valid state to start.
     */
    public async start(): Promise<void> {
        if (this._status.state !== TaskState.Pending) {
            throw new Error(this.strings.cannotStartInState(this._status.state));
        }

        this.updateStatus(TaskState.Initializing, this.strings.initializingTask, 0);

        // Recorded inside the callback because the telemetry runner may swallow the error.
        let initializationFailed = false;
        let initializationError: unknown;

        try {
            // Allow subclasses to perform initialization with telemetry
            await this.telemetry('taskService.taskInitialization', async (context) => {
                // Add base task properties with task_ prefix
                context.telemetry.properties.task_id = this.id;
                context.telemetry.properties.task_type = this.type;
                context.telemetry.properties.task_name = this.name;
                context.telemetry.properties.task_phase = 'initialization';

                try {
                    await this.onInitialize?.(this.abortController.signal, context);
                } catch (error) {
                    initializationFailed = true;
                    initializationError = error;
                    // Rethrow so the runner records the failure in telemetry.
                    throw error;
                }

                // Record initialization completion
                context.telemetry.properties.task_initializationCompleted = 'true';
            });
        } catch (error) {
            // The runner rethrew: either the initialization error or its own failure.
            initializationFailed = true;
            initializationError ??= error;
        }

        if (initializationFailed) {
            // A stop request during initialization is cancellation, not failure: an abort-aware
            // onInitialize may reject after Stop, so finalize as Stopped without starting work.
            if (this.abortController.signal.aborted) {
                this.updateStatus(TaskState.Stopped, this.strings.stoppedDuringInitialization);
            } else {
                this.updateStatus(TaskState.Failed, this.strings.failedToInitializeTask, 0, initializationError);
            }
            return;
        }

        // Check if abort was requested during initialization
        if (this.abortController.signal.aborted) {
            this.updateStatus(TaskState.Stopping, this.strings.stoppedDuringInitialization);
            // Let runWork handle the final state transition
            void this.runWork().catch((error) => {
                if (!this.isFinalState()) {
                    this.updateStatus(TaskState.Failed, this.strings.taskFailed, 0, error);
                }
            });
            return;
        }

        this.updateStatus(TaskState.Running, this.strings.taskRunning, 0);

        // Start the actual work asynchronously
        void this.runWork().catch((error) => {
            if (!this.isFinalState()) {
                this.updateStatus(TaskState.Failed, this.strings.taskFailed, 0, error);
            }
        });
    }

    /**
     * Executes the main task work with proper error handling and state management.
     * This method is private to ensure proper lifecycle management.
     */
    private async runWork(): Promise<void> {
        await this.telemetry('taskService.taskExecution', async (context: TaskTelemetryContext) => {
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
                        ? this.strings.stoppedWithMessage(currentMessage)
                        : this.strings.taskStopped;
                    this.updateStatus(TaskState.Stopped, stoppedMessage);
                } else {
                    context.telemetry.properties.task_final_state = 'completed';
                    this.updateStatus(TaskState.Completed, this.strings.taskCompletedSuccessfully, 100);
                }
            } catch (error) {
                // Add error information to telemetry
                context.telemetry.properties.task_error = error instanceof Error ? error.message : 'Unknown error';

                // Determine final state based on abort status
                if (this.abortController.signal.aborted) {
                    context.telemetry.properties.task_final_state = 'stopped';
                    // Preserve current progress message to show what was accomplished before stopping
                    const currentMessage = this._status.message;
                    const stoppedMessage = currentMessage
                        ? this.strings.stoppedWithMessage(currentMessage)
                        : this.strings.taskStopped;
                    this.updateStatus(TaskState.Stopped, stoppedMessage);
                } else {
                    context.telemetry.properties.task_final_state = 'failed';
                    this.updateStatus(TaskState.Failed, this.strings.taskFailed, 0, error);
                }
                throw error;
            }
        });
    }

    /**
     * Requests a graceful stop of the task.
     * This method signals the task to stop via AbortSignal and updates the state accordingly.
     * An unstarted task stops immediately; otherwise initialization or work must finish first.
     *
     * This method returns immediately after signaling the stop request. The actual stopping
     * is handled asynchronously by the running task when it detects the abort signal.
     */
    public stop(): void {
        if (this.isFinalState()) {
            return;
        }
        const wasPending = this._status.state === TaskState.Pending;
        this.updateStatus(TaskState.Stopping, this.strings.stoppingTask);
        this.abortController.abort();

        if (wasPending && !this.isFinalState()) {
            this.updateStatus(TaskState.Stopped, this.strings.taskStopped);
        }
    }

    /**
     * Performs cleanup for the task.
     * This should be called when the task is no longer needed.
     * Cleanup does not wait for running work, but task events remain active until it stops.
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
        }
        void whenTerminal(this).then(() => {
            this._onDidChangeState.dispose();
            this._onDidChangeStatus.dispose();
        });
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
     * protected async doWork(signal: AbortSignal, context?: TaskTelemetryContext): Promise<void> {
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
    protected abstract doWork(signal: AbortSignal, context?: TaskTelemetryContext): Promise<void>;

    /**
     * Optional hook called during task initialization.
     * Override this to perform setup operations before the main work begins.
     *
     * @param signal AbortSignal that will be triggered when stop() is called.
     *               Check signal.aborted to exit initialization early if needed.
     * @param context Optional telemetry context for adding initialization-specific properties and measurements.
     *                Use natural domain names (no prefixes) for implementation-specific data.
     */
    protected onInitialize?(signal: AbortSignal, context?: TaskTelemetryContext): Promise<void>;

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
     * The registry also evicts old finished tasks on its own (see
     * {@link TaskServiceOptions.maxFinishedTasks}); this method stays public so that a caller,
     * such as a future task UI, can remove a task explicitly.
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
    readonly onDidRegisterTask: Event<Task>;

    /**
     * Event fired when a task is deleted.
     * The event provides the task ID that was deleted.
     */
    readonly onDidDeleteTask: Event<string>;

    /**
     * Event fired when any task's status changes.
     * This aggregates status changes from all registered tasks,
     * providing a single subscription point for monitoring all task activity.
     */
    readonly onDidChangeTaskStatus: Event<{ taskId: string; status: TaskStatus }>;

    /**
     * Event fired when a task's state changes.
     * This provides detailed information about the state transition.
     */
    readonly onDidChangeTaskState: Event<TaskStateChangeEvent>;

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
 * Default for {@link TaskServiceOptions.maxFinishedTasks}: how many finished tasks the registry keeps.
 */
export const DEFAULT_MAX_FINISHED_TASKS = 20;

/**
 * Options for {@link createTaskService}.
 */
export interface TaskServiceOptions {
    /** Overrides for the English default strings used in registry errors. */
    readonly strings?: Partial<TaskStrings>;

    /**
     * Maximum number of finished (Completed, Failed or Stopped) tasks kept registered.
     * When a new task registers, the oldest finished tasks beyond this number are deleted, which
     * fires `onDidDeleteTask`. Tasks that have not finished are never evicted, and a task is never
     * evicted while its terminal state change is still being delivered. Must be an integer >= 0;
     * 0 evicts every finished task at the next registration.
     *
     * @default DEFAULT_MAX_FINISHED_TASKS
     */
    readonly maxFinishedTasks?: number;
}

/**
 * Private implementation of TaskService that manages long-running task operations
 * within the extension.
 *
 * This implementation provides comprehensive event support for both individual
 * tasks and aggregated task monitoring.
 */
class TaskServiceImpl implements TaskService {
    private readonly strings: TaskStrings;
    private readonly maxFinishedTasks: number;
    private readonly tasks = new Map<string, Task>();
    private readonly taskSubscriptions = new Map<string, Disposable[]>();
    /** IDs of evictable finished tasks, oldest finished first (Set keeps insertion order). */
    private readonly finishedTaskIds = new Set<string>();

    // Event emitters for the service events
    private readonly _onDidRegisterTask = new Emitter<Task>();
    private readonly _onDidDeleteTask = new Emitter<string>();
    private readonly _onDidChangeTaskStatus = new Emitter<{ taskId: string; status: TaskStatus }>();
    private readonly _onDidChangeTaskState = new Emitter<TaskStateChangeEvent>();

    public readonly onDidRegisterTask = this._onDidRegisterTask.event;
    public readonly onDidDeleteTask = this._onDidDeleteTask.event;
    public readonly onDidChangeTaskStatus = this._onDidChangeTaskStatus.event;
    public readonly onDidChangeTaskState = this._onDidChangeTaskState.event;

    constructor(options?: TaskServiceOptions) {
        this.strings = mergeStrings(defaultTaskStrings, options?.strings);
        const maxFinishedTasks = options?.maxFinishedTasks ?? DEFAULT_MAX_FINISHED_TASKS;
        if (!Number.isInteger(maxFinishedTasks) || maxFinishedTasks < 0) {
            throw new RangeError(`maxFinishedTasks must be an integer >= 0, got ${String(maxFinishedTasks)}`);
        }
        this.maxFinishedTasks = maxFinishedTasks;
    }

    public registerTask(task: Task): void {
        if (this.tasks.has(task.id)) {
            throw new Error(this.strings.taskAlreadyExists(task.id));
        }

        // Evict before adding, so a task registered already finished is not evicted by its own registration.
        this.evictFinishedTasks();

        // Subscribe to task events and aggregate them
        const subscriptions: Disposable[] = [
            task.onDidChangeStatus((status) => {
                this._onDidChangeTaskStatus.fire({ taskId: task.id, status });
            }),
            task.onDidChangeState((e) => {
                // Schedule before forwarding: a listener may synchronously finish another task, whose
                // bookkeeping must queue after this one to keep the finish order.
                if (isTerminalState(e.newState)) {
                    this.markFinished(task);
                }
                this._onDidChangeTaskState.fire(e);
            }),
        ];

        this.tasks.set(task.id, task);
        this.taskSubscriptions.set(task.id, subscriptions);
        if (isTerminalState(task.getStatus().state)) {
            this.markFinished(task);
        }
        // Notify listeners about the new task
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
            throw new Error(this.strings.taskNotFound(id));
        }

        await this.removeTask(task);
    }

    /**
     * Removes the task from the registry synchronously, then awaits its cleanup and fires
     * `onDidDeleteTask`. Removing first keeps the registry consistent while `onDelete` runs.
     */
    private async removeTask(task: Task): Promise<void> {
        const id = task.id;
        this.taskSubscriptions.get(id)?.forEach((sub) => sub.dispose());
        this.taskSubscriptions.delete(id);
        this.finishedTaskIds.delete(id);
        this.tasks.delete(id);

        // Delete the task (this will stop it if needed); Task.delete() swallows onDelete errors
        await task.delete();
        this._onDidDeleteTask.fire(id);
    }

    /**
     * Makes a finished task evictable once the current synchronous event delivery is over.
     * Emitter delivery is synchronous, but a fire from inside a listener is queued until the outer
     * delivery has reached every listener, so returning from `fire()` does not mean the terminal
     * event was delivered. A microtask runs only after the whole delivery, including the task's own
     * direct listeners, so a listener that registers a new task cannot evict the finishing one.
     */
    private markFinished(task: Task): void {
        queueMicrotask(() => {
            if (this.tasks.get(task.id) === task) {
                this.finishedTaskIds.add(task.id);
            }
        });
    }

    /**
     * Evicts the oldest finished tasks until at most `maxFinishedTasks` remain.
     * Non-terminal tasks are never evicted.
     */
    private evictFinishedTasks(): void {
        for (const id of this.finishedTaskIds) {
            if (this.finishedTaskIds.size <= this.maxFinishedTasks) {
                return;
            }
            const task = this.tasks.get(id);
            if (!task) {
                this.finishedTaskIds.delete(id);
                continue;
            }
            // removeTask drops the entry synchronously; Task.delete() already swallows onDelete errors.
            void this.removeTask(task).catch(() => undefined);
        }
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
 * Creates a TaskService instance for managing long-running tasks.
 */
export function createTaskService(options?: TaskServiceOptions): TaskService {
    return new TaskServiceImpl(options);
}
