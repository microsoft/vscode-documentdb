/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ConnectionUnavailableError } from '../../documentdb/ConnectionUnavailableError';
import { type PlaygroundConnection } from '../../documentdb/playground/types';
import { executePlaygroundCode, stopPlaygroundEvaluator } from './executePlaygroundCode';

const {
    evaluate,
    dispose,
    setExecuting,
    showResult,
    getConnection,
    getLatchReason,
    getEpoch,
    canRecover,
    recover,
    contexts,
} = vi.hoisted(() => ({
        evaluate: vi.fn(),
        dispose: vi.fn(),
        setExecuting: vi.fn(),
        showResult: vi.fn(),
        getConnection: vi.fn<() => PlaygroundConnection | undefined>(),
        getLatchReason: vi.fn(),
        getEpoch: vi.fn<() => number>(),
        canRecover: vi.fn(),
        recover: vi.fn(),
        contexts: new Map<string, IActionContext>(),
    }));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{ UserCancelledError: typeof UserCancelledError }>()),
    callWithTelemetryAndErrorHandling: (
        name: string,
        run: (context: IActionContext) => Promise<void>,
    ): Promise<void> => {
        const context = { errorHandling: {}, telemetry: { measurements: {}, properties: {} } } as IActionContext;
        contexts.set(name, context);
        return run(context);
    },
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getLatchReason, getExistingClient: vi.fn(), getEpoch },
}));

vi.mock('../signInAgain/signInAgain', () => ({
    canSignInAgainForWorker: canRecover,
    signInAgainForWorker: recover,
}));

vi.mock('../../documentdb/playground/PlaygroundEvaluator', () => ({
    PlaygroundEvaluator: class {
        evaluate = evaluate;
        dispose = dispose;
        sessionDomainProperties = { domainInfo_isAzure: 'true' };
    },
}));

vi.mock('../../documentdb/playground/PlaygroundService', () => ({
    PlaygroundService: {
        getInstance: () => ({
            getConnection,
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
        contexts.clear();
        getConnection.mockReturnValue({ clusterId: 'cluster', clusterDisplayName: 'Cluster', databaseName: 'test' });
        getEpoch.mockReturnValue(0);
        canRecover.mockReturnValue(false);
    });

    it.each([
        [
            'userDisconnected',
            'This connection is disconnected. Reconnect from the tree, then run the script again.',
        ],
        [
            'unreachable',
            'The connection is unavailable. Check the server or network, then run the script again.',
        ],
        [
            'credentialsRejected',
            'The saved credentials were rejected. Update them from the tree, then run the script again.',
        ],
        [
            'credentialsUpdating',
            'This connection is being updated. Run the script again when the update finishes.',
        ],
        [
            'connectionRemoved',
            'This connection was removed. Choose another connection for this playground.',
        ],
        [
            'credentialsChanged',
            'This playground is bound to the previous connection. Re-pick its connection from the tree.',
        ],
        [
            'identityChanged',
            'This playground is bound to the previous connection. Re-pick its connection from the tree.',
        ],
        [
            'credentialsMissing',
            'This connection is unavailable. Reconnect from the tree, then run the script again.',
        ],
        [
            'signInRequired',
            'This connection is unavailable. Reconnect from the tree, then run the script again.',
        ],
    ] as const)('uses %s guidance for latch and worker failures', async (reason, message) => {
        getLatchReason.mockReturnValueOnce(reason);
        const showWarning = vi.spyOn(vscode.window, 'showWarningMessage');
        const progress = vi
            .spyOn(vscode.window, 'withProgress')
            .mockImplementation((_options, task) =>
                Promise.resolve(
                    task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
                ),
            );

        try {
            const uri = vscode.Uri.file('test.documentdb.js');
            await executePlaygroundCode('db.stats()', 'runAll', uri);
            expect(showWarning).toHaveBeenCalledExactlyOnceWith(message);
            expect(evaluate).not.toHaveBeenCalled();
            expect(setExecuting).not.toHaveBeenCalled();

            showWarning.mockClear();
            const failure = new ConnectionUnavailableError(reason);
            evaluate.mockRejectedValueOnce(failure);

            await expect(executePlaygroundCode('db.stats()', 'runAll', uri)).rejects.toBe(failure);
            expect(showResult).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.stringContaining(message));
            expect(evaluate).toHaveBeenCalledOnce();
            expect(showWarning).not.toHaveBeenCalled();
        } finally {
            progress.mockRestore();
            showWarning.mockRestore();
            stopPlaygroundEvaluator('cluster');
        }
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

    it('keeps the worker destination properties on a warm run', async () => {
        const failure = Object.assign(new Error('token unavailable'), { name: 'TokenCallbackError' });
        evaluate.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure);
        const progress = vi
            .spyOn(vscode.window, 'withProgress')
            .mockImplementation((_options, task) =>
                Promise.resolve(
                    task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
                ),
            );
        try {
            const uri = vscode.Uri.file('test.documentdb.js');
            await expect(executePlaygroundCode('db.stats()', 'runAll', uri)).rejects.toBe(failure);
            await expect(executePlaygroundCode('db.stats()', 'runAll', uri)).rejects.toBe(failure);
            expect(contexts.get('playground.execute')?.telemetry.properties).toMatchObject({
                isNewEvaluator: 'false',
                domainInfo_isAzure: 'true',
            });
        } finally {
            progress.mockRestore();
            stopPlaygroundEvaluator('cluster');
        }
    });

    it.each([false, true])('honors the sign-in epoch unless superseded (%s)', async (superseded) => {
        const identity: NonNullable<PlaygroundConnection['entraIdentity']> = {
            kind: 'entra',
            providerId: 'microsoft',
            accountId: 'account',
            accountLabel: 'Account',
            tenantId: 'tenant',
        };
        getConnection.mockReturnValue({
            clusterId: 'cluster',
            clusterDisplayName: 'Cluster',
            databaseName: 'test',
            entraIdentity: identity,
        });
        canRecover.mockReturnValue(true);
        recover.mockImplementationOnce(async () => {
            getEpoch.mockReturnValue(superseded ? 2 : 1);
            return { identity, epoch: 1 };
        });
        const failure = Object.assign(new Error('private session miss'), { name: 'EntraSignInRequiredError' });
        evaluate.mockRejectedValueOnce(failure);
        const warning = vi
            .spyOn(vscode.window, 'showWarningMessage')
            .mockResolvedValue('Sign in again' as unknown as vscode.MessageItem);
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
            const signInContext = contexts.get('playground.signInAgain');
            expect(signInContext).toBeDefined();
            expect(signInContext).not.toBe(contexts.get('playground.execute'));
            expect(recover).toHaveBeenCalledExactlyOnceWith(signInContext, 'cluster', identity);
            expect(evaluate).toHaveBeenCalledOnce();
            expect(dispose).toHaveBeenCalledTimes(superseded ? 0 : 1);
        } finally {
            progress.mockRestore();
            warning.mockRestore();
            stopPlaygroundEvaluator('cluster');
        }
    });
});
