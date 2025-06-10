/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Example usage of the Task Service and implemented tasks.
 * This file demonstrates how to use the DummyTask and PausableTask implementations.
 */

import { DummyTask } from './DummyTask';
import { PausableTaskImpl } from './PausableTask';
import { taskService } from './taskService';

/**
 * Example: Basic DummyTask usage
 */
async function dummyTaskExample(): Promise<void> {
    // Create a dummy task that runs for 10 seconds (1000ms per step, 10 steps)
    const dummyTask = new DummyTask(1000, 10);
    
    console.log('Starting dummy task...');
    
    const result = await dummyTask.execute({
        onProgress: (progress) => {
            console.log(`Progress: ${progress.percentage}% - ${progress.message}`);
        },
        onStateChange: (state) => {
            console.log(`State changed to: ${state}`);
        },
    });
    
    if (result.success) {
        console.log(`Task completed: ${result.data}`);
    } else {
        console.error(`Task failed: ${result.error?.message}`);
    }
}

/**
 * Example: PausableTask with pause/resume
 */
async function pausableTaskExample(): Promise<void> {
    // Create a pausable task that runs for 10 seconds (1000ms per step, 10 steps)
    const pausableTask = new PausableTaskImpl(1000, 10);
    
    console.log('Starting pausable task...');
    
    const executePromise = pausableTask.execute({
        onProgress: (progress) => {
            console.log(`Progress: ${progress.percentage}% - ${progress.message}`);
        },
        onStateChange: (state) => {
            console.log(`State changed to: ${state}`);
        },
    });
    
    // Pause the task after 3 seconds
    setTimeout(() => {
        console.log('Pausing task...');
        pausableTask.pause();
    }, 3000);
    
    // Resume the task after 2 more seconds
    setTimeout(() => {
        console.log('Resuming task...');
        pausableTask.resume();
    }, 5000);
    
    const result = await executePromise;
    
    if (result.success) {
        console.log(`Task completed: ${result.data}`);
    } else {
        console.error(`Task failed: ${result.error?.message}`);
    }
}

/**
 * Example: Using TaskService to manage multiple tasks
 */
async function taskServiceExample(): Promise<void> {
    // Register tasks with the service
    const dummyTask = new DummyTask(500, 6); // 3 seconds total
    const pausableTask = new PausableTaskImpl(500, 8); // 4 seconds total
    
    taskService.registerTask(dummyTask);
    taskService.registerTask(pausableTask);
    
    console.log('Registered tasks:', taskService.getAllTasks().map(t => t.name));
    
    // Execute tasks concurrently
    console.log('Starting concurrent task execution...');
    
    const dummyPromise = taskService.executeTask('dummy-task', {
        onProgress: (progress) => {
            console.log(`[DUMMY] Progress: ${progress.percentage}%`);
        },
    });
    
    const pausablePromise = taskService.executeTask('pausable-task', {
        onProgress: (progress) => {
            console.log(`[PAUSABLE] Progress: ${progress.percentage}%`);
        },
    });
    
    // Pause the pausable task briefly
    setTimeout(() => {
        console.log('Pausing pausable task...');
        pausableTask.pause();
        
        setTimeout(() => {
            console.log('Resuming pausable task...');
            pausableTask.resume();
        }, 1000);
    }, 1500);
    
    const [dummyResult, pausableResult] = await Promise.all([dummyPromise, pausablePromise]);
    
    console.log('Dummy task result:', dummyResult?.success ? 'Success' : 'Failed');
    console.log('Pausable task result:', pausableResult?.success ? 'Success' : 'Failed');
    
    // Cleanup
    taskService.unregisterTask('dummy-task');
    taskService.unregisterTask('pausable-task');
}

/**
 * Example: Task with abort signal
 */
async function abortTaskExample(): Promise<void> {
    const dummyTask = new DummyTask(1000, 10); // 10 seconds total
    const controller = new AbortController();
    
    console.log('Starting task with abort capability...');
    
    const executePromise = dummyTask.execute({
        abortSignal: controller.signal,
        onProgress: (progress) => {
            console.log(`Progress: ${progress.percentage}% - ${progress.message}`);
        },
    });
    
    // Abort the task after 3 seconds
    setTimeout(() => {
        console.log('Aborting task...');
        controller.abort();
    }, 3000);
    
    const result = await executePromise;
    
    if (result.success) {
        console.log(`Task completed: ${result.data}`);
    } else {
        console.log(`Task was aborted: ${result.error?.message}`);
    }
}

// Export examples for potential usage
export {
    dummyTaskExample,
    pausableTaskExample,
    taskServiceExample,
    abortTaskExample,
};