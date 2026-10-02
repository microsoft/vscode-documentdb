/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type OIDCCallbackParams, type OIDCResponse } from 'mongodb';
import { type CachedClusterCredentials } from '../CredentialCache';
import { ConnectionStartupTimings } from '../utils/ConnectionStartupTimings';
import { AuthMethodId } from './AuthMethod';
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
        getManagedIdentityAccessToken.mockReset();
        getManagedIdentityAccessToken.mockResolvedValue({
            accessToken: 'a-token',
            expiresOnTimestamp: Date.now() + 3600 * 1000,
        });
    });

    it('configures the OIDC mechanism with a curated allowed-hosts list', async () => {
        const handler = new ManagedIdentityAuthHandler(buildCredentials());

        const { options } = await handler.configureAuth();

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
        );
    });

    it('returns the acquired token with a real expiry through the OIDC callback', async () => {
        const handler = new ManagedIdentityAuthHandler(buildCredentials());

        const { options } = await handler.configureAuth();
        const response = await invokeOidcCallback(options);

        expect(response.accessToken).toBe('a-token');
        expect(response.expiresInSeconds).toBeGreaterThan(0);
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

    it('honors the host-gated TLS exception', async () => {
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
});
