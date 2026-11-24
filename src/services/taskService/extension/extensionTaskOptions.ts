/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { type TaskOptions, type TaskStrings, type TaskTelemetryContext, type TaskTelemetryRunner } from '../taskHost';

export const extensionTaskTelemetryRunner: TaskTelemetryRunner = <T>(
    eventName: string,
    callback: (context: TaskTelemetryContext) => Promise<T>,
): Promise<T | undefined> =>
    callWithTelemetryAndErrorHandling(eventName, async (context) => {
        if (eventName === 'taskService.taskExecution') {
            // Execution-phase failures are shown by TaskProgressReportingService with a "Show Output" button.
            context.errorHandling.suppressDisplay = true;
        }
        return callback(context);
    });

export function getExtensionTaskStrings(): TaskStrings {
    return {
        taskCreated: vscode.l10n.t('Task created and ready to start'),
        cannotStartInState: (state: string): string => vscode.l10n.t('Cannot start task in state: {0}', state),
        initializingTask: vscode.l10n.t('Initializing task...'),
        stoppedDuringInitialization: vscode.l10n.t('Task stopped during initialization'),
        taskFailed: vscode.l10n.t('Task failed'),
        taskRunning: vscode.l10n.t('Task is running'),
        failedToInitializeTask: vscode.l10n.t('Failed to initialize task'),
        stoppedWithMessage: (message: string): string => vscode.l10n.t('Task stopped. {0}', message),
        taskStopped: vscode.l10n.t('Task stopped'),
        taskCompletedSuccessfully: vscode.l10n.t('Task completed successfully'),
        stoppingTask: vscode.l10n.t('Stopping task...'),
        taskAlreadyExists: (id: string): string => vscode.l10n.t('Task with ID {0} already exists', id),
        taskNotFound: (id: string): string => vscode.l10n.t('Task with ID {0} not found', id),
    };
}

export function createExtensionTaskOptions(): TaskOptions {
    return {
        logger: ext.outputChannel,
        telemetry: extensionTaskTelemetryRunner,
        strings: getExtensionTaskStrings(),
    };
}
