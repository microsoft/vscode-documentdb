/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Task } from '../taskService';

/**
 * A demo task implementation that demonstrates the Task abstract class.
 * This task simulates work by using timeouts and provides progress updates over a 10-second duration.
 *
 * The base class handles all state management, allowing this implementation
 * to focus solely on the business logic.
 */
export class DemoTask extends Task {
    public readonly type: string = 'demo-task';
    public readonly name: string;
    private readonly shouldFail: boolean;

    /**
     * Creates a new DemoTask instance.
     *
     * @param name User-friendly name for the task.
     * @param shouldFail Optional parameter to make the task fail after a random amount of time for testing purposes.
     */
    constructor(name: string, shouldFail: boolean = false) {
        super();
        this.name = name;
        this.shouldFail = shouldFail;
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

        // If shouldFail is true, determine a random failure point between step 2 and 8
        const failureStep = this.shouldFail ? Math.floor(Math.random() * 7) + 2 : -1; // Random between 2-8

        for (let step = 0; step < totalSteps; step++) {
            // Check for abort signal
            if (signal.aborted) {
                // Perform cleanup when stopping - no need for separate message update
                await this.cleanup();
                return;
            }

            // Check if we should fail at this step
            if (this.shouldFail && step === failureStep) {
                throw new Error(vscode.l10n.t('Simulated failure at step {0} for testing purposes', step + 1));
            }

            // Update progress
            const progress = ((step + 1) / totalSteps) * 100;
            this.updateProgress(progress, vscode.l10n.t('Processing step {0} of {1}', step + 1, totalSteps));

            // Simulate work
            await this.sleep(stepDuration);
        }
    }

    /**
     * Optional initialization logic.
     * Called by the base class during start().
     *
     * @param signal AbortSignal (not used in this demo, but part of the API)
     */
    protected async onInitialize(_signal: AbortSignal): Promise<void> {
        console.log(`Initializing task: ${this.name}`);
        // Could perform resource allocation, connection setup, etc.
        await this.sleep(3000); // Simulate some initialization delay
    }

    /**
     * Optional cleanup logic when deleting.
     * Called by the base class during delete().
     */
    protected async onDelete(): Promise<void> {
        console.log(`Deleting task: ${this.name}`);
        // Could clean up temporary files, release resources, etc.
        return this.sleep(2000); // Simulate cleanup delay
    }

    /**
     * Performs cleanup operations when the task is stopped.
     * This is called from within doWork when AbortSignal is triggered.
     */
    private async cleanup(): Promise<void> {
        console.log(`Cleaning up task: ${this.name}`);
        // Could close connections, save state, etc.
        return this.sleep(2000); // Simulate cleanup delay - longer to better demonstrate stopping state
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
