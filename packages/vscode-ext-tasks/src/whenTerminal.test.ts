/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { createTaskService, Task, TaskState, whenTerminal } from './taskService.js';

class TestTask extends Task {
    public readonly type = 'test';
    public readonly name = 'Test';

    public constructor() {
        super();
    }

    protected async doWork(): Promise<void> {}
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
    let resolve!: () => void;
    const promise = new Promise<void>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

describe('whenTerminal', () => {
    it('waits for a terminal state and disposes its subscription', async () => {
        const task = new TestTask();
        const event = task.onDidChangeState;
        const dispose = vi.fn();
        vi.spyOn(task, 'onDidChangeState').mockImplementation((listener, thisArgs, disposables) => {
            const subscription = event(listener, thisArgs, disposables);
            return {
                dispose: (): void => {
                    dispose();
                    subscription.dispose();
                },
            };
        });

        const terminal = whenTerminal(task);
        await task.start();
        await terminal;

        expect(task.getStatus().state).toBe(TaskState.Completed);
        expect(dispose).toHaveBeenCalledOnce();
    });

    it('resolves without subscribing if the task is already terminal', async () => {
        const task = new TestTask();
        const firstWait = whenTerminal(task);
        await task.start();
        await firstWait;
        const subscribe = vi.spyOn(task, 'onDidChangeState');

        await expect(whenTerminal(task)).resolves.toBeUndefined();
        expect(subscribe).not.toHaveBeenCalled();
    });

    it('preserves waiters and task listeners when running work is deleted', async () => {
        const work = deferred();
        const cleanup = vi.fn();
        class RunningTask extends TestTask {
            protected override async doWork(): Promise<void> {
                await work.promise;
            }

            protected async onDelete(): Promise<void> {
                cleanup();
            }
        }

        const service = createTaskService();
        const task = new RunningTask();
        const states: TaskState[] = [];
        const statuses: TaskState[] = [];
        task.onDidChangeState(({ newState }) => states.push(newState));
        task.onDidChangeStatus(({ state }) => statuses.push(state));
        service.registerTask(task);
        await task.start();
        const resolved = vi.fn();
        const beforeDeletion = whenTerminal(task).then(resolved);

        await service.deleteTask(task.id);
        expect(service.getTask(task.id)).toBeUndefined();
        expect(cleanup).toHaveBeenCalledOnce();
        expect(task.getStatus().state).toBe(TaskState.Stopping);
        expect(resolved).not.toHaveBeenCalled();

        const afterDeletion = whenTerminal(task);
        work.resolve();
        await afterDeletion;
        expect(resolved).toHaveBeenCalledOnce();
        await beforeDeletion;
        expect(task.getStatus().state).toBe(TaskState.Stopped);
        expect(states).toEqual([TaskState.Initializing, TaskState.Running, TaskState.Stopping, TaskState.Stopped]);
        expect(statuses).toContain(TaskState.Stopped);
    });

    it('preserves waiters when a deleted task stops during initialization', async () => {
        const initialization = deferred();
        class InitializingTask extends TestTask {
            protected async onInitialize(): Promise<void> {
                await initialization.promise;
                throw new Error('Initialization interrupted');
            }
        }

        const service = createTaskService();
        const task = new InitializingTask();
        service.registerTask(task);
        const start = task.start();
        const resolved = vi.fn();
        const terminal = whenTerminal(task).then(resolved);

        await service.deleteTask(task.id);
        expect(task.getStatus().state).toBe(TaskState.Stopping);
        expect(resolved).not.toHaveBeenCalled();
        initialization.resolve();
        await start;
        await Promise.resolve();

        expect(task.getStatus().state).toBe(TaskState.Stopped);
        expect(resolved).toHaveBeenCalledOnce();
        await terminal;
    });

    it('reaches a terminal state when an unstarted task is deleted', async () => {
        const service = createTaskService();
        const task = new TestTask();
        service.registerTask(task);
        const terminal = whenTerminal(task);

        await service.deleteTask(task.id);

        expect(task.getStatus().state).toBe(TaskState.Stopped);
        await terminal;
    });

    it('reaches a terminal state when an unstarted task is stopped', async () => {
        const task = new TestTask();
        const terminal = whenTerminal(task);

        task.stop();

        expect(task.getStatus().state).toBe(TaskState.Stopped);
        await terminal;
    });
});
