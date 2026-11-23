/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createTaskService, DEFAULT_MAX_FINISHED_TASKS, type TaskService as TaskServiceType } from '../taskService';
import { createTaskProgressReportingService } from '../UI/taskProgressReportingService';
import { getExtensionTaskStrings } from './extensionTaskOptions';

export const TaskService: TaskServiceType = createTaskService({
    strings: getExtensionTaskStrings(),
    maxFinishedTasks: DEFAULT_MAX_FINISHED_TASKS,
});
export const TaskProgressReportingService = createTaskProgressReportingService();
