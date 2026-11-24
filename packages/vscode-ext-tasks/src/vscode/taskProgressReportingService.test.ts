/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTaskService, Task } from '../taskService.js';
import { createTaskProgressReportingService } from './taskProgressReportingService.js';

const { progressPromises, showErrorMessage, showInformationMessage } = vi.hoisted(() => ({
    progressPromises: [] as Array<Promise<void>>,
    showErrorMessage: vi.fn((..._args: unknown[]): Promise<string | undefined> => Promise.resolve(undefined)),
    showInformationMessage: vi.fn((..._args: unknown[]): Promise<string | undefined> => Promise.resolve(undefined)),
}));

vi.mock('vscode', () => ({
    ProgressLocation: { Notification: 15 },
    window: {
        showErrorMessage,
        showInformationMessage,
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

class FailingTask extends Task {
    public readonly type = 'failing-test';
    public readonly name = 'Failing Task';

    constructor() {
        super();
    }

    protected doWork(): Promise<void> {
        return Promise.reject(new Error('boom'));
    }
}

describe('TaskProgressReportingService', () => {
    beforeEach(() => {
        showErrorMessage.mockClear();
        showInformationMessage.mockClear();
    });

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

    it('uses the injected strings and runs showOutput when its injected label is chosen', async () => {
        const showOutput = vi.fn();
        showErrorMessage.mockResolvedValueOnce('Afficher la sortie');
        const taskService = createTaskService();
        const reporting = createTaskProgressReportingService({
            strings: {
                failed: (name: string, error: string): string => `${name} a échoué : ${error}`,
                showOutput: 'Afficher la sortie',
            },
            showOutput,
        });
        reporting.attach(taskService);
        const task = new FailingTask();
        taskService.registerTask(task);

        await task.start();

        await vi.waitFor(() => expect(showOutput).toHaveBeenCalledTimes(1));
        expect(showErrorMessage).toHaveBeenCalledWith('Failing Task a échoué : boom', 'Afficher la sortie');
        reporting.detach();
    });

    it('does not run showOutput when the notification is dismissed', async () => {
        const showOutput = vi.fn();
        const taskService = createTaskService();
        const reporting = createTaskProgressReportingService({ showOutput });
        reporting.attach(taskService);
        const task = new FailingTask();
        taskService.registerTask(task);

        await task.start();

        await vi.waitFor(() =>
            expect(showErrorMessage).toHaveBeenCalledWith('Failing Task failed: boom', 'Show Output'),
        );
        await Promise.resolve();
        expect(showOutput).not.toHaveBeenCalled();
        reporting.detach();
    });

    it('defaults to English and offers no Show Output button without a showOutput callback', async () => {
        const taskService = createTaskService();
        const reporting = createTaskProgressReportingService();
        reporting.attach(taskService);
        const failing = new FailingTask();
        const passing = new PendingTask();
        taskService.registerTask(failing);
        taskService.registerTask(passing);

        await failing.start();
        await passing.start();

        await vi.waitFor(() => expect(showErrorMessage).toHaveBeenCalledWith('Failing Task failed: boom'));
        await vi.waitFor(() =>
            expect(showInformationMessage).toHaveBeenCalledWith('Pending Task completed successfully'),
        );
        reporting.detach();
    });
});
