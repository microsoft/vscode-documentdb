/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as azureAuth from '@microsoft/vscode-azext-azureauth';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { type callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type AuthTraceContext } from '../../utils/authTrace';
import { AuthMethodId } from '../auth/AuthMethod';
import type * as documentdbTokenResource from '../auth/documentdbTokenResource';
import {
    type ResolvedTokenResource,
    type resolveInteractiveTokenResource,
    type resolveManagedIdentityTokenResource,
} from '../auth/documentdbTokenResource';
import {
    getRecentEntraTokenFailure,
    recordEntraTokenFailure,
    resetEntraTokenFailuresForTests,
} from '../auth/entraErrors/entraTokenFailures';
import { ClustersClient } from '../ClustersClient';
import { type getManagedIdentityAccessToken } from '../auth/managedIdentityTokenProvider';
import { type CachedClusterCredentials } from '../CredentialCache';
import { PlaygroundEvaluator } from './PlaygroundEvaluator';
import { type WorkerSessionCallbacks } from './WorkerSessionManager';
import { getWorkerAuthReason, type MainToWorkerMessage, type WorkerToMainMessage } from './workerTypes';

type InitMessage = Extract<MainToWorkerMessage, { type: 'init' }>;
type TokenRequest = Extract<WorkerToMainMessage, { type: 'tokenRequest' }>;

const mocks = vi.hoisted(() => ({
    getCredentials: vi.fn<(clusterId: string) => CachedClusterCredentials | undefined>(),
    getConnectionStringWithPassword: vi.fn<(clusterId: string) => string>(),
    interactiveToken:
        vi.fn<
            (
                provider: string,
                scopes: readonly string[],
                options?: vscode.AuthenticationGetSessionOptions,
            ) => Promise<vscode.AuthenticationSession | undefined>
        >(),
    configuredProvider: vi.fn<() => string>(),
    managedIdentityToken: vi.fn<typeof getManagedIdentityAccessToken>(),
    resolveInteractive: vi.fn<typeof resolveInteractiveTokenResource>(),
    resolveManagedIdentity: vi.fn<typeof resolveManagedIdentityTokenResource>(),
    callbacks: undefined as WorkerSessionCallbacks | undefined,
    initMessage: undefined as InitMessage | undefined,
    clusterId: undefined as string | undefined,
    worker: {
        isConnectedTo: vi.fn<(clusterId: string) => boolean>(),
        sendEval: vi.fn<(message: MainToWorkerMessage) => Promise<{ result: { type: string; printable: string; durationMs: number } }>>(),
        killWorker: vi.fn(),
    },
}));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{ callWithTelemetryAndErrorHandling: typeof callWithTelemetryAndErrorHandling }>()),
    callWithTelemetryAndErrorHandling: async (
        _eventName: string,
        callback: (context: IActionContext) => Promise<unknown>,
    ): Promise<unknown> =>
        callback({
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
        } as unknown as IActionContext),
}));

vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            trace: vi.fn(),
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    },
}));

vi.mock('../CredentialCache', () => ({
    CredentialCache: {
        getCredentials: mocks.getCredentials,
        getConnectionStringWithPassword: mocks.getConnectionStringWithPassword,
    },
}));

vi.mock('@microsoft/vscode-azext-azureauth', async (importOriginal) => ({
    ...(await importOriginal<typeof azureAuth>()),
    getConfiguredAuthProviderId: mocks.configuredProvider,
    getConfiguredAzureEnv: () => ({ name: 'AzureCloud' }),
}));

vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    authentication: { getSession: mocks.interactiveToken },
}));

vi.mock('../auth/managedIdentityTokenProvider', () => ({
    getManagedIdentityAccessToken: mocks.managedIdentityToken,
}));

vi.mock('../auth/documentdbTokenResource', async (importOriginal) => ({
    ...(await importOriginal<typeof documentdbTokenResource>()),
    resolveInteractiveTokenResource: mocks.resolveInteractive,
    resolveManagedIdentityTokenResource: mocks.resolveManagedIdentity,
}));

vi.mock('./WorkerSessionManager', () => ({
    WorkerSessionManager: vi.fn().mockImplementation(function (callbacks: WorkerSessionCallbacks) {
        mocks.callbacks = callbacks;
        return {
            ...mocks.worker,
            ensureWorker: vi.fn(async (clusterId: string, initMessage: InitMessage): Promise<void> => {
                mocks.clusterId = clusterId;
                mocks.initMessage = initMessage;
            }),
            get workerClusterId(): string | undefined {
                return mocks.clusterId;
            },
            shutdown: vi.fn(),
            dispose: vi.fn(),
        };
    }),
}));

