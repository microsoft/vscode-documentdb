/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { type CachedClusterCredentials } from '../CredentialCache';
import { buildAuthConnectionTarget } from './authConnectionTarget';
import { AuthMethodId } from './AuthMethod';
import { NoAuthHandler } from './NoAuthHandler';

function buildCredentials(overrides: Partial<CachedClusterCredentials> = {}): CachedClusterCredentials {
    return {
        clusterId: 'cluster-1',
        connectionString: 'mongodb://anon-host:27017/?tls=false',
        connectionStringWithPassword: 'mongodb://anon-host:27017/?tls=false',
        authMechanism: AuthMethodId.NoAuth,
        ...overrides,
    };
}

describe('NoAuthHandler', () => {
    describe.each(['/?', '?'])('URI OIDC in query form %s', (queryStart): void => {
        it.each([
            'ENVIRONMENT:azure,TOKEN_RESOURCE:https://database.example.com',
            'ENVIRONMENT:gcp,TOKEN_RESOURCE:https://database.example.com',
            'ENVIRONMENT:k8s,TOKEN_RESOURCE:https://database.example.com',
            'OIDC_CALLBACK:untrusted',
        ])('cannot select machine authentication through %s', async (properties): Promise<void> => {
            const original =
                `mongodb://attacker.cloudapp.azure.com${queryStart}authMechanism=MONGODB-OIDC` +
                `&authMechanismProperties=${encodeURIComponent(properties)}&ssl=false`;
            const credentials = Object.freeze(
                buildCredentials({
                    connectionString: original,
                    connectionStringWithPassword: 'mongodb://different.example.com/?tls=true',
                }),
            );
            const { connectionString, options } = await new NoAuthHandler(credentials).configureAuth();
            const effective = new MongoClient(connectionString, options).options;
            expect(effective.credentials).toBeUndefined();
            expect(effective.credentials?.mechanism).not.toBe('MONGODB-OIDC');
            expect(effective.credentials?.mechanismProperties.ENVIRONMENT).toBeUndefined();
            expect(effective.credentials?.mechanismProperties.OIDC_CALLBACK).toBeUndefined();
            expect(effective.tls).toBe(false);
            expect(options).toEqual({});
            expect(credentials.connectionString).toBe(original);
        });
    });

    it('clears every mixed-case authentication variant before real driver parsing', async (): Promise<void> => {
        const original =
            'mongodb://db.example.com/?authMechanism=SCRAM-SHA-256&AUTHMECHANISM=MONGODB-OIDC' +
            '&AuthMechanism=GSSAPI&authMechanismProperties=ENVIRONMENT:azure' +
            '&AUTHMECHANISMPROPERTIES=ENVIRONMENT:gcp&AuthMechanismProperties=ENVIRONMENT:k8s&tls=false';
        const { connectionString, options } = await new NoAuthHandler(
            buildCredentials({ connectionString: original }),
        ).configureAuth();
        expect(connectionString).not.toMatch(/authMechanism|ENVIRONMENT/i);
        const effective = new MongoClient(connectionString, options).options;
        expect(effective.credentials).toBeUndefined();
        expect(effective.tls).toBe(false);
    });

    it.each([
        'mongodb://user:dummy@db.example.com/?authMechanism=SCRAM-SHA-256&ssl=false',
        'mongodb://user@db.example.com/?authMechanism=GSSAPI&authMechanismProperties=SERVICE_NAME:documentdb&authSource=%24external&tls=false',
        'mongodb://db.example.com/?authMechanism=MONGODB-X509&authSource=%24external&tls=true&tlsInsecure=true',
        'mongodb://db.example.com/?authMechanismProperties=SERVICE_NAME:documentdb&ssl=false',
    ])('leaves genuine non-OIDC declarations and TLS byte-identical: %s', async (original): Promise<void> => {
        const { connectionString, options } = await new NoAuthHandler(
            buildCredentials({ connectionString: original }),
        ).configureAuth();
        expect(connectionString).toBe(original);
        const before = new MongoClient(original).options;
        const after = new MongoClient(connectionString, options).options;
        expect(after.credentials).toEqual(before.credentials);
        expect(after.tls).toBe(before.tls);
        expect(after.rejectUnauthorized).toBe(before.rejectUnauthorized);
    });

    it.each([
        { host: '127.0.0.1', allow: true },
        { host: 'cluster.mongocluster.cosmos.azure.com', allow: undefined },
        { host: 'attacker.cloudapp.azure.com', allow: undefined },
    ])('retains the host-gated TLS exception when removing OIDC on $host', async ({ host, allow }): Promise<void> => {
        const { connectionString, options } = await new NoAuthHandler(
            buildCredentials({
                connectionString:
                    `mongodb://${host}/?authMechanism=MONGODB-OIDC` +
                    '&authMechanismProperties=ENVIRONMENT:azure&tls=true',
                emulatorConfiguration: { isEmulator: false, disableEmulatorSecurity: true },
            }),
        ).configureAuth();
        expect(options.tlsAllowInvalidCertificates).toBe(allow);
        expect(options.serverSelectionTimeoutMS).toBe(allow ? 4000 : undefined);
        expect(options.tls).toBeUndefined();
        const effective = new MongoClient(connectionString, options).options;
        expect(effective.credentials).toBeUndefined();
        expect(effective.tls).toBe(true);
        expect(effective.rejectUnauthorized).toBe(allow ? false : undefined);
    });

    it('propagates an invalid URI parse error', (): void => {
        const handler = new NoAuthHandler(buildCredentials({ connectionString: 'invalid' }));
        expect(() => handler.configureAuth()).toThrow(/Invalid scheme/);
    });

    it('returns the credential-free connection string verbatim', async () => {
        const handler = new NoAuthHandler(buildCredentials());

        const { connectionString } = await handler.configureAuth();

        expect(connectionString).toBe('mongodb://anon-host:27017/?tls=false');
    });

    it('never forces or injects tls for a non-emulator connection', async () => {
        const handler = new NoAuthHandler(
            buildCredentials({
                connectionString: 'mongodb://anon-host:27017/?ssl=false',
                connectionStringWithPassword: 'mongodb://anon-host:27017/?ssl=false',
            }),
        );

        const { connectionString, options } = await handler.configureAuth();

        // The user's TLS/SSL override survives untouched.
        expect(connectionString).toBe('mongodb://anon-host:27017/?ssl=false');
        expect(options.tls).toBeUndefined();
        expect(options.tlsAllowInvalidCertificates).toBeUndefined();
        expect(options.serverSelectionTimeoutMS).toBeUndefined();
    });

    it('preserves an explicit tls=true&tlsAllowInvalidCertificates=true override', async () => {
        const cs = 'mongodb://anon-host:27017/?tls=true&tlsAllowInvalidCertificates=true';
        const handler = new NoAuthHandler(buildCredentials({ connectionString: cs, connectionStringWithPassword: cs }));

        const { connectionString, options } = await handler.configureAuth();

        expect(connectionString).toBe(cs);
        // We do not set tls ourselves; the override comes from the URI only.
        expect(options.tls).toBeUndefined();
    });

    it('adds tlsAllowInvalidCertificates only for an emulator with disabled security', async () => {
        const handler = new NoAuthHandler(
            buildCredentials({
                emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true },
            }),
        );

        const { options } = await handler.configureAuth();

        expect(options.tlsAllowInvalidCertificates).toBe(true);
        expect(options.serverSelectionTimeoutMS).toBe(4000);
        // Still never forces tls on.
        expect(options.tls).toBeUndefined();
    });

    it('does not add tlsAllowInvalidCertificates for a secured emulator', async () => {
        const handler = new NoAuthHandler(
            buildCredentials({
                emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: false },
            }),
        );

        const { options } = await handler.configureAuth();

        expect(options.tlsAllowInvalidCertificates).toBeUndefined();
        expect(options.serverSelectionTimeoutMS).toBe(4000);
    });

    it('does not add tlsAllowInvalidCertificates for a public host even when the stored flag is set', async () => {
        const handler = new NoAuthHandler(
            buildCredentials({
                connectionString: 'mongodb://db.example.com:27017/',
                connectionStringWithPassword: 'mongodb://db.example.com:27017/',
                emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true },
            }),
        );

        const { options } = await handler.configureAuth();

        expect(options.tlsAllowInvalidCertificates).toBeUndefined();
    });

    it.each(['127.0.0.1', '[::1]'])(
        'honors the stored exception for a non-emulator connection on loopback %s',
        async (host) => {
            const cs = `mongodb://${host}:10260/?tls=true`;
            const handler = new NoAuthHandler(
                buildCredentials({
                    connectionString: cs,
                    connectionStringWithPassword: cs,
                    emulatorConfiguration: { isEmulator: false, disableEmulatorSecurity: true },
                }),
            );

            const { options } = await handler.configureAuth();

            expect(options.tlsAllowInvalidCertificates).toBe(true);
            expect(options.serverSelectionTimeoutMS).toBe(4000);
            expect(options.tls).toBeUndefined();
        },
    );

    it('adds no options for a non-emulator loopback connection without the stored exception', async () => {
        const cs = 'mongodb://127.0.0.1:10260/?tls=true';
        const handler = new NoAuthHandler(
            buildCredentials({
                connectionString: cs,
                connectionStringWithPassword: cs,
                emulatorConfiguration: { isEmulator: false, disableEmulatorSecurity: false },
            }),
        );

        const { options } = await handler.configureAuth();

        expect(options).toEqual({});
    });

    it('adds no options for a non-emulator public host even when the stored flag is set', async () => {
        const cs = 'mongodb://db.example.com:27017/?tls=true';
        const handler = new NoAuthHandler(
            buildCredentials({
                connectionString: cs,
                connectionStringWithPassword: cs,
                emulatorConfiguration: { isEmulator: false, disableEmulatorSecurity: true },
            }),
        );

        const { options } = await handler.configureAuth();

        expect(options).toEqual({});
    });

    it.each([
        { connectionString: 'mongodb://anon-host:27017/?ssl=false', emulatorConfiguration: undefined },
        {
            connectionString: 'mongodb://127.0.0.1:10260/?tls=true',
            emulatorConfiguration: { isEmulator: false, disableEmulatorSecurity: true },
        },
        {
            connectionString: 'mongodb://db.example.com:27017/',
            emulatorConfiguration: { isEmulator: true, disableEmulatorSecurity: true },
        },
    ])(
        'returns the connection string and network options of buildAuthConnectionTarget ($connectionString)',
        async ({ connectionString, emulatorConfiguration }) => {
            const credentials = buildCredentials({
                connectionString,
                connectionStringWithPassword: connectionString,
                emulatorConfiguration,
            });
            const target = buildAuthConnectionTarget(AuthMethodId.NoAuth, credentials);

            const result = await new NoAuthHandler(credentials).configureAuth();

            expect(result.connectionString).toBe(target.connectionString);
            expect(result.options).toMatchObject(target.networkOptions);
        },
    );
});
