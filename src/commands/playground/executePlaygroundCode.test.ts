/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { executePlaygroundCode, stopPlaygroundEvaluator } from './executePlaygroundCode';

const { evaluate, dispose, setExecuting, showResult } = vi.hoisted(() => ({
    evaluate: vi.fn(),
    dispose: vi.fn(),
    setExecuting: vi.fn(),
    showResult: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{ UserCancelledError: typeof UserCancelledError }>()),
    callWithTelemetryAndErrorHandling: (
        _name: string,
        run: (context: IActionContext) => Promise<void>,
    ): Promise<void> => run({ errorHandling: {}, telemetry: { measurements: {}, properties: {} } } as IActionContext),
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getLatchReason: vi.fn(), getExistingClient: vi.fn() },
}));

vi.mock('../../documentdb/playground/PlaygroundEvaluator', () => ({
    PlaygroundEvaluator: class {
        evaluate = evaluate;
        dispose = dispose;
    },
}));

vi.mock('../../documentdb/playground/PlaygroundService', () => ({
    PlaygroundService: {
        getInstance: () => ({
            getConnection: () => ({ clusterId: 'cluster', clusterDisplayName: 'Cluster', databaseName: 'test' }),
            isExecuting: () => false,
            setExecuting,
        }),
    },
}));

vi.mock('../../extensionVariables', () => ({
    ext: { playgroundResultProvider: { showResult } },
}));

describe('executePlaygroundCode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('cancels a stopped worker without replacing the retained result or showing an error', async () => {
        let stopEvaluation: (error: Error) => void = () => {};
        evaluate.mockImplementation(
            () =>
                new Promise((_resolve, reject) => {
                    stopEvaluation = reject;
                }),
        );
        dispose.mockImplementation(() => {
            stopEvaluation(new Error('Worker terminated'));
        });
        const showError = vi.spyOn(vscode.window, 'showErrorMessage');
        const progress = vi
            .spyOn(vscode.window, 'withProgress')
            .mockImplementation((_options, task) =>
                Promise.resolve(
                    task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
                ),
            );

        try {
            const run = executePlaygroundCode('db.stats()', 'runAll', vscode.Uri.file('test.documentdb.js'));
            expect(evaluate).toHaveBeenCalledOnce();
            stopPlaygroundEvaluator('cluster');
            await expect(run).rejects.toBeInstanceOf(UserCancelledError);
            expect(showResult).not.toHaveBeenCalled();
            expect(showError).not.toHaveBeenCalled();
            expect(setExecuting).toHaveBeenLastCalledWith('cluster', false);
        } finally {
            progress.mockRestore();
            showError.mockRestore();
            stopPlaygroundEvaluator('cluster');
        }
    });

    it('writes one actionable result for a bounded worker failure without an unsolicited modal', async () => {
        const failure = Object.assign(new Error('private callback details'), {
            name: 'TokenCallbackError',
        });
        evaluate.mockRejectedValueOnce(failure);
        const showError = vi.spyOn(vscode.window, 'showErrorMessage');
        const showWarning = vi.spyOn(vscode.window, 'showWarningMessage');
        const progress = vi
            .spyOn(vscode.window, 'withProgress')
            .mockImplementation((_options, task) =>
                Promise.resolve(
                    task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
                ),
            );

        try {
            await expect(
                executePlaygroundCode('db.stats()', 'runAll', vscode.Uri.file('test.documentdb.js')),
            ).rejects.toBe(failure);
            expect(showResult).toHaveBeenCalledExactlyOnceWith(
                expect.anything(),
                expect.stringContaining(
                    'The sign-in token could not be refreshed. Run the query again to reconnect with the same connection.',
                ),
            );
            expect(showResult.mock.calls[0][1]).not.toContain('private callback details');
            expect(showError).not.toHaveBeenCalled();
            expect(showWarning).not.toHaveBeenCalled();
        } finally {
            progress.mockRestore();
            showError.mockRestore();
            showWarning.mockRestore();
            stopPlaygroundEvaluator('cluster');
        }
    });
});
