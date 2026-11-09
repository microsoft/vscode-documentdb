/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface TaskLogger {
    appendLine(value: string): void;
    trace(message: string): void;
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string | Error): void;
}

export interface TaskTelemetryContext {
    telemetry: {
        // The object form structurally matches vscode's TelemetryTrustedValue<string>.
        properties: Record<string, string | { readonly value: string } | undefined>;
        measurements: Record<string, number | undefined>;
    };
}

export type TaskTelemetryRunner = <T>(
    eventName: string,
    callback: (context: TaskTelemetryContext) => Promise<T>,
) => Promise<T | undefined>;

export interface TaskStrings {
    taskCreated: string;
    cannotStartInState: (state: string) => string;
    initializingTask: string;
    stoppedDuringInitialization: string;
    taskFailed: string;
    taskRunning: string;
    failedToInitializeTask: string;
    stoppedWithMessage: (message: string) => string;
    taskStopped: string;
    taskCompletedSuccessfully: string;
    stoppingTask: string;
    taskAlreadyExists: (id: string) => string;
    taskNotFound: (id: string) => string;
}

export const defaultTaskStrings: TaskStrings = {
    taskCreated: 'Task created and ready to start',
    cannotStartInState: (state: string): string => `Cannot start task in state: ${state}`,
    initializingTask: 'Initializing task...',
    stoppedDuringInitialization: 'Task stopped during initialization',
    taskFailed: 'Task failed',
    taskRunning: 'Task is running',
    failedToInitializeTask: 'Failed to initialize task',
    stoppedWithMessage: (message: string): string => `Task stopped. ${message}`,
    taskStopped: 'Task stopped',
    taskCompletedSuccessfully: 'Task completed successfully',
    stoppingTask: 'Stopping task...',
    taskAlreadyExists: (id: string): string => `Task with ID ${id} already exists`,
    taskNotFound: (id: string): string => `Task with ID ${id} not found`,
};

export interface TaskOptions {
    logger?: TaskLogger;
    telemetry?: TaskTelemetryRunner;
    strings?: Partial<TaskStrings>;
}
