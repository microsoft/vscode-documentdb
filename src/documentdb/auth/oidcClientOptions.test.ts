/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MongoClient, type MongoClientOptions, type OIDCCallbackFunction } from 'mongodb';
import { type PeerCertificate } from 'tls';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { EntraDestinationRejectedError, isEntraDestinationRejectedError } from './oidcAllowedHosts';
import {
    buildOidcClientConfiguration,
    createEntraCheckServerIdentity,
    createOidcDestinationPolicy,
} from './oidcClientOptions';

const host = 'cluster.mongocluster.cosmos.azure.com';
const connectionString = `mongodb://${host}/`;
const patterns = ['*.mongocluster.cosmos.azure.com'];
const oidcCallback: OIDCCallbackFunction = async () => ({ accessToken: 'dummy-offline-token' });
const policy = createOidcDestinationPolicy(connectionString, () => undefined);

function certificateFor(hostname: string): PeerCertificate {
    return { subjectaltname: `DNS:${hostname}` } as PeerCertificate;
}

describe('createEntraCheckServerIdentity', () => {
    it('checks policy before examining the certificate', () => {
        const cert = new Proxy({} as PeerCertificate, {
            get: (): never => {
                throw new Error('Certificate must not be inspected for a rejected host');
            },
        });
        const error = createEntraCheckServerIdentity(policy)('evil.example', cert);
        expect(isEntraDestinationRejectedError(error)).toBe(true);
        expect(error).toMatchObject({ firstHost: 'evil.example', additionalHostCount: 0 });
    });

    it('delegates approved hosts to the real Node certificate hostname verifier', () => {
        const check = createEntraCheckServerIdentity(policy);
        expect(check(host, certificateFor(host))).toBeUndefined();
        expect(check(host, certificateFor('other.mongocluster.cosmos.azure.com'))).toMatchObject({
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
        expect(check(host, {} as PeerCertificate)).toMatchObject({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
    });

    it('checks every invocation, including discovered hosts, rather than caching seed approval', () => {
        const check = createEntraCheckServerIdentity(policy);
        for (const name of [host, 'node.mongocluster.cosmos.azure.com', host]) {
            expect(check(name, certificateFor(name))).toBeUndefined();
        }
        for (const name of [
            'app.eastus.cloudapp.azure.com',
            '127.0.0.1',
            'mongocluster.cosmos.azure.com',
            `${host}.`,
        ]) {
            expect(check(name, certificateFor(name))).toBeInstanceOf(EntraDestinationRejectedError);
        }
    });

    it('retains the original patterns when machine trust is broadened', () => {
        const original = 'mongodb://cluster.narrow.trusted.example/';
        let suffix = 'narrow.trusted.example';
        const check = createEntraCheckServerIdentity(createOidcDestinationPolicy(original, () => suffix));
        suffix = 'trusted.example';
        expect(check('server.trusted.example', certificateFor('server.trusted.example'))).toBeInstanceOf(
            EntraDestinationRejectedError,
        );
    });
});

describe('buildOidcClientConfiguration', () => {
    it.each([
        '',
        'not a connection string',
        'mongodb://evil.example/',
        `mongodb://${host},evil.example/`,
        `mongodb://${host}./`,
        'mongodb://mongocluster.cosmos.azure.com/',
        'mongodb://127.0.0.1/',
    ])('rejects before constructing client options or invoking the token callback: %s', (uri) => {
        const callback = vi.fn(oidcCallback);
        const baseOptions = new Proxy({} as MongoClientOptions, {
            ownKeys: (): never => {
                throw new Error('Options must not be accessed before destination validation');
            },
        });
        expect(() =>
            buildOidcClientConfiguration({
                connectionString: uri,
                policy,
                oidcCallback: callback,
                baseOptions,
            }),
        ).toThrow(EntraDestinationRejectedError);
        expect(callback).not.toHaveBeenCalled();
    });

    it('builds typed OIDC options with mandatory TLS and no eager token acquisition', () => {
        const callback = vi.fn(oidcCallback);
        const result = buildOidcClientConfiguration({ connectionString, policy, oidcCallback: callback });
        expect(result.ignoredTlsBypass).toBe(false);
        expect(result.options).toEqual({
            authMechanism: 'MONGODB-OIDC',
            authMechanismProperties: { ALLOWED_HOSTS: patterns, OIDC_CALLBACK: expect.any(Function) },
            tls: true,
            rejectUnauthorized: true,
            checkServerIdentity: expect.any(Function),
        });
        const parsed = new MongoClient(result.connectionString, result.options).options;
        expect(parsed.tls).toBe(true);
        expect(parsed.rejectUnauthorized).toBe(true);
        expect(parsed.checkServerIdentity).toBe(result.options.checkServerIdentity);
        expect(parsed.credentials).toMatchObject({
            mechanism: 'MONGODB-OIDC',
            source: '$external',
            username: '',
            mechanismProperties: {
                ALLOWED_HOSTS: patterns,
                OIDC_CALLBACK: result.options.authMechanismProperties?.OIDC_CALLBACK,
            },
        });
        expect(callback).not.toHaveBeenCalled();
    });

    it('clears URI credentials and all repeated case variants before the actual driver parses options', () => {
        const unsafe = [
            'authMechanism=SCRAM-SHA-256',
            'AUTHMECHANISM=MONGODB-OIDC',
            'AuthMechanism=INVALID',
            'authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:untrusted',
            'AUTHMECHANISMPROPERTIES=ENVIRONMENT:gcp',
            'AuthMechanismProperties=ALLOWED_HOSTS:*.evil.example',
            'tls=false',
            'TLS=true',
            'Tls=false',
            'ssl=false',
            'SSL=true',
            'tlsInsecure=false',
            'TLSINSECURE=true',
            'TlsInsecure=true',
            'tlsInsecure=true',
            'tlsAllowInvalidCertificates=true',
            'TLSALLOWINVALIDCERTIFICATES=true',
            'tlsAllowInvalidHostnames=true',
            'TLSALLOWINVALIDHOSTNAMES=true',
            'sslAllowInvalidCertificates=true',
            'SSLALLOWINVALIDCERTIFICATES=true',
            'sslAllowInvalidHostnames=true',
            'SSLALLOWINVALIDHOSTNAMES=true',
            'sslInsecure=true',
            'SSLINSECURE=true',
            'sslValidate=false',
            'SSLVALIDATE=false',
            'rejectUnauthorized=true',
            'REJECTUNAUTHORIZED=false',
            `servername=${host}`,
            'SERVERNAME=other.example',
            'session=untrusted',
            'SESSION=untrusted',
            'checkServerIdentity=untrusted',
            'CHECKSERVERIDENTITY=untrusted',
        ];
        const original = `mongodb://user:secret@${host}/?${unsafe.join('&')}&appName=kept`;
        const result = buildOidcClientConfiguration({ connectionString: original, policy, oidcCallback });
        const sanitized = new DocumentDBConnectionString(result.connectionString);
        expect(sanitized.username).toBe('');
        expect(sanitized.password).toBe('');
        expect([...sanitized.searchParams.entries()]).toEqual([['appName', 'kept']]);
        const parsed = new MongoClient(result.connectionString, result.options).options;
        expect(parsed.tls).toBe(true);
        expect(parsed.rejectUnauthorized).toBe(true);
        expect(parsed.servername).toBeUndefined();
        expect(parsed.session).toBeUndefined();
        expect(parsed.checkServerIdentity).toBe(result.options.checkServerIdentity);
        expect(parsed.credentials?.username).toBe('');
        expect(parsed.credentials?.password).toBe('');
        expect(parsed.credentials?.mechanismProperties).toEqual({
            ALLOWED_HOSTS: patterns,
            OIDC_CALLBACK: result.options.authMechanismProperties?.OIDC_CALLBACK,
        });
        expect(result.ignoredTlsBypass).toBe(true);
        expect(original).toContain('user:secret@');
        expect(original).toContain('TLSINSECURE=true');
    });

    it.each([
        ['tls=false', true],
        ['ssl=false', true],
        ['tlsInsecure=true', true],
        ['sslInsecure=true', true],
        ['tlsAllowInvalidCertificates=true', true],
        ['sslAllowInvalidCertificates=true', true],
        ['tlsAllowInvalidHostnames=true', true],
        ['sslAllowInvalidHostnames=true', true],
        ['rejectUnauthorized=false', true],
        ['sslValidate=false', true],
        ['tls=true', false],
        ['ssl=true', false],
        ['tlsInsecure=false', false],
        ['tlsAllowInvalidCertificates=false', false],
        ['tlsAllowInvalidHostnames=false', false],
        ['rejectUnauthorized=true', false],
        ['TLSINSECURE=false&tlsInsecure=TrUe', true],
        ['tlsInsecure=false&tlsInsecure=true', true],
        ['REJECTUNAUTHORIZED=true&rejectUnauthorized=FaLsE', true],
    ])('removes %s and reports only requested TLS relaxation', (query, ignored) => {
        const result = buildOidcClientConfiguration({
            connectionString: `${connectionString}?${query}`,
            policy,
            oidcCallback,
        });
        expect(new DocumentDBConnectionString(result.connectionString).search).toBe('');
        expect(result.ignoredTlsBypass).toBe(ignored);
        const parsed = new MongoClient(result.connectionString, result.options).options;
        expect(parsed.tls).toBe(true);
        expect(parsed.rejectUnauthorized).toBe(true);
        expect(parsed.checkServerIdentity?.(host, certificateFor('evil.example'))).toMatchObject({
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
    });

    it.each([
        ['ca', 'attacker-ca'],
        ['crl', 'attacker-crl'],
        ['tlsCAFile', 'attacker-ca.pem'],
        ['tlsCRLFile', 'attacker-crl.pem'],
        ['proxyHost', 'attacker.example'],
        ['proxyPort', '1080'],
        ['proxyUsername', 'attacker'],
        ['proxyPassword', 'dummy-proxy-password'],
    ])('removes every repeated URI case variant of %s and reports ignored parameters', (key, value) => {
        const query = [key, key.toUpperCase(), key.toLowerCase(), key]
            .map((variant) => `${variant}=${value}`)
            .join('&');
        const original = `${connectionString}?${query}&appName=preserved`;
        const result = buildOidcClientConfiguration({ connectionString: original, policy, oidcCallback });
        expect([...new DocumentDBConnectionString(result.connectionString).searchParams.entries()]).toEqual([
            ['appName', 'preserved'],
        ]);
        expect(result.ignoredTlsBypass).toBe(true);
        const parsed = new MongoClient(result.connectionString, result.options).options;
        expect(parsed.tlsCAFile).toBeUndefined();
        expect(parsed.tlsCRLFile).toBeUndefined();
        expect(parsed.ca).toBeUndefined();
        expect(parsed.crl).toBeUndefined();
        expect(parsed.proxyHost).toBeUndefined();
        expect(parsed.proxyPort).toBeUndefined();
        expect(parsed.proxyUsername).toBeUndefined();
        expect(parsed.proxyPassword).toBeUndefined();
        expect(parsed.tls).toBe(true);
        expect(parsed.rejectUnauthorized).toBe(true);
        expect(original).toBe(`${connectionString}?${query}&appName=preserved`);
    });

    it('prevents URI CA and SOCKS overrides while retaining extension-controlled trust and native semantics', () => {
        const query = [
            'tls=true',
            'ca=attacker-ca',
            'crl=attacker-crl',
            'tlsCAFile=attacker-ca.pem',
            'tlsCRLFile=attacker-crl.pem',
            'proxyHost=attacker.example',
            'proxyPort=1080',
            'proxyUsername=attacker',
            'proxyPassword=dummy-proxy-password',
        ].join('&');
        const input = Object.freeze({ connectionString: `${connectionString}?${query}`, policy, oidcCallback });
        const baseOptions = Object.freeze({ ca: 'extension-controlled-ca' });
        const result = buildOidcClientConfiguration({ ...input, baseOptions });
        const secured = new MongoClient(result.connectionString, result.options).options;
        expect(secured.ca).toBe(baseOptions.ca);
        expect(secured.tlsCAFile).toBeUndefined();
        expect(secured.tlsCRLFile).toBeUndefined();
        expect(secured.crl).toBeUndefined();
        expect(secured.proxyHost).toBeUndefined();
        expect(secured.proxyPort).toBeUndefined();
        expect(secured.proxyUsername).toBeUndefined();
        expect(secured.proxyPassword).toBeUndefined();
        expect(result.ignoredTlsBypass).toBe(true);
        expect(baseOptions).toEqual({ ca: 'extension-controlled-ca' });
        expect(input.connectionString).toBe(`${connectionString}?${query}`);
        const native = new MongoClient(input.connectionString).options;
        expect(native).toMatchObject({
            ca: 'attacker-ca',
            crl: 'attacker-crl',
            tlsCAFile: 'attacker-ca.pem',
            tlsCRLFile: 'attacker-crl.pem',
            proxyHost: 'attacker.example',
            proxyPort: 1080,
            proxyUsername: 'attacker',
            proxyPassword: 'dummy-proxy-password',
        });
    });

    it('preserves URI client certificate files without replacing peer trust', () => {
        const original = `${connectionString}?tlsCertificateKeyFile=client.pem&tlsCertificateKeyFilePassword=dummy-key-password`;
        const result = buildOidcClientConfiguration({ connectionString: original, policy, oidcCallback });
        const parsed = new MongoClient(result.connectionString, result.options).options;
        expect(parsed.tlsCertificateKeyFile).toBe('client.pem');
        expect(parsed.passphrase).toBe('dummy-key-password');
        expect(parsed.ca).toBeUndefined();
        expect(parsed.tlsCAFile).toBeUndefined();
        expect(parsed.rejectUnauthorized).toBe(true);
        expect(parsed.checkServerIdentity).toBe(result.options.checkServerIdentity);
        expect(result.ignoredTlsBypass).toBe(false);
    });

    it('overrides conflicting base options and casing without mutating unrelated options', () => {
        const bypass = vi.fn(() => undefined);
        const baseOptions: MongoClientOptions & Record<string, unknown> = {
            auth: { username: 'user', password: 'secret' },
            AUTH: { username: 'other', password: 'other-secret' },
            authMechanism: 'SCRAM-SHA-256',
            AUTHMECHANISM: 'SCRAM-SHA-1',
            authMechanismProperties: { ENVIRONMENT: 'azure', TOKEN_RESOURCE: 'untrusted' },
            AUTHMECHANISMPROPERTIES: { ALLOWED_HOSTS: ['*.evil.example'], OIDC_CALLBACK: bypass },
            tls: false,
            TLS: false,
            ssl: false,
            SSL: false,
            tlsInsecure: true,
            TLSINSECURE: true,
            tlsAllowInvalidCertificates: true,
            TLSALLOWINVALIDCERTIFICATES: true,
            tlsAllowInvalidHostnames: true,
            TLSALLOWINVALIDHOSTNAMES: true,
            SSLALLOWINVALIDCERTIFICATES: true,
            SSLALLOWINVALIDHOSTNAMES: true,
            SSLINSECURE: true,
            SSLVALIDATE: false,
            rejectUnauthorized: false,
            REJECTUNAUTHORIZED: false,
            checkServerIdentity: bypass,
            CHECKSERVERIDENTITY: bypass,
            servername: host,
            SERVERNAME: host,
            session: Buffer.from('untrusted'),
            SESSION: Buffer.from('untrusted'),
            appName: 'preserved',
            maxPoolSize: 3,
            connectTimeoutMS: 1234,
            ca: 'custom-ca-preserved',
            tlsCAFile: 'custom-ca.pem',
            tlsCertificateKeyFile: 'client.pem',
            tlsCertificateKeyFilePassword: 'local-key-password',
        };
        Object.freeze(baseOptions);
        Object.freeze(baseOptions.auth);
        Object.freeze(baseOptions.authMechanismProperties);
        const result = buildOidcClientConfiguration({ connectionString, policy, oidcCallback, baseOptions });
        expect(result.ignoredTlsBypass).toBe(true);
        expect(result.options).toMatchObject({
            appName: 'preserved',
            maxPoolSize: 3,
            connectTimeoutMS: 1234,
            ca: 'custom-ca-preserved',
            tlsCAFile: 'custom-ca.pem',
            tlsCertificateKeyFile: 'client.pem',
            tlsCertificateKeyFilePassword: 'local-key-password',
            tls: true,
            rejectUnauthorized: true,
        });
        expect(result.options.auth).toBeUndefined();
        expect(result.options.servername).toBeUndefined();
        expect(result.options.session).toBeUndefined();
        expect(Object.keys(result.options).filter((key) => key.toUpperCase() === key)).toEqual([]);
        const parsed = new MongoClient(result.connectionString, result.options).options;
        expect(parsed.credentials?.mechanismProperties).toEqual({
            ALLOWED_HOSTS: patterns,
            OIDC_CALLBACK: result.options.authMechanismProperties?.OIDC_CALLBACK,
        });
        expect(parsed.rejectUnauthorized).toBe(true);
        expect(parsed.tls).toBe(true);
        expect(parsed.checkServerIdentity).not.toBe(bypass);
        expect(parsed.checkServerIdentity?.('evil.example', certificateFor(host))).toBeInstanceOf(
            EntraDestinationRejectedError,
        );
        expect(parsed.checkServerIdentity?.(host, certificateFor('evil.example'))).toMatchObject({
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
        expect(baseOptions.tls).toBe(false);
        expect(baseOptions.auth?.username).toBe('user');
        expect(baseOptions.authMechanismProperties?.ENVIRONMENT).toBe('azure');
        expect(baseOptions.checkServerIdentity).toBe(bypass);
        expect(bypass).not.toHaveBeenCalled();
    });

    it('pins parseOptions URI precedence that requires sanitizing rather than just setting object options', () => {
        const original = `${connectionString}?authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:untrusted&tlsInsecure=true`;
        const insecure = new MongoClient(original, {
            tls: true,
            authMechanism: 'MONGODB-OIDC',
            authMechanismProperties: { ALLOWED_HOSTS: patterns, OIDC_CALLBACK: oidcCallback },
        }).options;
        expect(insecure.rejectUnauthorized).toBe(false);
        expect(insecure.credentials?.mechanismProperties.ENVIRONMENT).toBe('azure');
        const result = buildOidcClientConfiguration({ connectionString: original, policy, oidcCallback });
        const secured = new MongoClient(result.connectionString, result.options).options;
        expect(secured.rejectUnauthorized).toBe(true);
        expect(secured.credentials?.mechanismProperties.ENVIRONMENT).toBeUndefined();
        expect(secured.checkServerIdentity?.('evil.example', certificateFor('evil.example'))).toBeInstanceOf(
            EntraDestinationRejectedError,
        );
    });

    it('pins parseOptions object-hook precedence over the URI hostname bypass', () => {
        const original = `${connectionString}?tlsAllowInvalidHostnames=true`;
        const insecure = new MongoClient(original, { tls: true }).options;
        expect(insecure.checkServerIdentity?.(host, certificateFor('evil.example'))).toBeUndefined();
        const check = createEntraCheckServerIdentity(policy);
        const objectOverride = new MongoClient(original, { tls: true, checkServerIdentity: check }).options;
        expect(objectOverride.checkServerIdentity).toBe(check);
        expect(objectOverride.checkServerIdentity?.(host, certificateFor('evil.example'))).toMatchObject({
            code: 'ERR_TLS_CERT_ALTNAME_INVALID',
        });
    });

    it('supports SRV and explicit custom suffixes without adding unrelated destinations', () => {
        const result = buildOidcClientConfiguration({
            connectionString: 'mongodb+srv://cluster.database.example.com/',
            policy: createOidcDestinationPolicy(
                'mongodb+srv://cluster.database.example.com/',
                () => ' .DATABASE.EXAMPLE.COM ',
            ),
            oidcCallback,
        });
        const parsed = new MongoClient(result.connectionString, result.options).options;
        expect(parsed.tls).toBe(true);
        expect(parsed.credentials?.mechanismProperties.ALLOWED_HOSTS).toEqual(['*.database.example.com']);
        expect(
            parsed.checkServerIdentity?.('node.database.example.com', certificateFor('node.database.example.com')),
        ).toBeUndefined();
        expect(parsed.checkServerIdentity?.(host, certificateFor(host))).toBeInstanceOf(EntraDestinationRejectedError);
    });

    it('leaves the persisted URI and native TLS semantics unchanged', () => {
        const input = Object.freeze({
            connectionString: `mongodb://user:secret@${host}/?tls=true&tlsInsecure=true&appName=native`,
            oidcCallback,
        });
        buildOidcClientConfiguration({ ...input, policy });
        const native = new MongoClient(input.connectionString).options;
        expect(native.rejectUnauthorized).toBe(false);
        expect(native.credentials?.username).toBe('user');
        expect(native.credentials?.password).toBe('secret');
        expect(native.appName).toBe('native');
        expect(input.connectionString).toContain('tlsInsecure=true');
    });

    it('keeps original multi-seed restrictions after preparation narrows the seeds', () => {
        const originalPolicy = createOidcDestinationPolicy(
            `mongodb://${host},cluster.mongocluster.cosmos.azure.us/`,
            () => undefined,
        );
        const result = buildOidcClientConfiguration({ connectionString, policy: originalPolicy, oidcCallback });
        expect(result.options.authMechanismProperties?.ALLOWED_HOSTS).toEqual([
            '*.mongocluster.cosmos.azure.com',
            '*.mongocluster.cosmos.azure.us',
        ]);
        expect(
            result.options.checkServerIdentity?.(
                'node.mongocluster.cosmos.azure.cn',
                certificateFor('node.mongocluster.cosmos.azure.cn'),
            ),
        ).toBeInstanceOf(EntraDestinationRejectedError);
        expect(() =>
            buildOidcClientConfiguration({
                connectionString: 'mongodb://node.mongocluster.cosmos.azure.cn/',
                policy: originalPolicy,
                oidcCallback,
            }),
        ).toThrow(EntraDestinationRejectedError);
    });

    it('rechecks live trust on existing TLS hooks and on both sides of callback awaits', async () => {
        const original = 'mongodb://cluster.database.example.com/';
        let suffix: string | undefined = 'database.example.com';
        const originalPolicy = createOidcDestinationPolicy(original, () => suffix);
        let finish!: (value: { accessToken: string }) => void;
        const callback = vi.fn(
            () =>
                new Promise<{ accessToken: string }>((resolve) => {
                    finish = resolve;
                }),
        );
        const result = buildOidcClientConfiguration({
            connectionString: original,
            policy: originalPolicy,
            oidcCallback: callback,
        });
        const wrapped = result.options.authMechanismProperties!.OIDC_CALLBACK!;
        const params = { version: 1 as const, timeoutContext: new AbortController().signal };
        const token = wrapped(params);
        expect(callback).toHaveBeenCalledTimes(1);
        suffix = undefined;
        finish({ accessToken: 'must-not-return' });
        await expect(token).rejects.toBeInstanceOf(EntraDestinationRejectedError);
        expect(
            result.options.checkServerIdentity?.(
                'cluster.database.example.com',
                certificateFor('cluster.database.example.com'),
            ),
        ).toBeInstanceOf(EntraDestinationRejectedError);
        await expect(wrapped(params)).rejects.toBeInstanceOf(EntraDestinationRejectedError);
        expect(callback).toHaveBeenCalledTimes(1);
    });
});
