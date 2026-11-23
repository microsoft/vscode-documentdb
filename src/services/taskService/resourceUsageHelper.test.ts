/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCanProceedAndInformUser } from './resourceUsageHelper';
import { type TaskService } from './taskService';
import { type TaskInfo } from './taskServiceResourceTracking';

const { showErrorMessage } = vi.hoisted(() => ({
    showErrorMessage: vi.fn((..._args: unknown[]): Promise<undefined> => Promise.resolve(undefined)),
}));

vi.mock('vscode', () => ({ window: { showErrorMessage } }));

function serviceWithConflicts(conflicts: TaskInfo[]): TaskService {
    return { getConflictingTasks: () => conflicts } as unknown as TaskService;
}

const copyTask: TaskInfo = { taskId: 't1', taskName: 'Copy users', taskType: 'copy-paste-collection' };

describe('checkCanProceedAndInformUser', () => {
    beforeEach(() => {
        showErrorMessage.mockClear();
    });

    it('defaults to English when no strings are injected', async () => {
        const canProceed = await checkCanProceedAndInformUser(
            serviceWithConflicts([copyTask]),
            { clusterId: 'c1', databaseName: 'db', collectionName: 'users' },
            'delete this collection',
        );

        expect(canProceed).toBe(false);
        expect(showErrorMessage).toHaveBeenCalledWith('Cannot delete this collection', {
            detail: 'The following tasks are currently using collection "users":\n • Copy users (copy-paste-collection)\n\nPlease stop these tasks first before proceeding.',
            modal: true,
        });
    });

    it('uses the injected strings for the title, detail and resource description', async () => {
        await checkCanProceedAndInformUser(
            serviceWithConflicts([copyTask]),
            { clusterId: 'c1', databaseName: 'db' },
            'supprimer',
            {
                cannotProceed: (operation: string): string => `Impossible de ${operation}`,
                tasksUsingResource: (resource: string, list: string): string => `${resource} utilisé par:${list}`,
                databaseDescription: (name: string): string => `base « ${name} »`,
            },
        );

        expect(showErrorMessage).toHaveBeenCalledWith('Impossible de supprimer', {
            detail: 'base « db » utilisé par: • Copy users (copy-paste-collection)',
            modal: true,
        });
    });
});
