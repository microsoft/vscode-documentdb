/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Disposable } from '../events';
import { type TaskLogger } from '../taskHost';
import { TaskState, type TaskService } from '../taskService';

export function attachTaskLifecycleLogger(service: TaskService, logger: TaskLogger): Disposable {
    return service.onDidChangeTaskState((e) => {
        const task = service.getTask(e.taskId);
        if (!task) {
            return;
        }

        const status = task.getStatus();
        const msg = status.message ?? '';
        switch (e.newState) {
            case TaskState.Initializing:
                logger.appendLine(`○ Task '${task.name}' initializing...`);
                break;
            case TaskState.Running:
                logger.appendLine(`► Task '${task.name}' starting...`);
                break;
            case TaskState.Completed:
                logger.appendLine(`✓ Task '${task.name}' completed successfully. ${msg}`);
                break;
            case TaskState.Stopped:
                logger.appendLine(`■ Task '${task.name}' was stopped. ${msg}`);
                break;
            case TaskState.Failed: {
                const err = status.error instanceof Error ? status.error.message : '';
                const detail = err ? ` Error: ${err}` : '';
                logger.error(`! Task '${task.name}' failed. ${`${msg}${detail}`.trim()}`);
                break;
            }
        }
    });
}
