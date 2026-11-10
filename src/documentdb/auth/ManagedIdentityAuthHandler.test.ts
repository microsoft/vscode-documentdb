/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type OIDCCallbackParams, type OIDCResponse } from 'mongodb';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type CachedClusterCredentials } from '../CredentialCache';
import { ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { type AuthPhaseObserver } from './authCallerPolicy';
import { buildAuthConnectionTarget } from './authConnectionTarget';
import { AuthMethodId } from './AuthMethod';
import * as tokenResources from './documentdbTokenResource';
import { EntraErrorExplainer } from './entraErrors/EntraErrorExplainer';
import { getRecentEntraTokenFailure, resetEntraTokenFailuresForTests } from './entraErrors/entraTokenFailures';
import { ManagedIdentityAuthHandler } from './ManagedIdentityAuthHandler';
import { expiresInSecondsFromTimestamp } from './tokenExpiry';

const getManagedIdentityAccessToken = vi.fn();

vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), error: vi.fn() } },
}));

vi.mock('./managedIdentityTokenProvider', () => ({
    getManagedIdentityAccessToken: (...args: unknown[]) => getManagedIdentityAccessToken(...args),
}));

function buildCredentials(overrides: Partial<CachedClusterCredentials> = {}): CachedClusterCredentials {
    return {
        clusterId: 'cluster-1',
        connectionString: 'mongodb+srv://my-cluster.mongocluster.cosmos.azure.com/?retryWrites=true',
        connectionStringWithPassword: 'mongodb+srv://my-cluster.mongocluster.cosmos.azure.com/?retryWrites=true',
        authMechanism: AuthMethodId.ManagedIdentity,
        managedIdentityConfig: {},
        ...overrides,
    };
}

async function invokeOidcCallback(options: {
    authMechanismProperties?: Record<string, unknown>;
}): Promise<OIDCResponse> {
    const callback = options.authMechanismProperties?.OIDC_CALLBACK as (
        params: OIDCCallbackParams,
    ) => Promise<OIDCResponse>;
    return callback({} as OIDCCallbackParams);
}

describe('expiresInSecondsFromTimestamp', () => {
    const now = 1_700_000_000_000;

    it('converts an absolute expiry into remaining seconds minus a safety margin', () => {
        expect(expiresInSecondsFromTimestamp(now + 3600 * 1000, now)).toBe(3300);
    });

    it('floors at zero for an already expired token', () => {
        expect(expiresInSecondsFromTimestamp(now - 1000, now)).toBe(0);
    });

    it('floors at zero when the remaining lifetime is inside the safety margin', () => {
        expect(expiresInSecondsFromTimestamp(now + 60 * 1000, now)).toBe(0);
    });

    it('returns zero for a non-finite timestamp', () => {
        expect(expiresInSecondsFromTimestamp(Number.NaN, now)).toBe(0);
    });
});

