/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TaskState } from '../taskService';
import { PausableDummyTask } from './PausableDummyTask';

describe('PausableDummyTask', () => {
    let task: PausableDummyTask;

    beforeEach(() => {
        task = new PausableDummyTask('Test Pausable Task');
    });

    afterEach(async () => {
        await task.delete();
    });

    describe('constructor', () => {
        it('should initialize with correct properties', () => {
            const status = task.getStatus();
            
            expect(task.id).toMatch(/^pausable-dummy-task-\d+$/);
            expect(task.type).toBe('pausable-dummy-task');
            expect(task.name).toBe('Test Pausable Task');
            expect(status.state).toBe(TaskState.Pending);
            expect(status.progress).toBe(0);
            expect(status.message).toBe('Pausable task created and ready to start');
        });

        it('should generate unique IDs for multiple instances', () => {
            const task1 = new PausableDummyTask();
            const task2 = new PausableDummyTask();
            
            expect(task1.id).not.toBe(task2.id);
            
            // Cleanup
            void task1.delete();
            void task2.delete();
        });
    });

    describe('canPause', () => {
        it('should return false when task is pending', () => {
            expect(task.canPause()).toBe(false);
        });

        it('should return true when task is running', async () => {
            await task.start();
            expect(task.canPause()).toBe(true);
        });

        it('should return false when task is paused', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 500));
            await task.pause();
            expect(task.canPause()).toBe(false);
        });

        it('should return false when task is completed', async () => {
            await task.start();
            
            // Wait for completion
            await new Promise(resolve => setTimeout(resolve, 11000));
            
            expect(task.canPause()).toBe(false);
        }, 15000);
    });

    describe('start', () => {
        it('should transition through initialization states', async () => {
            const startPromise = task.start();
            
            // Should be initializing briefly
            await new Promise(resolve => setTimeout(resolve, 50));
            let status = task.getStatus();
            expect(status.state).toBe(TaskState.Initializing);
            
            await startPromise;
            
            // Should now be running
            status = task.getStatus();
            expect(status.state).toBe(TaskState.Running);
        });

        it('should update progress over time', async () => {
            await task.start();
            
            // Wait for at least one progress update
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Running);
            expect(status.progress).toBeGreaterThan(0);
            expect(status.progress).toBeLessThanOrEqual(100);
        });
    });

    describe('pause', () => {
        it('should pause a running task', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 500));
            
            await task.pause();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Paused);
            expect(status.message).toContain('Task paused at');
            expect(status.message).toContain('% progress');
        });

        it('should not allow pausing non-running task', async () => {
            await expect(task.pause()).rejects.toThrow('Cannot pause task in state: pending');
        });

        it('should not allow pausing already paused task', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 500));
            await task.pause();
            
            await expect(task.pause()).rejects.toThrow('Cannot pause task in state: paused');
        });

        it('should transition through pausing state', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const pausePromise = task.pause();
            
            // Brief moment to catch pausing state
            await new Promise(resolve => setTimeout(resolve, 25));
            const pausingStatus = task.getStatus();
            expect(pausingStatus.state).toBe(TaskState.Pausing);
            
            await pausePromise;
            
            const pausedStatus = task.getStatus();
            expect(pausedStatus.state).toBe(TaskState.Paused);
        });
    });

    describe('resume', () => {
        it('should resume a paused task', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            const progressBeforePause = task.getStatus().progress;
            await task.pause();
            await task.resume();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Running);
            expect(status.message).toContain('Task resumed from');
            expect(status.message).toContain(`${progressBeforePause}% progress`);
        });

        it('should not allow resuming non-paused task', async () => {
            await task.start();
            
            await expect(task.resume()).rejects.toThrow('Cannot resume task in state: running');
        });

        it('should transition through resuming state', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 500));
            await task.pause();
            
            const resumePromise = task.resume();
            
            // Brief moment to catch resuming state
            await new Promise(resolve => setTimeout(resolve, 25));
            const resumingStatus = task.getStatus();
            expect(resumingStatus.state).toBe(TaskState.Resuming);
            
            await resumePromise;
            
            const resumedStatus = task.getStatus();
            expect(resumedStatus.state).toBe(TaskState.Running);
        });

        it('should preserve progress when resuming', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 2100));
            
            const progressBeforePause = task.getStatus().progress;
            await task.pause();
            
            // Wait while paused
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            await task.resume();
            
            // Progress should be preserved (not reset)
            const progressAfterResume = task.getStatus().progress;
            expect(progressAfterResume).toBe(progressBeforePause);
        });
    });

    describe('pause and resume cycles', () => {
        it('should handle multiple pause/resume cycles', async () => {
            await task.start();
            
            // First cycle
            await new Promise(resolve => setTimeout(resolve, 1100));
            const progress1 = task.getStatus().progress ?? 0;
            await task.pause();
            await task.resume();
            
            // Second cycle
            await new Promise(resolve => setTimeout(resolve, 1100));
            const progress2 = task.getStatus().progress ?? 0;
            await task.pause();
            await task.resume();
            
            expect(progress2).toBeGreaterThan(progress1);
            expect(task.getStatus().state).toBe(TaskState.Running);
        });

        it('should continue progress correctly after multiple pauses', async () => {
            await task.start();
            
            // Let it run for 2 seconds
            await new Promise(resolve => setTimeout(resolve, 2100));
            const progress1 = task.getStatus().progress ?? 0;
            
            await task.pause();
            // Pause for 2 seconds (this time should not count toward progress)
            await new Promise(resolve => setTimeout(resolve, 2000));
            await task.resume();
            
            // Let it run for another 2 seconds
            await new Promise(resolve => setTimeout(resolve, 2100));
            const progress2 = task.getStatus().progress ?? 0;
            
            // Progress should reflect only 4 seconds of actual work, not 6
            expect(progress2).toBeGreaterThan(35); // Should be around 40% but timing may vary
            expect(progress2).toBeLessThan(50); // Should not be much higher than 45%
            expect(progress2).toBeGreaterThan(progress1);
        }, 10000);

        it('should not count paused time toward total duration', async () => {
            await task.start();
            
            // Run for 3 seconds
            await new Promise(resolve => setTimeout(resolve, 3100));
            await task.pause();
            
            // Pause for 5 seconds 
            await new Promise(resolve => setTimeout(resolve, 5000));
            await task.resume();
            
            // Run for another 7 seconds to complete
            await new Promise(resolve => setTimeout(resolve, 7100));
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Completed);
            expect(status.progress).toBe(100);
        }, 20000); // Increase timeout for this longer test
    });

    describe('stop during pause operations', () => {
        it('should handle stop while paused', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 1100));
            await task.pause();
            
            await task.stop();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Stopped);
        });

        it('should handle stop during pause transition', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            // Start pausing and stop immediately
            const pausePromise = task.pause();
            const stopPromise = task.stop();
            
            await Promise.all([pausePromise.catch(() => {}), stopPromise]);
            
            const status = task.getStatus();
            expect([TaskState.Stopped, TaskState.Paused].includes(status.state)).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('should handle rapid pause/resume calls', async () => {
            await task.start();
            await new Promise(resolve => setTimeout(resolve, 1100));
            
            // Rapid pause/resume
            await task.pause();
            await task.resume();
            await new Promise(resolve => setTimeout(resolve, 100));
            await task.pause();
            await task.resume();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Running);
        });

        it('should handle pause at very beginning of execution', async () => {
            await task.start();
            
            // Pause immediately after start
            await task.pause();
            
            const status = task.getStatus();
            expect(status.state).toBe(TaskState.Paused);
            expect(status.progress).toBe(0);
        });

        it('should handle pause near completion', async () => {
            await task.start();
            
            // Wait close to completion
            await new Promise(resolve => setTimeout(resolve, 9500));
            
            if (task.canPause()) {
                await task.pause();
                await task.resume();
            }
            
            // Should still complete properly
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const status = task.getStatus();
            expect([TaskState.Completed, TaskState.Running]).toContain(status.state);
        }, 15000);
    });
});