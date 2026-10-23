/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const getSessionFromVSCode = vi.fn();
const mockOutputChannel = { info: vi.fn(), error: vi.fn() };
vi.mock('../../extensionVariables', () => ({
    ext: {
        get outputChannel(): typeof mockOutputChannel {
            return mockOutputChannel;
        },
    },
}));

vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode: (...args: unknown[]) => getSessionFromVSCode(...args),
}));

vi.mock('./documentdbTokenResource', async (importOriginal) => ({
    ...(await importOriginal<typeof import('./documentdbTokenResource')>()),
    resolveInteractiveTokenResource: vi.fn(),
}));

import { type CachedClusterCredentials } from '../CredentialCache';
import { ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { AuthMethodId } from './AuthMethod';
import { resolveInteractiveTokenResource, TokenResourceResolutionError } from './documentdbTokenResource';
import { getRecentEntraTokenFailure, resetEntraTokenFailuresForTests } from './entraErrors/entraTokenFailures';
import { MicrosoftEntraIDAuthHandler } from './MicrosoftEntraIDAuthHandler';

function buildCredentials(connectionString: string): CachedClusterCredentials {
    return {
        clusterId: 'cluster-1',
        connectionString,
        connectionStringWithPassword: connectionString,
        authMechanism: AuthMethodId.MicrosoftEntraID,
        entraIdConfig: { tenantId: 'tenant' },
    };
}

describe('MicrosoftEntraIDAuthHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetEntraTokenFailuresForTests();
        getSessionFromVSCode.mockReset();
        getSessionFromVSCode.mockResolvedValue({ accessToken: 'access-token' });
        vi.mocked(resolveInteractiveTokenResource).mockResolvedValue({
            resource: 'https://ossrdbms-aad.database.windows.net',
            scope: 'https://ossrdbms-aad.database.windows.net/.default',
            cloudCategory: 'public',
            reason: 'setting',
        });
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue(undefined),
        } as unknown as vscode.WorkspaceConfiguration);
    });

    afterEach((): void => {
        resetEntraTokenFailuresForTests();
    });

    it('strips credentials and stale OIDC markers from the connection string', async () => {
        const connectionString =
            'mongodb+srv://managed-identity@my-cluster.mongocluster.cosmos.azure.com/' +
            '?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure&retryWrites=true';

        const result = await new MicrosoftEntraIDAuthHandler(buildCredentials(connectionString)).configureAuth();

        expect(result.connectionString).not.toContain('managed-identity');
        expect(result.connectionString).not.toContain('authMechanism');
        expect(result.connectionString).not.toContain('authMechanismProperties');
        expect(result.connectionString).toContain('retryWrites=true');
        expect(result.options.authMechanismProperties).toHaveProperty('OIDC_CALLBACK');
        expect(getSessionFromVSCode).toHaveBeenCalledWith(
            ['https://ossrdbms-aad.database.windows.net/.default'],
            'tenant',
            { createIfNone: true },
        );
        const output = JSON.stringify(mockOutputChannel.info.mock.calls);
        expect(output).toContain('interactiveEntra.getSession');
        expect(output).not.toContain('access-token');
        expect(output).not.toContain('my-cluster');
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
    });

    it('requests the resolved US Government scope and records its category on the existing trace', async () => {
        const scope = 'https://ossrdbms-aad.database.usgovcloudapi.net/.default';
        vi.mocked(resolveInteractiveTokenResource).mockResolvedValueOnce({
            resource: 'https://ossrdbms-aad.database.usgovcloudapi.net',
            scope,
            cloudCategory: 'usgov',
            reason: 'setting',
        });
        const connectionString = 'mongodb://cluster.azure.us/';
        await new MicrosoftEntraIDAuthHandler(buildCredentials(connectionString)).configureAuth();
        expect(resolveInteractiveTokenResource).toHaveBeenCalledWith(connectionString);
        expect(getSessionFromVSCode).toHaveBeenCalledWith([scope], 'tenant', { createIfNone: true });
        const output = String(mockOutputChannel.info.mock.calls[0][0]);
        expect(output).toContain('"cloudCategory":"usgov"');
        expect(output).toContain('"tokenResourceReason":"setting"');
        expect(mockOutputChannel.info).toHaveBeenCalledTimes(3);
    });

    it('propagates a cloud mismatch unchanged before requesting a session', async () => {
        const error = new TokenResourceResolutionError('Select the cloud of the cluster.', 'cloudMismatch');
        vi.mocked(resolveInteractiveTokenResource).mockRejectedValueOnce(error);
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.azure.us/'));
        await expect(handler.configureAuth()).rejects.toBe(error);
        expect(getSessionFromVSCode).not.toHaveBeenCalled();
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
    });

    it.each(['public', 'usgov', 'china', 'custom'] as const)(
        'records a failed token acquisition in %s without changing the error',
        async (cloudCategory): Promise<void> => {
            vi.mocked(resolveInteractiveTokenResource).mockResolvedValueOnce({
                resource: 'https://database.example.com',
                scope: 'https://database.example.com/.default',
                cloudCategory,
                reason: 'setting',
            });
            const error = Object.freeze(
                Object.assign(new Error('AADSTS65002: Preauthorization required'), { code: 'original-code' }),
            );
            getSessionFromVSCode.mockRejectedValueOnce(error);
            const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/'));

            await expect(handler.configureAuth()).rejects.toBe(error);
            expect(error.code).toBe('original-code');
            expect(getRecentEntraTokenFailure('cluster-1')).toEqual({
                cloudCategory,
                authMethod: 'interactive',
                timestamp: expect.any(Number),
            });
            expect(mockOutputChannel.error).toHaveBeenCalledTimes(1);
        },
    );

    it('records a token-acquisition failure when no session is returned', async (): Promise<void> => {
        getSessionFromVSCode.mockResolvedValueOnce(undefined);
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/'));
        await expect(handler.configureAuth()).rejects.toThrow('Failed to obtain Entra ID token.');
        expect(getRecentEntraTokenFailure('cluster-1')).toMatchObject({
            cloudCategory: 'public',
            authMethod: 'interactive',
        });
    });

    it('passes the explicitly configured custom hostname suffix to the OIDC allowlist', async () => {
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue({ mongoClusterHostnameSuffix: '.database.example.com' }),
        } as unknown as vscode.WorkspaceConfiguration);
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.database.example.com/'));
        const { options } = await handler.configureAuth();
        expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual(['*.database.example.com']);
    });

    it('logs interactive authentication failure without the raw message', async () => {
        getSessionFromVSCode.mockRejectedValueOnce(new Error('secret-token'));
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://localhost:27017/'));

        await expect(handler.configureAuth()).rejects.toThrow('secret-token');

        expect(JSON.stringify(mockOutputChannel.error.mock.calls)).toContain('interactiveEntra.getSession');
        expect(JSON.stringify(mockOutputChannel.error.mock.calls)).not.toContain('secret-token');
    });

    it('labels every auth message with the startup ID of its connection', async (): Promise<void> => {
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://localhost:27017/'));
        await handler.configureAuth(undefined, { startupCorrelationId: 'startup-id', surface: 'extension' });

        const messages = mockOutputChannel.info.mock.calls.map((call) => String(call[0]));
        expect(messages).toHaveLength(3);
        for (const message of messages) {
            expect(message).toMatch(/^\[Authentication\] startup=startup-id surface=extension interactiveEntra\./);
        }
    });

    it('labels authentication failure with its startup ID without exposing secrets', async (): Promise<void> => {
        getSessionFromVSCode.mockRejectedValueOnce(new Error('secret-token'));
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://localhost:27017/'));
        await expect(
            handler.configureAuth(undefined, { startupCorrelationId: 'startup-id', surface: 'extension' }),
        ).rejects.toThrow('secret-token');
        expect(mockOutputChannel.error).toHaveBeenCalledWith(
            expect.stringContaining('[Authentication] startup=startup-id surface=extension'),
        );
        expect(JSON.stringify(mockOutputChannel.error.mock.calls)).not.toContain('secret-token');
    });

    it('measures the actual session request separately from database connection work', async () => {
        let now = 0;
        const timings = new ConnectionStartupTimings(() => now);
        getSessionFromVSCode.mockImplementationOnce(async () => {
            now = 25;
            return { accessToken: 'access-token' };
        });
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://localhost:27017/'));
        await handler.configureAuth(timings);
        const stopDatabase = timings.startDatabaseConnect();
        now = 65;
        stopDatabase();

        expect(timings.finish()).toEqual({ tokenAcquireDurationMs: 25, databaseConnectDurationMs: 40 });
    });

    it('retains token-acquisition time when the session request fails', async () => {
        let now = 0;
        const timings = new ConnectionStartupTimings(() => now);
        const error = new Error('private-token');
        getSessionFromVSCode.mockImplementationOnce(async () => {
            now = 30;
            throw error;
        });
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://localhost:27017/'));

        await expect(handler.configureAuth(timings)).rejects.toBe(error);
        expect(timings.finish()).toEqual({ tokenAcquireDurationMs: 30 });
    });
});
