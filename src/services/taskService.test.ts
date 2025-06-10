/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DummyTask } from './DummyTask';
import { PausableTaskImpl } from './PausableTask';
import { TaskService, TaskState } from './taskService';

describe('TaskService', () => {
    let service: TaskService;
    let dummyTask: DummyTask;
    let pausableTask: PausableTaskImpl;

    beforeEach(() => {
        service = new TaskService();
        // Use very short delays for testing (1ms per step, 5 steps = 5ms total)
        dummyTask = new DummyTask(1, 5);
        pausableTask = new PausableTaskImpl(1, 5);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('task registration', () => {
        it('should register and retrieve tasks', () => {
            service.registerTask(dummyTask);
            service.registerTask(pausableTask);

            expect(service.getTask('dummy-task')).toBe(dummyTask);
            expect(service.getTask('pausable-task')).toBe(pausableTask);
            expect(service.getTask('non-existent')).toBeUndefined();
        });

        it('should get all registered tasks', () => {
            service.registerTask(dummyTask);
            service.registerTask(pausableTask);

            const allTasks = service.getAllTasks();
            expect(allTasks).toHaveLength(2);
            expect(allTasks).toContain(dummyTask);
            expect(allTasks).toContain(pausableTask);
        });

        it('should unregister tasks', () => {
            service.registerTask(dummyTask);
            service.registerTask(pausableTask);

            service.unregisterTask('dummy-task');

            expect(service.getTask('dummy-task')).toBeUndefined();
            expect(service.getTask('pausable-task')).toBe(pausableTask);
            expect(service.getAllTasks()).toHaveLength(1);
        });

        it('should handle unregistering non-existent task', () => {
            service.unregisterTask('non-existent');
            expect(service.getAllTasks()).toHaveLength(0);
        });

        it('should overwrite task with same ID', () => {
            const newDummyTask = new DummyTask();
            
            service.registerTask(dummyTask);
            service.registerTask(newDummyTask);

            expect(service.getTask('dummy-task')).toBe(newDummyTask);
            expect(service.getAllTasks()).toHaveLength(1);
        });
    });

    describe('task execution', () => {
        beforeEach(() => {
            service.registerTask(dummyTask);
            service.registerTask(pausableTask);
        });

        it('should execute task by ID', async () => {
            const progressCallback = jest.fn();
            const result = await service.executeTask('dummy-task', {
                onProgress: progressCallback,
            });

            expect(result?.success).toBe(true);
            expect(result?.data).toBe('Dummy task completed successfully!');
            expect(result?.finalState).toBe(TaskState.Completed);
            expect(progressCallback).toHaveBeenCalled();
        });

        it('should return undefined for non-existent task', async () => {
            const result = await service.executeTask('non-existent');
            expect(result).toBeUndefined();
        });

        it('should pass execution options to task', async () => {
            const controller = new AbortController();
            const progressCallback = jest.fn();
            const stateChangeCallback = jest.fn();

            const executePromise = service.executeTask('dummy-task', {
                abortSignal: controller.signal,
                onProgress: progressCallback,
                onStateChange: stateChangeCallback,
            });

            // Let task start then abort
            setTimeout(() => controller.abort(), 2);

            const result = await executePromise;

            expect(result?.success).toBe(false);
            expect(result?.error?.message).toBe('Task was aborted');
            expect(progressCallback).toHaveBeenCalled();
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Running);
            expect(stateChangeCallback).toHaveBeenCalledWith(TaskState.Aborted);
        });

        it('should handle task execution errors', async () => {
            // Mock the task to throw an error
            const mockTask = {
                id: 'error-task',
                name: 'Error Task',
                state: TaskState.NotStarted,
                progress: 0,
                execute: jest.fn().mockRejectedValue(new Error('Task execution failed')),
            };

            service.registerTask(mockTask);

            await expect(service.executeTask('error-task')).rejects.toThrow('Task execution failed');
        });

        it('should execute pausable task through service', async () => {
            const executePromise = service.executeTask('pausable-task');

            // Let task start then pause it
            await new Promise((resolve) => setTimeout(resolve, 2));
            pausableTask.pause();
            await new Promise((resolve) => setTimeout(resolve, 2));

            expect(pausableTask.state).toBe(TaskState.Paused);

            pausableTask.resume();

            const result = await executePromise;

            expect(result?.success).toBe(true);
            expect(result?.finalState).toBe(TaskState.Completed);
        });
    });

    describe('concurrent execution', () => {
        beforeEach(() => {
            service.registerTask(dummyTask);
            service.registerTask(pausableTask);
        });

        it('should allow concurrent execution of different tasks', async () => {
            const dummyPromise = service.executeTask('dummy-task');
            const pausablePromise = service.executeTask('pausable-task');

            const [dummyResult, pausableResult] = await Promise.all([dummyPromise, pausablePromise]);

            expect(dummyResult?.success).toBe(true);
            expect(pausableResult?.success).toBe(true);
        });

        it('should prevent multiple executions of same task', async () => {
            const firstExecution = service.executeTask('dummy-task');

            await expect(service.executeTask('dummy-task')).rejects.toThrow('Task is already running');

            await firstExecution;
        });
    });

    describe('task state management', () => {
        beforeEach(() => {
            service.registerTask(dummyTask);
            service.registerTask(pausableTask);
        });

        it('should maintain task states independently', async () => {
            // Start dummy task
            const dummyPromise = service.executeTask('dummy-task');
            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(dummyTask.state).toBe(TaskState.Running);
            expect(pausableTask.state).toBe(TaskState.NotStarted);

            // Start pausable task
            const pausablePromise = service.executeTask('pausable-task');
            await new Promise((resolve) => setTimeout(resolve, 1));

            expect(dummyTask.state).toBe(TaskState.Running);
            expect(pausableTask.state).toBe(TaskState.Running);

            // Complete both tasks
            await Promise.all([dummyPromise, pausablePromise]);

            expect(dummyTask.state).toBe(TaskState.Completed);
            expect(pausableTask.state).toBe(TaskState.Completed);
        });

        it('should track progress independently for each task', async () => {
            const dummyPromise = service.executeTask('dummy-task');
            const pausablePromise = service.executeTask('pausable-task');
            await new Promise((resolve) => setTimeout(resolve, 1));

            // Let both tasks run for a bit
            await new Promise((resolve) => setTimeout(resolve, 2));

            // Both should have made some progress
            expect(dummyTask.progress).toBeGreaterThan(0);
            expect(pausableTask.progress).toBeGreaterThan(0);

            // Pause only the pausable task
            pausableTask.pause();
            await new Promise((resolve) => setTimeout(resolve, 1));

            // Get current progress levels
            const dummyProgressBeforePause = dummyTask.progress;
            const pausableProgressAtPause = pausableTask.progress;

            // Let some time pass
            await new Promise((resolve) => setTimeout(resolve, 2));

            // Dummy task should continue progressing, pausable should stay the same
            expect(dummyTask.progress).toBeGreaterThanOrEqual(dummyProgressBeforePause);
            expect(pausableTask.progress).toBe(pausableProgressAtPause);

            // Resume pausable task and complete both
            pausableTask.resume();

            await Promise.all([dummyPromise, pausablePromise]);

            expect(dummyTask.progress).toBe(100);
            expect(pausableTask.progress).toBe(100);
        });
    });
});