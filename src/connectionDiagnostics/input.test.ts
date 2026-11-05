/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { builtInFindingCodes } from '@documentdb-js/connection-diagnostics';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialCache, type CachedClusterCredentials } from '../documentdb/CredentialCache';
import { AuthMethodId } from '../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../documentdb/utils/DocumentDBConnectionString';
import { type EphemeralClusterCredentials } from '../tree/documentdb/ClusterItemBase';
import { buildDiagnosticsSetup, detectAvailableCompressors } from './input';
import { extensionFindingCodes } from './types';

const clusterId = 'stable-id';
const password = 'secret:@encoded';
const user = 'fixture-user';
const uri = 'mongodb://private.example:27017/';

function credentials(overrides: Partial<EphemeralClusterCredentials> = {}): EphemeralClusterCredentials {
    return { connectionString: uri, availableAuthMethods: [AuthMethodId.NativeAuth], ...overrides };
}

function cached(overrides: Partial<CachedClusterCredentials> = {}): CachedClusterCredentials {
    return {
        clusterId,
        connectionString: uri,
        authMechanism: AuthMethodId.NativeAuth,
        nativeAuthConfig: { connectionUser: user, connectionPassword: password },
        ...overrides,
    };
}

const setters = ['setCredentials', 'setAuthCredentials', 'setFromConnectionItem'] as const;

