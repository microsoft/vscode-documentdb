/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import type * as documentdbTokenResource from './documentdbTokenResource';

const getSessionFromVSCode = vi.hoisted(() => vi.fn());
const getManagedIdentityAccessToken = vi.hoisted(() => vi.fn());

vi.mock('@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode', () => ({
    getSessionFromVSCode,
}));

vi.mock('./managedIdentityTokenProvider', () => ({ getManagedIdentityAccessToken }));

vi.mock('./documentdbTokenResource', async (importOriginal) => ({
    ...(await importOriginal<typeof documentdbTokenResource>()),
    resolveInteractiveTokenResource: vi.fn(),
    resolveManagedIdentityTokenResource: vi.fn(),
}));

import { type CachedClusterCredentials } from '../CredentialCache';
import { buildAuthConnectionTarget, type AuthNetworkOptions } from './authConnectionTarget';
import { AuthMethodId } from './AuthMethod';
import { resolveInteractiveTokenResource, resolveManagedIdentityTokenResource } from './documentdbTokenResource';
import { NativeAuthHandler } from './NativeAuthHandler';

const LOCAL_CS = 'mongodb://localhost:10260/?tls=true';
const LOCAL_CS_WITH_PASSWORD = 'mongodb://user:secret@localhost:10260/?tls=true';
const PUBLIC_CS = 'mongodb://db.example.com:27017/?tls=true';
const PUBLIC_CS_WITH_PASSWORD = 'mongodb://user:secret@db.example.com:27017/?tls=true';

interface MatrixCase {
    readonly local: boolean;
    readonly isEmulator: boolean | undefined;
    readonly disableEmulatorSecurity: boolean | undefined;
    readonly passwordOrAnonymous: AuthNetworkOptions;
    readonly oidc: AuthNetworkOptions;
}

const OIDC_BASE: AuthNetworkOptions = { authMechanism: 'MONGODB-OIDC', tls: true };
const OIDC_ALLOW_INVALID: AuthNetworkOptions = { ...OIDC_BASE, tlsAllowInvalidCertificates: true };
const FAIL_FAST: AuthNetworkOptions = { serverSelectionTimeoutMS: 4000 };
const FAIL_FAST_ALLOW_INVALID: AuthNetworkOptions = { ...FAIL_FAST, tlsAllowInvalidCertificates: true };

// The TLS exception is honored only for local hosts; the fail-fast timeout follows `isEmulator` or an
// honored exception, and applies to native and anonymous connections only.
const matrix: readonly MatrixCase[] = [
    {
        local: true,
        isEmulator: undefined,
        disableEmulatorSecurity: undefined,
        passwordOrAnonymous: {},
        oidc: OIDC_BASE,
    },
    { local: true, isEmulator: false, disableEmulatorSecurity: false, passwordOrAnonymous: {}, oidc: OIDC_BASE },
    { local: true, isEmulator: true, disableEmulatorSecurity: false, passwordOrAnonymous: FAIL_FAST, oidc: OIDC_BASE },
    {
        local: true,
        isEmulator: false,
        disableEmulatorSecurity: true,
        passwordOrAnonymous: FAIL_FAST_ALLOW_INVALID,
        oidc: OIDC_ALLOW_INVALID,
    },
    {
        local: true,
        isEmulator: true,
        disableEmulatorSecurity: true,
        passwordOrAnonymous: FAIL_FAST_ALLOW_INVALID,
        oidc: OIDC_ALLOW_INVALID,
    },
    {
        local: false,
        isEmulator: undefined,
        disableEmulatorSecurity: undefined,
        passwordOrAnonymous: {},
        oidc: OIDC_BASE,
    },
    { local: false, isEmulator: false, disableEmulatorSecurity: false, passwordOrAnonymous: {}, oidc: OIDC_BASE },
    { local: false, isEmulator: true, disableEmulatorSecurity: false, passwordOrAnonymous: FAIL_FAST, oidc: OIDC_BASE },
    { local: false, isEmulator: false, disableEmulatorSecurity: true, passwordOrAnonymous: {}, oidc: OIDC_BASE },
    { local: false, isEmulator: true, disableEmulatorSecurity: true, passwordOrAnonymous: FAIL_FAST, oidc: OIDC_BASE },
];

