/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Example usage demonstration for DummyTask and PausableDummyTask
 * 
 * This file shows how to use the task implementations for future development.
 * It is not part of the production code but serves as documentation.
 */

import { TaskService } from '../taskService';
import { DummyTask, PausableDummyTask } from './index';

/**
 * Example: Basic DummyTask usage
 */
export async function demonstrateDummyTask(): Promise<void> {
    console.log('=== DummyTask Demonstration ===');
    
    const task = new DummyTask('Demo Dummy Task');
    
    // Register with task service
    TaskService.registerTask(task);
    
    console.log('Initial status:', task.getStatus());
    
    // Start the task
    await task.start();
    console.log('After start:', task.getStatus());
    
    // Monitor progress for a few seconds
    const progressInterval = setInterval(() => {
        const status = task.getStatus();
        console.log(`Progress: ${status.progress}% - ${status.message}`);
        
        if (status.state === 'completed' || status.state === 'stopped') {
            clearInterval(progressInterval);
            console.log('Final status:', status);
        }
    }, 2000);
    
    // Stop after 5 seconds
    setTimeout(async () => {
        await task.stop();
        console.log('Task stopped manually');
        clearInterval(progressInterval);
        await TaskService.deleteTask(task.id);
    }, 5000);
}

/**
 * Example: PausableDummyTask usage with pause/resume
 */
export async function demonstratePausableTask(): Promise<void> {
    console.log('\n=== PausableDummyTask Demonstration ===');
    
    const task = new PausableDummyTask('Demo Pausable Task');
    
    // Register with task service
    TaskService.registerTask(task);
    
    console.log('Initial status:', task.getStatus());
    
    // Start the task
    await task.start();
    console.log('After start:', task.getStatus());
    
    // Let it run for 3 seconds
    setTimeout(async () => {
        if (task.canPause()) {
            await task.pause();
            console.log('Task paused:', task.getStatus());
            
            // Resume after 2 seconds of being paused
            setTimeout(async () => {
                await task.resume();
                console.log('Task resumed:', task.getStatus());
            }, 2000);
        }
    }, 3000);
    
    // Monitor progress
    const progressInterval = setInterval(() => {
        const status = task.getStatus();
        console.log(`State: ${status.state}, Progress: ${status.progress}% - ${status.message}`);
        
        if (status.state === 'completed' || status.state === 'stopped') {
            clearInterval(progressInterval);
            console.log('Final status:', status);
            void TaskService.deleteTask(task.id);
        }
    }, 1000);
}

/**
 * Example: Using TaskService to manage multiple tasks
 */
export async function demonstrateTaskService(): Promise<void> {
    console.log('\n=== TaskService Demonstration ===');
    
    const task1 = new DummyTask('Task 1');
    const task2 = new PausableDummyTask('Pausable Task 2');
    
    // Register multiple tasks
    TaskService.registerTask(task1);
    TaskService.registerTask(task2);
    
    console.log('Registered tasks:', TaskService.listTasks().map(t => ({ id: t.id, name: t.name, type: t.type })));
    
    // Start both tasks
    await task1.start();
    await task2.start();
    
    // Demonstrate service operations
    console.log('Task 1 pausable?', TaskService.isTaskPausable(task1.id));
    console.log('Task 2 pausable?', TaskService.isTaskPausable(task2.id));
    
    // Pause the pausable task via service
    if (TaskService.isTaskPausable(task2.id)) {
        setTimeout(async () => {
            await TaskService.pauseTask(task2.id);
            console.log('Paused task 2 via service');
            
            setTimeout(async () => {
                await TaskService.resumeTask(task2.id);
                console.log('Resumed task 2 via service');
            }, 2000);
        }, 2000);
    }
    
    // Clean up after 8 seconds
    setTimeout(async () => {
        console.log('Cleaning up tasks...');
        await TaskService.deleteTask(task1.id);
        await TaskService.deleteTask(task2.id);
        console.log('All tasks cleaned up');
    }, 8000);
}

// Export for potential use in integration demos
export { DummyTask, PausableDummyTask, TaskService };