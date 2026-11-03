/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type * as documentdbTokenResource from './documentdbTokenResource';

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
    ...(await importOriginal<typeof documentdbTokenResource>()),
    resolveInteractiveTokenResource: vi.fn(),
}));

import { type CachedClusterCredentials } from '../CredentialCache';
import { ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { AuthInputUnavailableError, type AuthPhaseObserver } from './authCallerPolicy';
import { buildAuthConnectionTarget } from './authConnectionTarget';
import { AuthMethodId } from './AuthMethod';
import { resolveInteractiveTokenResource, TokenResourceResolutionError } from './documentdbTokenResource';
import { EntraDiagnosticsProvider } from './entraErrors/EntraDiagnosticsProvider';
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
            details: {
                flow: 'interactive',
                tokenResource: 'https://ossrdbms-aad.database.windows.net',
            },
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
        const cloudResolutionTrace = mockOutputChannel.info.mock.calls
            .map((call) => String(call[0]))
            .find((message) => message.includes('entraCloud.resolved'));
        expect(cloudResolutionTrace).toContain('"tokenResource":"https://ossrdbms-aad.database.windows.net"');
        expect(cloudResolutionTrace).not.toContain('my-cluster');
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
    });

    it('requests the resolved US Government scope and records its category on the existing trace', async () => {
        const scope = 'https://ossrdbms-aad.database.usgovcloudapi.net/.default';
        vi.mocked(resolveInteractiveTokenResource).mockResolvedValueOnce({
            resource: 'https://ossrdbms-aad.database.usgovcloudapi.net',
            scope,
            cloudCategory: 'usgov',
            reason: 'setting',
            details: { flow: 'interactive', tokenResource: 'https://ossrdbms-aad.database.usgovcloudapi.net' },
        });
        const connectionString = 'mongodb://cluster.azure.us/';
        await new MicrosoftEntraIDAuthHandler(buildCredentials(connectionString)).configureAuth();
        expect(resolveInteractiveTokenResource).toHaveBeenCalledWith(connectionString);
        expect(getSessionFromVSCode).toHaveBeenCalledWith([scope], 'tenant', { createIfNone: true });
        const output = mockOutputChannel.info.mock.calls.map((call) => String(call[0])).join('\n');
        expect(output).toContain('"cloudCategory":"usgov"');
        expect(output).toContain('"tokenResourceReason":"setting"');
        expect(mockOutputChannel.info).toHaveBeenCalledTimes(4);
    });

    it('propagates a cloud mismatch unchanged before requesting a session', async () => {
        const error = new TokenResourceResolutionError('Select the cloud of the cluster.', 'cloudMismatch', {
            flow: 'interactive',
            errorKind: 'cloudMismatch',
        });
        vi.mocked(resolveInteractiveTokenResource).mockRejectedValueOnce(error);
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.azure.us/'));
        const startupProperties: Record<string, string> = {};
        await expect(
            handler.configureAuth(undefined, {
                startupCorrelationId: 'startup-id',
                surface: 'extension',
                startupProperties,
            }),
        ).rejects.toBe(error);
        expect(startupProperties.errorKind).toBe('cloudMismatch');
        expect(getSessionFromVSCode).not.toHaveBeenCalled();
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
    });

    it.each([false, true])('emits complete real-resolver cloud evidence (mismatch: %s)', async (mismatch) => {
        const actual = await vi.importActual<typeof documentdbTokenResource>('./documentdbTokenResource');
        const resource = mismatch ? 'https://database.example.com' : 'https://ossrdbms-aad.database.usgovcloudapi.net';
        const deps: documentdbTokenResource.TokenResourceResolverDeps = {
            getConfiguredCloud: () => ({ name: 'custom', isCustomCloud: true }),
            getCustomEnvironment: () => ({ ossrdbmsEndpoint: resource }),
            getCustomHostnameSuffixSource: () => 'none',
            getSignInEnvironment: () => ({
                authProvider: 'microsoft-sovereign-cloud',
                brokerImplementation: undefined,
            }),
            fetchArmMetadata: vi.fn(),
            readImdsAzEnvironment: vi.fn(),
            warn: vi.fn(),
        };
        vi.mocked(resolveInteractiveTokenResource).mockImplementationOnce((connectionString) =>
            actual.resolveInteractiveTokenResource(connectionString, deps),
        );
        const result = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://private-identifier.azure.us/'),
        ).configureAuth();
        if (mismatch) {
            await expect(result).rejects.toMatchObject({ kind: 'cloudMismatch' });
            expect(getSessionFromVSCode).not.toHaveBeenCalled();
        } else {
            await result;
        }
        const trace = mockOutputChannel.info.mock.calls
            .map((call) => String(call[0]))
            .find((message) => message.includes(mismatch ? 'entraCloud.unresolved' : 'entraCloud.resolved'));
        if (!trace) {
            throw new Error('Missing cloud resolution trace');
        }
        const details: unknown = JSON.parse(trace.slice(trace.indexOf(': ') + 2));
        expect(details).toEqual({
            flow: 'interactive',
            configuredCloud: 'custom',
            authProvider: 'microsoft-sovereign-cloud',
            brokerImplementation: 'default',
            hostCloud: 'AzureUSGovernment',
            hostsOutsideAzure: false,
            customOssrdbmsEndpointState: 'valid',
            customOssrdbmsEndpointApplicable: true,
            customHostnameSuffixSet: false,
            customHostnameSuffixSource: 'none',
            armMetadata: 'notNeeded',
            imdsAzEnvironment: 'notQueried',
            cloudCategory: mismatch ? 'custom' : 'usgov',
            reason: 'customOverride',
            tokenResource: resource,
            ...(mismatch ? { errorKind: 'cloudMismatch' } : {}),
        });
        expect(trace).not.toContain('private-identifier');
        expect(trace).not.toContain('access-token');
    });

    it.each(['public', 'usgov', 'china', 'custom'] as const)(
        'records a failed token acquisition in %s without changing the error',
        async (cloudCategory): Promise<void> => {
            vi.mocked(resolveInteractiveTokenResource).mockResolvedValueOnce({
                resource: 'https://database.example.com',
                scope: 'https://database.example.com/.default',
                cloudCategory,
                reason: 'setting',
                details: { flow: 'interactive', tokenResource: 'https://database.example.com' },
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
                ruleId: 'firstPartyPreauthorization',
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

    it('clears a prior failure only after a session succeeds, without stale explanation context', async (): Promise<void> => {
        vi.mocked(resolveInteractiveTokenResource).mockResolvedValueOnce({
            resource: 'https://ossrdbms-aad.database.usgovcloudapi.net',
            scope: 'https://ossrdbms-aad.database.usgovcloudapi.net/.default',
            cloudCategory: 'usgov',
            reason: 'setting',
            details: { flow: 'interactive', cloudCategory: 'usgov', reason: 'setting' },
        });
        const error = Object.freeze(new Error('platform_broker_error'));
        getSessionFromVSCode.mockRejectedValueOnce(error);
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/'));
        const failedProperties: Record<string, string> = {};
        await expect(
            handler.configureAuth(undefined, {
                startupCorrelationId: 'failed-startup',
                surface: 'extension',
                startupProperties: failedProperties,
            }),
        ).rejects.toBe(error);
        const failure = getRecentEntraTokenFailure('cluster-1');
        expect(failure).toMatchObject({ cloudCategory: 'usgov', authMethod: 'interactive' });
        const diagnostics = new EntraDiagnosticsProvider();
        expect(await diagnostics.explain({ clusterId: 'cluster-1', error })).toContain(
            'Sign-in failed in Azure US Government',
        );

        getSessionFromVSCode.mockImplementationOnce(async () => {
            expect(getRecentEntraTokenFailure('cluster-1')).toBe(failure);
            return { accessToken: 'access-token' };
        });
        const successfulProperties: Record<string, string> = {};
        await handler.configureAuth(undefined, {
            startupCorrelationId: 'successful-startup',
            surface: 'extension',
            startupProperties: successfulProperties,
        });
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
        expect(failedProperties.errorKind).toBe('tokenAcquisitionFailed');
        expect(successfulProperties.errorKind).toBe('none');
        expect(await diagnostics.explain({ clusterId: 'cluster-1', error })).toMatch(
            /^The sign-in window reported an error without details\./,
        );
        expect(mockOutputChannel.info).toHaveBeenLastCalledWith(
            expect.stringContaining('"cloudCategory":"unknown","recentTokenFailure":false'),
        );
        expect(error.message).toBe('platform_broker_error');
    });

    it('passes the explicitly configured custom hostname suffix to the OIDC allowlist', async () => {
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn().mockReturnValue({ hostnameSuffix: '.database.example.com' }),
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
        expect(messages).toHaveLength(4);
        for (const message of messages) {
            expect(message).toMatch(
                /^\[Authentication\] startup=startup-id surface=extension (entraCloud\.resolved|interactiveEntra\.)/,
            );
        }
    });

    it('labels authentication failure with its startup ID without exposing secrets', async (): Promise<void> => {
        getSessionFromVSCode.mockRejectedValueOnce(new Error('secret-token'));
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://localhost:27017/'));
        const startupProperties: Record<string, string> = {};
        await expect(
            handler.configureAuth(undefined, {
                startupCorrelationId: 'startup-id',
                surface: 'extension',
                startupProperties,
            }),
        ).rejects.toThrow('secret-token');
        expect(startupProperties.errorKind).toBe('tokenAcquisitionFailed');
        expect(JSON.stringify(startupProperties)).not.toContain('secret-token');
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

    it.each([
        {
            connectionString:
                'mongodb+srv://someone:secret@my-cluster.mongocluster.cosmos.azure.com/' +
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
            const credentials: CachedClusterCredentials = {
                ...buildCredentials(connectionString),
                emulatorConfiguration,
            };
            const target = buildAuthConnectionTarget(AuthMethodId.MicrosoftEntraID, credentials);

            const result = await new MicrosoftEntraIDAuthHandler(credentials).configureAuth();

            expect(result.connectionString).toBe(target.connectionString);
            expect(result.options).toMatchObject(target.networkOptions);
        },
    );

    describe('caller policy', () => {
        function recordingObserver(events: string[]): AuthPhaseObserver {
            return {
                onSignInConfigurationResolved: (info) => events.push(`resolved:${info.allowedHosts.join(',')}`),
                onSignInConfigurationFailed: (info) => events.push(`configurationFailed:${info.kind}`),
                onTokenStarted: () => events.push('tokenStarted'),
                onTokenAcquired: (info) => events.push(`tokenAcquired:${info.tenantId ?? 'none'}`),
                onTokenFailed: () => events.push('tokenFailed'),
            };
        }

        it('keeps the interactive request when the policy is explicitly interactive', async () => {
            const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/'), {
                interactive: true,
            });
            await handler.configureAuth();
            expect(getSessionFromVSCode).toHaveBeenCalledWith(
                ['https://ossrdbms-aad.database.windows.net/.default'],
                'tenant',
                { createIfNone: true },
            );
            const output = mockOutputChannel.info.mock.calls.map((call) => String(call[0])).join('\n');
            expect(output).toContain('"createIfNone":true');
            expect(output).not.toContain('"silent"');
        });

        it('looks up an existing session silently when non-interactive', async () => {
            const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/'), {
                interactive: false,
            });
            const { options } = await handler.configureAuth();
            expect(getSessionFromVSCode).toHaveBeenCalledTimes(1);
            expect(getSessionFromVSCode).toHaveBeenCalledWith(
                ['https://ossrdbms-aad.database.windows.net/.default'],
                'tenant',
                { silent: true },
            );
            const sessionOptions: unknown = getSessionFromVSCode.mock.calls[0]?.[2];
            expect(sessionOptions).not.toHaveProperty('createIfNone');
            expect(sessionOptions).not.toHaveProperty('forceNewSession');
            expect(options.authMechanismProperties).toHaveProperty('OIDC_CALLBACK');
            const output = mockOutputChannel.info.mock.calls.map((call) => String(call[0])).join('\n');
            expect(output).toContain('"silent":true');
            expect(output).not.toContain('createIfNone');
            expect(output).not.toContain('access-token');
        });

        it('reports a missing silent session as unavailable input without recording a token failure', async () => {
            getSessionFromVSCode.mockResolvedValueOnce(undefined);
            const events: string[] = [];
            const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/'), {
                interactive: false,
                observer: recordingObserver(events),
            });
            const startupProperties: Record<string, string> = {};

            const result = handler.configureAuth(undefined, {
                startupCorrelationId: 'run-id',
                surface: 'troubleshooter',
                startupProperties,
            });

            await expect(result).rejects.toBeInstanceOf(AuthInputUnavailableError);
            await expect(result).rejects.toMatchObject({ missing: 'entraSession' });
            expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
            expect(startupProperties.errorKind).not.toBe('tokenAcquisitionFailed');
            expect(startupProperties.errorKind).toBe('none');
            expect(events).toEqual(['resolved:*.azure.com', 'tokenStarted', 'tokenFailed']);
        });

        it('does not clear an earlier recorded failure when no silent session is available', async () => {
            getSessionFromVSCode.mockRejectedValueOnce(new Error('AADSTS65002: Preauthorization required'));
            await expect(
                new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/')).configureAuth(),
            ).rejects.toThrow('AADSTS65002');
            const failure = getRecentEntraTokenFailure('cluster-1');
            expect(failure).toBeDefined();

            getSessionFromVSCode.mockResolvedValueOnce(undefined);
            await expect(
                new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/'), {
                    interactive: false,
                }).configureAuth(),
            ).rejects.toBeInstanceOf(AuthInputUnavailableError);
            expect(getRecentEntraTokenFailure('cluster-1')).toBe(failure);
        });

        it('records a silent token request error exactly as an interactive one', async () => {
            const error = Object.freeze(new Error('AADSTS65002: Preauthorization required'));
            getSessionFromVSCode.mockRejectedValueOnce(error);
            const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/'), {
                interactive: false,
            });
            const startupProperties: Record<string, string> = {};

            await expect(
                handler.configureAuth(undefined, {
                    startupCorrelationId: 'run-id',
                    surface: 'troubleshooter',
                    startupProperties,
                }),
            ).rejects.toBe(error);
            expect(getRecentEntraTokenFailure('cluster-1')).toEqual({
                cloudCategory: 'public',
                authMethod: 'interactive',
                ruleId: 'firstPartyPreauthorization',
                timestamp: expect.any(Number),
            });
            expect(startupProperties.errorKind).toBe('tokenAcquisitionFailed');
        });

        it('notifies the observer in real order and passes the token only to the observer', async () => {
            getSessionFromVSCode.mockResolvedValueOnce({
                accessToken: 'access-token',
                account: { label: 'alice@contoso.com', id: 'account-id' },
            });
            const events: string[] = [];
            const acquired: unknown[] = [];
            const observer = recordingObserver(events);
            const handler = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                {
                    interactive: false,
                    observer: {
                        ...observer,
                        onTokenStarted: () => {
                            expect(getSessionFromVSCode).not.toHaveBeenCalled();
                            observer.onTokenStarted?.();
                        },
                        onTokenAcquired: (info) => {
                            acquired.push(info);
                            observer.onTokenAcquired?.(info);
                        },
                    },
                },
            );

            await handler.configureAuth();

            expect(events).toEqual(['resolved:*.azure.com', 'tokenStarted', 'tokenAcquired:tenant']);
            expect(acquired).toEqual([
                {
                    accessToken: 'access-token',
                    account: { label: 'alice@contoso.com', id: 'account-id' },
                    tenantId: 'tenant',
                },
            ]);
            expect(JSON.stringify(mockOutputChannel.info.mock.calls)).not.toContain('access-token');
        });

        it('passes the resolver details and reason to the observer', async () => {
            let resolvedInfo:
                | Parameters<NonNullable<AuthPhaseObserver['onSignInConfigurationResolved']>>[0]
                | undefined;
            const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.example.com/'), {
                interactive: true,
                observer: { onSignInConfigurationResolved: (info) => (resolvedInfo = info) },
            });
            await handler.configureAuth();
            expect(resolvedInfo).toEqual({
                details: { flow: 'interactive', tokenResource: 'https://ossrdbms-aad.database.windows.net' },
                cloudCategory: 'public',
                tokenResourceReason: 'setting',
                allowedHosts: ['*.azure.com'],
            });
        });

        it.each([true, false])(
            'reports a resolver failure before any token request (interactive: %s)',
            async (interactive) => {
                const error = new TokenResourceResolutionError('Select the cloud of the cluster.', 'cloudMismatch', {
                    flow: 'interactive',
                    errorKind: 'cloudMismatch',
                });
                vi.mocked(resolveInteractiveTokenResource).mockRejectedValueOnce(error);
                const events: string[] = [];
                let failedInfo: unknown;
                const observer = recordingObserver(events);
                const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.azure.us/'), {
                    interactive,
                    observer: {
                        ...observer,
                        onSignInConfigurationFailed: (info) => {
                            failedInfo = info;
                            observer.onSignInConfigurationFailed?.(info);
                        },
                    },
                });

                await expect(handler.configureAuth()).rejects.toBe(error);
                expect(events).toEqual(['configurationFailed:cloudMismatch']);
                expect(failedInfo).toEqual({
                    kind: 'cloudMismatch',
                    details: { flow: 'interactive', errorKind: 'cloudMismatch' },
                });
                expect(getSessionFromVSCode).not.toHaveBeenCalled();
                expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
            },
        );

        it.each([true, false])('ignores a throwing observer (interactive: %s)', async (interactive) => {
            const throwing = (): never => {
                throw new Error('observer failure');
            };
            const observer: AuthPhaseObserver = {
                onSignInConfigurationResolved: throwing,
                onSignInConfigurationFailed: throwing,
                onTokenStarted: throwing,
                onTokenAcquired: throwing,
                onTokenFailed: throwing,
            };
            const credentials = buildCredentials('mongodb://cluster.example.com/');
            const expected = await new MicrosoftEntraIDAuthHandler(credentials, { interactive }).configureAuth();

            const result = await new MicrosoftEntraIDAuthHandler(credentials, {
                interactive,
                observer,
            }).configureAuth();

            expect(result.connectionString).toBe(expected.connectionString);
            expect(result.options.authMechanismProperties?.ALLOWED_HOSTS).toEqual(
                expected.options.authMechanismProperties?.ALLOWED_HOSTS,
            );

            const error = new Error('token request failed');
            getSessionFromVSCode.mockRejectedValueOnce(error);
            await expect(
                new MicrosoftEntraIDAuthHandler(credentials, { interactive, observer }).configureAuth(),
            ).rejects.toBe(error);
            expect(getRecentEntraTokenFailure('cluster-1')).toMatchObject({ authMethod: 'interactive' });
        });
    });
});
