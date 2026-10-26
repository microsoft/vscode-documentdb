/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { type MongoClientOptions, type OIDCResponse } from 'mongodb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type AuthTraceContext } from '../../../utils/authTrace';
import { ClustersClient } from '../../ClustersClient';
import { CredentialCache, type CachedClusterCredentials } from '../../CredentialCache';
import { PlaygroundEvaluator } from '../../playground/PlaygroundEvaluator';
import { type MainToWorkerMessage, type WorkerToMainMessage } from '../../playground/workerTypes';
import { ShellSessionManager } from '../../shell/ShellSessionManager';
import { ConnectionStartupTimings } from '../../utils/ConnectionStartupTimings';
import { AuthMethodId } from '../AuthMethod';
import { ManagedIdentityAuthHandler } from '../ManagedIdentityAuthHandler';
import { MicrosoftEntraIDAuthHandler } from '../MicrosoftEntraIDAuthHandler';
import { resetPreviewDiagnosticsForTests } from './previewDiagnostics';

const network = vi.hoisted(() => ({
    session: vi.fn(), managedToken: vi.fn(), connect: vi.fn(), command: vi.fn(), posted: [] as MainToWorkerMessage[],
}));

vi.mock('../../../extensionVariables', () => ({
    ext: {
        context: { extensionPath: '/extension-root', extension: { packageJSON: { version: '1.2.3' } } },
        outputChannel: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    },
}));
vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: network.session,
}));
vi.mock('../managedIdentityTokenProvider', () => ({ getManagedIdentityAccessToken: network.managedToken }));
vi.mock('mongodb', async (original) => ({
    ...(await original<typeof import('mongodb')>()),
    MongoClient: class {
        public connect = network.connect;
        public db(): { command: typeof network.command } {
            return { command: network.command };
        }
        public async close(): Promise<void> {}
    },
}));
vi.mock('@microsoft/vscode-azext-utils', async (original) => ({
    ...(await original<typeof import('@microsoft/vscode-azext-utils')>()),
    parseError: (error: unknown): { message: string } => ({ message: error instanceof Error ? error.message : String(error) }),
    callWithTelemetryAndErrorHandling: async (
        _event: string,
        callback: (context: { telemetry: { properties: Record<string, string>; measurements: Record<string, number> }; errorHandling: Record<string, boolean> }) => Promise<unknown>,
    ): Promise<unknown> => callback({ telemetry: { properties: {}, measurements: {} }, errorHandling: {} }),
}));
vi.mock('worker_threads', async () => {
    const { EventEmitter } = await import('events');
    return {
        Worker: class extends EventEmitter {
            private initId = '';
            public postMessage(message: MainToWorkerMessage): void {
                network.posted.push(message);
                if (message.type === 'init') {
                    this.initId = message.requestId;
                    this.reply({
                        type: 'tokenRequest', requestId: 'token-request',
                        source: message.authMechanism === 'ManagedIdentity' ? 'managedIdentity' : 'vscode',
                        tenantId: message.tenantId, clientId: message.managedIdentityClientId,
                    });
                } else if (message.type === 'tokenResponse' || message.type === 'tokenError') {
                    this.reply({
                        type: 'initResult', requestId: this.initId, success: message.type === 'tokenResponse',
                        error: message.type === 'tokenError' ? message.error : undefined,
                    });
                } else if (message.type === 'eval') {
                    this.reply({ type: 'evalResult', requestId: message.requestId, result: { type: 'number', printable: '1', durationMs: 0 } });
                }
            }
            private reply(message: WorkerToMainMessage): void {
                queueMicrotask(() => this.emit('message', message));
            }
            public async terminate(): Promise<number> {
                return 0;
            }
        },
    };
});

const credentials: CachedClusterCredentials = {
    clusterId: 'private-cluster', connectionString: 'mongodb://private-cluster.mongocluster.cosmos.azure.us:10255/',
    authMechanism: AuthMethodId.MicrosoftEntraID, entraIdConfig: { tenantId: 'private-tenant' },
    managedIdentityConfig: { clientId: 'private-client', tenantId: 'private-tenant' },
};
const context: AuthTraceContext = {
    startupCorrelationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', surface: 'extension',
};
const never = new Promise<string | undefined>(() => undefined);

beforeEach((): void => {
    vi.clearAllMocks();
    resetPreviewDiagnosticsForTests();
    network.posted.length = 0;
    network.session.mockReset().mockResolvedValue({ accessToken: 'private-token', account: { label: 'private-user' } });
    network.managedToken.mockReset().mockResolvedValue({ accessToken: 'private-token', expiresOnTimestamp: Date.now() + 3600_000 });
    network.command.mockReset().mockResolvedValue({ ok: 1 });
    network.connect.mockReset().mockResolvedValue(undefined);
    vi.mocked(vscode.window.showInformationMessage).mockReset().mockResolvedValue('Continue' as never);
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: vi.fn((key: string) => key === 'environment' ? 'USGovernment' : undefined),
        inspect: vi.fn(), has: vi.fn(), update: vi.fn(),
    } as unknown as vscode.WorkspaceConfiguration);
});

