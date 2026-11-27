/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import * as vscode from 'vscode';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ConnectionUnavailableError } from '../../documentdb/ConnectionUnavailableError';
import { CredentialCache } from '../../documentdb/CredentialCache';
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
    createEvaluator,
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
        createEvaluator: vi.fn(),
    }));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{ UserCancelledError: typeof UserCancelledError }>()),
    callWithTelemetryAndErrorHandling: (
        name: string,
        run: (context: IActionContext) => Promise<void>,
    ): Promise<void> => {
        const context = { errorHandling: {}, telemetry: { measurements: {}, properties: {} } } as IActionContext;
        contexts.set(name, context);
        const result = run(context);
        // Fire-and-forget recovery uses the real telemetry wrapper's default error suppression.
        return name === 'playground.signInAgain' ? result.catch((): undefined => undefined) : result;
    },
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getLatchReason,
        getExistingClient: vi.fn(),
        getEpoch,
        getLastVerifiedIdentity: vi.fn(),
        clearLastVerifiedIdentity: vi.fn(),
        getClient: vi.fn(),
        startAfterSignIn: vi.fn(),
        deleteClient: vi.fn(),
        latch: vi.fn(),
        unlatch: vi.fn(),
        invalidate: vi.fn(),
    },
}));

vi.mock('../signInAgain/signInAgain', () => ({
    canSignInAgainForWorker: canRecover,
    signInAgainForWorker: recover,
}));