describe('PlaygroundEvaluator token relay lifecycle', () => {
    const clusterId = 'playground-cluster';
    const originalConnection = 'mongodb://original.mongocluster.cosmos.azure.com/';
    const accessToken = 'private-access-token';
    const accountLabel = 'private-account@example.com';
    const resolution: ResolvedTokenResource = {
        resource: 'https://ossrdbms-aad.database.windows.net',
        scope: 'https://ossrdbms-aad.database.windows.net/.default',
        cloudCategory: 'public',
        reason: 'host',
        details: { flow: 'interactive', cloudCategory: 'public', reason: 'host' },
    };
    const traceContext: AuthTraceContext = {
        startupCorrelationId: 'playground-startup',
        surface: 'playground',
    };
    let evaluator: PlaygroundEvaluator;
    let customSuffix: string | undefined;

    beforeEach((): void => {
        vi.clearAllMocks();
        resetEntraTokenFailuresForTests();
        mocks.callbacks = undefined;
        mocks.initMessage = undefined;
        mocks.clusterId = undefined;
        mocks.configuredProvider.mockReturnValue('microsoft');
        mocks.worker.isConnectedTo.mockReturnValue(false);
        mocks.worker.sendEval.mockResolvedValue({ result: { type: 'number', printable: '1', durationMs: 0 } });
        customSuffix = undefined;
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn((_key: string, defaultValue: unknown): unknown => defaultValue),
            inspect: vi.fn(() => ({ globalValue: { hostnameSuffix: customSuffix } })),
        } as unknown as vscode.WorkspaceConfiguration);
        mocks.resolveInteractive.mockResolvedValue(resolution);
        mocks.resolveManagedIdentity.mockResolvedValue(resolution);
        mocks.interactiveToken.mockResolvedValue({
            id: 'private-session',
            accessToken,
            account: { id: 'private-account', label: accountLabel },
            scopes: [resolution.scope],
        });
        mocks.managedIdentityToken.mockResolvedValue({ accessToken, expiresOnTimestamp: 4_000_000_000_000 });
        evaluator = new PlaygroundEvaluator();
    });

    afterEach((): void => {
        expect(mocks.getCredentials).not.toHaveBeenCalled();
        expect(mocks.getConnectionStringWithPassword).not.toHaveBeenCalled();
        evaluator.dispose();
    });

    async function initializeSession(
        authMechanism: AuthMethodId,
        connectionString: string = originalConnection,
    ): Promise<InitMessage> {
        mocks.getCredentials.mockReturnValue({
            clusterId,
            connectionString,
            authMechanism,
            entraIdConfig: { tenantId: 'interactive-tenant' },
            managedIdentityConfig: { tenantId: 'managed-tenant', clientId: 'managed-client' },
        });
        mocks.getConnectionStringWithPassword.mockReturnValue(connectionString);
        await evaluator.evaluate({ clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' }, '1');
        const init = mocks.initMessage;
        if (!init) {
            throw new Error('Expected the evaluator to initialize its worker');
        }
        expect(mocks.getCredentials).toHaveBeenCalledWith(clusterId);
        // Token relays must never consult credentials changed since worker initialization.
        mocks.getCredentials.mockClear().mockImplementation((): never => {
            throw new Error('Live credential-cache reads are forbidden during token relay');
        });
        mocks.getConnectionStringWithPassword.mockClear().mockImplementation((): never => {
            throw new Error('Live connection-string reads are forbidden during token relay');
        });
        return init;
    }

    async function requestToken(
        request: TokenRequest,
        isCurrent: () => boolean = () => true,
    ): Promise<Mock<(response: MainToWorkerMessage) => void>> {
        const handler = mocks.callbacks?.onTokenRequest;
        if (!handler) {
            throw new Error('Expected the evaluator to register its token handler');
        }
        const postResponse = vi.fn<(response: MainToWorkerMessage) => void>();
        await handler(request, postResponse, isCurrent, undefined, traceContext);
        return postResponse;
    }

    function expectNoTokenAcquisition(): void {
        expect(mocks.resolveInteractive).not.toHaveBeenCalled();
        expect(mocks.resolveManagedIdentity).not.toHaveBeenCalled();
        expect(mocks.interactiveToken).not.toHaveBeenCalled();
        expect(mocks.managedIdentityToken).not.toHaveBeenCalled();
    }

    const connection = { clusterId, clusterDisplayName: 'Test Cluster', databaseName: 'test' };

    it('uses a verified cluster identity silently on the first relay', async (): Promise<void> => {
        const verified = vi.spyOn(ClustersClient, 'getLastVerifiedIdentity').mockReturnValue({
            kind: 'entra',
            providerId: 'microsoft',
            tenantId: 'interactive-tenant',
            accountId: 'private-account',
            accountLabel,
        });
        try {
            await initializeSession(AuthMethodId.MicrosoftEntraID);
            const response = await requestToken({ type: 'tokenRequest', requestId: 'first-silent' });
            expect(response).toHaveBeenCalledWith(expect.objectContaining({ type: 'tokenResponse' }));
            expect(mocks.interactiveToken).toHaveBeenCalledExactlyOnceWith(
                'microsoft',
                [resolution.scope, 'VSCODE_TENANT:interactive-tenant'],
                { silent: true, account: { id: 'private-account', label: accountLabel } },
            );
        } finally {
            verified.mockRestore();
        }
    });

    it('fails closed for a changed account or provider and does not return either token', async (): Promise<void> => {
        await initializeSession(AuthMethodId.MicrosoftEntraID);
        await requestToken({ type: 'tokenRequest', requestId: 'first' });
        mocks.interactiveToken.mockResolvedValueOnce({
            id: 'other-session',
            account: { id: 'other-account', label: 'other-account' },
            scopes: [resolution.scope],
            accessToken: 'other-token',
        });
        const mismatch = await requestToken({ type: 'tokenRequest', requestId: 'different-account' });
        expect(mismatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'tokenError', reason: 'identityMismatch' }));
        mocks.configuredProvider.mockReturnValue('microsoft-sovereign-cloud');
        const changed = await requestToken({ type: 'tokenRequest', requestId: 'different-provider' });
        expect(changed).toHaveBeenCalledWith(expect.objectContaining({ type: 'tokenError', reason: 'signInRequired' }));
        expect(mocks.interactiveToken).toHaveBeenCalledTimes(2);
        expect(getRecentEntraTokenFailure(clusterId)).toBeUndefined();
    });

    it('checks a document fingerprint on warm runs without consulting the credentials cache', async (): Promise<void> => {
        await initializeSession(AuthMethodId.NoAuth);
        mocks.worker.isConnectedTo.mockReturnValue(true);
        const capture = vi.fn();
        await evaluator.evaluate(connection, '2', undefined, capture);
        const binding = capture.mock.calls[0][0] as { fingerprint: string };
        await evaluator.evaluate({ ...connection, ...binding }, '3');
        await expect(evaluator.evaluate({ ...connection, fingerprint: 'old-binding' }, '4')).rejects.toMatchObject({
            reason: 'credentialsChanged',
        });
        expect(mocks.worker.sendEval).toHaveBeenCalledTimes(3);
    });

    it('rejects a latched Run or an old document binding after evaluator recreation', async (): Promise<void> => {
        await initializeSession(AuthMethodId.NoAuth);
        mocks.worker.isConnectedTo.mockReturnValue(true);
        const capture = vi.fn();
        await evaluator.evaluate(connection, '1', undefined, capture);
        const binding = capture.mock.calls[0][0] as { fingerprint: string };
        const oldDocument = { ...connection, ...binding };
        evaluator.dispose();
        evaluator = new PlaygroundEvaluator();
        mocks.worker.isConnectedTo.mockReturnValue(false);
        ClustersClient.latch(clusterId, 'userDisconnected');
        try {
            await expect(evaluator.evaluate(oldDocument, '2')).rejects.toMatchObject({ reason: 'userDisconnected' });
        } finally {
            ClustersClient.unlatch(clusterId);
        }
        mocks.getCredentials.mockReturnValue({ clusterId, connectionString: 'mongodb://other.example.com/', authMechanism: AuthMethodId.NoAuth });
        await evaluator.evaluate(connection, '3');
        mocks.worker.isConnectedTo.mockReturnValue(true);
        await expect(evaluator.evaluate(oldDocument, '4')).rejects.toMatchObject({ reason: 'credentialsChanged' });
        mocks.getCredentials.mockClear();
    });

    it('lets a re-picked document replace one failed worker without moving its old identity', async (): Promise<void> => {
        const oldIdentity = {
            kind: 'entra',
            providerId: 'microsoft',
            tenantId: 'interactive-tenant',
            accountId: 'account-a',
            accountLabel: 'Account A',
        } as const;
        const newIdentity = {
            ...oldIdentity,
            accountId: 'account-b',
            accountLabel: 'Account B',
        } as const;
        const identity = vi.spyOn(ClustersClient, 'getLastVerifiedIdentity').mockReturnValue(oldIdentity);
        try {
            await initializeSession(AuthMethodId.MicrosoftEntraID);
            mocks.worker.isConnectedTo.mockReturnValue(true);
            const capture = vi.fn();
            await evaluator.evaluate(connection, '2', undefined, capture);
            const oldBinding = {
                ...connection,
                ...(capture.mock.calls[0][0] as { fingerprint: string; entraIdentity?: typeof oldIdentity }),
            };
            mocks.worker.sendEval.mockRejectedValueOnce(
                Object.assign(new Error('sign in required'), { name: 'EntraSignInRequiredError' }),
            );
            await expect(evaluator.evaluate(oldBinding, 'failed')).rejects.toSatisfy(
                (error: unknown) => getWorkerAuthReason(error) === 'signInRequired',
            );

            mocks.getCredentials.mockReturnValue({
                clusterId,
                connectionString: originalConnection,
                authMechanism: AuthMethodId.MicrosoftEntraID,
                entraIdConfig: { tenantId: 'interactive-tenant' },
            });
            identity.mockReturnValue(newIdentity);
            vi.spyOn(ClustersClient, 'getBinding').mockReturnValue({
                clusterId,
                fingerprint: 'fingerprint-b',
                generation: 2,
            });
            const expected = vi
                .spyOn(ClustersClient, 'getExpectedFingerprint')
                .mockReturnValue('fingerprint-b');

            await expect(evaluator.evaluate(oldBinding, 'old-document')).rejects.toMatchObject({
                reason: 'credentialsChanged',
            });
            const replacement = { fingerprint: 'fingerprint-b' };
            const repicked = {
                ...connection,
                fingerprint: 'fingerprint-b',
                entraIdentity: newIdentity,
                workerReplacement: replacement,
            };
            await evaluator.evaluate(repicked, 'replacement');
            await expect(evaluator.evaluate(oldBinding, 'still-old')).rejects.toMatchObject({
                reason: 'credentialsChanged',
            });
            mocks.worker.sendEval.mockRejectedValueOnce(
                Object.assign(new Error('sign in required again'), { name: 'EntraSignInRequiredError' }),
            );
            await expect(evaluator.evaluate(repicked, 'second-failure')).rejects.toSatisfy(
                (error: unknown) => getWorkerAuthReason(error) === 'signInRequired',
            );
            await expect(evaluator.evaluate(repicked, 'already-consumed')).rejects.toMatchObject({
                name: 'EntraSignInRequiredError',
            });
            expect(expected).toHaveBeenCalled();
            expect(mocks.worker.sendEval.mock.calls.map(([message]) => message.type === 'eval' && message.code)).toEqual([
                '1',
                '2',
                'failed',
                'replacement',
                'second-failure',
            ]);
            mocks.getCredentials.mockClear();
        } finally {
            vi.restoreAllMocks();
        }
    });

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'restarts %s at the next Run after refresh fails, without replaying the failed query',
        async (authMechanism): Promise<void> => {
            await initializeSession(authMechanism);
            await requestToken({ type: 'tokenRequest', requestId: 'first' });
            mocks.worker.isConnectedTo.mockReturnValue(true);
            const capture = vi.fn();
            await evaluator.evaluate(connection, '2', undefined, capture);
            const binding = capture.mock.calls[0][0] as { fingerprint: string };
            const bound = { ...connection, ...binding };
            const failure = new Error('outer driver error', { cause: Object.assign(new Error('private broker'), { name: 'TokenCallbackError' }) });
            mocks.worker.sendEval.mockRejectedValueOnce(failure);
            await expect(evaluator.evaluate(bound, 'failed')).rejects.toSatisfy((error: unknown) => getWorkerAuthReason(error) === 'refreshFailed');
            mocks.worker.isConnectedTo.mockReturnValue(false);
            mocks.getCredentials.mockReturnValue({
                clusterId,
                connectionString: originalConnection,
                authMechanism,
                entraIdConfig: { tenantId: 'interactive-tenant' },
                managedIdentityConfig: { tenantId: 'managed-tenant', clientId: 'managed-client' },
            });
            await evaluator.evaluate(bound, 'next');
            mocks.worker.isConnectedTo.mockReturnValue(true);
            mocks.getCredentials.mockClear();
            await evaluator.evaluate(bound, 'after');
            expect(mocks.worker.sendEval.mock.calls.map(([message]) => message.type === 'eval' && message.code)).toEqual([
                '1', '2', 'failed', 'next', 'after',
            ]);
        },
    );

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'uses the captured %s identity and original connection despite forged request fields',
        async (authMethod): Promise<void> => {
            const init = await initializeSession(authMethod);
            expect(init).toMatchObject({
                connectionString: originalConnection,
                authMechanism: authMethod,
                tenantId: authMethod === AuthMethodId.ManagedIdentity ? 'managed-tenant' : 'interactive-tenant',
                managedIdentityClientId: 'managed-client',
            });
            const forged: TokenRequest = {
                type: 'tokenRequest',
                requestId: 'forged-request',
                source: authMethod === AuthMethodId.ManagedIdentity ? 'vscode' : 'managedIdentity',
                tenantId: 'forged-tenant',
                clientId: 'forged-client',
            };
            const response = await requestToken(forged);
            const refresh = await requestToken({ ...forged, requestId: 'refresh' });

            if (authMethod === AuthMethodId.ManagedIdentity) {
                expect(mocks.resolveManagedIdentity).toHaveBeenCalledExactlyOnceWith(init.connectionString);
                expect(mocks.resolveInteractive).not.toHaveBeenCalled();
                expect(mocks.interactiveToken).not.toHaveBeenCalled();
                expect(mocks.managedIdentityToken).toHaveBeenCalledTimes(2);
                expect(mocks.managedIdentityToken).toHaveBeenNthCalledWith(
                    1,
                    [resolution.scope],
                    init.managedIdentityClientId,
                    init.tenantId,
                    evaluator.sessionId,
                    traceContext,
                );
                expect(mocks.managedIdentityToken.mock.calls[1]).toEqual(mocks.managedIdentityToken.mock.calls[0]);
            } else {
                expect(mocks.resolveInteractive).toHaveBeenCalledExactlyOnceWith(init.connectionString);
                expect(mocks.resolveManagedIdentity).not.toHaveBeenCalled();
                expect(mocks.managedIdentityToken).not.toHaveBeenCalled();
                expect(mocks.interactiveToken).toHaveBeenCalledTimes(2);
                const scopes = [resolution.scope, `VSCODE_TENANT:${init.tenantId}`];
                expect(mocks.interactiveToken).toHaveBeenNthCalledWith(1, 'microsoft', scopes, { createIfNone: true });
                expect(mocks.interactiveToken).toHaveBeenNthCalledWith(2, 'microsoft', scopes, {
                    silent: true,
                    account: { id: 'private-account', label: accountLabel },
                });
            }
            expect(response).toHaveBeenCalledExactlyOnceWith({
                type: 'tokenResponse',
                requestId: forged.requestId,
                accessToken,
            });
            expect(refresh).toHaveBeenCalledExactlyOnceWith({
                type: 'tokenResponse',
                requestId: 'refresh',
                accessToken,
            });
        },
    );

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'rechecks current machine trust for %s even with a cached session audience',
        async (authMethod): Promise<void> => {
            customSuffix = '.database.example.com';
            const connectionString = 'mongodb://original.database.example.com/';
            await initializeSession(authMethod, connectionString);
            const first = await requestToken({ type: 'tokenRequest', requestId: 'first' });
            expect(first).toHaveBeenCalledExactlyOnceWith({
                type: 'tokenResponse',
                requestId: 'first',
                accessToken,
            });
            mocks.resolveInteractive.mockClear();
            mocks.resolveManagedIdentity.mockClear();
            mocks.interactiveToken.mockClear();
            mocks.managedIdentityToken.mockClear();
            vi.mocked(ext.outputChannel.info).mockClear();
            customSuffix = '.different.example.com';

            const response = await requestToken({ type: 'tokenRequest', requestId: 'refresh' });

            expectNoTokenAcquisition();
            expect(response).toHaveBeenCalledExactlyOnceWith({
                type: 'tokenError',
                requestId: 'refresh',
                error: "Microsoft Entra ID isn't allowed for this server.",
                errorName: 'EntraDestinationRejectedError',
                reason: 'destinationRejected',
            });
            const output = JSON.stringify([
                response.mock.calls,
                ...Object.values(ext.outputChannel).map((log) => vi.mocked(log).mock.calls),
            ]);
            for (const secret of [accessToken, accountLabel, connectionString, 'original.database.example.com']) {
                expect(output).not.toContain(secret);
            }
        },
    );

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'blocks pending %s token delivery when machine trust is revoked without changing failure context',
        async (authMethod): Promise<void> => {
            customSuffix = 'database.example.com';
            await initializeSession(authMethod, 'mongodb://original.database.example.com/');
            recordEntraTokenFailure(clusterId, { cloudCategory: 'custom', authMethod: 'interactive' });
            const failure = getRecentEntraTokenFailure(clusterId);
            let finish!: () => void;
            const gate = new Promise<void>((resolve) => {
                finish = resolve;
            });
            if (authMethod === AuthMethodId.ManagedIdentity) {
                mocks.managedIdentityToken.mockImplementationOnce(async () => {
                    await gate;
                    return { accessToken, expiresOnTimestamp: 4_000_000_000_000 };
                });
            } else {
                mocks.interactiveToken.mockImplementationOnce(async () => {
                    await gate;
                    return { accessToken, id: 'session', account: { id: 'account', label: accountLabel }, scopes: [] };
                });
            }
            const startupProperties: Record<string, string> = {};
            const response = vi.fn();
            const pending = mocks.callbacks!.onTokenRequest!(
                { type: 'tokenRequest', requestId: 'pending' },
                response,
                () => true,
                undefined,
                { ...traceContext, startupProperties },
            );
            await vi.waitFor(() =>
                expect(
                    authMethod === AuthMethodId.ManagedIdentity ? mocks.managedIdentityToken : mocks.interactiveToken,
                ).toHaveBeenCalledTimes(1),
            );
            customSuffix = undefined;
            finish();
            await pending;
            expect(response).toHaveBeenCalledExactlyOnceWith({
                type: 'tokenError',
                requestId: 'pending',
                error: "Microsoft Entra ID isn't allowed for this server.",
                errorName: 'EntraDestinationRejectedError',
                reason: 'destinationRejected',
            });
            expect(getRecentEntraTokenFailure(clusterId)).toBe(failure);
            expect(startupProperties.entraFailureKind).not.toBe('tokenAcquisitionFailed');
            expect(JSON.stringify(response.mock.calls)).not.toContain(accessToken);
        },
    );

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'ignores stale %s token requests without resolving, acquiring or responding',
        async (authMethod): Promise<void> => {
            await initializeSession(authMethod);

            const response = await requestToken({ type: 'tokenRequest', requestId: 'stale' }, () => false);

            expectNoTokenAcquisition();
            expect(response).not.toHaveBeenCalled();
        },
    );

    it('refuses forged token requests from a NativeAuth session', async (): Promise<void> => {
        await initializeSession(AuthMethodId.NativeAuth);

        const response = await requestToken({
            type: 'tokenRequest',
            requestId: 'native',
            source: 'managedIdentity',
            tenantId: 'forged-tenant',
            clientId: 'forged-client',
        });

        expectNoTokenAcquisition();
        expect(response).toHaveBeenCalledExactlyOnceWith({
            type: 'tokenError',
            requestId: 'native',
            error: 'Failed to obtain a Microsoft Entra ID token.',
            reason: 'refreshFailed',
        });
    });

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'rejects the first %s relay for mixed saved hosts before resolution or provider access',
        async (authMethod): Promise<void> => {
            await initializeSession(
                authMethod,
                'mongodb://original.mongocluster.cosmos.azure.com,attacker.cloudapp.azure.com/',
            );

            const response = await requestToken({ type: 'tokenRequest', requestId: 'rejected' });

            expectNoTokenAcquisition();
            expect(response).toHaveBeenCalledExactlyOnceWith({
                type: 'tokenError',
                requestId: 'rejected',
                error: "Microsoft Entra ID isn't allowed for this server.",
                errorName: 'EntraDestinationRejectedError',
                reason: 'destinationRejected',
            });
        },
    );
});
