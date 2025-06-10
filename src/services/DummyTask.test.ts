/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DummyTask } from './DummyTask';
import { TaskState } from './taskService';

describe('DummyTask', () => {
    let task: DummyTask;

    beforeEach(() => {
        task = new DummyTask();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    describe('initial state', () => {
        it('should have correct initial properties', () => {
            expect(task.id).toBe('dummy-task');
            expect(task.name).toBe('Dummy Task');
            expect(task.state).toBe(TaskState.NotStarted);
            expect(task.progress).toBe(0);
        });
    });

    describe('execute', () => {
        it('should complete successfully without options', async () => {
            const executePromise = task.execute();

            // Fast-forward through all timeouts
            jest.runAllTimers();

            const result = await executePromise;

            expect(result.success).toBe(true);
            expect(result.data).toBe('Dummy task completed successfully!');
            expect(result.finalState).toBe(TaskState.Completed);
            expect(task.state).toBe(TaskState.Completed);
            expect(task.progress).toBe(100);
        });

        it('should report progress updates during execution', async () => {
            const progressCallback = jest.fn();
            const stateChangeCallback = jest.fn();

            const executePromise = task.execute({
                onProgress: progressCallback,
                onStateChange: stateChangeCallback,
            });

            // Fast-forward through all timeouts
            jest.runAllTimers();
            await executePromise;

            // Check that we got the starting progress call
            expect(progressCallback).toHaveBeenCalledWith({
                percentage: 0,
                message: 'Starting dummy task...',
                increment: 0,
            });

            // Check that we got progress updates for each step (11 calls total: 1 start + 10 steps)
            expect(progressCallback).toHaveBeenCalledTimes(12); // start + 10 steps + final

            // Verify state changes
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Running);
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Completed);
            expect(stateChangeCallback).toHaveBeenCalledTimes(2);
        });

        it('should handle abort signal before execution starts', async () => {
            const controller = new AbortController();
            controller.abort();

            const result = await task.execute({
                abortSignal: controller.signal,
            });

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Task was aborted');
            expect(result.finalState).toBe(TaskState.Aborted);
            expect(task.state).toBe(TaskState.Aborted);
        });

        it('should handle abort signal during execution', async () => {
            const controller = new AbortController();
            const stateChangeCallback = jest.fn();

            const executePromise = task.execute({
                abortSignal: controller.signal,
                onStateChange: stateChangeCallback,
            });

            // Let the task run for a few steps then abort
            jest.advanceTimersByTime(3000);
            controller.abort();
            jest.runAllTimers();

            const result = await executePromise;

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Task was aborted');
            expect(result.finalState).toBe(TaskState.Aborted);
            expect(task.state).toBe(TaskState.Aborted);
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Aborted);
        });

        it('should handle abort signal during delay', async () => {
            const controller = new AbortController();

            const executePromise = task.execute({
                abortSignal: controller.signal,
            });

            // Start a step but abort during the delay
            jest.advanceTimersByTime(500);
            controller.abort();
            jest.runAllTimers();

            const result = await executePromise;

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Task was aborted');
            expect(result.finalState).toBe(TaskState.Aborted);
        });

        it('should throw error if already running', async () => {
            const executePromise1 = task.execute();

            await expect(task.execute()).rejects.toThrow('Task is already running');

            // Clean up the first execution
            jest.runAllTimers();
            await executePromise1;
        });

        it('should handle unexpected errors gracefully', async () => {
            // Mock setTimeout to throw an error
            const originalSetTimeout = global.setTimeout;
            global.setTimeout = jest.fn().mockImplementation(() => {
                throw new Error('Unexpected error');
            }) as any;

            const result = await task.execute();

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Unexpected error');
            expect(result.finalState).toBe(TaskState.Failed);
            expect(task.state).toBe(TaskState.Failed);

            // Restore original setTimeout
            global.setTimeout = originalSetTimeout;
        });

        it('should report initial progress message', async () => {
            const progressCallback = jest.fn();

            const executePromise = task.execute({
                onProgress: progressCallback,
            });

            // Initial progress should be reported immediately
            expect(progressCallback).toHaveBeenCalledWith({
                percentage: 0,
                message: 'Starting dummy task...',
                increment: 0,
            });

            jest.runAllTimers();
            await executePromise;
        });

        it('should maintain progress state between calls', async () => {
            // First execution
            const executePromise1 = task.execute();
            jest.runAllTimers();
            await executePromise1;

            expect(task.progress).toBe(100);
            expect(task.state).toBe(TaskState.Completed);

            // Second execution should reset progress
            const executePromise2 = task.execute();
            expect(task.state).toBe(TaskState.Running);
            expect(task.progress).toBe(0);

            jest.runAllTimers();
            await executePromise2;
        });
    });
});