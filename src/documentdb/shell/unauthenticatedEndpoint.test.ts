/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { toUnauthenticatedConnectionString } from './unauthenticatedEndpoint';

describe('unauthenticated shell endpoint', () => {
    it('removes all spellings of database, proxy and client-certificate authentication', (): void => {
        const keys = [
            'authMechanism', 'authSource', 'authMechanismProperties', 'proxyUsername', 'proxyPassword',
            'tlsCertificateKeyFile', 'tlsCertificateKeyFilePassword', 'sslPEMKeyFile', 'sslPEMKeyPassword',
            'sslCert', 'sslCertificateKeyFile',
        ];
        const options = keys.flatMap((key) => [`${key}=private`, `${key.toUpperCase()}=private`]).join('&');
        const result = toUnauthenticatedConnectionString(`mongodb://account:password@localhost:27017/db?${options}`);
        expect(result).toBe('mongodb://localhost:27017/db');
    });

    it.each(['mongodb://host-a:27017,host-b:27018/db', 'mongodb+srv://cluster.example.com/db'])(
        'preserves endpoints and server trust options for %s',
        (endpoint): void => {
            const result = new DocumentDBConnectionString(toUnauthenticatedConnectionString(
                `${endpoint}?tls=true&tlsCAFile=trust.pem&tlsAllowInvalidCertificates=false&tlsAllowInvalidHostnames=false&replicaSet=rs&directConnection=true`,
            ));
            expect(result.hosts).toEqual(new DocumentDBConnectionString(endpoint).hosts);
            expect(result.pathname).toBe('/db');
            expect([...result.searchParams.entries()]).toEqual([
                ['tls', 'true'], ['tlsCAFile', 'trust.pem'], ['tlsAllowInvalidCertificates', 'false'],
                ['tlsAllowInvalidHostnames', 'false'], ['replicaSet', 'rs'], ['directConnection', 'true'],
            ]);
        },
    );

    it.each(['mongodb://user:private@', 'mongodb://us[er:private@host/', 'not-a-uri-private'])(
        'discards unsafe constructor errors for %s',
        (input): void => {
            try {
                toUnauthenticatedConnectionString(input);
                expect.fail('Expected an invalid endpoint');
            } catch (error) {
                expect(error).toBeInstanceOf(Error);
                expect((error as Error).message).toBe('Invalid connection string.');
                expect((error as Error).cause).toBeUndefined();
                expect((error as Error).stack).not.toContain(input);
            }
        },
    );
});
