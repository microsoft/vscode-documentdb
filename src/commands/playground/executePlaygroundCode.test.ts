/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { executePlaygroundCode, stopPlaygroundEvaluator } from './executePlaygroundCode';

const { evaluate, dispose, setExecuting, showResult } = vi.hoisted(() => ({
    evaluate: vi.fn(),
    dispose: vi.fn(),
    setExecuting: vi.fn(),
    showResult: vi.fn(),
}));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@microsoft/vscode-azext-utils')>()),
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
});
