/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type TaskLogger, type TaskOptions, type TaskTelemetryContext, type TaskTelemetryRunner } from './taskHost';
import { createTaskService, Task, TaskState, type TaskStatus } from './taskService';

const TaskService = createTaskService();

// Mock extensionVariables (ext) module
vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: vi.fn(), // Mock appendLine as a no-op function
            error: vi.fn(),
            trace: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            info: vi.fn(),
            appendLog: vi.fn(),
            show: vi.fn(),
        },
    },
}));

// Mock @microsoft/vscode-azext-utils module
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(async (_eventName: string, callback: (context: any) => Promise<void>) => {
        // Mock telemetry context
        const mockContext = {
            telemetry: {
                properties: {},
                measurements: {},
            },
            errorHandling: {
                suppressDisplay: false,
            },
        };
        return await callback(mockContext);
    }),
}));

// Mock vscode module
vi.mock('vscode', () => ({
    l10n: {
        t: (key: string, ...args: string[]): string => {
            return args.length > 0 ? `${key} ${args.join(' ')}` : key;
        },
    },
    ThemeIcon: vi.fn().mockImplementation(function (id: string) {
        return { id };
    }),
    EventEmitter: vi.fn().mockImplementation(function () {
        const listeners: Array<(...args: any[]) => void> = [];
        return {
            event: vi.fn((listener: (...args: any[]) => void) => {
                listeners.push(listener);
                return {
                    dispose: vi.fn(() => {
                        const index = listeners.indexOf(listener);
                        if (index > -1) {
                            listeners.splice(index, 1);
                        }
                    }),
                };
            }),
            fire: vi.fn((data: any) => {
                listeners.forEach((listener) => listener(data));
            }),
            dispose: vi.fn(),
        };
    }),
}));

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