function buildCredentials(
    authMechanism: AuthMethodId,
    {
        local,
        isEmulator,
        disableEmulatorSecurity,
    }: Pick<MatrixCase, 'local' | 'isEmulator' | 'disableEmulatorSecurity'>,
): CachedClusterCredentials {
    return {
        clusterId: 'cluster-1',
        connectionString: local ? LOCAL_CS : PUBLIC_CS,
        connectionStringWithPassword: local ? LOCAL_CS_WITH_PASSWORD : PUBLIC_CS_WITH_PASSWORD,
        authMechanism,
        ...(isEmulator === undefined && disableEmulatorSecurity === undefined
            ? {}
            : {
                  emulatorConfiguration: {
                      isEmulator: isEmulator ?? false,
                      disableEmulatorSecurity: disableEmulatorSecurity ?? false,
                  },
              }),
    };
}

function describeCase(c: MatrixCase): string {
    return `${c.local ? 'local' : 'public'} host, isEmulator=${String(c.isEmulator)}, disableEmulatorSecurity=${String(c.disableEmulatorSecurity)}`;
}

describe('buildAuthConnectionTarget', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe.each(matrix.map((c): [string, MatrixCase] => [describeCase(c), c]))('%s', (_name, c) => {
        it('NativeAuth', () => {
            const target = buildAuthConnectionTarget(
                AuthMethodId.NativeAuth,
                buildCredentials(AuthMethodId.NativeAuth, c),
            );

            expect(target.connectionString).toBe(c.local ? LOCAL_CS_WITH_PASSWORD : PUBLIC_CS_WITH_PASSWORD);
            expect(target.networkOptions).toStrictEqual(c.passwordOrAnonymous);
        });

        it('NoAuth', () => {
            const target = buildAuthConnectionTarget(AuthMethodId.NoAuth, buildCredentials(AuthMethodId.NoAuth, c));

            expect(target.connectionString).toBe(c.local ? LOCAL_CS : PUBLIC_CS);
            expect(target.networkOptions).toStrictEqual(c.passwordOrAnonymous);
        });

        it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])('%s', (method) => {
            const target = buildAuthConnectionTarget(method, buildCredentials(method, c));

            // `tls=true` is removed from the URI and forced through the options instead.
            expect(target.connectionString).toBe(
                c.local ? 'mongodb://localhost:10260/' : 'mongodb://db.example.com:27017/',
            );
            expect(target.networkOptions).toStrictEqual(c.oidc);
        });
    });

    it.each([AuthMethodId.MicrosoftEntraID, AuthMethodId.ManagedIdentity])(
        '%s strips user, password, authMechanism, authMechanismProperties and tls, and forces tls',
        (method) => {
            const cs =
                'mongodb+srv://someone:secret@my-cluster.mongocluster.cosmos.azure.com/' +
                '?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure&tls=false&retryWrites=true';

            const target = buildAuthConnectionTarget(method, {
                clusterId: 'cluster-1',
                connectionString: cs,
                connectionStringWithPassword: cs,
                authMechanism: method,
            });

            expect(target.connectionString).toBe(
                'mongodb+srv://my-cluster.mongocluster.cosmos.azure.com/?retryWrites=true',
            );
            expect(target.networkOptions).toStrictEqual({ authMechanism: 'MONGODB-OIDC', tls: true });
        },
    );

    it('NoAuth passes user TLS overrides through verbatim and never forces tls', () => {
        const cs = 'mongodb://anon-host:27017/?ssl=false';

        const target = buildAuthConnectionTarget(AuthMethodId.NoAuth, {
            clusterId: 'cluster-1',
            connectionString: cs,
            authMechanism: AuthMethodId.NoAuth,
        });

        expect(target.connectionString).toBe(cs);
        expect(target.networkOptions.tls).toBeUndefined();
    });

    it.each([AuthMethodId.NativeAuth, AuthMethodId.NoAuth])(
        '%s strips conflicting OIDC declarations from diagnostic probe targets',
        (method): void => {
            const query = '?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure&tls=false';
            const target = buildAuthConnectionTarget(method, {
                clusterId: 'cluster-1',
                connectionString: `mongodb://db.example.com:27017/${query}`,
                connectionStringWithPassword: `mongodb://user:password@db.example.com:27017/${query}`,
                authMechanism: method,
            });

            expect(target.connectionString).toBe(
                method === AuthMethodId.NativeAuth
                    ? 'mongodb://user:password@db.example.com:27017/?tls=false'
                    : 'mongodb://db.example.com:27017/?tls=false',
            );
            expect(target.networkOptions).toStrictEqual({});
        },
    );

    it('NativeAuth gates the TLS exception on the hosts of the password-bearing connection string', () => {
        const target = buildAuthConnectionTarget(AuthMethodId.NativeAuth, {
            clusterId: 'cluster-1',
            connectionString: PUBLIC_CS,
            connectionStringWithPassword: LOCAL_CS_WITH_PASSWORD,
            authMechanism: AuthMethodId.NativeAuth,
            emulatorConfiguration: { isEmulator: false, disableEmulatorSecurity: true },
        });

        expect(target.networkOptions).toStrictEqual(FAIL_FAST_ALLOW_INVALID);
    });

    it('NativeAuth throws when the password-bearing connection string is missing', () => {
        expect(() =>
            buildAuthConnectionTarget(AuthMethodId.NativeAuth, {
                clusterId: 'cluster-1',
                connectionString: LOCAL_CS,
                authMechanism: AuthMethodId.NativeAuth,
            }),
        ).toThrow(
            'Internal error: Expected value to be neither null nor undefined: clusterCredentials.connectionStringWithPassword (NativeAuthHandler.ts)',
        );
    });

    it('throws for an unsupported authentication method', () => {
        expect(() =>
            buildAuthConnectionTarget('SomethingElse' as AuthMethodId, {
                clusterId: 'cluster-1',
                connectionString: LOCAL_CS,
            }),
        ).toThrow('Unsupported authentication method: SomethingElse');
    });

    it('acquires no token, resolves no token resource and reads no settings', () => {
        for (const method of Object.values(AuthMethodId)) {
            buildAuthConnectionTarget(
                method,
                buildCredentials(method, { local: true, isEmulator: true, disableEmulatorSecurity: true }),
            );
        }

        expect(getSessionFromVSCode).not.toHaveBeenCalled();
        expect(getManagedIdentityAccessToken).not.toHaveBeenCalled();
        expect(resolveInteractiveTokenResource).not.toHaveBeenCalled();
        expect(resolveManagedIdentityTokenResource).not.toHaveBeenCalled();
        expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
    });

    describe('NativeAuthHandler equivalence', () => {
        it.each(matrix.map((c): [string, MatrixCase] => [describeCase(c), c]))(
            'returns exactly the helper target (%s)',
            async (_name, c) => {
                const credentials = buildCredentials(AuthMethodId.NativeAuth, c);
                const target = buildAuthConnectionTarget(AuthMethodId.NativeAuth, credentials);

                const response = await new NativeAuthHandler(credentials).configureAuth();

                expect(response.connectionString).toBe(target.connectionString);
                expect(response.options).toStrictEqual(target.networkOptions);
            },
        );

        it('rejects with the same error when the password-bearing connection string is missing', () => {
            const handler = new NativeAuthHandler({
                clusterId: 'cluster-1',
                connectionString: LOCAL_CS,
                authMechanism: AuthMethodId.NativeAuth,
            });

            expect(() => handler.configureAuth()).toThrow(
                'Internal error: Expected value to be neither null nor undefined: clusterCredentials.connectionStringWithPassword (NativeAuthHandler.ts)',
            );
        });
    });
});
