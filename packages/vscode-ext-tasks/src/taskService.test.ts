/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type TaskLogger, type TaskOptions, type TaskTelemetryContext, type TaskTelemetryRunner } from './taskHost.js';
import { createTaskService, isTerminalState, Task, TaskState, type TaskStatus } from './taskService.js';

const TaskService = createTaskService();

/**
 * Simple test task implementation
 */
class TestTask extends Task {
    public readonly type = 'test';
    public readonly name: string;
    private readonly workSteps: number;
    private readonly stepDuration: number;
    private readonly shouldFail: boolean;
    private readonly failAtStep?: number;

    constructor(
        name: string,
        options: {
            workSteps?: number;
            stepDuration?: number;
            shouldFail?: boolean;
            failAtStep?: number;
        } = {},
    ) {
        super();
        this.name = name;
        this.workSteps = options.workSteps ?? 5;
        this.stepDuration = options.stepDuration ?? 20;
        this.shouldFail = options.shouldFail ?? false;
        this.failAtStep = options.failAtStep;
    }

    protected async doWork(signal: AbortSignal): Promise<void> {
        for (let i = 0; i < this.workSteps; i++) {
            if (signal.aborted) {
                return;
            }

            if (this.shouldFail && i === (this.failAtStep ?? Math.floor(this.workSteps / 2))) {
                throw new Error('Task failed as expected');
            }

            await new Promise((resolve) => setTimeout(resolve, this.stepDuration));

            const progress = ((i + 1) / this.workSteps) * 100;
            this.updateProgress(progress, `Step ${i + 1} of ${this.workSteps}`);
        }
    }
}

/**
 * Helper function to wait for a task to reach a terminal state (Completed, Failed, or Stopped).
 * This is more reliable than fixed timeouts, especially when running tests in parallel.
 */
