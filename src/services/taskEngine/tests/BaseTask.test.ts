/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BaseTask, TaskStatus, type TaskProgress } from '../index';

class TestTask extends BaseTask {
    constructor(id: string) {
        super(id);
    }

    public async execute(): Promise<void> {
        this.updateStatus(TaskStatus.Running);
        this.updateProgress({ percentage: 50, message: 'Running test' });
        this.updateStatus(TaskStatus.Completed);
        this.updateProgress({ percentage: 100, message: 'Test completed' });
    }

    public cancel(): void {
        this.updateStatus(TaskStatus.Failed);
        this.setError(new Error('Test cancelled'));
    }

    // Expose protected methods for testing
    public testUpdateStatus(status: TaskStatus): void {
        this.updateStatus(status);
    }

    public testUpdateProgress(progress: TaskProgress): void {
        this.updateProgress(progress);
    }

    public testSetError(error: Error): void {
        this.setError(error);
    }
}

describe('BaseTask', () => {
    describe('initialization', () => {
        it('should initialize with correct default values', () => {
            const task = new TestTask('test-id');

            expect(task.id).toBe('test-id');
            expect(task.status).toBe(TaskStatus.Pending);
            expect(task.progress).toEqual({ percentage: 0 });
            expect(task.error).toBeUndefined();
        });
    });

    describe('status updates', () => {
        it('should update status and notify callbacks', () => {
            const task = new TestTask('test-id');
            const statusCallback = jest.fn();
            
            const subscription = task.onStatusChange(statusCallback);
            task.testUpdateStatus(TaskStatus.Running);

            expect(task.status).toBe(TaskStatus.Running);
            expect(statusCallback).toHaveBeenCalledWith(TaskStatus.Running);

            subscription.dispose();
        });

        it('should not notify callbacks for same status', () => {
            const task = new TestTask('test-id');
            const statusCallback = jest.fn();
            
            task.onStatusChange(statusCallback);
            task.testUpdateStatus(TaskStatus.Running);
            task.testUpdateStatus(TaskStatus.Running); // Same status

            expect(statusCallback).toHaveBeenCalledTimes(1);
        });
    });

    describe('progress updates', () => {
        it('should update progress and notify callbacks', () => {
            const task = new TestTask('test-id');
            const progressCallback = jest.fn();
            
            const subscription = task.onProgress(progressCallback);
            const newProgress = { percentage: 50, message: 'Testing' };
            task.testUpdateProgress(newProgress);

            expect(task.progress).toEqual(newProgress);
            expect(progressCallback).toHaveBeenCalledWith(newProgress);

            subscription.dispose();
        });
    });

    describe('error handling', () => {
        it('should set error and update status to failed', () => {
            const task = new TestTask('test-id');
            const error = new Error('Test error');
            
            task.testSetError(error);

            expect(task.error).toBe(error);
            expect(task.status).toBe(TaskStatus.Failed);
        });
    });

    describe('subscription management', () => {
        it('should dispose progress subscriptions', () => {
            const task = new TestTask('test-id');
            const progressCallback = jest.fn();
            
            const subscription = task.onProgress(progressCallback);
            subscription.dispose();
            
            task.testUpdateProgress({ percentage: 50 });
            expect(progressCallback).not.toHaveBeenCalled();
        });

        it('should dispose status subscriptions', () => {
            const task = new TestTask('test-id');
            const statusCallback = jest.fn();
            
            const subscription = task.onStatusChange(statusCallback);
            subscription.dispose();
            
            task.testUpdateStatus(TaskStatus.Running);
            expect(statusCallback).not.toHaveBeenCalled();
        });
    });

    describe('execution', () => {
        it('should execute successfully', async () => {
            const task = new TestTask('test-id');
            const statusCallback = jest.fn();
            const progressCallback = jest.fn();
            
            task.onStatusChange(statusCallback);
            task.onProgress(progressCallback);
            
            await task.execute();

            expect(task.status).toBe(TaskStatus.Completed);
            expect(task.progress.percentage).toBe(100);
            expect(statusCallback).toHaveBeenCalledWith(TaskStatus.Running);
            expect(statusCallback).toHaveBeenCalledWith(TaskStatus.Completed);
            expect(progressCallback).toHaveBeenCalledWith({ percentage: 50, message: 'Running test' });
            expect(progressCallback).toHaveBeenCalledWith({ percentage: 100, message: 'Test completed' });
        });
    });
});