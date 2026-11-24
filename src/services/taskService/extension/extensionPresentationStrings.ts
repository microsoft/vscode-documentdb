/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ResourceUsageStrings, type TaskProgressStrings } from '@microsoft/vscode-ext-tasks/vscode';
import * as vscode from 'vscode';

// `unknownError` keeps its English default: the extension has never localized it.
export function getExtensionTaskProgressStrings(): Omit<TaskProgressStrings, 'unknownError'> {
    return {
        stoppingTask: vscode.l10n.t('Stopping task...'),
        stoppingTitle: (taskName: string): string => vscode.l10n.t('Stopping {0}', taskName),
        completedSuccessfully: (taskName: string): string => vscode.l10n.t('{0} completed successfully', taskName),
        wasStopped: (taskName: string): string => vscode.l10n.t('{0} was stopped', taskName),
        failed: (taskName: string, errorMessage: string): string =>
            vscode.l10n.t('{0} failed: {1}', taskName, errorMessage),
        showOutput: vscode.l10n.t('Show Output'),
    };
}

export function getExtensionResourceUsageStrings(): ResourceUsageStrings {
    return {
        cannotProceed: (operationName: string): string => vscode.l10n.t('Cannot {0}', operationName),
        tasksUsingResource: (resourceDescription: string, taskList: string): string =>
            vscode.l10n.t(
                'The following tasks are currently using {resourceDescription}:\n{taskList}\n\nPlease stop these tasks first before proceeding.',
                {
                    resourceDescription,
                    taskList,
                },
            ),
        collectionDescription: (collectionName: string): string => vscode.l10n.t('collection "{0}"', collectionName),
        databaseDescription: (databaseName: string): string => vscode.l10n.t('database "{0}"', databaseName),
        connectionDescription: (clusterId: string): string => vscode.l10n.t('connection "{0}"', clusterId),
        thisResource: vscode.l10n.t('this resource'),
    };
}
