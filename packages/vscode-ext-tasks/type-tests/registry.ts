/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Example starts here.
import {
    createTaskService,
    type Task,
    type TaskService,
    type TaskStatus,
    whenTerminal,
} from '@microsoft/vscode-ext-tasks';
import { checkCanProceedAndInformUser, createTaskProgressReportingService } from '@microsoft/vscode-ext-tasks/vscode';

export function createTaskHost(showOutput: () => void): { service: TaskService; dispose: () => void } {
    const service = createTaskService({ maxFinishedTasks: 20 });
    const reporter = createTaskProgressReportingService({ showOutput });
    reporter.attach(service);
    return { service, dispose: () => reporter.detach() };
}

export async function runTask(service: TaskService, task: Task): Promise<TaskStatus> {
    service.registerTask(task);
    await task.start();
    await whenTerminal(task);
    return task.getStatus();
}

export async function deleteCollection(
    service: TaskService,
    clusterId: string,
    databaseName: string,
    collectionName: string,
    operationName: string,
    performDelete: () => Promise<void>,
): Promise<boolean> {
    const resource = { clusterId, databaseName, collectionName };
    if (!(await checkCanProceedAndInformUser(service, resource, operationName))) {
        return false;
    }
    await performDelete();
    return true;
}
