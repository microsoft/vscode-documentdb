/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { createTaskService, Task } from '../taskService';
import { createTaskProgressReportingService } from './taskProgressReportingService';

const { progressPromises } = vi.hoisted(() => ({ progressPromises: [] as Array<Promise<void>> }));

vi.mock('../../../extensionVariables', () => ({ ext: {} }));

vi.mock('vscode', () => ({
    ProgressLocation: { Notification: 15 },
    l10n: { t: (key: string): string => key },
    window: {
        withProgress: vi.fn(
            (
                _options: unknown,
                callback: (
                    progress: { report: () => void },
                    token: { isCancellationRequested: boolean; onCancellationRequested: () => void },
                ) => Promise<void>,
            ): Promise<void> => {
                const promise = callback(
                    { report: vi.fn() },
                    { isCancellationRequested: false, onCancellationRequested: vi.fn() },
                );
                progressPromises.push(promise);
                return promise;
            },
        ),
    },
}));

class PendingTask extends Task {
    public readonly type = 'pending-test';
    public readonly name = 'Pending Task';

    constructor() {
        super();
    }

    protected doWork(): Promise<void> {
        return Promise.resolve();
    }
}

describe('TaskProgressReportingService', () => {
    it('detach() closes every active progress notification', async () => {
        const taskService = createTaskService();
        const reporting = createTaskProgressReportingService();
        reporting.attach(taskService);
        const tasks = [new PendingTask(), new PendingTask()];
        tasks.forEach((task) => taskService.registerTask(task));
        expect(reporting.getActiveReports()).toEqual(tasks.map((task) => task.id));

        reporting.detach();

        expect(reporting.getActiveReports()).toEqual([]);
        await expect(Promise.all(progressPromises)).resolves.toBeDefined();
    });
});
