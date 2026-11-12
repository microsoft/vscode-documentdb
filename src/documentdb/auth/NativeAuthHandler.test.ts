/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { type CachedClusterCredentials } from '../CredentialCache';
import { AuthMethodId } from './AuthMethod';
import { NativeAuthHandler } from './NativeAuthHandler';

function buildCredentials(overrides: Partial<CachedClusterCredentials> = {}): CachedClusterCredentials {
    return {
        clusterId: 'cluster-1',
        connectionString: 'mongodb://db.example.com/?tls=false',
        connectionStringWithPassword: 'mongodb://user:dummy@db.example.com/?tls=false',
        authMechanism: AuthMethodId.NativeAuth,
        ...overrides,
    };
}

describe('NativeAuthHandler', () => {
    it.each([
        { host: 'cluster.mongocluster.cosmos.azure.com', password: '' },
        { host: 'attacker.cloudapp.azure.com', password: '' },
        { host: 'cluster.mongocluster.cosmos.azure.com', password: 'actualpassword' },
        { host: 'attacker.cloudapp.azure.com', password: 'actualpassword' },
    ])(
        'honors native credentials instead of URI OIDC on $host with password "$password"',
        async ({ host, password }): Promise<void> => {
            const username = '00000000-0000-0000-0000-000000000001';
            const query =
                '?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:untrusted' +
                '&authSource=%24external&ssl=false';
            const credentials = Object.freeze(
                buildCredentials({
                    connectionString: `mongodb://${host}/${query}`,
                    connectionStringWithPassword: `mongodb://${username}:${password}@${host}/${query}`,
                }),
            );
            const original = credentials.connectionStringWithPassword;
            const { connectionString, options } = await new NativeAuthHandler(credentials).configureAuth();
            const effective = new MongoClient(connectionString, options).options;
            expect(effective.credentials).toMatchObject({
                username,
                password,
                mechanism: 'DEFAULT',
                source: '$external',
                mechanismProperties: {},
            });
            expect(effective.credentials?.mechanismProperties.ENVIRONMENT).toBeUndefined();
            expect(effective.credentials?.mechanismProperties.OIDC_CALLBACK).toBeUndefined();
            expect(effective.tls).toBe(false);
            expect(options).toEqual({});
            expect(credentials.connectionStringWithPassword).toBe(original);
            expect(credentials.connectionString).toContain('authMechanism=MONGODB-OIDC');
        },
    );

    it.each([
        'mongodb://user:dummy@cluster.mongocluster.cosmos.azure.com/?authMechanism=SCRAM-SHA-256&ssl=false',
        'mongodb://user:dummy@attacker.cloudapp.azure.com/?authMechanism=SCRAM-SHA-1&tls=true&tlsInsecure=true',
        'mongodb://user@db.example.com/?authMechanism=GSSAPI&authMechanismProperties=SERVICE_NAME:documentdb&authSource=%24external&tls=false',
        'mongodb://CN%3Doffline@db.example.com/?authMechanism=MONGODB-X509&authSource=%24external&ssl=true&tlsAllowInvalidHostnames=true',
    ])('preserves the native URI and effective credentials/TLS options: %s', async (original): Promise<void> => {
        const { connectionString, options } = await new NativeAuthHandler(
            buildCredentials({ connectionStringWithPassword: original }),
        ).configureAuth();
        expect(connectionString).toBe(original);
        expect(options).toEqual({});
        const before = new MongoClient(original).options;
        const after = new MongoClient(connectionString, options).options;
        expect(after.credentials).toEqual(before.credentials);
        expect(after.tls).toBe(before.tls);
        expect(after.tlsInsecure).toBe(before.tlsInsecure);
        expect(after.tlsAllowInvalidHostnames).toBe(before.tlsAllowInvalidHostnames);
        expect(after.rejectUnauthorized).toBe(before.rejectUnauthorized);
    });

    it.each([
        { host: '127.0.0.1', isEmulator: false, disableEmulatorSecurity: true, allow: true, timeout: 4000 },
        { host: '[::1]', isEmulator: true, disableEmulatorSecurity: false, allow: undefined, timeout: 4000 },
        { host: '127.0.0.1', isEmulator: false, disableEmulatorSecurity: false, allow: undefined, timeout: undefined },
        { host: 'db.example.com', isEmulator: true, disableEmulatorSecurity: true, allow: undefined, timeout: 4000 },
        {
            host: 'db.example.com',
            isEmulator: false,
            disableEmulatorSecurity: true,
            allow: undefined,
            timeout: undefined,
        },
    ])(
        'preserves the existing TLS exception and timeout for $host ($isEmulator, $disableEmulatorSecurity)',
        async ({ host, isEmulator, disableEmulatorSecurity, allow, timeout }): Promise<void> => {
            const original =
                `mongodb://user:dummy@${host}/?authMechanism=MONGODB-OIDC` +
                '&authMechanismProperties=ENVIRONMENT:k8s&tls=true';
            const { connectionString, options } = await new NativeAuthHandler(
                buildCredentials({
                    connectionStringWithPassword: original,
                    emulatorConfiguration: { isEmulator, disableEmulatorSecurity },
                }),
            ).configureAuth();
            expect(options.tlsAllowInvalidCertificates).toBe(allow);
            expect(options.serverSelectionTimeoutMS).toBe(timeout);
            expect(options.tls).toBeUndefined();
            const effective = new MongoClient(connectionString, options).options;
            expect(effective.credentials?.mechanism).toBe('DEFAULT');
            expect(effective.credentials?.mechanismProperties.ENVIRONMENT).toBeUndefined();
            expect(effective.tls).toBe(true);
            expect(effective.rejectUnauthorized).toBe(allow ? false : undefined);
        },
    );

    it('propagates the existing empty-username parse error without an OIDC fallback', (): void => {
        const handler = new NativeAuthHandler(
            buildCredentials({
                connectionStringWithPassword:
                    'mongodb://:dummy@db.example.com/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure',
            }),
        );
        expect(() => handler.configureAuth()).toThrow(/empty userinfo/);
    });

    it('rejects invalid input rather than returning an unsanitized URI', (): void => {
        const handler = new NativeAuthHandler(buildCredentials({ connectionStringWithPassword: 'invalid' }));
        expect(() => handler.configureAuth()).toThrow(/Invalid scheme/);
    });

    it('retains the existing missing-password-string validation', (): void => {
        const handler = new NativeAuthHandler(buildCredentials({ connectionStringWithPassword: undefined }));
        expect(() => handler.configureAuth()).toThrow(/connectionStringWithPassword/);
    });
});
