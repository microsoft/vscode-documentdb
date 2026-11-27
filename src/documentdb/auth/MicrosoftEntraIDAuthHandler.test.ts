/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as azureAuth from '@microsoft/vscode-azext-azureauth';
import { type PeerCertificate } from 'tls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type * as documentdbTokenResource from './documentdbTokenResource';

const getSessionFromVSCode = vi.fn();
const getConfiguredAuthProviderId = vi.fn<() => string>();
type AzureSignInSettings = Pick<
    ReturnType<typeof azureAuth.getConfiguredAzureEnv>,
    'name' | 'activeDirectoryEndpointUrl'
>;
const getConfiguredAzureEnv = vi.fn<() => AzureSignInSettings>();
const account = { id: 'account-id', label: 'account-label' };
const session = { accessToken: 'access-token', account };
const mockOutputChannel = { info: vi.fn(), error: vi.fn() };
vi.mock('../../extensionVariables', () => ({
    ext: {
        get outputChannel(): typeof mockOutputChannel {
            return mockOutputChannel;
        },
    },
}));

vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    authentication: { getSession: (...args: unknown[]): unknown => getSessionFromVSCode(...args) },
}));

vi.mock('@microsoft/vscode-azext-azureauth', async (importOriginal) => ({
    ...(await importOriginal<typeof azureAuth>()),
    getConfiguredAuthProviderId: (): string => getConfiguredAuthProviderId(),
    getConfiguredAzureEnv: (): AzureSignInSettings => getConfiguredAzureEnv(),
}));

vi.mock('./documentdbTokenResource', async (importOriginal) => ({
    ...(await importOriginal<typeof documentdbTokenResource>()),
    resolveInteractiveTokenResource: vi.fn(),
}));