afterEach((): void => {
    CredentialCache.deleteCredentials(credentials.clusterId);
});

describe('real handlers and callback wiring', () => {
    it.each([false, true])('cancels before requesting any token (managed identity: %s)', async (managedIdentity) => {
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined);
        const handler = managedIdentity ? new ManagedIdentityAuthHandler(credentials) : new MicrosoftEntraIDAuthHandler(credentials);
        await expect(handler.configureAuth(undefined, context)).rejects.toBeInstanceOf(UserCancelledError);
        expect(network.session).not.toHaveBeenCalled();
        expect(network.managedToken).not.toHaveBeenCalled();
    });

    it('blocks interactive token result outside the automated callback', async () => {
        vi.mocked(vscode.window.showInformationMessage)
            .mockResolvedValueOnce('Continue' as never).mockReturnValueOnce(never as never);
        let completed = false;
        void new MicrosoftEntraIDAuthHandler(credentials).configureAuth(undefined, context).then(() => { completed = true; });
        await vi.waitFor(() => expect(network.session).toHaveBeenCalledOnce());
        expect(completed).toBe(false);
    });

    it('managed identity callback returns token and original failure without awaiting its modal', async () => {
        const { options } = await new ManagedIdentityAuthHandler(credentials).configureAuth(undefined, context);
        const callback = options.authMechanismProperties?.OIDC_CALLBACK as () => Promise<OIDCResponse>;
        vi.mocked(vscode.window.showInformationMessage).mockReturnValue(never as never);
        await expect(callback()).resolves.toMatchObject({ accessToken: 'private-token' });
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
        resetPreviewDiagnosticsForTests();
        vi.mocked(vscode.window.showInformationMessage).mockResolvedValueOnce('Continue' as never);
        const retry = await new ManagedIdentityAuthHandler(credentials).configureAuth(undefined, context);
        const error = new Error('AADSTS65002 private-host');
        network.managedToken.mockRejectedValueOnce(error);
        await expect((retry.options.authMechanismProperties?.OIDC_CALLBACK as () => Promise<OIDCResponse>)()).rejects.toBe(error);
    });

    it.each([
        ['shell', AuthMethodId.MicrosoftEntraID], ['shell', AuthMethodId.ManagedIdentity],
        ['playground', AuthMethodId.MicrosoftEntraID], ['playground', AuthMethodId.ManagedIdentity],
    ] as const)('%s %s returns worker tokens while both modal dialogs remain unresolved', async (surface, authMethod) => {
        CredentialCache.setAuthCredentials(credentials.clusterId, authMethod, credentials.connectionString,
            undefined, undefined, credentials.entraIdConfig, credentials.managedIdentityConfig);
        vi.mocked(vscode.window.showInformationMessage).mockReturnValue(never as never);
        const info = { clusterId: credentials.clusterId, clusterDisplayName: 'Test cluster', databaseName: 'test' };
        const manager = surface === 'shell' ? new ShellSessionManager(info) : new PlaygroundEvaluator();
        try {
            if (manager instanceof ShellSessionManager) {
                await manager.initialize();
            } else {
                await manager.evaluate(info, '1');
            }
            expect(network.posted).toContainEqual({
                type: 'tokenResponse', requestId: 'token-request', accessToken: 'private-token',
            });
            expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(2);
        } finally {
            manager.dispose();
        }
    });
});

describe('real ClustersClient connect hook', () => {
    async function connect(options: MongoClientOptions): Promise<void> {
        const instance = Reflect.construct(ClustersClient, [credentials.clusterId]) as {
            connect: (...args: unknown[]) => Promise<void>;
        };
        await instance.connect({
            id: context.startupCorrelationId, startedAt: Date.now(), costTimings: new ConnectionStartupTimings(),
            telemetry: { properties: {}, measurements: {} }, stageDurationsMs: {},
            stage: 'stage03PreparingClient', stageStartedAt: Date.now(),
        }, credentials.connectionString, options);
    }

    it('reports all probe failures without failing an actual successful connect', async () => {
        const { options } = await new MicrosoftEntraIDAuthHandler(credentials).configureAuth(undefined, context);
        network.command.mockRejectedValue(new Error('private-probe-host'));
        await expect(connect(options)).resolves.toBeUndefined();
        expect(network.command).toHaveBeenCalledTimes(3);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(3);
        expect(JSON.stringify(vi.mocked(vscode.window.showInformationMessage).mock.calls)).not.toContain('private-probe-host');
    });

    it('reports the original connect failure and runs no probes', async () => {
        const { options } = await new MicrosoftEntraIDAuthHandler(credentials).configureAuth(undefined, context);
        const error = Object.assign(new Error('private-driver-host'), { code: 18 });
        network.connect.mockRejectedValueOnce(error);
        await expect(connect(options)).rejects.toBe(error);
        expect(network.command).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(3);
        expect(JSON.stringify(vi.mocked(vscode.window.showInformationMessage).mock.calls)).not.toContain('private-driver-host');
    });
});
