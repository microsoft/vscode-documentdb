/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CachedClusterCredentials } from '../CredentialCache';
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
        const handler = new NoAuthHandler(
            buildCredentials({ connectionString: cs, connectionStringWithPassword: cs }),
        );

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
});