describe('ManagedIdentityAuthHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetEntraTokenFailuresForTests();
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue(undefined),
            inspect: vi.fn().mockReturnValue(undefined),
        } as unknown as vscode.WorkspaceConfiguration);
        getManagedIdentityAccessToken.mockReset();
        getManagedIdentityAccessToken.mockResolvedValue({
            accessToken: 'a-token',
            expiresOnTimestamp: Date.now() + 3600 * 1000,
        });
    });

    afterEach((): void => {
        vi.restoreAllMocks();
        resetEntraTokenFailuresForTests();
    });

    it('configures the OIDC mechanism with a curated allowed-hosts list', async () => {
        const handler = new ManagedIdentityAuthHandler(buildCredentials());

        const startupProperties: Record<string, string> = {};
        const { options } = await handler.configureAuth(undefined, {
            startupCorrelationId: 'startup-id',
            surface: 'extension',
            startupProperties,
        });
        expect(startupProperties).toEqual({
            cloudCategory: 'public',
            tokenResourceReason: 'host',
            configuredCloud: 'AzureCloud',
            hostCloud: 'AzureCloud',
            entraFailureKind: 'none',
        });

        expect(options.authMechanism).toBe('MONGODB-OIDC');
        expect(options.tls).toBe(true);
        expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual(['*.azure.com']);
    });

    it('strips authMechanism, authMechanismProperties, and credentials from the connection string', async () => {
        const cs =
            'mongodb+srv://11111111-2222-3333-4444-555555555555@my-cluster.mongocluster.cosmos.azure.com/' +
            '?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:https://ossrdbms-aad.database.windows.net&retryWrites=true';
        const handler = new ManagedIdentityAuthHandler(
            buildCredentials({ connectionString: cs, connectionStringWithPassword: cs }),
        );

        const { connectionString } = await handler.configureAuth();

        expect(connectionString).not.toContain('authMechanism');
        expect(connectionString).not.toContain('authMechanismProperties');
        expect(connectionString).not.toContain('11111111-2222-3333-4444-555555555555');
        expect(connectionString).toContain('retryWrites=true');
    });

    it('requests a token for the system-assigned identity when no client ID is configured', async () => {
        const handler = new ManagedIdentityAuthHandler(buildCredentials({ managedIdentityConfig: {} }));

        const { options } = await handler.configureAuth();
        await invokeOidcCallback(options);

        expect(getManagedIdentityAccessToken).toHaveBeenCalledWith(
            ['https://ossrdbms-aad.database.windows.net/.default'],
            undefined,
            undefined,
            expect.any(String),
            undefined,
        );
    });

    it('requests a token for the configured user-assigned identity and cluster tenant', async () => {
        const clientId = '11111111-2222-3333-4444-555555555555';
        const handler = new ManagedIdentityAuthHandler(
            buildCredentials({ managedIdentityConfig: { clientId, tenantId: 'cluster-tenant' } }),
        );

        const { options } = await handler.configureAuth();
        await invokeOidcCallback(options);

        expect(getManagedIdentityAccessToken).toHaveBeenCalledWith(
            ['https://ossrdbms-aad.database.windows.net/.default'],
            clientId,
            'cluster-tenant',
            expect.any(String),
            undefined,
        );
    });

    it('requests the US Government audience for an azure.us host and traces the resolution', async () => {
        const connectionString = 'mongodb://cluster.mongocluster.cosmos.azure.us/';
        const handler = new ManagedIdentityAuthHandler(
            buildCredentials({ connectionString, connectionStringWithPassword: connectionString }),
        );
        const { options } = await handler.configureAuth();
        await invokeOidcCallback(options);
        expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual(['*.azure.us']);
        expect(getManagedIdentityAccessToken).toHaveBeenCalledWith(
            ['https://ossrdbms-aad.database.usgovcloudapi.net/.default'],
            undefined,
            undefined,
            expect.any(String),
            undefined,
        );
        expect(ext.outputChannel.info).toHaveBeenCalledWith(expect.stringContaining('"cloudCategory":"usgov"'));
        expect(ext.outputChannel.info).toHaveBeenCalledWith(expect.stringContaining('"tokenResourceReason":"host"'));
    });

    it('passes the configured custom suffix to the allowed-hosts list', async () => {
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue({
                ossrdbmsEndpoint: 'https://database.example.com',
                hostnameSuffix: '.database.example.com',
            }),
            inspect: vi.fn().mockReturnValue({
                globalValue: { hostnameSuffix: '.database.example.com' },
            }),
        } as unknown as vscode.WorkspaceConfiguration);
        const connectionString = 'mongodb://cluster.database.example.com/';
        const handler = new ManagedIdentityAuthHandler(
            buildCredentials({ connectionString, connectionStringWithPassword: connectionString }),
        );
        const { options } = await handler.configureAuth();
        expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual(['*.database.example.com']);
    });

    it('passes startup context into the deferred token provider', async (): Promise<void> => {
        const handler = new ManagedIdentityAuthHandler(buildCredentials());
        const context = { startupCorrelationId: 'startup-id', surface: 'extension' };
        const { options } = await handler.configureAuth(undefined, context);
        await invokeOidcCallback(options);
        expect(getManagedIdentityAccessToken).toHaveBeenCalledWith(
            ['https://ossrdbms-aad.database.windows.net/.default'],
            undefined,
            undefined,
            expect.any(String),
            context,
        );
    });

    it('returns the acquired token with a real expiry through the OIDC callback', async () => {
        const handler = new ManagedIdentityAuthHandler(buildCredentials());

        const { options } = await handler.configureAuth();
        const response = await invokeOidcCallback(options);

        expect(response.accessToken).toBe('a-token');
        expect(response.expiresInSeconds).toBeGreaterThan(0);
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
    });

    it('reuses one token correlation ID across OIDC callback retries', async () => {
        const handler = new ManagedIdentityAuthHandler(buildCredentials());

        const { options } = await handler.configureAuth();
        await invokeOidcCallback(options);
        await invokeOidcCallback(options);

        expect(getManagedIdentityAccessToken.mock.calls[0][3]).toBe(getManagedIdentityAccessToken.mock.calls[1][3]);
    });

    it('propagates the provider readable failure', async () => {
        getManagedIdentityAccessToken.mockRejectedValue(new Error('More than one managed identity is available.'));
        const handler = new ManagedIdentityAuthHandler(buildCredentials());

        const { options } = await handler.configureAuth();

        await expect(invokeOidcCallback(options)).rejects.toThrow(/more than one managed identity/i);
    });

    it('records failures only inside the deferred token callback and rethrows the same error', async (): Promise<void> => {
        const connectionString = 'mongodb://cluster.azure.us/';
        const handler = new ManagedIdentityAuthHandler(
            buildCredentials({ connectionString, connectionStringWithPassword: connectionString }),
        );
        const error = Object.freeze(new Error('AADSTS500011: Resource not found'));
        getManagedIdentityAccessToken.mockRejectedValueOnce(error);

        const startupProperties: Record<string, string> = {};
        const { options } = await handler.configureAuth(undefined, {
            startupCorrelationId: 'startup-id',
            surface: 'extension',
            startupProperties,
        });
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
        expect(getManagedIdentityAccessToken).not.toHaveBeenCalled();

        await expect(invokeOidcCallback(options)).rejects.toBe(error);
        expect(startupProperties.entraFailureKind).toBe('tokenAcquisitionFailed');
        expect(JSON.stringify(startupProperties)).not.toMatch(/cluster-1|AADSTS|https/);
        expect(getRecentEntraTokenFailure('cluster-1')).toEqual({
            cloudCategory: 'usgov',
            authMethod: 'managedIdentity',
            ruleId: 'resourceNotInTenant',
            timestamp: expect.any(Number),
        });
    });

    it('does not record token resource resolution errors as token-acquisition failures', async (): Promise<void> => {
        const error = new tokenResources.TokenResourceResolutionError(
            'Set the cloud resource.',
            'managedIdentityCloudUnknown',
            {
                flow: 'managedIdentity',
                errorKind: 'managedIdentityCloudUnknown',
            },
        );
        vi.spyOn(tokenResources, 'resolveManagedIdentityTokenResource').mockRejectedValueOnce(error);
        const handler = new ManagedIdentityAuthHandler(buildCredentials());

        const startupProperties: Record<string, string> = {};
        await expect(
            handler.configureAuth(undefined, {
                startupCorrelationId: 'startup-id',
                surface: 'extension',
                startupProperties,
            }),
        ).rejects.toBe(error);
        expect(startupProperties.entraFailureKind).toBe('managedIdentityCloudUnknown');
        expect(getManagedIdentityAccessToken).not.toHaveBeenCalled();
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
    });

    it('retains failure context through configureAuth and clears it only after a token succeeds', async (): Promise<void> => {
        const connectionString = 'mongodb://cluster.azure.us/';
        const handler = new ManagedIdentityAuthHandler(
            buildCredentials({ connectionString, connectionStringWithPassword: connectionString }),
        );
        const error = Object.freeze(new Error('platform_broker_error'));
        getManagedIdentityAccessToken.mockRejectedValueOnce(error);
        const failedProperties: Record<string, string> = {};
        const failed = await handler.configureAuth(undefined, {
            startupCorrelationId: 'failed-startup',
            surface: 'extension',
            startupProperties: failedProperties,
        });
        await expect(invokeOidcCallback(failed.options)).rejects.toBe(error);
        const failure = getRecentEntraTokenFailure('cluster-1');
        expect(failure).toMatchObject({ cloudCategory: 'usgov', authMethod: 'managedIdentity' });
        const diagnostics = new EntraErrorExplainer();
        expect(await diagnostics.explain({ clusterId: 'cluster-1', error })).toContain(
            'Sign-in failed in Azure US Government',
        );

        const successfulProperties: Record<string, string> = {};
        const successful = await handler.configureAuth(undefined, {
            startupCorrelationId: 'successful-startup',
            surface: 'extension',
            startupProperties: successfulProperties,
        });
        expect(getRecentEntraTokenFailure('cluster-1')).toBe(failure);
        getManagedIdentityAccessToken.mockImplementationOnce(async () => {
            expect(getRecentEntraTokenFailure('cluster-1')).toBe(failure);
            return { accessToken: 'a-token', expiresOnTimestamp: Date.now() + 3_600_000 };
        });
        await expect(invokeOidcCallback(successful.options)).resolves.toMatchObject({ accessToken: 'a-token' });
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
        expect(failedProperties.entraFailureKind).toBe('tokenAcquisitionFailed');
        expect(successfulProperties.entraFailureKind).toBe('none');
        expect(await diagnostics.explain({ clusterId: 'cluster-1', error })).toMatch(
            /^The sign-in window reported an error without details\./,
        );
        expect(ext.outputChannel.info).toHaveBeenLastCalledWith(
            expect.stringContaining('"cloudCategory":"unknown","recentTokenFailure":false'),
        );
        expect(error.message).toBe('platform_broker_error');
    });

    it('honors the host-gated TLS exception', async () => {
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue({ ossrdbmsEndpoint: 'https://ossrdbms-aad.database.windows.net' }),
            inspect: vi.fn().mockReturnValue(undefined),
        } as unknown as vscode.WorkspaceConfiguration);
        const cs = 'mongodb://localhost:27017/';
        const handler = new ManagedIdentityAuthHandler(
            buildCredentials({
                connectionString: cs,
                connectionStringWithPassword: cs,
                emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true },
            }),
        );

        const { options } = await handler.configureAuth();

        expect(options.tlsAllowInvalidCertificates).toBe(true);
    });

    it('excludes managed-identity token acquisition from the database duration', async () => {
        let now = 0;
        const timings = new ConnectionStartupTimings(() => now);
        const handler = new ManagedIdentityAuthHandler(buildCredentials());
        const { options } = await handler.configureAuth(timings);
        getManagedIdentityAccessToken.mockImplementationOnce(async () => {
            now = 35;
            return { accessToken: 'a-token', expiresOnTimestamp: Date.now() + 3600000 };
        });
        const stopDatabase = timings.startDatabaseConnect();
        now = 10;
        await invokeOidcCallback(options);
        now = 50;
        stopDatabase();

        expect(timings.finish()).toEqual({ databaseConnectDurationMs: 25, tokenAcquireDurationMs: 25 });
    });

    it.each([
        {
            connectionString:
                'mongodb+srv://11111111-2222-3333-4444-555555555555@my-cluster.mongocluster.cosmos.azure.com/' +
                '?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure&tls=false&retryWrites=true',
            emulatorConfiguration: undefined,
        },
        {
            connectionString: 'mongodb://localhost:27017/?tls=false',
            emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true },
        },
    ])(
        'returns the connection string and network options of buildAuthConnectionTarget ($connectionString)',
        async ({ connectionString, emulatorConfiguration }) => {
            vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
                get: vi.fn().mockReturnValue({ ossrdbmsEndpoint: 'https://ossrdbms-aad.database.windows.net' }),
                inspect: vi.fn().mockReturnValue(undefined),
            } as unknown as vscode.WorkspaceConfiguration);
            const credentials = buildCredentials({
                connectionString,
                connectionStringWithPassword: connectionString,
                emulatorConfiguration,
            });
            const target = buildAuthConnectionTarget(AuthMethodId.ManagedIdentity, credentials);

            const { connectionString: actual, options } = await new ManagedIdentityAuthHandler(
                credentials,
            ).configureAuth();

            expect(actual).toBe(target.connectionString);
            expect(options).toMatchObject(target.networkOptions);
        },
    );

    describe('caller policy', () => {
        function recordingObserver(events: string[], tokens: string[] = []): AuthPhaseObserver {
            return {
                onSignInConfigurationResolved: (info) =>
                    events.push(
                        `resolved:${info.cloudCategory}:${info.tokenResourceReason}:${info.allowedHosts.join(',')}`,
                    ),
                onSignInConfigurationFailed: (info) => events.push(`configurationFailed:${info.kind}`),
                onTokenStarted: () => events.push('tokenStarted'),
                onTokenAcquired: (info) => {
                    tokens.push(info.accessToken);
                    events.push(`tokenAcquired:${info.tenantId ?? 'none'}`);
                },
                onTokenFailed: () => events.push('tokenFailed'),
            };
        }

        it.each([true, false])(
            'does not change the flow for a %s interactive policy',
            async (interactive): Promise<void> => {
                const credentials = buildCredentials({ managedIdentityConfig: { clientId: 'client-id' } });
                const expected = await new ManagedIdentityAuthHandler(credentials).configureAuth();
                const { connectionString, options } = await new ManagedIdentityAuthHandler(credentials, {
                    interactive,
                }).configureAuth();

                expect(connectionString).toBe(expected.connectionString);
                expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual(
                    expected.options.authMechanismProperties?.ALLOWED_HOSTS,
                );
                await expect(invokeOidcCallback(options)).resolves.toMatchObject({ accessToken: 'a-token' });
            },
        );

        it('fires token events inside the OIDC callback, not during configureAuth', async (): Promise<void> => {
            const events: string[] = [];
            const tokens: string[] = [];
            const handler = new ManagedIdentityAuthHandler(
                buildCredentials({ managedIdentityConfig: { tenantId: 'tenant' } }),
                {
                    interactive: false,
                    observer: recordingObserver(events, tokens),
                },
            );

            const { options } = await handler.configureAuth();
            expect(events).toEqual(['resolved:public:host:*.azure.com']);
            expect(getManagedIdentityAccessToken).not.toHaveBeenCalled();

            await invokeOidcCallback(options);
            expect(events).toEqual(['resolved:public:host:*.azure.com', 'tokenStarted', 'tokenAcquired:tenant']);
            expect(tokens).toEqual(['a-token']);
            const output = JSON.stringify([
                vi.mocked(ext.outputChannel.info).mock.calls,
                vi.mocked(ext.outputChannel.error).mock.calls,
            ]);
            expect(output).not.toContain('a-token');
        });

        it('reports a token failure inside the OIDC callback and records it as today', async (): Promise<void> => {
            const error = new Error('AADSTS700016: identity not found');
            getManagedIdentityAccessToken.mockRejectedValueOnce(error);
            const events: string[] = [];
            const handler = new ManagedIdentityAuthHandler(buildCredentials(), {
                interactive: false,
                observer: recordingObserver(events),
            });

            const { options } = await handler.configureAuth();
            expect(events).toEqual(['resolved:public:host:*.azure.com']);
            await expect(invokeOidcCallback(options)).rejects.toBe(error);
            expect(events).toEqual(['resolved:public:host:*.azure.com', 'tokenStarted', 'tokenFailed']);
            expect(getRecentEntraTokenFailure('cluster-1')).toMatchObject({
                authMethod: 'managedIdentity',
                ruleId: 'applicationNotInDirectory',
            });
        });

        it('reports a resolver failure with its kind and never starts a token', async (): Promise<void> => {
            const error = new tokenResources.TokenResourceResolutionError(
                'Set the cloud resource.',
                'managedIdentityCloudUnknown',
                { flow: 'managedIdentity', errorKind: 'managedIdentityCloudUnknown' },
            );
            vi.spyOn(tokenResources, 'resolveManagedIdentityTokenResource').mockRejectedValueOnce(error);
            const events: string[] = [];
            const handler = new ManagedIdentityAuthHandler(buildCredentials(), {
                interactive: false,
                observer: recordingObserver(events),
            });

            await expect(handler.configureAuth()).rejects.toBe(error);
            expect(events).toEqual(['configurationFailed:managedIdentityCloudUnknown']);
            expect(getManagedIdentityAccessToken).not.toHaveBeenCalled();
        });

        it('ignores a throwing observer', async (): Promise<void> => {
            const throwing = (): never => {
                throw new Error('observer failure');
            };
            const handler = new ManagedIdentityAuthHandler(buildCredentials(), {
                interactive: false,
                observer: {
                    onSignInConfigurationResolved: throwing,
                    onTokenStarted: throwing,
                    onTokenAcquired: throwing,
                    onTokenFailed: throwing,
                },
            });

            const { options } = await handler.configureAuth();
            await expect(invokeOidcCallback(options)).resolves.toMatchObject({ accessToken: 'a-token' });
            const error = new Error('token failure');
            getManagedIdentityAccessToken.mockRejectedValueOnce(error);
            await expect(invokeOidcCallback(options)).rejects.toBe(error);
        });
    });
});