vi.mock('../../documentdb/playground/PlaygroundEvaluator', () => ({
    PlaygroundEvaluator: class {
        constructor() {
            createEvaluator();
        }
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

    describe('stale sign-in notifications', () => {
        const uri = vscode.Uri.file('test.documentdb.js');
        let connection: PlaygroundConnection;
        let chooseAction: (choice: vscode.MessageItem | undefined) => void;
        let warning: MockInstance;
        let modal: MockInstance;
        let openDocuments: vscode.TextDocument[];
        let connectionStateCalls: MockInstance[];

        beforeEach(async (): Promise<void> => {
            connection = {
                clusterId: 'cluster',
                clusterDisplayName: 'Cluster',
                databaseName: 'test',
                entraIdentity: {
                    kind: 'entra',
                    providerId: 'microsoft',
                    accountId: 'account',
                    accountLabel: 'Account',
                    tenantId: 'tenant',
                },
            };
            getConnection.mockReturnValue(connection);
            getLatchReason.mockReturnValue(undefined);
            canRecover.mockReturnValue(true);
            openDocuments = vscode.workspace.textDocuments as vscode.TextDocument[];
            openDocuments.push({ uri: vscode.Uri.parse(uri.toString()) } as vscode.TextDocument);
            warning = vi.spyOn(vscode.window, 'showWarningMessage').mockImplementationOnce(
                () => new Promise<vscode.MessageItem | undefined>((resolve) => {
                    chooseAction = resolve;
                }),
            );
            modal = vi.spyOn(vscode.window, 'showErrorMessage');
            vi.spyOn(vscode.window, 'withProgress').mockImplementation((_options, task) =>
                Promise.resolve(
                    task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
                ),
            );
            const failure = Object.assign(new Error('private session miss'), { name: 'EntraSignInRequiredError' });
            evaluate.mockRejectedValueOnce(failure);
            await expect(executePlaygroundCode('db.stats()', 'runAll', uri)).rejects.toBe(failure);
            connectionStateCalls = [
                vi.spyOn(CredentialCache, 'getCredentials'),
                vi.spyOn(CredentialCache, 'setCredentials'),
                vi.spyOn(CredentialCache, 'deleteCredentials'),
                vi.spyOn(ClustersClient, 'getLastVerifiedIdentity'),
                vi.spyOn(ClustersClient, 'clearLastVerifiedIdentity'),
                vi.spyOn(ClustersClient, 'getClient'),
                vi.spyOn(ClustersClient, 'startAfterSignIn'),
                vi.spyOn(ClustersClient, 'deleteClient'),
                vi.spyOn(ClustersClient, 'latch'),
                vi.spyOn(ClustersClient, 'unlatch'),
                vi.spyOn(ClustersClient, 'invalidate'),
            ];
        });

        afterEach((): void => {
            stopPlaygroundEvaluator('cluster');
            openDocuments.splice(0);
            vi.restoreAllMocks();
        });

        it.each([
            ['before click', 'connectionRemoved', 'This connection was removed. Choose another connection for this playground.'],
            ['before click', 'credentialsChanged', 'This playground is bound to the previous connection. Re-pick its connection from the tree.'],
            ['before click', 'identityChanged', 'This playground is bound to the previous connection. Re-pick its connection from the tree.'],
            ['during sign-in', 'connectionRemoved', 'This connection was removed. Choose another connection for this playground.'],
            ['during sign-in', 'credentialsChanged', 'This playground is bound to the previous connection. Re-pick its connection from the tree.'],
            ['during sign-in', 'identityChanged', 'This playground is bound to the previous connection. Re-pick its connection from the tree.'],
        ] as const)('explains %s %s for the existing document only', async (stage, reason, message): Promise<void> => {
            if (stage === 'before click') {
                getEpoch.mockReturnValue(1);
                getLatchReason.mockReturnValue(reason);
            } else {
                recover.mockImplementationOnce(async (): Promise<undefined> => {
                    getLatchReason.mockReturnValue(reason);
                    return undefined;
                });
            }

            chooseAction('Sign in again' as unknown as vscode.MessageItem);
            await vi.waitFor(() => expect(warning).toHaveBeenCalledTimes(2));

            expect(warning).toHaveBeenNthCalledWith(
                1,
                'Microsoft sign-in expired for this playground. Sign in again to continue.',
                'Sign in again',
            );
            expect(warning).toHaveBeenNthCalledWith(2, message);
            expect(modal).not.toHaveBeenCalled();
            expect(recover).toHaveBeenCalledTimes(stage === 'before click' ? 0 : 1);
            expect(evaluate).toHaveBeenCalledOnce();
            expect(createEvaluator).toHaveBeenCalledOnce();
            expect(dispose).not.toHaveBeenCalled();
            expect(showResult).toHaveBeenCalledOnce();
            expect(getConnection()).toBe(connection);
            expect(canRecover).toHaveBeenCalledTimes(2);
            for (const call of connectionStateCalls) {
                expect(call).not.toHaveBeenCalled();
            }
        });

        it.each([
            ['before click', 'cancelled'],
            ['before click', 'closed'],
            ['before click', 'disposed'],
            ['before click', 'epoch only'],
            ['before click', 'unproven no latch'],
            ['before click', 're-picked healthy'],
            ['before click', 'already completed'],
            ['during sign-in', 'cancelled'],
            ['during sign-in', 'closed'],
            ['during sign-in', 'disposed'],
            ['during sign-in', 'epoch only'],
            ['during sign-in', 'unproven no latch'],
            ['during sign-in', 're-picked healthy'],
            ['during sign-in', 'already completed'],
        ] as const)('keeps %s %s quiet without replacing the worker or result', async (stage, outcome): Promise<void> => {
            const supersede = (): void => {
                if (outcome === 'closed' || outcome === 'disposed') {
                    openDocuments.splice(0);
                    openDocuments.push({ uri: vscode.Uri.file('another.documentdb.js') } as vscode.TextDocument);
                }
                if (outcome === 'disposed') {
                    stopPlaygroundEvaluator('cluster');
                    dispose.mockClear();
                }
                if (outcome === 're-picked healthy' || outcome === 'unproven no latch') {
                    getConnection.mockReturnValue({ ...connection, clusterId: 'healthy-cluster', entraIdentity: undefined });
                }
                getEpoch.mockReturnValue(2);
                getLatchReason.mockReturnValue(
                    outcome === 'closed' || outcome === 'disposed' || outcome === 'cancelled'
                        ? 'connectionRemoved'
                        : undefined,
                );
            };
            if (stage === 'before click') {
                supersede();
            } else {
                recover.mockImplementationOnce(async () => {
                    supersede();
                    if (outcome === 'cancelled') {
                        throw new UserCancelledError('playground.signInAgain');
                    }
                    return outcome === 'unproven no latch'
                        ? undefined
                        : { identity: connection.entraIdentity, epoch: 1 };
                });
            }

            chooseAction(
                stage === 'before click' && outcome === 'cancelled'
                    ? undefined
                    : 'Sign in again' as unknown as vscode.MessageItem,
            );
            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(warning).toHaveBeenCalledOnce();
            expect(modal).not.toHaveBeenCalled();
            expect(recover).toHaveBeenCalledTimes(stage === 'before click' ? 0 : 1);
            expect(evaluate).toHaveBeenCalledOnce();
            expect(createEvaluator).toHaveBeenCalledOnce();
            expect(dispose).not.toHaveBeenCalled();
            expect(showResult).toHaveBeenCalledOnce();
            expect(canRecover).toHaveBeenCalledTimes(2);
            for (const call of connectionStateCalls) {
                expect(call).not.toHaveBeenCalled();
            }
        });
    });
});
