/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PausableTaskImpl } from './PausableTask';
import { TaskState } from './taskService';

describe('PausableTask', () => {
    let task: PausableTaskImpl;

    beforeEach(() => {
        // Use very short delays for testing (1ms per step, 5 steps = 5ms total)
        task = new PausableTaskImpl(1, 5);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('initial state', () => {
        it('should have correct initial properties', () => {
            expect(task.id).toBe('pausable-task');
            expect(task.name).toBe('Pausable Task');
            expect(task.state).toBe(TaskState.NotStarted);
            expect(task.progress).toBe(0);
            expect(task.canPause).toBe(false);
            expect(task.canResume).toBe(false);
        });
    });

    describe('pause and resume capabilities', () => {
        it('should allow pause only when running', async () => {
            expect(task.canPause).toBe(false);

            const executePromise = task.execute();
            // Allow task to start running
            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(task.canPause).toBe(true);
            expect(task.canResume).toBe(false);

            await executePromise;

            expect(task.canPause).toBe(false);
            expect(task.canResume).toBe(false);
        });

        it('should allow resume only when paused', async () => {
            const executePromise = task.execute();
            
            // Let task start then pause it
            await new Promise((resolve) => setTimeout(resolve, 2));
            task.pause();
            await new Promise((resolve) => setTimeout(resolve, 2));

            expect(task.state).toBe(TaskState.Paused);
            expect(task.canPause).toBe(false);
            expect(task.canResume).toBe(true);

            // Resume the task
            task.resume();
            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(task.state).toBe(TaskState.Running);
            expect(task.canPause).toBe(true);
            expect(task.canResume).toBe(false);

            await executePromise;
        });
    });

    describe('execute without pause/resume', () => {
        it('should complete successfully like a normal task', async () => {
            const result = await task.execute();

            expect(result.success).toBe(true);
            expect(result.data).toBe('Pausable task completed successfully!');
            expect(result.finalState).toBe(TaskState.Completed);
            expect(task.state).toBe(TaskState.Completed);
            expect(task.progress).toBe(100);
        });

        it('should handle abort signal', async () => {
            const controller = new AbortController();

            const executePromise = task.execute({
                abortSignal: controller.signal,
            });

            // Let task start then abort
            setTimeout(() => controller.abort(), 2);

            const result = await executePromise;

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Task was aborted');
            expect(result.finalState).toBe(TaskState.Aborted);
        });
    });

    describe('pause and resume functionality', () => {
        it('should pause and resume correctly', async () => {
            const progressCallback = jest.fn();
            const stateChangeCallback = jest.fn();

            const executePromise = task.execute({
                onProgress: progressCallback,
                onStateChange: stateChangeCallback,
            });

            // Let task run for a bit then pause
            await new Promise((resolve) => setTimeout(resolve, 2));
            
            task.pause();
            await new Promise((resolve) => setTimeout(resolve, 2));

            expect(task.state).toBe(TaskState.Paused);
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Paused);

            // Verify task doesn't progress while paused
            const pausedProgress = task.progress;
            await new Promise((resolve) => setTimeout(resolve, 5));
            expect(task.progress).toBe(pausedProgress);

            // Resume the task
            task.resume();
            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(task.state).toBe(TaskState.Running);
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Running);

            await executePromise;

            expect(task.state).toBe(TaskState.Completed);
            expect(task.progress).toBe(100);
        });

        it('should handle multiple pause/resume cycles', async () => {
            // Use a task with more steps for more realistic testing
            const longTask = new PausableTaskImpl(2, 10);
            const stateChangeCallback = jest.fn();
            const executePromise = longTask.execute({
                onStateChange: stateChangeCallback,
            });

            // First pause/resume cycle
            await new Promise((resolve) => setTimeout(resolve, 3));
            longTask.pause();
            await new Promise((resolve) => setTimeout(resolve, 2));
            expect(longTask.state).toBe(TaskState.Paused);

            longTask.resume();
            await new Promise((resolve) => setTimeout(resolve, 2));
            expect(longTask.state).toBe(TaskState.Running);

            // Second pause/resume cycle
            longTask.pause();
            await new Promise((resolve) => setTimeout(resolve, 2));
            expect(longTask.state).toBe(TaskState.Paused);

            longTask.resume();
            await new Promise((resolve) => setTimeout(resolve, 2));
            expect(longTask.state).toBe(TaskState.Running);

            await executePromise;

            expect(longTask.state).toBe(TaskState.Completed);
            // Should have: Running, Paused, Running, Paused, Running, Completed
            const stateChanges = stateChangeCallback.mock.calls.map(call => call[0]);
            expect(stateChanges).toContain(TaskState.Running);
            expect(stateChanges).toContain(TaskState.Paused);
            expect(stateChanges).toContain(TaskState.Completed);
            expect(stateChanges.length).toBeGreaterThanOrEqual(4); // At least some state changes
        });

        it('should handle resume multiple times when already running', async () => {
            const executePromise = task.execute();
            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(task.state).toBe(TaskState.Running);

            // Multiple resume calls should not affect running task
            task.resume();
            task.resume();
            task.resume();

            expect(task.state).toBe(TaskState.Running);

            await executePromise;
        });

        it('should handle pause when not running', () => {
            // Should not crash or change state
            task.pause();
            expect(task.state).toBe(TaskState.NotStarted);
        });

        it('should handle abort signal while paused', async () => {
            const controller = new AbortController();
            const executePromise = task.execute({
                abortSignal: controller.signal,
            });

            // Run for a bit, then pause
            await new Promise((resolve) => setTimeout(resolve, 1));
            task.pause();
            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(task.state).toBe(TaskState.Paused);

            // Abort while paused
            controller.abort();

            // Resume - should detect abort
            task.resume();

            const result = await executePromise;

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Task was aborted');
            expect(result.finalState).toBe(TaskState.Aborted);
        });

        it('should reset state correctly for new execution after completion', async () => {
            // First execution with pause/resume
            const executePromise1 = task.execute();
            await new Promise((resolve) => setTimeout(resolve, 1));
            task.pause();
            await new Promise((resolve) => setTimeout(resolve, 1));
            task.resume();
            await executePromise1;

            expect(task.state).toBe(TaskState.Completed);
            expect(task.progress).toBe(100);

            // Second execution should start fresh
            const executePromise2 = task.execute();
            // Give a moment for the task to initialize
            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(task.state).toBe(TaskState.Running);
            // Progress should be reset after initial progress reporting
            expect(task.progress).toBeGreaterThanOrEqual(0);
            expect(task.progress).toBeLessThanOrEqual(20); // Should be at most the first step

            await executePromise2;

            expect(task.state).toBe(TaskState.Completed);
            expect(task.progress).toBe(100);
        });
    });

    describe('edge cases', () => {
        it('should throw error if already running', async () => {
            const executePromise1 = task.execute();

            await expect(task.execute()).rejects.toThrow('Task is already running');

            await executePromise1;
        });

        it('should handle task with different step counts', async () => {
            const taskWith3Steps = new PausableTaskImpl(1, 3);
            const progressCallback = jest.fn();

            const result = await taskWith3Steps.execute({
                onProgress: progressCallback,
            });

            expect(result.success).toBe(true);
            expect(taskWith3Steps.progress).toBe(100);

            // Should have initial + 3 steps + final = 5 calls
            expect(progressCallback).toHaveBeenCalledTimes(5);
        });
    });
});