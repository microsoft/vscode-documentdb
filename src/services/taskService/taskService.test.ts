/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Task, TaskService, TaskState, type TaskStatus } from './taskService';

// Mock extensionVariables (ext) module
jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: jest.fn(), // Mock appendLine as a no-op function
            error: jest.fn(),
            trace: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            info: jest.fn(),
            appendLog: jest.fn(),
            show: jest.fn(),
        },
    },
}));

// Mock @microsoft/vscode-azext-utils module
jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventName: string, callback: (context: any) => Promise<void>) => {
            // Mock telemetry context
            const mockContext = {
                telemetry: {
                    properties: {},
                    measurements: {},
                },
            };
            return await callback(mockContext);
        },
    ),
}));

// Mock vscode module
jest.mock('vscode', () => ({
    l10n: {
        t: (key: string, ...args: string[]): string => {
            return args.length > 0 ? `${key} ${args.join(' ')}` : key;
        },
    },
    ThemeIcon: jest.fn().mockImplementation((id: string) => ({
        id,
    })),
    EventEmitter: jest.fn().mockImplementation(() => {
        const listeners: Array<(...args: any[]) => void> = [];
        return {
            event: jest.fn((listener: (...args: any[]) => void) => {
                listeners.push(listener);
                return {
                    dispose: jest.fn(() => {
                        const index = listeners.indexOf(listener);
                        if (index > -1) {
                            listeners.splice(index, 1);
                        }
                    }),
                };
            }),
            fire: jest.fn((data: any) => {
                listeners.forEach((listener) => listener(data));
            }),
            dispose: jest.fn(),
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

describe('TaskService', () => {
    let taskService: typeof TaskService;

    beforeEach(() => {
        // Clear the singleton state between tests
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

        // Wait for completion
        await new Promise((resolve) => setTimeout(resolve, 100));

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

        // Wait for failure
        await new Promise((resolve) => setTimeout(resolve, 100));

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

        // Wait for task to be running and complete at least one step
        await new Promise((resolve) => setTimeout(resolve, 80));

        // Stop the task
        task.stop();

        // Wait for the task to process the abort signal
        await new Promise((resolve) => setTimeout(resolve, 100));

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

        // Wait for completion
        await new Promise((resolve) => setTimeout(resolve, 100));

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

        // Wait for task to be running
        await new Promise((resolve) => setTimeout(resolve, 30));

        // Delete the running task
        await taskService.deleteTask(task.id);

        // Verify task was stopped
        expect(states).toContain(TaskState.Stopping);

        // Wait for task to be stopped
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(task.getStatus().state).toBe(TaskState.Stopped);
    });
});