describe('buildDiagnosticsSetup', (): void => {
    beforeEach((): void => {
        vi.spyOn(CredentialCache, 'getCredentials').mockReturnValue(undefined);
        for (const setter of setters) {
            vi.spyOn(CredentialCache, setter).mockImplementation((): never => {
                throw new Error('Cache write forbidden');
            });
        }
        vi.stubEnv('DOCUMENTDB_DISABLE_SRV_FALLBACK', '');
        vi.stubEnv('DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK', '');
    });
    afterEach((): void => {
        for (const setter of setters) {
            expect(CredentialCache[setter]).not.toHaveBeenCalled();
        }
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it('keeps extension and built-in codes disjoint', (): void => {
        const builtIn: ReadonlySet<string> = new Set(builtInFindingCodes);
        expect(extensionFindingCodes.filter((code): boolean => builtIn.has(code))).toEqual([]);
    });

    it('honors the stored method before a cached method and never infers from available methods', async (): Promise<void> => {
        vi.mocked(CredentialCache.getCredentials).mockReturnValue(cached());
        const setup = buildDiagnosticsSetup(clusterId, credentials({ selectedAuthMethod: AuthMethodId.NoAuth }));
        expect(setup.chosenAuthMethod).toBe(AuthMethodId.NoAuth);
        expect(setup.credentialState).toBe('available');
        expect(setup.input.connectionString).not.toContain(password);
        expect(setup.transientCredentials?.nativeAuthConfig).toBeUndefined();
        expect(CredentialCache.getCredentials).toHaveBeenCalledWith(clusterId);
    });

    it('uses the session method and password by stable clusterId without modifying the cache', async (): Promise<void> => {
        const entry = Object.freeze(cached());
        vi.mocked(CredentialCache.getCredentials).mockReturnValue(entry);
        const setup = buildDiagnosticsSetup(clusterId, credentials());
        expect(setup.chosenAuthMethod).toBe(AuthMethodId.NativeAuth);
        expect(setup.credentialState).toBe('available');
        expect(new DocumentDBConnectionString(setup.input.connectionString).password).toBe(password);
        expect(setup.transientCredentials).not.toBe(entry);
        expect(entry.connectionStringWithPassword).toBeUndefined();
        expect(setup.input.networkOptionLayers).toEqual([{ origin: 'authHandler', options: {} }]);
    });

    it('uses stored native credentials before cached ones and excludes them from non-secret input fields', async (): Promise<void> => {
        vi.mocked(CredentialCache.getCredentials).mockReturnValue(cached());
        const setup = buildDiagnosticsSetup(
            clusterId,
            credentials({
                selectedAuthMethod: AuthMethodId.NativeAuth,
                nativeAuthConfig: { connectionUser: 'stored-user', connectionPassword: 'stored-password' },
            }),
        );
        const parsed = new DocumentDBConnectionString(setup.input.connectionString);
        expect(parsed.username).toBe('stored-user');
        expect(parsed.password).toBe('stored-password');
        const nonSecretInput = { ...setup.input };
        Reflect.deleteProperty(nonSecretInput, 'connectionString');
        expect(JSON.stringify(nonSecretInput)).not.toContain('stored-password');
        expect(JSON.stringify(nonSecretInput)).not.toContain('stored-user');
    });

    it('does not replace an explicitly empty stored password with a stale cached password', async (): Promise<void> => {
        vi.mocked(CredentialCache.getCredentials).mockReturnValue(cached());
        const setup = buildDiagnosticsSetup(
            clusterId,
            credentials({
                selectedAuthMethod: AuthMethodId.NativeAuth,
                nativeAuthConfig: { connectionUser: user, connectionPassword: '' },
            }),
        );
        expect(setup.credentialState).toBe('passwordMissing');
        expect(setup.input.connectionString).toBe(uri);
        expect(setup.input.networkOptionLayers).toBeUndefined();
    });

    it('keeps probing without a native password or an auth-handler layer', async (): Promise<void> => {
        const setup = buildDiagnosticsSetup(
            clusterId,
            credentials({
                selectedAuthMethod: AuthMethodId.NativeAuth,
                connectionString: `mongodb://${user}:embedded-password@private.example:27017/`,
                nativeAuthConfig: { connectionUser: user },
            }),
        );
        expect(setup.credentialState).toBe('passwordMissing');
        expect(setup.input.connectionString).toBe(uri);
        expect(setup.input.networkOptionLayers).toBeUndefined();
    });

    it('does not choose an available method or infer one from credentials', async (): Promise<void> => {
        const setup = buildDiagnosticsSetup(
            clusterId,
            credentials({ nativeAuthConfig: { connectionUser: user, connectionPassword: password } }),
        );
        expect(setup.chosenAuthMethod).toBeUndefined();
        expect(setup.credentialState).toBe('noMethod');
        expect(setup.transientCredentials).toBeUndefined();
        expect(setup.input.networkOptionLayers).toBeUndefined();
        expect(setup.input.connectionString).toBe(uri);
    });

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        'uses the real OIDC network policy for %s without credentials',
        async (method): Promise<void> => {
            const setup = buildDiagnosticsSetup(
                clusterId,
                credentials({
                    selectedAuthMethod: method,
                    connectionString:
                        'mongodb://old-user:old-password@private.example/?authMechanism=SCRAM-SHA-256&tls=false&authMechanismProperties=ENVIRONMENT:azure',
                }),
            );
            expect(setup.credentialState).toBe('available');
            expect(setup.input.networkOptionLayers).toEqual([
                { origin: 'authHandler', options: { tls: true, authMechanism: 'MONGODB-OIDC' } },
            ]);
            expect(setup.input.connectionString).not.toMatch(/old-user|old-password|authMechanism|tls=false/);
        },
    );

    it('uses the local TLS exception without persisting it, leaving the builder fail-fast to the driver', async (): Promise<void> => {
        vi.mocked(CredentialCache.getCredentials).mockReturnValue(
            cached({
                emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true },
            }),
        );
        const setup = buildDiagnosticsSetup(
            clusterId,
            credentials({ connectionString: 'mongodb://127.0.0.1:27017/' }),
        );
        expect(setup.input.networkOptionLayers).toEqual([
            { origin: 'authHandler', options: { tlsAllowInvalidCertificates: true } },
        ]);
        // R3: the 4-second fail-fast stays with the driver; it is not a connection-configured runner timeout.
        expect(setup.input.connectionTimeouts).toBeUndefined();
    });

    it('uses stored TLS exceptions before a stale cached emulator policy', async (): Promise<void> => {
        vi.mocked(CredentialCache.getCredentials).mockReturnValue(
            cached({
                emulatorConfiguration: { isEmulator: false, disableEmulatorSecurity: false },
            }),
        );
        const setup = buildDiagnosticsSetup(
            clusterId,
            credentials({
                connectionString: 'mongodb://127.0.0.1:27017/',
                connectionProperties: {
                    emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true },
                },
            }),
        );
        expect(setup.input.networkOptionLayers).toEqual([
            { origin: 'authHandler', options: { tlsAllowInvalidCertificates: true } },
        ]);
        // R3: the 4-second fail-fast stays with the driver; it is not a connection-configured runner timeout.
        expect(setup.input.connectionTimeouts).toBeUndefined();
    });

    it('uses the shared SRV fallback switches', async (): Promise<void> => {
        vi.stubEnv('DOCUMENTDB_DEBUG_FORCE_SRV_FALLBACK', '1');
        expect(buildDiagnosticsSetup(clusterId, credentials()).input.srvFallbackMode).toBe('force');
        vi.stubEnv('DOCUMENTDB_DISABLE_SRV_FALLBACK', '1');
        expect(buildDiagnosticsSetup(clusterId, credentials()).input.srvFallbackMode).toBe('off');
    });

    it('leaves malformed input for the connectionString check, not an input-building error', async (): Promise<void> => {
        const setup = buildDiagnosticsSetup(
            clusterId,
            credentials({
                connectionString: 'not-a-uri',
                selectedAuthMethod: AuthMethodId.NativeAuth,
                nativeAuthConfig: { connectionUser: user, connectionPassword: password },
            }),
        );
        expect(setup.input.connectionString).toBe('not-a-uri');
    });

    it('detects only resolvable optional compressors; zlib is always available', (): void => {
        const resolve = vi.fn((moduleId: string): string => {
            if (moduleId === 'snappy') {
                return 'installed/snappy';
            }
            throw new Error('not installed');
        });
        expect(detectAvailableCompressors(resolve)).toEqual(['zlib', 'snappy']);
        expect(resolve.mock.calls).toEqual([['snappy'], ['@mongodb-js/zstd']]);
        expect(detectAvailableCompressors((): string => 'installed')).toEqual(['zlib', 'snappy', 'zstd']);
        expect(
            detectAvailableCompressors((): never => {
                throw new Error('missing');
            }),
        ).toEqual(['zlib']);
    });
});
