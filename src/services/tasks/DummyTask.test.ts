/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TaskState } from '../taskService';
import { DummyTask } from './DummyTask';

describe('DummyTask', () => {
    let task: DummyTask;

    beforeEach(() => {
        task = new DummyTask('Test Dummy Task');
    });

    afterEach(async () => {
        await task.delete();
    });

    describe('constructor', () => {
        it('should initialize with correct properties', () => {
            const status = task.getStatus();
            
            expect(task.id).toMatch(/^dummy-task-\d+$/);
            expect(task.type).toBe('dummy-task');
            expect(task.name).toBe('Test Dummy Task');
            expect(status.state).toBe(TaskState.Pending);
            expect(status.progress).toBe(0);
            expect(status.message).toBe('Task created and ready to start');
        });

        it('should generate unique IDs for multiple instances', () => {
            const task1 = new DummyTask();
            const task2 = new DummyTask();
            
            expect(task1.id).not.toBe(task2.id);
            
            // Cleanup
            void task1.delete();
            void task2.delete();
        });

        it('should use default name when none provided', () => {
            const defaultTask = new DummyTask();
            expect(defaultTask.name).toMatch(/^Dummy Task \d+$/);
            
            void defaultTask.delete();
        });
    });

    describe('start', () => {
        it('should transition through initialization states', async () => {
            const startPromise = task.start();
            
            // Should be initializing briefly
            await new Promise(resolve => setTimeout(resolve, 50));
            let status = task.getStatus();
            expect(status.state).toBe(TaskState.Initializing);
            expect(status.message).toBe('Initializing task...');
            
            await startPromise;
            
            // Should now be running
            status = task.getStatus();
            expect(status.state).toBe(TaskState.Running);
            expect(status.message).toBe('Task execution started');
        });

        it('should not allow starting twice', async () => {
            await task.start();
            
            await expect(task.start()).rejects.toThrow('Cannot start task in state: running');
        });

        it('should update progress over time', async () => {
            await task.start();
            
            // Wait for at least one progress update
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Running);
            expect(status.progress).toBeGreaterThan(0);
            expect(status.progress).toBeLessThanOrEqual(100);
            expect(status.message).toContain('Processing...');
            expect(status.message).toContain('% complete');
        });

        it('should complete after approximately 10 seconds', async () => {
            await task.start();
            
            // Wait for completion (with some buffer for timing)
            await new Promise(resolve => setTimeout(resolve, 11000));
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Completed);
            expect(status.progress).toBe(100);
            expect(status.message).toBe('Task completed successfully');
        }, 15000); // Increase Jest timeout for this test
    });

    describe('stop', () => {
        it('should stop a running task', async () => {
            await task.start();
            
            // Let it run for a bit
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            await task.stop();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Stopped);
            expect(status.message).toBe('Task was stopped');
        });

        it('should handle stopping before start', async () => {
            await task.stop();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Stopped);
        });

        it('should handle multiple stop calls', async () => {
            await task.start();
            await task.stop();
            
            // Second stop should not throw
            await expect(task.stop()).resolves.toBeUndefined();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Stopped);
        });

        it('should preserve progress when stopped', async () => {
            await task.start();
            
            // Wait for some progress
            await new Promise(resolve => setTimeout(resolve, 2100));
            
            const progressBeforeStop = task.getStatus().progress;
            await task.stop();
            
            const status = task.getStatus();
            expect(status.progress).toBe(progressBeforeStop);
        });
    });

    describe('delete', () => {
        it('should stop and cleanup the task', async () => {
            await task.start();
            
            // Let it run briefly
            await new Promise(resolve => setTimeout(resolve, 500));
            
            await task.delete();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Stopped);
        });

        it('should handle delete on pending task', async () => {
            await expect(task.delete()).resolves.toBeUndefined();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Stopped);
        });
    });

    describe('abort signal handling', () => {
        it('should handle abort during initialization', async () => {
            const startPromise = task.start();
            
            // Give it a tiny bit of time to enter initialization, then stop
            await new Promise(resolve => setTimeout(resolve, 10));
            await task.stop();
            await startPromise;
            
            const status = task.getStatus();
            // The task might be in running state if start() completed before stop()
            // or stopped if stop() was processed first
            expect([TaskState.Stopped, TaskState.Running].includes(status.state)).toBe(true);
        });

        it('should handle abort during execution', async () => {
            await task.start();
            
            // Let it start running
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            await task.stop();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Stopped);
        });
    });

    describe('getStatus', () => {
        it('should return a copy of status to prevent mutation', () => {
            const status1 = task.getStatus();
            const status2 = task.getStatus();
            
            expect(status1).toEqual(status2);
            expect(status1).not.toBe(status2); // Different object references
        });
    });
});