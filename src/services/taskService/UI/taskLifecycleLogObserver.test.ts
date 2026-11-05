/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Disposable } from '../events';
import { type TaskLogger } from '../taskHost';
import { Task, TaskService, TaskState } from '../taskService';
import { attachTaskLifecycleLogger } from './taskLifecycleLogObserver';

class HostTestTask extends Task {
    public readonly type = 'host-test';
    public readonly name = 'Host Task';

    constructor(private readonly work: (signal: AbortSignal) => Promise<void> = async (): Promise<void> => {}) {
        super();
    }

    protected doWork(signal: AbortSignal): Promise<void> {
        return this.work(signal);
    }
}

describe('Task lifecycle log observer', () => {
    let logger: TaskLogger;
    let subscription: Disposable;

    beforeEach(() => {
        logger = {
            appendLine: vi.fn(),
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        };
        subscription = attachTaskLifecycleLogger(TaskService, logger);
    });

    afterEach(async () => {
        subscription.dispose();
        for (const task of TaskService.listTasks()) {
            await TaskService.deleteTask(task.id);
        }
    });

    it('writes initialization, execution and completion lifecycle lines to the logger', async () => {
        const task = new HostTestTask();
        TaskService.registerTask(task);

        await task.start();
        await vi.waitFor(() => {
            expect(task.getStatus().state).toBe(TaskState.Completed);
        });

        expect(logger.appendLine).toHaveBeenNthCalledWith(1, "○ Task 'Host Task' initializing...");
        expect(logger.appendLine).toHaveBeenNthCalledWith(2, "► Task 'Host Task' starting...");
        expect(logger.appendLine).toHaveBeenNthCalledWith(
            3,
            "✓ Task 'Host Task' completed successfully. Task completed successfully",
        );
        expect(logger.appendLine).toHaveBeenCalledTimes(3);
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('writes the failure lifecycle line through the logger error method', async () => {
        const task = new HostTestTask(async (): Promise<void> => {
            throw new Error('expected failure');
        });
        TaskService.registerTask(task);

        await task.start();
        await vi.waitFor(() => {
            expect(task.getStatus().state).toBe(TaskState.Failed);
        });

        expect(logger.error).toHaveBeenCalledExactlyOnceWith(
            "! Task 'Host Task' failed. Task failed Error: expected failure",
        );
    });

    it('writes the stopped lifecycle line to the logger', async () => {
        const task = new HostTestTask(
            (signal: AbortSignal): Promise<void> =>
                new Promise((resolve) => {
                    signal.addEventListener('abort', (): void => resolve(), { once: true });
                }),
        );
        TaskService.registerTask(task);

        await task.start();
        task.stop();
        await vi.waitFor(() => {
            expect(task.getStatus().state).toBe(TaskState.Stopped);
        });

        expect(logger.appendLine).toHaveBeenLastCalledWith(
            "■ Task 'Host Task' was stopped. Task stopped. Stopping task...",
        );
        expect(logger.appendLine).toHaveBeenCalledTimes(3);
    });
});
