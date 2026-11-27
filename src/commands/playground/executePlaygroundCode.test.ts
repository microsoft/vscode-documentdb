/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type ExecutionResult, type PlaygroundConnection } from '../../documentdb/playground/types';
import { disposeEvaluators, executePlaygroundCode } from './executePlaygroundCode';

const mocks = vi.hoisted(() => ({
    evaluate: vi.fn<() => Promise<ExecutionResult>>(),
    killWorker: vi.fn(),
    consoleOutputCount: 0,
    provider: { showResult: vi.fn(), focusResult: vi.fn<() => Promise<boolean>>() },
    service: { getConnection: vi.fn(), isExecuting: vi.fn(), setExecuting: vi.fn() },
    recordSurveyActivity: vi.fn(),
    notificationChoice: vi.fn<() => Promise<string | undefined>>(),
    errors: [] as { event: string; error: unknown }[],
    tasks: [] as Promise<unknown>[],
}));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@microsoft/vscode-azext-utils')>()),
    callWithTelemetryAndErrorHandling: (
        event: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ): Promise<unknown> => {
        const context = { telemetry: { properties: {}, measurements: {} }, errorHandling: {} } as IActionContext;
        const task = (async (): Promise<unknown> => {
            try {
                return await callback(context);
            } catch (error) {
                mocks.errors.push({ event, error });
                return undefined;
            }
        })();
        mocks.tasks.push(task);
        return task;
    },
}));
vi.mock('../../documentdb/ClustersClient', () => ({ ClustersClient: { getExistingClient: vi.fn() } }));
vi.mock('../../documentdb/CredentialCache', () => ({ CredentialCache: { getCredentials: vi.fn() } }));
vi.mock('../../documentdb/feedResultToSchemaStore', () => ({ feedResultToSchemaStore: vi.fn() }));
vi.mock('../../documentdb/playground/PlaygroundEvaluator', () => ({
    PlaygroundEvaluator: class {
        readonly evaluate = mocks.evaluate;
        readonly killWorker = mocks.killWorker;
        readonly sessionEvalCount = 1;
        readonly lastInitDurationMs = 0;
        get lastEvalConsoleOutputCount(): number { return mocks.consoleOutputCount; }
        dispose(): void {}
    },
}));
vi.mock('../../documentdb/playground/PlaygroundService', () => ({
    PlaygroundService: { getInstance: (): typeof mocks.service => mocks.service },
}));
vi.mock('../../documentdb/utils/getClusterMetadata', () => ({ addDomainInfoToProperties: vi.fn() }));
vi.mock('../../documentdb/utils/connectionStringHelpers', () => ({ getHostsFromConnectionString: vi.fn() }));
vi.mock('../../extensionVariables', () => ({ ext: { playgroundResultProvider: mocks.provider } }));
vi.mock('../../services/errorExplanationService', () => ({
    ErrorExplanationService: { explain: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../services/survey/SurveyService', () => ({ recordSurveyActivity: mocks.recordSurveyActivity }));
vi.mock('./connectDatabase', () => ({ promptAndConnectPlayground: vi.fn() }));

describe('executePlaygroundCode after-run behavior', () => {
    const sourceUri = vscode.Uri.file('/query.documentdb.js');
    const connection: PlaygroundConnection = { clusterId: 'cluster', clusterDisplayName: 'Cluster', databaseName: 'db' };
    const result: ExecutionResult = { type: 'Cursor', printable: [{ _id: 1 }, { _id: 2 }], durationMs: 5 };
    let cancellation: vscode.EventEmitter<void>;
    let progressFinished: boolean;
    let token: vscode.CancellationToken;

    beforeEach(() => {
        mocks.errors.length = 0;
        mocks.tasks.length = 0;
        mocks.consoleOutputCount = 0;
        mocks.evaluate.mockResolvedValue(result);
        mocks.provider.showResult.mockResolvedValue(undefined);
        mocks.provider.focusResult.mockResolvedValue(true);
        mocks.service.getConnection.mockReturnValue(connection);
        mocks.service.isExecuting.mockReturnValue(false);
        mocks.notificationChoice.mockResolvedValue(undefined);
        cancellation = new vscode.EventEmitter<void>();
        token = { isCancellationRequested: false, onCancellationRequested: cancellation.event };
        progressFinished = false;
        vi.spyOn(vscode.window, 'showInformationMessage').mockImplementation(async <T extends string | vscode.MessageItem>(
            _message: string,
            ...items: (T | vscode.MessageOptions)[]
        ): Promise<T | undefined> => {
            const choice = await mocks.notificationChoice();
            return items.find((item): item is T => {
                if (typeof item === 'string') {
                    return item === choice;
                }
                return typeof item === 'object' && 'title' in item && item.title === choice;
            });
        });
        vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
        vi.spyOn(vscode.window, 'withProgress').mockImplementation(async <R>(
            _options: vscode.ProgressOptions,
            task: (progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken) => Thenable<R>,
        ): Promise<R> => {
            try {
                return await task({ report: vi.fn() }, token);
            } finally {
                progressFinished = true;
            }
        });
    });

    afterEach(() => {
        cancellation.dispose();
        disposeEvaluators();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it.each([undefined, 'stay', 'focusResult', 'notify'] as const)('performs only the %s success outcome', async (afterRun) => {
        await executePlaygroundCode('db.test.find()', 'runSelected', sourceUri, afterRun ? { afterRun } : undefined);

        expect(mocks.provider.showResult).toHaveBeenCalledExactlyOnceWith(
            sourceUri, expect.stringContaining('// Result: Cursor (2 documents)'), { focus: afterRun === 'focusResult' },
        );
        if (afterRun === 'notify') {
            expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
                'Query completed: Cursor (2 documents)', 'Focus Result',
            );
        } else {
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        }
        expect(mocks.provider.focusResult).not.toHaveBeenCalled();
        expect(mocks.recordSurveyActivity).toHaveBeenCalledWith('queryPlayground');
        expect(mocks.service.setExecuting.mock.calls).toEqual([['cluster', true], ['cluster', false]]);
        expect(progressFinished).toBe(true);
    });

    it('uses the approved no-return message only when the worker proves the printable was undefined', async () => {
        mocks.evaluate.mockResolvedValue({ type: null, printable: undefined, printableIsUndefined: true, durationMs: 5 });

        await executePlaygroundCode('const a = 1', 'runAll', sourceUri, { afterRun: 'notify' });

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Query completed without a return value.', 'Focus Result',
        );
    });

    it.each([
        [null, 'null'],
        [42, 'number'],
    ] as const)('truthfully announces an untyped printable %j instead of claiming no return value', async (printable, description) => {
        mocks.evaluate.mockResolvedValue({ type: null, printable, durationMs: 5 });

        await executePlaygroundCode('db.test.findOne()', 'runAll', sourceUri, { afterRun: 'notify' });

        expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
            `Query completed: ${description}`, 'Focus Result',
        );
        expect(mocks.provider.showResult).toHaveBeenCalledExactlyOnceWith(
            sourceUri, expect.any(String), { focus: false },
        );
    });

    it.each([undefined, 'Focus Result'])('finishes progress and unlocks execution before the notification choice %s', async (choice) => {
        let choose: ((value: string | undefined) => void) | undefined;
        const notification = new Promise<string | undefined>((resolve) => { choose = resolve; });
        mocks.notificationChoice.mockReturnValueOnce(notification);

        await executePlaygroundCode('db.test.find()', 'runAll', sourceUri, { afterRun: 'notify' });

        expect(progressFinished).toBe(true);
        expect(mocks.service.setExecuting).toHaveBeenLastCalledWith('cluster', false);
        expect(mocks.provider.focusResult).not.toHaveBeenCalled();
        choose?.(choice);
        await Promise.all(mocks.tasks);
        if (choice) {
            expect(mocks.provider.focusResult).toHaveBeenCalledExactlyOnceWith(sourceUri);
        } else {
            expect(mocks.provider.focusResult).not.toHaveBeenCalled();
        }
        expect(mocks.errors).toEqual([]);
    });

    it('reports a result closed before the notification action is chosen', async () => {
        mocks.notificationChoice.mockResolvedValueOnce('Focus Result');
        mocks.provider.focusResult.mockResolvedValue(false);

        await executePlaygroundCode('db.test.find()', 'runAll', sourceUri, { afterRun: 'notify' });
        await Promise.all(mocks.tasks);

        expect(vscode.window.showInformationMessage).toHaveBeenLastCalledWith('No Query Playground result is open.');
    });

    it.each(['notification', 'focus'])('handles a failed fire-and-forget %s through the telemetry/error wrapper', async (failure) => {
        const error = new Error('Action failed');
        if (failure === 'notification') {
            mocks.notificationChoice.mockRejectedValueOnce(error);
        } else {
            mocks.notificationChoice.mockResolvedValueOnce('Focus Result');
            mocks.provider.focusResult.mockRejectedValue(error);
        }

        await executePlaygroundCode('db.test.find()', 'runAll', sourceUri, { afterRun: 'notify' });
        await Promise.all(mocks.tasks);

        expect(mocks.errors).toEqual([{ event: 'playground.afterRun.notify', error }]);
        expect(progressFinished).toBe(true);
    });

    it.each(['stay', 'focusResult', 'notify'] as const)('preserves the existing error result and notification for %s', async (afterRun) => {
        const error = new Error('Query failed');
        mocks.evaluate.mockRejectedValue(error);

        await executePlaygroundCode('db.test.find()', 'runAll', sourceUri, { afterRun });

        expect(mocks.provider.showResult).toHaveBeenCalledExactlyOnceWith(
            sourceUri, expect.stringContaining('Query failed'),
        );
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith('Query playground execution failed: Query failed');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(mocks.provider.focusResult).not.toHaveBeenCalled();
        expect(mocks.recordSurveyActivity).not.toHaveBeenCalled();
        expect(mocks.errors).toEqual([{ event: 'playground.execute', error }]);
        expect(mocks.service.setExecuting).toHaveBeenLastCalledWith('cluster', false);
    });

    it.each(['focusResult', 'notify'] as const)('keeps focus and skips completion when a cancelled evaluation still succeeds (%s)', async (afterRun) => {
        mocks.evaluate.mockImplementation(async () => {
            cancellation.fire();
            return result;
        });

        await executePlaygroundCode('db.test.find()', 'runAll', sourceUri, { afterRun });

        expect(mocks.killWorker).toHaveBeenCalledOnce();
        expect(mocks.provider.showResult).toHaveBeenCalledExactlyOnceWith(sourceUri, expect.any(String), { focus: false });
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(mocks.recordSurveyActivity).not.toHaveBeenCalled();
    });

    it('keeps focus and suppresses error/success UI when worker cancellation rejects', async () => {
        mocks.evaluate.mockImplementation(async () => {
            cancellation.fire();
            throw new Error('Worker killed');
        });

        await executePlaygroundCode('db.test.find()', 'runAll', sourceUri, { afterRun: 'notify' });

        expect(mocks.provider.showResult).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(mocks.errors).toEqual([{
            event: 'playground.execute', error: expect.objectContaining({ stepName: 'playground.execute', _isUserCancelledError: true }),
        }]);
        expect(mocks.service.setExecuting).toHaveBeenLastCalledWith('cluster', false);
    });

    it('does not focus or notify when progress was cancelled before its callback', async () => {
        token = { ...token, isCancellationRequested: true };

        await executePlaygroundCode('db.test.find()', 'runAll', sourceUri, { afterRun: 'focusResult' });

        expect(mocks.provider.showResult).toHaveBeenCalledWith(sourceUri, expect.any(String), { focus: false });
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(mocks.recordSurveyActivity).not.toHaveBeenCalled();
    });

    it('retains the existing console output hint in the result', async () => {
        mocks.consoleOutputCount = 1;

        await executePlaygroundCode('print(1)', 'runAll', sourceUri);

        expect(mocks.provider.showResult).toHaveBeenCalledWith(
            sourceUri,
            expect.stringContaining('\n\n// Note: Output was printed to the "DocumentDB Query Playground Output" channel'),
            { focus: false },
        );
    });
});