import { type CachedClusterCredentials } from '../CredentialCache';
import { ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { AuthInputUnavailableError, type AuthPhaseObserver } from './authCallerPolicy';
import { buildAuthConnectionTarget } from './authConnectionTarget';
import { type VerifiedEntraIdentity } from './AuthHandler';
import { AuthMethodId } from './AuthMethod';
import { resolveInteractiveTokenResource, TokenResourceResolutionError } from './documentdbTokenResource';
import {
    EntraIdentityMismatchError,
    EntraSignInRequiredError,
    TokenCallbackError,
} from './entraErrors/entraCallbackErrors';
import { EntraErrorExplainer } from './entraErrors/EntraErrorExplainer';
import {
    getRecentEntraTokenFailure,
    recordEntraTokenFailure,
    resetEntraTokenFailuresForTests,
} from './entraErrors/entraTokenFailures';
import { MicrosoftEntraIDAuthHandler } from './MicrosoftEntraIDAuthHandler';
import { EntraDestinationRejectedError } from './oidcAllowedHosts';

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
    const pinnedEntraIdentity: VerifiedEntraIdentity = {
        kind: 'entra',
        providerId: 'microsoft',
        accountId: account.id,
        accountLabel: account.label,
        tenantId: 'pinned-tenant',
    };

    beforeEach(() => {
        vi.clearAllMocks();
        resetEntraTokenFailuresForTests();
        getSessionFromVSCode.mockReset();
        getSessionFromVSCode.mockResolvedValue(session);
        getConfiguredAuthProviderId.mockReset().mockReturnValue('microsoft');
        getConfiguredAzureEnv.mockReset().mockReturnValue({
            name: 'AzureCloud',
            activeDirectoryEndpointUrl: 'https://login.microsoftonline.com/',
        });
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
            inspect: vi.fn().mockReturnValue(undefined),
        } as unknown as vscode.WorkspaceConfiguration);
    });

    afterEach((): void => {
        resetEntraTokenFailuresForTests();
    });

    it.each(['pinned-tenant', undefined])('uses the pinned tenant %s, never the cached tenant', async (tenantId) => {
        const pin = { ...pinnedEntraIdentity, tenantId };
        const result = await new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
            { interactive: true, pinnedEntraIdentity: pin },
        ).configureAuth();

        const scopes = ['https://ossrdbms-aad.database.windows.net/.default'];
        if (tenantId !== undefined) {
            scopes.push(`VSCODE_TENANT:${tenantId}`);
        }
        expect(getSessionFromVSCode).toHaveBeenCalledExactlyOnceWith(pin.providerId, scopes, { silent: true, account });
        expect(result.verifiedIdentity).toEqual(pin);
    });

    it.each(['providerChanged', 'noSession', 'identityMismatch'] as const)(
        'fails closed on a pinned %s without changing the existing failure context',
        async (failure) => {
            const credentials = buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/');
            recordEntraTokenFailure(credentials.clusterId, { cloudCategory: 'public', authMethod: 'interactive' });
            const previousFailure = getRecentEntraTokenFailure(credentials.clusterId);
            const startupProperties: Record<string, string> = {};
            if (failure === 'providerChanged') {
                getConfiguredAuthProviderId.mockReturnValue('different-provider');
            } else if (failure === 'noSession') {
                getSessionFromVSCode.mockResolvedValue(undefined);
            } else {
                getSessionFromVSCode.mockResolvedValue({
                    ...session,
                    account: { ...account, id: 'different-account' },
                });
            }

            const configuring = new MicrosoftEntraIDAuthHandler(credentials, {
                interactive: false,
                pinnedEntraIdentity,
            }).configureAuth(undefined, { startupCorrelationId: 'startup', surface: 'extension', startupProperties });
            if (failure === 'identityMismatch') {
                await expect(configuring).rejects.toBeInstanceOf(EntraIdentityMismatchError);
            } else {
                await expect(configuring).rejects.toBeInstanceOf(EntraSignInRequiredError);
                await expect(configuring).rejects.toMatchObject({ reason: failure });
            }
            expect(getSessionFromVSCode).toHaveBeenCalledTimes(failure === 'providerChanged' ? 0 : 1);
            expect(getRecentEntraTokenFailure(credentials.clusterId)).toBe(previousFailure);
            expect(startupProperties.entraFailureKind).not.toBe('tokenAcquisitionFailed');
        },
    );

    it.each([
        'mongodb://attacker.cloudapp.azure.com/',
        'mongodb://cluster.mongocluster.cosmos.azure.com,attacker.example.com/',
        'mongodb://localhost:27017/',
    ])('rejects %s before audience resolution or eager sign-in', async (connectionString): Promise<void> => {
        const startupProperties: Record<string, string> = {};
        await expect(
            new MicrosoftEntraIDAuthHandler(buildCredentials(connectionString)).configureAuth(undefined, {
                startupCorrelationId: 'startup-id',
                surface: 'extension',
                startupProperties,
            }),
        ).rejects.toBeInstanceOf(EntraDestinationRejectedError);
        expect(resolveInteractiveTokenResource).not.toHaveBeenCalled();
        expect(getSessionFromVSCode).not.toHaveBeenCalled();
        expect(startupProperties.entraDestinationClass).toMatch(/^(otherAzure|other)$/);
        expect(JSON.stringify(mockOutputChannel.info.mock.calls)).not.toMatch(/attacker|localhost|mongodb:\/\//);
    });

    it('keeps eager sign-in after destination validation and forces secure driver options', async (): Promise<void> => {
        const connectionString =
            'mongodb://cluster.mongocluster.cosmos.azure.com/?TLS=false&tlsInsecure=true&authMechanismProperties=ENVIRONMENT:azure';
        getSessionFromVSCode.mockImplementationOnce(async () => {
            expect(resolveInteractiveTokenResource).toHaveBeenCalledExactlyOnceWith(connectionString);
            expect(mockOutputChannel.info.mock.calls[0][0]).toContain('entraDestination.evaluated');
            return session;
        });
        const result = await new MicrosoftEntraIDAuthHandler(buildCredentials(connectionString)).configureAuth();
        expect(getSessionFromVSCode).toHaveBeenCalledTimes(1);
        expect(result.connectionString).not.toMatch(/ENVIRONMENT|tls|authMechanismProperties/i);
        expect(result.options).toMatchObject({
            tls: true,
            rejectUnauthorized: true,
            checkServerIdentity: expect.any(Function),
            authMechanismProperties: { ALLOWED_HOSTS: ['*.mongocluster.cosmos.azure.com'] },
        });
        expect(mockOutputChannel.info).toHaveBeenCalledWith(
            '[Auth] TLS validation bypass parameters are ignored for Microsoft Entra ID connections.',
        );
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
            'microsoft',
            ['https://ossrdbms-aad.database.windows.net/.default', 'VSCODE_TENANT:tenant'],
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

    it.each([
        [false, false],
        [false, true],
        [true, false],
        [true, true],
    ] as const)(
        'blocks token completion after trust removal without replacing failure context (prior=%s, interactive=%s)',
        async (prior, interactive): Promise<void> => {
            let suffix: string | undefined = 'database.example.com';
            vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
                inspect: vi.fn(() => ({ globalValue: { hostnameSuffix: suffix } })),
            } as unknown as vscode.WorkspaceConfiguration);
            if (prior) {
                recordEntraTokenFailure('cluster-1', { cloudCategory: 'custom', authMethod: 'interactive' });
            }
            const failure = getRecentEntraTokenFailure('cluster-1');
            let finish!: (value: { accessToken: string }) => void;
            getSessionFromVSCode.mockReturnValueOnce(
                new Promise((resolve) => {
                    finish = resolve;
                }),
            );
            const startupProperties: Record<string, string> = {};
            const onTokenStarted = vi.fn();
            const onTokenAcquired = vi.fn();
            const onTokenFailed = vi.fn();
            const configuring = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.database.example.com/'),
                { interactive, observer: { onTokenStarted, onTokenAcquired, onTokenFailed } },
            ).configureAuth(undefined, { startupCorrelationId: 'startup', surface: 'extension', startupProperties });
            await vi.waitFor(() => expect(getSessionFromVSCode).toHaveBeenCalledTimes(1));
            expect(getSessionFromVSCode.mock.calls[0][2]).toEqual(
                interactive ? { createIfNone: true } : { silent: true },
            );
            suffix = undefined;
            finish({ accessToken: 'must-not-return' });
            await expect(configuring).rejects.toBeInstanceOf(EntraDestinationRejectedError);
            expect(getRecentEntraTokenFailure('cluster-1')).toBe(failure);
            expect(startupProperties.entraFailureKind).not.toBe('tokenAcquisitionFailed');
            expect(onTokenStarted).toHaveBeenCalledOnce();
            expect(onTokenAcquired).not.toHaveBeenCalled();
            expect(onTokenFailed).not.toHaveBeenCalled();
        },
    );

    it('silently accepts the same still-valid token twice with the pinned identity and bounded diagnostics', async () => {
        const now = Math.floor(Date.now() / 1000);
        const accessToken = `header.${Buffer.from(JSON.stringify({ iat: now - 60, exp: now + 600 })).toString('base64url')}.signature`;
        getSessionFromVSCode.mockResolvedValue({ accessToken, account });
        const onTokenLookup = vi.fn();
        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
            { interactive: true, getTokenLookupEpoch: () => 0, onTokenLookup },
        );
        const { options, verifiedIdentity } = await handler.configureAuth(undefined, {
            startupCorrelationId: 'startup-id',
            surface: 'extension',
        });
        const callback = options.authMechanismProperties?.OIDC_CALLBACK;
        if (!callback) {
            throw new Error('Missing OIDC callback');
        }
        const params = { version: 1, timeoutContext: new AbortController().signal } as const;

        expect(verifiedIdentity).toEqual({
            kind: 'entra',
            providerId: 'microsoft',
            accountId: account.id,
            accountLabel: account.label,
            tenantId: 'tenant',
        });
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
        try {
            await expect(callback(params)).resolves.toEqual({ accessToken, expiresInSeconds: 600 });
            await expect(callback(params)).resolves.toEqual({ accessToken, expiresInSeconds: 600 });
        } finally {
            clock.mockRestore();
        }
        const scopes = ['https://ossrdbms-aad.database.windows.net/.default', 'VSCODE_TENANT:tenant'];
        expect(getSessionFromVSCode.mock.calls).toEqual([
            ['microsoft', scopes, { createIfNone: true }],
            ['microsoft', scopes, { silent: true, account }],
            ['microsoft', scopes, { silent: true, account }],
        ]);
        expect(onTokenLookup.mock.calls).toEqual([
            [{ outcome: 'returned', lifetimeSeconds: 660 }],
            [{ outcome: 'returned', lifetimeSeconds: 660 }],
        ]);
        expect(
            mockOutputChannel.info.mock.calls
                .map(([message]) => String(message))
                .filter((message) => message.includes('interactiveEntra.oidcCallback')),
        ).toEqual([
            '[Authentication] startup=startup-id surface=extension interactiveEntra.oidcCallback: {"invocation":1,"outcome":"returned"}',
            '[Authentication] startup=startup-id surface=extension interactiveEntra.oidcCallback: {"invocation":2,"outcome":"returned"}',
        ]);
    });

    it.each([false, true])(
        'reports a pending driver timeout once without changing the callback (later epoch change=%s)',
        async (changeEpoch): Promise<void> => {
            let epoch = 0;
            const onTokenLookup = vi.fn((): void => {
                throw new Error('test lookup observer failure');
            });
            const onCallbackTokenObserved = vi.fn();
            const { options } = await new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                {
                    interactive: true,
                    getTokenLookupEpoch: (): number => epoch,
                    onTokenLookup,
                    observer: { onCallbackTokenObserved },
                },
            ).configureAuth();
            let finish!: (value: typeof session) => void;
            getSessionFromVSCode.mockReturnValueOnce(
                new Promise<typeof session>((resolve) => {
                    finish = resolve;
                }),
            );
            const controller = new AbortController();
            const pending = options.authMechanismProperties!.OIDC_CALLBACK!({
                version: 1,
                timeoutContext: controller.signal,
            });
            await vi.waitFor(() => expect(getSessionFromVSCode).toHaveBeenCalledTimes(2));
            expect(onTokenLookup).not.toHaveBeenCalled();
            expect(onCallbackTokenObserved).not.toHaveBeenCalled();

            expect(() => controller.abort()).not.toThrow();
            expect(onTokenLookup.mock.calls).toEqual([[{ outcome: 'timedOut' }]]);
            if (changeEpoch) {
                epoch++;
            }
            finish(session);
            await expect(pending).resolves.toEqual({ accessToken: session.accessToken });
            expect(onTokenLookup.mock.calls).toEqual([[{ outcome: 'timedOut' }]]);
            expect(onCallbackTokenObserved).toHaveBeenCalledExactlyOnceWith({
                outcome: 'acquired',
                accessToken: session.accessToken,
                tenantId: 'tenant',
            });
            expect(getSessionFromVSCode.mock.calls[1]?.[2]).toEqual({ silent: true, account });
        },
    );

    it('does not report a timeout after the pending lookup becomes stale', async (): Promise<void> => {
        let epoch = 0;
        const onTokenLookup = vi.fn();
        const { options } = await new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
            { interactive: true, getTokenLookupEpoch: (): number => epoch, onTokenLookup },
        ).configureAuth();
        let finish!: (value: typeof session) => void;
        getSessionFromVSCode.mockReturnValueOnce(
            new Promise<typeof session>((resolve) => {
                finish = resolve;
            }),
        );
        const controller = new AbortController();
        const pending = options.authMechanismProperties!.OIDC_CALLBACK!({
            version: 1,
            timeoutContext: controller.signal,
        });
        await vi.waitFor(() => expect(getSessionFromVSCode).toHaveBeenCalledTimes(2));
        epoch++;
        controller.abort();
        expect(onTokenLookup).not.toHaveBeenCalled();
        finish(session);
        await expect(pending).resolves.toEqual({ accessToken: session.accessToken });
        expect(onTokenLookup).not.toHaveBeenCalled();
    });

    it.each(['returned', 'failed'] as const)(
        'does not report a timeout after the callback has %s',
        async (outcome): Promise<void> => {
            const onTokenLookup = vi.fn();
            const { options } = await new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                { interactive: true, getTokenLookupEpoch: (): number => 0, onTokenLookup },
            ).configureAuth();
            if (outcome === 'failed') {
                getSessionFromVSCode.mockRejectedValueOnce(new Error('test provider failure'));
            }
            const controller = new AbortController();
            const result = options.authMechanismProperties!.OIDC_CALLBACK!({
                version: 1,
                timeoutContext: controller.signal,
            });
            if (outcome === 'failed') {
                await expect(result).rejects.toBeInstanceOf(TokenCallbackError);
            } else {
                await expect(result).resolves.toEqual({ accessToken: session.accessToken });
            }
            expect(onTokenLookup.mock.calls).toEqual([[{ outcome }]]);
            controller.abort();
            expect(onTokenLookup.mock.calls).toEqual([[{ outcome }]]);
        },
    );

    it('rechecks destination trust before the silent callback and applies the existing TLS hook', async (): Promise<void> => {
        let suffix: string | undefined = 'database.example.com';
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn(),
            inspect: vi.fn(() => ({ globalValue: { hostnameSuffix: suffix } })),
        } as unknown as vscode.WorkspaceConfiguration);
        const { options } = await new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.database.example.com/'),
        ).configureAuth();
        const callback = options.authMechanismProperties!.OIDC_CALLBACK!;
        await expect(callback({ version: 1, timeoutContext: new AbortController().signal })).resolves.toEqual({
            accessToken: 'access-token',
        });
        suffix = undefined;
        await expect(callback({ version: 1, timeoutContext: new AbortController().signal })).rejects.toBeInstanceOf(
            EntraDestinationRejectedError,
        );
        expect(options.checkServerIdentity?.('cluster.database.example.com', {} as PeerCertificate)).toBeInstanceOf(
            EntraDestinationRejectedError,
        );
        expect(getSessionFromVSCode).toHaveBeenCalledTimes(2);
    });

    it('rechecks destination trust after a silent lookup, before returning its token', async () => {
        let suffix: string | undefined = 'database.example.com';
        const onCallbackTokenObserved = vi.fn();
        vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
            get: vi.fn(),
            inspect: vi.fn(() => ({ globalValue: { hostnameSuffix: suffix } })),
        } as unknown as vscode.WorkspaceConfiguration);
        const { options } = await new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.database.example.com/'),
            { interactive: false, observer: { onCallbackTokenObserved } },
        ).configureAuth();
        getSessionFromVSCode.mockImplementationOnce(async () => {
            suffix = undefined;
            return session;
        });
        await expect(
            options.authMechanismProperties!.OIDC_CALLBACK!({
                version: 1,
                timeoutContext: new AbortController().signal,
            }),
        ).rejects.toBeInstanceOf(EntraDestinationRejectedError);
        expect(getSessionFromVSCode).toHaveBeenCalledTimes(2);
        expect(onCallbackTokenObserved).not.toHaveBeenCalled();
    });

    it('does not reject or repeat a lookup based on the token expiration claim', async () => {
        const { options } = await new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
        ).configureAuth();
        const accessToken = `header.${Buffer.from('{"exp":1}').toString('base64url')}.signature`;
        getSessionFromVSCode.mockResolvedValueOnce({ accessToken, account });
        await expect(
            options.authMechanismProperties!.OIDC_CALLBACK!({
                version: 1,
                timeoutContext: new AbortController().signal,
            }),
        ).resolves.toEqual({ accessToken, expiresInSeconds: 0 });
        expect(getSessionFromVSCode).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['noSession', 'noSession', EntraSignInRequiredError],
        ['providerChanged', 'noSession', EntraSignInRequiredError],
        ['identityMismatch', 'identityMismatch', EntraIdentityMismatchError],
    ] as const)('rejects %s without prompting or recording a token failure', async (failure, outcome, errorType) => {
        const onTokenLookup = vi.fn();
        const onCallbackTokenObserved = vi.fn<NonNullable<AuthPhaseObserver['onCallbackTokenObserved']>>();
        const { options } = await new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
            { interactive: true, getTokenLookupEpoch: () => 0, onTokenLookup, observer: { onCallbackTokenObserved } },
        ).configureAuth();
        if (failure === 'providerChanged') {
            getConfiguredAuthProviderId.mockReturnValue('microsoft-sovereign-cloud');
        } else {
            getSessionFromVSCode.mockResolvedValueOnce(
                failure === 'noSession' ? undefined : { ...session, account: { ...account, id: 'different-account' } },
            );
        }
        const result = options.authMechanismProperties!.OIDC_CALLBACK!({
            version: 1,
            timeoutContext: new AbortController().signal,
        });
        await expect(result).rejects.toBeInstanceOf(errorType);
        expect(onCallbackTokenObserved).toHaveBeenCalledOnce();
        const observed = onCallbackTokenObserved.mock.lastCall?.[0];
        expect(observed?.outcome).toBe('failed');
        await expect(result).rejects.toBe(observed?.outcome === 'failed' ? observed.error : undefined);
        if (failure !== 'identityMismatch') {
            await expect(result).rejects.toMatchObject({ reason: failure });
        }
        if (failure === 'providerChanged') {
            expect(getSessionFromVSCode).toHaveBeenCalledTimes(1);
        } else {
            expect(getSessionFromVSCode).toHaveBeenCalledTimes(2);
            expect(getSessionFromVSCode.mock.calls[1]?.[2]).toEqual({ silent: true, account });
        }
        expect(onTokenLookup.mock.calls).toEqual([[{ outcome }]]);
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
    });

    it.each([
        {
            name: 'AzureChinaCloud',
            activeDirectoryEndpointUrl: 'https://login.chinacloudapi.cn/',
        },
        {
            name: 'CustomCloud',
            activeDirectoryEndpointUrl: 'https://login.microsoftonline.us/',
        },
    ])(
        'rejects a sovereign cloud switch to $name before lookup even when the provider ID is unchanged',
        async (environment): Promise<void> => {
            getConfiguredAuthProviderId.mockReturnValue('microsoft-sovereign-cloud');
            getConfiguredAzureEnv.mockReturnValue({
                name: 'AzureUSGovernment',
                activeDirectoryEndpointUrl: 'https://login.microsoftonline.us/',
            });
            const { options } = await new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.us/'),
            ).configureAuth();
            getConfiguredAzureEnv.mockReturnValue(environment);

            await expect(
                options.authMechanismProperties!.OIDC_CALLBACK!({
                    version: 1,
                    timeoutContext: new AbortController().signal,
                }),
            ).rejects.toMatchObject({ name: 'EntraSignInRequiredError', reason: 'providerChanged' });
            expect(getSessionFromVSCode).toHaveBeenCalledOnce();
            expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
        },
    );

    it.each(['returns', 'rejects'] as const)(
        'rejects same-cloud authority path drift when the silent lookup %s',
        async (lookupOutcome): Promise<void> => {
            getConfiguredAuthProviderId.mockReturnValue('microsoft-sovereign-cloud');
            getConfiguredAzureEnv.mockReturnValue({
                name: 'CustomCloud',
                activeDirectoryEndpointUrl: 'https://authority.example.com/original/',
            });
            const onTokenLookup = vi.fn();
            const { options } = await new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                { interactive: true, getTokenLookupEpoch: () => 0, onTokenLookup },
            ).configureAuth();
            recordEntraTokenFailure('cluster-1', { cloudCategory: 'custom', authMethod: 'interactive' });
            const priorFailure = getRecentEntraTokenFailure('cluster-1');
            getSessionFromVSCode.mockImplementationOnce(async () => {
                getConfiguredAzureEnv.mockReturnValue({
                    name: 'CustomCloud',
                    activeDirectoryEndpointUrl: 'https://authority.example.com/changed/',
                });
                if (lookupOutcome === 'rejects') {
                    throw new Error('AADSTS65002: private-lookup-cause');
                }
                return { ...session, accessToken: 'mismatched-token' };
            });

            const result = options.authMechanismProperties!.OIDC_CALLBACK!({
                version: 1,
                timeoutContext: new AbortController().signal,
            });
            await expect(result).rejects.toMatchObject({ name: 'EntraSignInRequiredError', reason: 'providerChanged' });
            await expect(result).rejects.not.toHaveProperty('cause');
            expect(getSessionFromVSCode).toHaveBeenCalledTimes(2);
            expect(getRecentEntraTokenFailure('cluster-1')).toBe(priorFailure);
            expect(onTokenLookup.mock.calls).toEqual([[{ outcome: 'noSession' }]]);
            const logs = JSON.stringify([mockOutputChannel.info.mock.calls, mockOutputChannel.error.mock.calls]);
            expect(logs).not.toMatch(/authority\.example\.com|mismatched-token|private-lookup-cause|AADSTS65002/);
        },
    );

    it.each(['before', 'after'] as const)(
        'treats an unreadable environment %s the silent lookup as controlled drift',
        async (when): Promise<void> => {
            const { options } = await new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
            ).configureAuth();
            const makeEnvironmentUnreadable = (): void => {
                getConfiguredAzureEnv.mockImplementationOnce(() => {
                    throw new Error('private-configuration-cause');
                });
            };
            if (when === 'before') {
                makeEnvironmentUnreadable();
            } else {
                getSessionFromVSCode.mockImplementationOnce(async () => {
                    makeEnvironmentUnreadable();
                    return session;
                });
            }

            const result = options.authMechanismProperties!.OIDC_CALLBACK!({
                version: 1,
                timeoutContext: new AbortController().signal,
            });
            await expect(result).rejects.toMatchObject({ name: 'EntraSignInRequiredError', reason: 'providerChanged' });
            await expect(result).rejects.not.toHaveProperty('cause');
            expect(getSessionFromVSCode).toHaveBeenCalledTimes(when === 'before' ? 1 : 2);
            expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
            const logs = JSON.stringify([mockOutputChannel.info.mock.calls, mockOutputChannel.error.mock.calls]);
            expect(logs).not.toContain('private-configuration-cause');
        },
    );

    it('does not request a session when the authority changes during resource resolution', async () => {
        getConfiguredAuthProviderId.mockReturnValue('microsoft-sovereign-cloud');
        getConfiguredAzureEnv.mockReturnValue({
            name: 'CustomCloud',
            activeDirectoryEndpointUrl: 'https://authority.example.com/original/',
        });
        const resolveResource = vi.mocked(resolveInteractiveTokenResource);
        const resolveWithoutDrift = resolveResource.getMockImplementation()!;
        resolveResource.mockImplementationOnce(async (connectionString) => {
            const resolved = await resolveWithoutDrift(connectionString);
            getConfiguredAzureEnv.mockReturnValue({
                name: 'CustomCloud',
                activeDirectoryEndpointUrl: 'https://authority.example.com/changed/',
            });
            return resolved;
        });

        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
        );
        await expect(handler.configureAuth()).rejects.toMatchObject({
            name: 'EntraSignInRequiredError',
            reason: 'providerChanged',
        });
        expect(getSessionFromVSCode).not.toHaveBeenCalled();
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
    });

    it.each([true, false])(
        'does not pin a session or change the prior failure if the initial lookup environment changes (interactive=%s)',
        async (interactive): Promise<void> => {
            getConfiguredAuthProviderId.mockReturnValue('microsoft-sovereign-cloud');
            getConfiguredAzureEnv.mockReturnValue({
                name: 'AzureUSGovernment',
                activeDirectoryEndpointUrl: 'https://login.microsoftonline.us/',
            });
            recordEntraTokenFailure('cluster-1', { cloudCategory: 'usgov', authMethod: 'interactive' });
            const priorFailure = getRecentEntraTokenFailure('cluster-1');
            getSessionFromVSCode.mockImplementationOnce(async () => {
                getConfiguredAzureEnv.mockReturnValue({
                    name: 'AzureChinaCloud',
                    activeDirectoryEndpointUrl: 'https://login.chinacloudapi.cn/',
                });
                return session;
            });
            const onTokenAcquired = vi.fn();
            const handler = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.us/'),
                { interactive, observer: { onTokenAcquired } },
            );

            await expect(handler.configureAuth()).rejects.toMatchObject({
                name: 'EntraSignInRequiredError',
                reason: 'providerChanged',
            });
            expect(onTokenAcquired).not.toHaveBeenCalled();
            expect(getRecentEntraTokenFailure('cluster-1')).toBe(priorFailure);
        },
    );

    it('wraps and records only an unexpected callback failure, without logging its cause', async () => {
        const onTokenLookup = vi.fn();
        const onCallbackTokenObserved = vi.fn<NonNullable<AuthPhaseObserver['onCallbackTokenObserved']>>();
        const { options } = await new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
            { interactive: true, getTokenLookupEpoch: () => 0, onTokenLookup, observer: { onCallbackTokenObserved } },
        ).configureAuth();
        const cause = new Error('AADSTS65002: private-cause');
        getSessionFromVSCode.mockRejectedValueOnce(cause);

        const result = options.authMechanismProperties!.OIDC_CALLBACK!({
            version: 1,
            timeoutContext: new AbortController().signal,
        });
        await expect(result).rejects.toBeInstanceOf(TokenCallbackError);
        await expect(result).rejects.toMatchObject({
            message: 'Failed to obtain a Microsoft Entra ID token.',
            authMethod: AuthMethodId.MicrosoftEntraID,
            cause,
        });
        expect(onCallbackTokenObserved).toHaveBeenCalledOnce();
        const observed = onCallbackTokenObserved.mock.lastCall?.[0];
        expect(observed?.outcome).toBe('failed');
        await expect(result).rejects.toBe(observed?.outcome === 'failed' ? observed.error : undefined);
        expect(getRecentEntraTokenFailure('cluster-1')).toMatchObject({
            authMethod: 'interactive',
            ruleId: 'firstPartyPreauthorization',
        });
        expect(onTokenLookup.mock.calls).toEqual([[{ outcome: 'failed' }]]);
        expect(JSON.stringify([mockOutputChannel.info.mock.calls, mockOutputChannel.error.mock.calls])).not.toContain(
            'private-cause',
        );
        expect(mockOutputChannel.info).toHaveBeenLastCalledWith(
            expect.stringContaining('interactiveEntra.oidcCallback: {"invocation":1,"outcome":"threw"}'),
        );
    });

    it('captures the original destination and tenant before resolving the audience', async (): Promise<void> => {
        const original = 'mongodb://cluster.mongocluster.cosmos.azure.com/';
        const credentials = buildCredentials(original);
        vi.mocked(resolveInteractiveTokenResource).mockImplementationOnce(async () => {
            credentials.connectionString = 'mongodb://attacker.example/';
            credentials.entraIdConfig = { tenantId: 'changed-tenant' };
            return {
                resource: 'https://database.example',
                scope: 'https://database.example/.default',
                cloudCategory: 'public',
                reason: 'host',
                details: {},
            };
        });
        const { connectionString } = await new MicrosoftEntraIDAuthHandler(credentials).configureAuth();
        expect(connectionString).toBe(original);
        expect(getSessionFromVSCode).toHaveBeenCalledWith(
            'microsoft',
            ['https://database.example/.default', 'VSCODE_TENANT:tenant'],
            { createIfNone: true },
        );
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
        const connectionString = 'mongodb://cluster.mongocluster.cosmos.azure.us/';
        await new MicrosoftEntraIDAuthHandler(buildCredentials(connectionString)).configureAuth();
        expect(resolveInteractiveTokenResource).toHaveBeenCalledWith(connectionString);
        expect(getSessionFromVSCode).toHaveBeenCalledWith('microsoft', [scope, 'VSCODE_TENANT:tenant'], {
            createIfNone: true,
        });
        const output = mockOutputChannel.info.mock.calls.map((call) => String(call[0])).join('\n');
        expect(output).toContain('"cloudCategory":"usgov"');
        expect(output).toContain('"tokenResourceReason":"setting"');
        expect(mockOutputChannel.info).toHaveBeenCalledTimes(5);
    });

    it('propagates a cloud mismatch unchanged before requesting a session', async () => {
        const error = new TokenResourceResolutionError('Select the cloud of the cluster.', 'cloudMismatch', {
            flow: 'interactive',
            errorKind: 'cloudMismatch',
        });
        vi.mocked(resolveInteractiveTokenResource).mockRejectedValueOnce(error);
        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.us/'),
        );
        const startupProperties: Record<string, string> = {};
        await expect(
            handler.configureAuth(undefined, {
                startupCorrelationId: 'startup-id',
                surface: 'extension',
                startupProperties,
            }),
        ).rejects.toBe(error);
        expect(startupProperties.entraFailureKind).toBe('cloudMismatch');
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
            buildCredentials('mongodb://private-identifier.mongocluster.cosmos.azure.us/'),
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
            const handler = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
            );

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
        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
        );
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
        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
        );
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
        const diagnostics = new EntraErrorExplainer();
        expect(await diagnostics.explain({ clusterId: 'cluster-1', error })).toContain(
            'Sign-in failed in Azure US Government',
        );

        getSessionFromVSCode.mockImplementationOnce(async () => {
            expect(getRecentEntraTokenFailure('cluster-1')).toBe(failure);
            return session;
        });
        const successfulProperties: Record<string, string> = {};
        await handler.configureAuth(undefined, {
            startupCorrelationId: 'successful-startup',
            surface: 'extension',
            startupProperties: successfulProperties,
        });
        expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
        expect(failedProperties.entraFailureKind).toBe('tokenAcquisitionFailed');
        expect(successfulProperties.entraFailureKind).toBe('none');
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
            inspect: vi.fn().mockReturnValue({ globalValue: { hostnameSuffix: '.database.example.com' } }),
        } as unknown as vscode.WorkspaceConfiguration);
        const handler = new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.database.example.com/'));
        const { options } = await handler.configureAuth();
        expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual(['*.database.example.com']);
    });

    it('logs interactive authentication failure without the raw message', async () => {
        getSessionFromVSCode.mockRejectedValueOnce(new Error('secret-token'));
        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
        );

        await expect(handler.configureAuth()).rejects.toThrow('secret-token');

        expect(JSON.stringify(mockOutputChannel.error.mock.calls)).toContain('interactiveEntra.getSession');
        expect(JSON.stringify(mockOutputChannel.error.mock.calls)).not.toContain('secret-token');
    });

    it('labels every auth message with the startup ID of its connection', async (): Promise<void> => {
        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
        );
        await handler.configureAuth(undefined, { startupCorrelationId: 'startup-id', surface: 'extension' });

        const messages = mockOutputChannel.info.mock.calls.map((call) => String(call[0]));
        expect(messages).toHaveLength(5);
        for (const message of messages) {
            expect(message).toMatch(
                /^\[Authentication\] startup=startup-id surface=extension (entraDestination\.evaluated|entraCloud\.resolved|interactiveEntra\.)/,
            );
        }
    });

    it('labels authentication failure with its startup ID without exposing secrets', async (): Promise<void> => {
        getSessionFromVSCode.mockRejectedValueOnce(new Error('secret-token'));
        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
        );
        const startupProperties: Record<string, string> = {};
        await expect(
            handler.configureAuth(undefined, {
                startupCorrelationId: 'startup-id',
                surface: 'extension',
                startupProperties,
            }),
        ).rejects.toThrow('secret-token');
        expect(startupProperties.entraFailureKind).toBe('tokenAcquisitionFailed');
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
            return session;
        });
        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
        );
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
        const handler = new MicrosoftEntraIDAuthHandler(
            buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
        );

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

            if (connectionString.startsWith('mongodb://localhost:')) {
                await expect(new MicrosoftEntraIDAuthHandler(credentials).configureAuth()).rejects.toBeInstanceOf(
                    EntraDestinationRejectedError,
                );
                expect(getSessionFromVSCode).not.toHaveBeenCalled();
                return;
            }

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
            const handler = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                {
                    interactive: true,
                },
            );
            await handler.configureAuth();
            expect(getSessionFromVSCode).toHaveBeenCalledWith(
                'microsoft',
                ['https://ossrdbms-aad.database.windows.net/.default', 'VSCODE_TENANT:tenant'],
                { createIfNone: true },
            );
            const output = mockOutputChannel.info.mock.calls.map((call) => String(call[0])).join('\n');
            expect(output).toContain('"createIfNone":true');
            expect(output).not.toContain('"silent"');
        });

        it('looks up an existing session silently when non-interactive', async () => {
            const handler = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                {
                    interactive: false,
                },
            );
            const { options } = await handler.configureAuth();
            expect(getSessionFromVSCode).toHaveBeenCalledTimes(1);
            expect(getSessionFromVSCode).toHaveBeenCalledWith(
                'microsoft',
                ['https://ossrdbms-aad.database.windows.net/.default', 'VSCODE_TENANT:tenant'],
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
            const handler = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                {
                    interactive: false,
                    observer: recordingObserver(events),
                },
            );
            const startupProperties: Record<string, string> = {};

            const result = handler.configureAuth(undefined, {
                startupCorrelationId: 'run-id',
                surface: 'connectionDiagnostics',
                startupProperties,
            });

            await expect(result).rejects.toBeInstanceOf(AuthInputUnavailableError);
            await expect(result).rejects.toMatchObject({ missing: 'entraSession' });
            expect(getRecentEntraTokenFailure('cluster-1')).toBeUndefined();
            expect(startupProperties.entraFailureKind).not.toBe('tokenAcquisitionFailed');
            expect(startupProperties.entraFailureKind).toBe('none');
            expect(events).toEqual(['resolved:*.mongocluster.cosmos.azure.com', 'tokenStarted', 'tokenFailed']);
        });

        it('does not clear an earlier recorded failure when no silent session is available', async () => {
            getSessionFromVSCode.mockRejectedValueOnce(new Error('AADSTS65002: Preauthorization required'));
            await expect(
                new MicrosoftEntraIDAuthHandler(
                    buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                ).configureAuth(),
            ).rejects.toThrow('AADSTS65002');
            const failure = getRecentEntraTokenFailure('cluster-1');
            expect(failure).toBeDefined();

            getSessionFromVSCode.mockResolvedValueOnce(undefined);
            await expect(
                new MicrosoftEntraIDAuthHandler(buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'), {
                    interactive: false,
                }).configureAuth(),
            ).rejects.toBeInstanceOf(AuthInputUnavailableError);
            expect(getRecentEntraTokenFailure('cluster-1')).toBe(failure);
        });

        it('records a silent token request error exactly as an interactive one', async () => {
            const error = Object.freeze(new Error('AADSTS65002: Preauthorization required'));
            getSessionFromVSCode.mockRejectedValueOnce(error);
            const handler = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                {
                    interactive: false,
                },
            );
            const startupProperties: Record<string, string> = {};

            await expect(
                handler.configureAuth(undefined, {
                    startupCorrelationId: 'run-id',
                    surface: 'connectionDiagnostics',
                    startupProperties,
                }),
            ).rejects.toBe(error);
            expect(getRecentEntraTokenFailure('cluster-1')).toEqual({
                cloudCategory: 'public',
                authMethod: 'interactive',
                ruleId: 'firstPartyPreauthorization',
                timestamp: expect.any(Number),
            });
            expect(startupProperties.entraFailureKind).toBe('tokenAcquisitionFailed');
        });

        it('notifies the observer in real order and passes the token only to the observer', async () => {
            getSessionFromVSCode.mockResolvedValueOnce({
                accessToken: 'access-token',
                account: { label: 'alice@contoso.com', id: 'account-id' },
            });
            const events: string[] = [];
            const acquired: unknown[] = [];
            const onCallbackTokenObserved = vi.fn();
            const observer = recordingObserver(events);
            const handler = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                {
                    interactive: false,
                    observer: {
                        ...observer,
                        onCallbackTokenObserved,
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

            const { options } = await handler.configureAuth();
            expect(onCallbackTokenObserved).not.toHaveBeenCalled();
            getSessionFromVSCode.mockResolvedValueOnce({ ...session, accessToken: 'callback-token' });
            await expect(
                options.authMechanismProperties!.OIDC_CALLBACK!({
                    version: 1,
                    timeoutContext: new AbortController().signal,
                }),
            ).resolves.toEqual({ accessToken: 'callback-token' });
            expect(onCallbackTokenObserved.mock.calls).toEqual([
                [{ outcome: 'acquired', accessToken: 'callback-token', tenantId: 'tenant' }],
            ]);

            expect(events).toEqual([
                'resolved:*.mongocluster.cosmos.azure.com',
                'tokenStarted',
                'tokenAcquired:tenant',
            ]);
            expect(acquired).toEqual([
                {
                    accessToken: 'access-token',
                    account: { label: 'alice@contoso.com', id: 'account-id' },
                    tenantId: 'tenant',
                },
            ]);
            expect(JSON.stringify(mockOutputChannel.info.mock.calls)).not.toMatch(/access-token|callback-token/);
        });

        it('passes the resolver details and reason to the observer', async () => {
            let resolvedInfo:
                | Parameters<NonNullable<AuthPhaseObserver['onSignInConfigurationResolved']>>[0]
                | undefined;
            const handler = new MicrosoftEntraIDAuthHandler(
                buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/'),
                {
                    interactive: true,
                    observer: { onSignInConfigurationResolved: (info) => (resolvedInfo = info) },
                },
            );
            await handler.configureAuth();
            expect(resolvedInfo).toEqual({
                details: { flow: 'interactive', tokenResource: 'https://ossrdbms-aad.database.windows.net' },
                cloudCategory: 'public',
                tokenResourceReason: 'setting',
                allowedHosts: ['*.mongocluster.cosmos.azure.com'],
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
                const handler = new MicrosoftEntraIDAuthHandler(
                    buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.us/'),
                    {
                        interactive,
                        observer: {
                            ...observer,
                            onSignInConfigurationFailed: (info) => {
                                failedInfo = info;
                                observer.onSignInConfigurationFailed?.(info);
                            },
                        },
                    },
                );

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
                onCallbackTokenObserved: throwing,
            };
            const credentials = buildCredentials('mongodb://cluster.mongocluster.cosmos.azure.com/');
            const expected = await new MicrosoftEntraIDAuthHandler(credentials, { interactive }).configureAuth();

            const result = await new MicrosoftEntraIDAuthHandler(credentials, {
                interactive,
                observer,
            }).configureAuth();

            expect(result.connectionString).toBe(expected.connectionString);
            expect(result.options.authMechanismProperties?.ALLOWED_HOSTS).toEqual(
                expected.options.authMechanismProperties?.ALLOWED_HOSTS,
            );
            const callback = result.options.authMechanismProperties!.OIDC_CALLBACK!;
            const params = { version: 1, timeoutContext: new AbortController().signal } as const;
            await expect(callback(params)).resolves.toEqual({ accessToken: session.accessToken });
            getSessionFromVSCode.mockResolvedValueOnce(undefined);
            await expect(callback(params)).rejects.toBeInstanceOf(EntraSignInRequiredError);

            const error = new Error('token request failed');
            getSessionFromVSCode.mockRejectedValueOnce(error);
            await expect(
                new MicrosoftEntraIDAuthHandler(credentials, { interactive, observer }).configureAuth(),
            ).rejects.toBe(error);
            expect(getRecentEntraTokenFailure('cluster-1')).toMatchObject({ authMethod: 'interactive' });
        });
    });
});
