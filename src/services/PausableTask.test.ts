/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PausableTaskImpl } from './PausableTask';
import { TaskState } from './taskService';

describe('PausableTask', () => {
    let task: PausableTaskImpl;

    beforeEach(() => {
        task = new PausableTaskImpl();
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
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
            await Promise.resolve(); // Allow task to start

            expect(task.canPause).toBe(true);
            expect(task.canResume).toBe(false);

            jest.advanceTimersByTime(10000);
            await executePromise;

            expect(task.canPause).toBe(false);
            expect(task.canResume).toBe(false);
        });

        it('should allow resume only when paused', async () => {
            const executePromise = task.execute();
            await Promise.resolve();

            // Pause the task
            task.pause();
            jest.advanceTimersByTime(1000);
            await Promise.resolve();

            expect(task.state).toBe(TaskState.Paused);
            expect(task.canPause).toBe(false);
            expect(task.canResume).toBe(true);

            // Resume the task
            task.resume();
            await Promise.resolve();

            expect(task.state).toBe(TaskState.Running);
            expect(task.canPause).toBe(true);
            expect(task.canResume).toBe(false);

            jest.advanceTimersByTime(9000);
            await executePromise;
        });
    });

    describe('execute without pause/resume', () => {
        it('should complete successfully like a normal task', async () => {
            const executePromise = task.execute();

            jest.advanceTimersByTime(10000);

            const result = await executePromise;

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

            jest.advanceTimersByTime(3000);
            controller.abort();
            jest.advanceTimersByTime(1000);

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

            // Let task run for 3 steps
            jest.advanceTimersByTime(3000);
            await Promise.resolve();

            expect(task.progress).toBe(30);

            // Pause the task
            task.pause();
            jest.advanceTimersByTime(1000);
            await Promise.resolve();

            expect(task.state).toBe(TaskState.Paused);
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Paused);

            // Verify task doesn't progress while paused
            const pausedProgress = task.progress;
            jest.advanceTimersByTime(5000);
            await Promise.resolve();
            expect(task.progress).toBe(pausedProgress);

            // Resume the task
            task.resume();
            await Promise.resolve();

            expect(task.state).toBe(TaskState.Running);
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Running);

            // Let task complete
            jest.advanceTimersByTime(7000);
            await executePromise;

            expect(task.state).toBe(TaskState.Completed);
            expect(task.progress).toBe(100);
        });

        it('should handle pause mid-progress', async () => {
            const executePromise = task.execute();

            // Start the task and let it run for 2.5 seconds (mid step)
            jest.advanceTimersByTime(2500);
            await Promise.resolve();

            // Pause should be requested but not take effect until current step completes
            task.pause();

            // Complete the current step
            jest.advanceTimersByTime(500);
            await Promise.resolve();

            // Now the task should be paused
            expect(task.state).toBe(TaskState.Paused);

            // Resume and let it finish
            task.resume();
            jest.advanceTimersByTime(7000);
            await executePromise;

            expect(task.state).toBe(TaskState.Completed);
        });

        it('should handle multiple pause/resume cycles', async () => {
            const stateChangeCallback = jest.fn();
            const executePromise = task.execute({
                onStateChange: stateChangeCallback,
            });

            // First pause/resume cycle
            jest.advanceTimersByTime(2000);
            task.pause();
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
            expect(task.state).toBe(TaskState.Paused);

            task.resume();
            await Promise.resolve();
            expect(task.state).toBe(TaskState.Running);

            // Second pause/resume cycle
            jest.advanceTimersByTime(3000);
            task.pause();
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
            expect(task.state).toBe(TaskState.Paused);

            task.resume();
            await Promise.resolve();
            expect(task.state).toBe(TaskState.Running);

            // Complete the task
            jest.advanceTimersByTime(4000);
            await executePromise;

            expect(task.state).toBe(TaskState.Completed);
            expect(stateChangeCallback).toHaveBeenCalledTimes(6); // Running, Paused, Running, Paused, Running, Completed
        });

        it('should handle resume multiple times when already running', async () => {
            const executePromise = task.execute();

            await Promise.resolve();
            expect(task.state).toBe(TaskState.Running);

            // Multiple resume calls should not affect running task
            task.resume();
            task.resume();
            task.resume();

            expect(task.state).toBe(TaskState.Running);

            jest.advanceTimersByTime(10000);
            await executePromise;
        });

        it('should handle pause when not running', () => {
            // Should not crash or change state
            task.pause();
            expect(task.state).toBe(TaskState.NotStarted);

            // After completion
            const executePromise = task.execute();
            jest.advanceTimersByTime(10000);
            executePromise.then(() => {
                task.pause();
                expect(task.state).toBe(TaskState.Completed);
            });
        });

        it('should maintain progress state across pause/resume', async () => {
            const progressCallback = jest.fn();
            const executePromise = task.execute({
                onProgress: progressCallback,
            });

            // Run for 4 steps
            jest.advanceTimersByTime(4000);
            await Promise.resolve();
            expect(task.progress).toBe(40);

            // Pause
            task.pause();
            jest.advanceTimersByTime(1000);
            await Promise.resolve();

            // Progress should remain the same while paused
            expect(task.progress).toBe(40);

            // Resume and complete
            task.resume();
            jest.advanceTimersByTime(6000);
            await executePromise;

            expect(task.progress).toBe(100);

            // Verify progress was incremental throughout
            const progressCalls = progressCallback.mock.calls.map((call) => call[0].percentage);
            expect(progressCalls).toEqual([0, 10, 20, 30, 40, 40, 50, 60, 70, 80, 90, 100, 100]);
        });

        it('should handle abort signal while paused', async () => {
            const controller = new AbortController();
            const executePromise = task.execute({
                abortSignal: controller.signal,
            });

            // Run for a few steps then pause
            jest.advanceTimersByTime(3000);
            task.pause();
            jest.advanceTimersByTime(1000);
            await Promise.resolve();

            expect(task.state).toBe(TaskState.Paused);

            // Abort while paused
            controller.abort();

            // Resume - should detect abort
            task.resume();
            await Promise.resolve();

            const result = await executePromise;

            expect(result.success).toBe(false);
            expect(result.error?.message).toBe('Task was aborted');
            expect(result.finalState).toBe(TaskState.Aborted);
        });

        it('should reset state correctly for new execution after completion', async () => {
            // First execution with pause/resume
            const executePromise1 = task.execute();
            jest.advanceTimersByTime(3000);
            task.pause();
            jest.advanceTimersByTime(1000);
            await Promise.resolve();
            task.resume();
            jest.advanceTimersByTime(7000);
            await executePromise1;

            expect(task.state).toBe(TaskState.Completed);
            expect(task.progress).toBe(100);

            // Second execution should start fresh
            const executePromise2 = task.execute();
            await Promise.resolve();

            expect(task.state).toBe(TaskState.Running);
            expect(task.progress).toBe(0);

            jest.advanceTimersByTime(10000);
            await executePromise2;

            expect(task.state).toBe(TaskState.Completed);
            expect(task.progress).toBe(100);
        });
    });

    describe('edge cases', () => {
        it('should throw error if already running', async () => {
            const executePromise1 = task.execute();

            await expect(task.execute()).rejects.toThrow('Task is already running');

            jest.advanceTimersByTime(10000);
            await executePromise1;
        });

        it('should continue from paused state on new execute call', async () => {
            // Start and pause the task
            const executePromise1 = task.execute();
            jest.advanceTimersByTime(3000);
            task.pause();
            jest.advanceTimersByTime(1000);
            await Promise.resolve();

            expect(task.state).toBe(TaskState.Paused);
            expect(task.progress).toBe(30);

            // Try to execute again while paused - should throw
            await expect(task.execute()).rejects.toThrow('Task is already running');

            // Resume the original execution
            task.resume();
            jest.advanceTimersByTime(7000);
            await executePromise1;
        });
    });
});