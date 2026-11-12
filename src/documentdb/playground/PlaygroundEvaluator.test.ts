/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
import { type getManagedIdentityAccessToken } from '../auth/managedIdentityTokenProvider';
import { type CachedClusterCredentials } from '../CredentialCache';
import { PlaygroundEvaluator } from './PlaygroundEvaluator';
import { type WorkerSessionCallbacks } from './WorkerSessionManager';
import { type MainToWorkerMessage, type WorkerToMainMessage } from './workerTypes';

type InitMessage = Extract<MainToWorkerMessage, { type: 'init' }>;
type TokenRequest = Extract<WorkerToMainMessage, { type: 'tokenRequest' }>;

const mocks = vi.hoisted(() => ({
    getCredentials: vi.fn<(clusterId: string) => CachedClusterCredentials | undefined>(),
    getConnectionStringWithPassword: vi.fn<(clusterId: string) => string>(),
    interactiveToken:
        vi.fn<
            (
                scopes?: string | string[],
                tenantId?: string,
                options?: vscode.AuthenticationGetSessionOptions,
            ) => Promise<vscode.AuthenticationSession | undefined>
        >(),
    managedIdentityToken: vi.fn<typeof getManagedIdentityAccessToken>(),
    resolveInteractive: vi.fn<typeof resolveInteractiveTokenResource>(),
    resolveManagedIdentity: vi.fn<typeof resolveManagedIdentityTokenResource>(),
    callbacks: undefined as WorkerSessionCallbacks | undefined,
    initMessage: undefined as InitMessage | undefined,
    clusterId: undefined as string | undefined,
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

vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: mocks.interactiveToken,
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
            isConnectedTo: vi.fn(() => false),
            ensureWorker: vi.fn(async (clusterId: string, initMessage: InitMessage): Promise<void> => {
                mocks.clusterId = clusterId;
                mocks.initMessage = initMessage;
            }),
            get workerClusterId(): string | undefined {
                return mocks.clusterId;
            },
            sendEval: vi.fn().mockResolvedValue({ result: { type: 'number', printable: '1', durationMs: 0 } }),
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
        expect(mocks.getCredentials).toHaveBeenCalledExactlyOnceWith(clusterId);
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
                for (const call of mocks.interactiveToken.mock.calls) {
                    expect(call).toEqual([[resolution.scope], init.tenantId, { createIfNone: true }]);
                }
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
            error: 'No credentials found for the query playground connection.',
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
            });
        },
    );
});