function waitForTaskCompletion(task: Task, timeoutMs: number = 5000): Promise<TaskStatus> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Task did not complete within ${timeoutMs}ms. Current state: ${task.getStatus().state}`));
        }, timeoutMs);

        const checkStatus = (status: TaskStatus): void => {
            if (
                status.state === TaskState.Completed ||
                status.state === TaskState.Failed ||
                status.state === TaskState.Stopped
            ) {
                clearTimeout(timeout);
                resolve(status);
            }
        };

        // Check if already in terminal state
        const currentStatus = task.getStatus();
        if (
            currentStatus.state === TaskState.Completed ||
            currentStatus.state === TaskState.Failed ||
            currentStatus.state === TaskState.Stopped
        ) {
            clearTimeout(timeout);
            resolve(currentStatus);
            return;
        }

        // Listen for status changes
        task.onDidChangeStatus(checkStatus);
    });
}

describe('TaskService', () => {
    let taskService: typeof TaskService;

    beforeEach(() => {
        // Clear the service state between tests
        taskService = TaskService;
        // Clear any existing tasks
        taskService.listTasks().forEach((task) => {
            void taskService.deleteTask(task.id);
        });
    });

    it('should register and retrieve tasks', () => {
        const task = new TestTask('My Task');

        taskService.registerTask(task);

        expect(taskService.getTask(task.id)).toBe(task);
        expect(taskService.listTasks()).toContain(task);
    });

    it('should not share registered tasks between service instances', () => {
        const firstService = createTaskService();
        const secondService = createTaskService();
        const task = new TestTask('Isolated Task');

        firstService.registerTask(task);

        expect(firstService.getTask(task.id)).toBe(task);
        expect(secondService.getTask(task.id)).toBeUndefined();
        expect(secondService.listTasks()).toEqual([]);
    });

    it('should track task progress and state transitions in correct order', async () => {
        const task = new TestTask('Progress Task', { workSteps: 5, stepDuration: 10 });
        taskService.registerTask(task);

        const states: TaskState[] = [];
        const progressUpdates: number[] = [];

        task.onDidChangeStatus((status) => {
            states.push(status.state);
            if (status.progress !== undefined && status.state === TaskState.Running) {
                progressUpdates.push(status.progress);
            }
        });

        await task.start();

        // Wait for task to actually complete instead of using fixed timeout
        await waitForTaskCompletion(task);

        // Verify state transitions
        expect(states).toEqual([
            'Initializing',
            'Running',
            'Running',
            'Running',
            'Running',
            'Running',
            'Running',
            'Completed',
        ]);

        // Verify progress increases
        expect(progressUpdates).toEqual([0, 20, 40, 60, 80, 100]);
    });

    it('delivers state changes in order when a listener stops the task on Running', async () => {
        const task = new TestTask('Reentrant Stop Task', { workSteps: 1, stepDuration: 5 });
        const observed: TaskState[] = [];
        task.onDidChangeState((event) => {
            if (event.newState === TaskState.Running) {
                task.stop();
            }
        });
        task.onDidChangeState((event) => observed.push(event.newState));

        await task.start();
        await waitForTaskCompletion(task);

        expect(observed).toEqual([TaskState.Initializing, TaskState.Running, TaskState.Stopping, TaskState.Stopped]);
    });

    it('should handle task failure with error message', async () => {
        const task = new TestTask('Failing Task', {
            shouldFail: true,
            failAtStep: 1,
            workSteps: 3,
            stepDuration: 10,
        });
        taskService.registerTask(task);

        const states: TaskState[] = [];
        let finalStatus: TaskStatus | undefined;

        task.onDidChangeStatus((status) => {
            states.push(status.state);
            if (status.state === TaskState.Failed) {
                finalStatus = status;
            }
        });

        await task.start();

        // Wait for task to fail instead of using fixed timeout
        await waitForTaskCompletion(task);

        // Verify state transitions
        expect(states).toContain(TaskState.Initializing);
        expect(states).toContain(TaskState.Running);
        expect(states).toContain(TaskState.Failed);
        expect(states).not.toContain(TaskState.Completed);

        // Verify error details
        expect(finalStatus?.error).toBeInstanceOf(Error);
        expect((finalStatus?.error as Error).message).toBe('Task failed as expected');
    });

    it('should handle task abortion correctly', async () => {
        const task = new TestTask('Long Task', {
            workSteps: 10,
            stepDuration: 50,
        });
        taskService.registerTask(task);

        const states: TaskState[] = [];

        task.onDidChangeStatus((status) => {
            states.push(status.state);
        });

        await task.start();

        // Wait for task to be running - poll until we see the Running state
        await new Promise<void>((resolve) => {
            const checkRunning = (): void => {
                if (states.includes(TaskState.Running)) {
                    resolve();
                } else {
                    setTimeout(checkRunning, 10);
                }
            };
            checkRunning();
        });

        // Stop the task
        task.stop();

        // Wait for the task to reach terminal state
        await waitForTaskCompletion(task);

        // Get the final state
        const finalStatus = task.getStatus();

        // Verify state transitions
        expect(states).toContain(TaskState.Initializing);
        expect(states).toContain(TaskState.Running);
        expect(states).toContain(TaskState.Stopping);
        expect(states).toContain(TaskState.Stopped);

        // Verify final state
        expect(finalStatus.state).toBe(TaskState.Stopped);

        // Verify it didn't complete
        expect(states).not.toContain(TaskState.Completed);
        expect(states).not.toContain(TaskState.Failed);
    });

    it('should aggregate task events through TaskService', async () => {
        const task1 = new TestTask('Task 1', { workSteps: 2, stepDuration: 10 });
        const task2 = new TestTask('Task 2', { workSteps: 2, stepDuration: 10 });

        taskService.registerTask(task1);
        taskService.registerTask(task2);

        const serviceStatusUpdates: Array<{ taskId: string; state: TaskState }> = [];

        taskService.onDidChangeTaskStatus(({ taskId, status }) => {
            serviceStatusUpdates.push({ taskId, state: status.state });
        });

        // Start both tasks
        await task1.start();
        await task2.start();

        // Wait for both tasks to complete
        await Promise.all([waitForTaskCompletion(task1), waitForTaskCompletion(task2)]);

        // Verify we received updates from both tasks
        const task1Updates = serviceStatusUpdates.filter((u) => u.taskId === task1.id);
        const task2Updates = serviceStatusUpdates.filter((u) => u.taskId === task2.id);

        expect(task1Updates.length).toBeGreaterThan(0);
        expect(task2Updates.length).toBeGreaterThan(0);

        // Verify both completed
        expect(task1Updates[task1Updates.length - 1].state).toBe(TaskState.Completed);
        expect(task2Updates[task2Updates.length - 1].state).toBe(TaskState.Completed);
    });

    it('should emit events when tasks are registered and deleted', async () => {
        const task = new TestTask('Event Task');

        const registeredTasks: Task[] = [];
        const deletedTaskIds: string[] = [];

        taskService.onDidRegisterTask((t) => registeredTasks.push(t));
        taskService.onDidDeleteTask((id) => deletedTaskIds.push(id));

        // Register task
        taskService.registerTask(task);
        expect(registeredTasks).toContain(task);

        // Delete task
        await taskService.deleteTask(task.id);
        expect(deletedTaskIds).toContain(task.id);

        // Verify task is gone
        expect(taskService.getTask(task.id)).toBeUndefined();
    });

    it('should stop running task when deleted', async () => {
        const task = new TestTask('Delete Running Task', {
            workSteps: 10,
            stepDuration: 50,
        });
        taskService.registerTask(task);

        const states: TaskState[] = [];
        task.onDidChangeStatus((status) => states.push(status.state));

        await task.start();

        // Wait for task to be running - poll until we see the Running state
        await new Promise<void>((resolve) => {
            const checkRunning = (): void => {
                if (states.includes(TaskState.Running)) {
                    resolve();
                } else {
                    setTimeout(checkRunning, 10);
                }
            };
            checkRunning();
        });

        // Delete the running task
        await taskService.deleteTask(task.id);

        // Verify task was stopped
        expect(states).toContain(TaskState.Stopping);

        // Wait for task to reach terminal state
        await waitForTaskCompletion(task);

        expect(task.getStatus().state).toBe(TaskState.Stopped);
    });
});

describe('TaskService retention of finished tasks', () => {
    const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

    async function finish(task: Task): Promise<void> {
        await task.start();
        await waitForTaskCompletion(task);
        await flush();
    }

    it('evicts the oldest-finished task beyond the limit when a new task registers', async () => {
        const service = createTaskService({ maxFinishedTasks: 1 });
        const deleted: string[] = [];
        service.onDidDeleteTask((id) => deleted.push(id));
        const first = new TestTask('first', { workSteps: 0 });
        const second = new TestTask('second', { workSteps: 0 });
        service.registerTask(first);
        service.registerTask(second);

        // Finish in the opposite order of registration: eviction follows finish order.
        await finish(second);
        await finish(first);
        expect(service.listTasks()).toHaveLength(2);

        const next = new TestTask('next');
        service.registerTask(next);
        await flush();

        expect(service.getTask(second.id)).toBeUndefined();
        expect(service.getTask(first.id)).toBe(first);
        expect(service.getTask(next.id)).toBe(next);
        expect(deleted).toEqual([second.id]);
    });

    it('with a limit of 0 evicts every finished task at the next registration, but never unfinished ones', async () => {
        const service = createTaskService({ maxFinishedTasks: 0 });
        const pending = new TestTask('pending');
        const running = new TestTask('running', { workSteps: 50, stepDuration: 20 });
        const done = [new TestTask('done 1', { workSteps: 0 }), new TestTask('done 2', { workSteps: 0 })];
        for (const task of [pending, running, ...done]) {
            service.registerTask(task);
        }
        await Promise.all(done.map(finish));
        await running.start();

        service.registerTask(new TestTask('next'));

        expect(service.listTasks().map((task) => task.name)).toEqual(['pending', 'running', 'next']);
        running.stop();
        await waitForTaskCompletion(running);
    });

    it('does not evict a task while its terminal state change is being delivered', async () => {
        const service = createTaskService({ maxFinishedTasks: 0 });
        const task = new TestTask('finishing', { workSteps: 0 });
        service.registerTask(task);
        const lookups: Array<Task | undefined> = [];
        const isTerminalEventOfTask = (e: { taskId: string; newState: TaskState }): boolean =>
            e.taskId === task.id && isTerminalState(e.newState);
        service.onDidChangeTaskState((e) => {
            if (isTerminalEventOfTask(e)) {
                service.registerTask(new TestTask('registered from a service listener'));
                lookups.push(service.getTask(task.id));
            }
        });
        // Direct task listeners run after the registry's own subscription has returned.
        task.onDidChangeState((e) => {
            if (isTerminalEventOfTask(e)) {
                service.registerTask(new TestTask('registered from a task listener'));
            }
        });
        task.onDidChangeState((e) => {
            if (isTerminalEventOfTask(e)) {
                lookups.push(service.getTask(task.id));
            }
        });

        await finish(task);

        expect(lookups).toEqual([task, task]);
        service.registerTask(new TestTask('later'));
        expect(service.getTask(task.id)).toBeUndefined();
    });

    it('keeps finish order when a terminal-state listener synchronously finishes another task', async () => {
        class SyncFinishTask extends TestTask {
            public finishNow(): void {
                this.updateStatus(TaskState.Completed);
            }
        }
        const service = createTaskService({ maxFinishedTasks: 1 });
        const first = new SyncFinishTask('first');
        const second = new SyncFinishTask('second');
        service.registerTask(first);
        service.registerTask(second);
        service.onDidChangeTaskState((e) => {
            if (e.taskId === first.id && isTerminalState(e.newState)) {
                second.finishNow();
            }
        });

        first.finishNow();
        await flush();
        service.registerTask(new TestTask('next'));

        expect(service.getTask(first.id)).toBeUndefined();
        expect(service.getTask(second.id)).toBe(second);
    });

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects maxFinishedTasks = %s', (value) => {
        expect(() => createTaskService({ maxFinishedTasks: value })).toThrow(RangeError);
    });
});

describe('Task host options', () => {
    class HostTestTask extends Task {
        public readonly type = 'host-test';
        public readonly name = 'Host Task';

        constructor(
            options?: TaskOptions,
            private readonly work: (signal: AbortSignal) => Promise<void> = async (): Promise<void> => {},
        ) {
            super(options);
        }

        protected doWork(signal: AbortSignal): Promise<void> {
            return this.work(signal);
        }
    }

    function createLogger(): TaskLogger {
        return {
            appendLine: vi.fn(),
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
    }

    it.each([TaskState.Initializing, TaskState.Running])(
        'preserves one Stopped notification when default-runner work rejects after stopping in %s',
        async (stopState) => {
            const error = new Error('Work aborted');
            const task = new HostTestTask(
                undefined,
                (signal: AbortSignal): Promise<void> =>
                    new Promise((_resolve, reject) => {
                        if (signal.aborted) {
                            reject(error);
                            return;
                        }
                        signal.addEventListener('abort', (): void => reject(error), { once: true });
                    }),
            );
            const terminalStatuses: TaskStatus[] = [];
            task.onDidChangeStatus((status) => {
                if (isTerminalState(status.state)) {
                    terminalStatuses.push(status);
                }
                if (stopState === TaskState.Initializing && status.state === TaskState.Initializing) {
                    task.stop();
                }
            });

            await task.start();
            if (stopState === TaskState.Running) {
                task.stop();
            }
            await waitForTaskCompletion(task);
            await new Promise<void>((resolve) => setImmediate(resolve));

            expect(task.getStatus().state).toBe(TaskState.Stopped);
            expect(terminalStatuses.map((status) => status.state)).toEqual([TaskState.Stopped]);
        },
    );

    it('emits Failed once with the original error when default-runner work rejects', async () => {
        const error = new Error('Work failed');
        const task = new HostTestTask(undefined, async (): Promise<void> => {
            throw error;
        });
        const terminalStatuses: TaskStatus[] = [];
        task.onDidChangeStatus((status) => {
            if (isTerminalState(status.state)) {
                terminalStatuses.push(status);
            }
        });

        await task.start();
        await waitForTaskCompletion(task);
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(task.getStatus().state).toBe(TaskState.Failed);
        expect(task.getStatus().error).toBe(error);
        expect(terminalStatuses).toHaveLength(1);
        expect(terminalStatuses[0].error).toBe(error);
    });

    it('keeps default strings for explicitly undefined overrides', async () => {
        const task = new HostTestTask(
            { strings: { stoppedWithMessage: undefined, taskStopped: undefined } },
            (signal: AbortSignal): Promise<void> =>
                new Promise((resolve) => {
                    signal.addEventListener('abort', (): void => resolve(), { once: true });
                }),
        );
        const registry = createTaskService({ strings: { taskAlreadyExists: undefined } });
        registry.registerTask(task);

        await task.start();
        task.stop();
        await waitForTaskCompletion(task);

        expect(task.getStatus()).toMatchObject({ state: TaskState.Stopped, message: 'Task stopped. Stopping task...' });
        expect(() => registry.registerTask(task)).toThrow(`Task with ID ${task.id} already exists`);
    });

    it('finalizes as Stopped without starting work when initialization rejects after Stop', async () => {
        const work = vi.fn(async (): Promise<void> => {});
        class AbortAwareInitTask extends HostTestTask {
            protected onInitialize(signal: AbortSignal): Promise<void> {
                return new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', (): void => reject(new Error('Initialization aborted')), {
                        once: true,
                    });
                });
            }
        }
        const task = new AbortAwareInitTask(undefined, work);
        const states: TaskState[] = [];
        task.onDidChangeState((event) => states.push(event.newState));

        const start = task.start();
        task.stop();
        await expect(start).resolves.toBeUndefined();

        expect(states).toEqual([TaskState.Initializing, TaskState.Stopping, TaskState.Stopped]);
        expect(task.getStatus().error).toBeUndefined();
        expect(work).not.toHaveBeenCalled();
    });

    // Mimics callWithTelemetryAndErrorHandling: records the failure, then resolves with undefined.
    const swallowingRunner: TaskTelemetryRunner = async <T>(
        _eventName: string,
        callback: (context: TaskTelemetryContext) => Promise<T>,
    ): Promise<T | undefined> => {
        try {
            return await callback({ telemetry: { properties: {}, measurements: {} } });
        } catch {
            return undefined;
        }
    };

    it.each([
        ['the default runner', undefined],
        ['a runner that swallows errors', swallowingRunner],
    ])('ends as Failed without running work when initialization rejects with %s', async (_name, telemetry) => {
        const error = new Error('Initialization failed');
        const work = vi.fn(async (): Promise<void> => {});
        class FailingInitTask extends HostTestTask {
            protected onInitialize(): Promise<void> {
                return Promise.reject(error);
            }
        }
        const task = new FailingInitTask({ telemetry }, work);
        const states: TaskState[] = [];
        task.onDidChangeState((event) => states.push(event.newState));

        await expect(task.start()).resolves.toBeUndefined();
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(states).toEqual([TaskState.Initializing, TaskState.Failed]);
        expect(task.getStatus()).toMatchObject({ state: TaskState.Failed, error });
        expect(work).not.toHaveBeenCalled();
    });

    it('finalizes as Stopped without starting work when initialization rejects after Stop with a swallowing runner', async () => {
        const work = vi.fn(async (): Promise<void> => {});
        class AbortAwareInitTask extends HostTestTask {
            protected onInitialize(signal: AbortSignal): Promise<void> {
                return new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', (): void => reject(new Error('Initialization aborted')), {
                        once: true,
                    });
                });
            }
        }
        const task = new AbortAwareInitTask({ telemetry: swallowingRunner }, work);
        const states: TaskState[] = [];
        task.onDidChangeState((event) => states.push(event.newState));

        const start = task.start();
        task.stop();
        await expect(start).resolves.toBeUndefined();

        expect(states).toEqual([TaskState.Initializing, TaskState.Stopping, TaskState.Stopped]);
        expect(task.getStatus().error).toBeUndefined();
        expect(work).not.toHaveBeenCalled();
    });

    it('fails when the telemetry runner throws before invoking the work callback', async () => {
        const error = new Error('Telemetry runner failed');
        const telemetry: TaskTelemetryRunner = async <T>(
            eventName: string,
            callback: (context: TaskTelemetryContext) => Promise<T>,
        ): Promise<T> => {
            if (eventName === 'taskService.taskExecution') {
                throw error;
            }
            return callback({ telemetry: { properties: {}, measurements: {} } });
        };
        const work = vi.fn(async (): Promise<void> => {});
        const task = new HostTestTask({ telemetry }, work);

        await task.start();
        await waitForTaskCompletion(task);

        expect(work).not.toHaveBeenCalled();
        expect(task.getStatus().state).toBe(TaskState.Failed);
        expect(task.getStatus().error).toBe(error);
    });

    it('does not write lifecycle lines to the injected logger', async () => {
        const logger = createLogger();
        const completedTask = new HostTestTask({ logger });
        const failedTask = new HostTestTask({ logger }, async (): Promise<void> => {
            throw new Error('expected failure');
        });
        const stoppedTask = new HostTestTask(
            { logger },
            (signal: AbortSignal): Promise<void> =>
                new Promise((resolve) => {
                    signal.addEventListener('abort', (): void => resolve(), { once: true });
                }),
        );

        await completedTask.start();
        await waitForTaskCompletion(completedTask);
        await failedTask.start();
        await waitForTaskCompletion(failedTask);
        await stoppedTask.start();
        stoppedTask.stop();
        await waitForTaskCompletion(stoppedTask);

        expect(logger.appendLine).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('uses the injected runner and populates its contexts with the unchanged task telemetry properties', async () => {
        const contexts: TaskTelemetryContext[] = [];
        const eventNames: string[] = [];
        const telemetry: TaskTelemetryRunner = async <T>(
            eventName: string,
            callback: (context: TaskTelemetryContext) => Promise<T>,
        ): Promise<T> => {
            const context: TaskTelemetryContext = { telemetry: { properties: {}, measurements: {} } };
            eventNames.push(eventName);
            contexts.push(context);
            return callback(context);
        };
        const task = new HostTestTask({ telemetry });

        await task.start();
        await waitForTaskCompletion(task);

        expect(eventNames).toEqual(['taskService.taskInitialization', 'taskService.taskExecution']);
        expect(contexts[0].telemetry.properties).toEqual({
            task_id: task.id,
            task_type: task.type,
            task_name: task.name,
            task_phase: 'initialization',
            task_initializationCompleted: 'true',
        });
        expect(contexts[1].telemetry.properties).toEqual({
            task_id: task.id,
            task_type: task.type,
            task_name: task.name,
            task_phase: 'execution',
            task_final_state: 'completed',
        });
    });

    it('merges injected partial strings with the English defaults', async () => {
        const task = new HostTestTask({
            strings: {
                taskCreated: 'Ready',
                taskCompletedSuccessfully: 'Finished',
                cannotStartInState: (state: string): string => `Already ${state}`,
            },
        });
        const messages: Array<string | undefined> = [];
        task.onDidChangeStatus((status) => messages.push(status.message));

        expect(task.getStatus().message).toBe('Ready');
        await task.start();
        await waitForTaskCompletion(task);

        expect(messages).toEqual(['Initializing task...', 'Task is running', 'Finished']);
        await expect(task.start()).rejects.toThrow('Already Completed');
    });
});
