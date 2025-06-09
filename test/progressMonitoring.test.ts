/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestOutputChannel } from '@microsoft/vscode-azext-dev';
import * as assert from 'assert';
import { ProgressMonitoringService } from '../src/services/ProgressMonitoringService';
import { TaskService, TaskState } from '../src/services/TaskService';
import { ext } from '../src/extensionVariables';

suite('Progress Monitoring Service Tests', () => {
    let originalOutputChannel: typeof ext.outputChannel;

    suiteSetup(() => {
        originalOutputChannel = ext.outputChannel;
        ext.outputChannel = new TestOutputChannel();
    });

    suiteTeardown(() => {
        ext.outputChannel = originalOutputChannel;
        ProgressMonitoringService.stopAllMonitoring();
    });

    teardown(() => {
        ProgressMonitoringService.stopAllMonitoring();
        // Clear all tasks
        const allTasks = TaskService.getAllTasks();
        allTasks.forEach(task => TaskService.removeTask(task.id));
    });

    test('should create and monitor a task', (done) => {
        const task = TaskService.createTask('Test Task');
        
        // Start monitoring
        ProgressMonitoringService.startMonitoring(task.id);
        
        // Verify monitoring started
        assert.strictEqual(ProgressMonitoringService.isMonitoring(task.id), true);
        
        // Update task progress
        task.start();
        task.updateProgress(5, 10);
        
        // Wait a bit to allow monitoring to log
        setTimeout(() => {
            task.complete();
            
            // Wait for completion to be logged
            setTimeout(() => {
                assert.strictEqual(ProgressMonitoringService.isMonitoring(task.id), false);
                done();
            }, 100);
        }, 1100); // Wait longer than monitoring interval
    });

    test('should handle task abort signals', (done) => {
        const task = TaskService.createTask('Abortable Task');
        
        ProgressMonitoringService.startMonitoring(task.id);
        task.start();
        
        // Stop the task (simulate abort)
        task.stop();
        
        setTimeout(() => {
            assert.strictEqual(task.state, TaskState.Stopped);
            assert.strictEqual(ProgressMonitoringService.isMonitoring(task.id), false);
            done();
        }, 100);
    });

    test('should handle task with error', (done) => {
        const task = TaskService.createTask('Error Task');
        
        ProgressMonitoringService.startMonitoring(task.id);
        task.start();
        
        // Set an error
        const error = new Error('Test error');
        task.setError(error);
        
        setTimeout(() => {
            assert.strictEqual(task.state, TaskState.Failed);
            assert.strictEqual(task.error, error);
            assert.strictEqual(ProgressMonitoringService.isMonitoring(task.id), false);
            done();
        }, 100);
    });

    test('should track multiple tasks', () => {
        const task1 = TaskService.createTask('Task 1');
        const task2 = TaskService.createTask('Task 2');
        
        ProgressMonitoringService.startMonitoring(task1.id);
        ProgressMonitoringService.startMonitoring(task2.id);
        
        const monitoredIds = ProgressMonitoringService.getMonitoredTaskIds();
        assert.strictEqual(monitoredIds.length, 2);
        assert.ok(monitoredIds.includes(task1.id));
        assert.ok(monitoredIds.includes(task2.id));
    });

    test('should stop monitoring for non-existent task gracefully', () => {
        const nonExistentTaskId = 'non-existent-task';
        
        // Should not throw
        assert.doesNotThrow(() => {
            ProgressMonitoringService.stopMonitoring(nonExistentTaskId);
        });
    });

    test('should handle progress updates correctly', () => {
        const task = TaskService.createTask('Progress Task');
        
        task.updateProgress(25, 100);
        assert.strictEqual(task.progress, 25);
        assert.strictEqual(task.processedItems, 25);
        assert.strictEqual(task.totalItems, 100);
        
        task.updateProgress(50);
        assert.strictEqual(task.progress, 50);
        assert.strictEqual(task.processedItems, 50);
        assert.strictEqual(task.totalItems, 100);
    });
});