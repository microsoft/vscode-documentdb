/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DummyTask } from './DummyTask';
import { TaskState } from './taskService';

describe('DummyTask', () => {
    let task: DummyTask;

    beforeEach(() => {
        // Use very short delays for testing (1ms per step, 5 steps = 5ms total)
        task = new DummyTask(1, 5);
    });

    afterEach(() => {
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
            const result = await task.execute();

            expect(result.success).toBe(true);
            expect(result.data).toBe('Dummy task completed successfully!');
            expect(result.finalState).toBe(TaskState.Completed);
            expect(task.state).toBe(TaskState.Completed);
            expect(task.progress).toBe(100);
        });

        it('should report progress updates during execution', async () => {
            const progressCallback = jest.fn();
            const stateChangeCallback = jest.fn();

            const result = await task.execute({
                onProgress: progressCallback,
                onStateChange: stateChangeCallback,
            });

            expect(result.success).toBe(true);

            // Check that we got the starting progress call
            expect(progressCallback).toHaveBeenCalledWith({
                percentage: 0,
                message: 'Starting dummy task...',
                increment: 0,
            });

            // Should have been called for initial + 5 steps + final completion message
            expect(progressCallback).toHaveBeenCalledTimes(7);

            // Verify state changes
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Running);
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Completed);
            expect(stateChangeCallback).toHaveBeenCalledTimes(2);

            // Check progress increments
            expect(progressCallback).toHaveBeenCalledWith({
                percentage: 20,
                message: expect.stringContaining('step 1 of 5'),
                increment: 20,
            });
            expect(progressCallback).toHaveBeenCalledWith({
                percentage: 100,
                message: 'Dummy task completed successfully!',
                increment: 0,
            });
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

            // Start the task and abort it during execution
            const executePromise = task.execute({
                abortSignal: controller.signal,
                onStateChange: stateChangeCallback,
            });

            // Abort after a short delay to let the task start
            setTimeout(() => controller.abort(), 2);

            const result = await executePromise;

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Task was aborted');
            expect(result.finalState).toBe(TaskState.Aborted);
            expect(task.state).toBe(TaskState.Aborted);
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Aborted);
        });

        it('should throw error if already running', async () => {
            const executePromise1 = task.execute();

            await expect(task.execute()).rejects.toThrow('Task is already running');

            // Clean up the first execution
            await executePromise1;
        });

        it('should report initial progress message', () => {
            const progressCallback = jest.fn();

            task.execute({
                onProgress: progressCallback,
            });

            // Initial progress should be reported immediately
            expect(progressCallback).toHaveBeenCalledWith({
                percentage: 0,
                message: 'Starting dummy task...',
                increment: 0,
            });
        });

        it('should maintain progress state between calls', async () => {
            // First execution
            await task.execute();

            expect(task.progress).toBe(100);
            expect(task.state).toBe(TaskState.Completed);

            // Second execution should reset progress
            const executePromise2 = task.execute();
            expect(task.state).toBe(TaskState.Running);
            expect(task.progress).toBe(0);

            await executePromise2;
        });

        it('should handle different step counts', async () => {
            const taskWith3Steps = new DummyTask(1, 3);
            const progressCallback = jest.fn();

            const result = await taskWith3Steps.execute({
                onProgress: progressCallback,
            });

            expect(result.success).toBe(true);
            expect(taskWith3Steps.progress).toBe(100);

            // Should have initial + 3 steps + final = 5 calls
            expect(progressCallback).toHaveBeenCalledTimes(5);

            // Check that progress increments correctly (33.33%, 66.67%, 100%)
            expect(progressCallback).toHaveBeenCalledWith({
                percentage: expect.closeTo(33.33, 1),
                message: expect.stringContaining('step 1 of 3'),
                increment: expect.any(Number),
            });
        });
    });
});