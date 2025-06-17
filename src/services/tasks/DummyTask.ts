/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Task } from '../taskService';

/**
 * A dummy task implementation that demonstrates the Task abstract class.
 * This task simulates work by using timeouts and provides progress updates over a 10-second duration.
 *
 * The base class handles all state management, allowing this implementation
 * to focus solely on the business logic.
 */
export class DummyTask extends Task {
    public readonly type: string = 'dummy-task';
    public readonly name: string;

    /**
     * Creates a new DummyTask instance.
     *
     * @param id Unique identifier for the task.
     * @param name User-friendly name for the task.
     */
    constructor(id: string, name: string) {
        super(id);
        this.name = name;
    }

    /**
     * Implements the main task logic with progress updates.
     * The base class handles all state transitions and error handling.
     *
     * @param signal AbortSignal to check for stop requests.
     */
    protected async doWork(signal: AbortSignal): Promise<void> {
        const totalSteps = 10;
        const stepDuration = 1000; // 1 second per step

        for (let step = 0; step < totalSteps; step++) {
            // Check for abort signal
            if (signal.aborted) {
                // Perform cleanup when stopping
                this.updateMessage(vscode.l10n.t('Cleaning up task: {0}', this.name));
                await this.cleanup();
                return;
            }

            // Simulate work
            await this.sleep(stepDuration);

            // Update progress
            const progress = ((step + 1) / totalSteps) * 100;
            this.updateProgress(progress, vscode.l10n.t('Processing step {0} of {1}', step + 1, totalSteps));
        }
    }

    /**
     * Optional initialization logic.
     * Called by the base class during start().
     */
    protected async onInitialize(): Promise<void> {
        console.log(`Initializing task: ${this.name}`);
        // Could perform resource allocation, connection setup, etc.
    }

    /**
     * Optional cleanup logic when deleting.
     * Called by the base class during delete().
     */
    protected async onDelete(): Promise<void> {
        console.log(`Deleting task: ${this.name}`);
        // Could clean up temporary files, release resources, etc.
    }

    /**
     * Performs cleanup operations when the task is stopped.
     * This is called from within doWork when AbortSignal is triggered.
     */
    private async cleanup(): Promise<void> {
        console.log(`Cleaning up task: ${this.name}`);
        // Could close connections, save state, etc.
        // This demonstrates how to handle cleanup using AbortSignal instead of onStop
    }

    /**
     * Helper method to create a delay.
     *
     * @param ms Delay in milliseconds.
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
