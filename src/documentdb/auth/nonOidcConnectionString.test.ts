/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AuthMechanism, MongoClient, MongoParseError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { removeConflictingOidcMechanism } from './nonOidcConnectionString';

describe('removeConflictingOidcMechanism', () => {
    it.each([
        'ENVIRONMENT:azure,TOKEN_RESOURCE:https://database.example.com',
        'ENVIRONMENT:gcp,TOKEN_RESOURCE:https://database.example.com',
        'ENVIRONMENT:k8s,TOKEN_RESOURCE:https://database.example.com',
        'OIDC_CALLBACK:untrusted',
    ])('prevents URI-selected OIDC with %s in the real driver', (properties): void => {
        const original =
            'mongodb://db.example.com/?authMechanism=MONGODB-OIDC' +
            `&authMechanismProperties=${encodeURIComponent(properties)}&tls=false&appName=kept`;
        const sanitized = removeConflictingOidcMechanism(original);
        const parsed = new DocumentDBConnectionString(sanitized);
        expect([...parsed.searchParams.entries()]).toEqual([
            ['tls', 'false'],
            ['appName', 'kept'],
        ]);
        // MongoClient's constructor runs the installed driver's parseOptions without connecting.
        const effective = new MongoClient(sanitized).options;
        expect(effective.credentials?.mechanism).not.toBe('MONGODB-OIDC');
        expect(effective.credentials?.mechanismProperties.ENVIRONMENT).toBeUndefined();
        expect(effective.credentials?.mechanismProperties.TOKEN_RESOURCE).toBeUndefined();
        expect(effective.credentials?.mechanismProperties.OIDC_CALLBACK).toBeUndefined();
        expect(effective.tls).toBe(false);
        expect(effective.appName).toBe('kept');
    });

    it.each([
        'AUTHMECHANISM=mongodb-oidc',
        'AuthMechanism=%20mOnGoDb-OiDc%09',
        'authMechanism=SCRAM-SHA-256&AUTHMECHANISM=MONGODB-OIDC&AuthMechanism=INVALID',
        'authMechanism=SCRAM-SHA-256&authMechanism=MONGODB-OIDC',
        'authMechanism=MONGODB-OIDC&authMechanism=SCRAM-SHA-256',
        'AUTHMECHANISM=SCRAM-SHA-256&AuthMechanism=MONGODB-OIDC&authMechanism=GSSAPI',
    ])('removes every authentication key spelling when any value conflicts: %s', (mechanisms): void => {
        const original =
            `mongodb://db.example.com/?${mechanisms}` +
            '&authMechanismProperties=ENVIRONMENT:azure&TLS=false' +
            '&AUTHMECHANISMPROPERTIES=ENVIRONMENT:gcp&AuthMechanismProperties=ENVIRONMENT:k8s' +
            '&authMechanismProperties=OIDC_CALLBACK:untrusted';
        const sanitized = removeConflictingOidcMechanism(original);
        expect([...new DocumentDBConnectionString(sanitized).searchParams.entries()]).toEqual([['TLS', 'false']]);
        const effective = new MongoClient(sanitized).options;
        expect(effective.credentials?.mechanism).not.toBe('MONGODB-OIDC');
        expect(effective.credentials?.mechanismProperties.ENVIRONMENT).toBeUndefined();
        expect(effective.tls).toBe(false);
    });

    it.each(['OIDC', 'oidc', '-OIDC', 'MONGODB-.IDC'])(
        'removes %s when the installed driver resolves it to OIDC',
        (mechanism): void => {
            const original =
                `mongodb://db.example.com/?AUTHMECHANISM=${encodeURIComponent(mechanism)}` +
                '&AuthMechanismProperties=ENVIRONMENT:k8s&tls=false&appName=kept';
            expect(new MongoClient(original).options.credentials?.mechanism).toBe(AuthMechanism.MONGODB_OIDC);

            const sanitized = removeConflictingOidcMechanism(original);
            expect([...new DocumentDBConnectionString(sanitized).searchParams.entries()]).toEqual([
                ['tls', 'false'],
                ['appName', 'kept'],
            ]);
            const effective = new MongoClient(sanitized).options;
            expect(effective.credentials?.mechanism).not.toBe(AuthMechanism.MONGODB_OIDC);
            expect(effective.credentials?.mechanismProperties.ENVIRONMENT).toBeUndefined();
            expect(effective.tls).toBe(false);
            expect(effective.appName).toBe('kept');
        },
    );

    it.each([
        ['.*', AuthMechanism.MONGODB_AWS],
        ['MONGODB-.*', AuthMechanism.MONGODB_AWS],
        ['OIDC|AWS', AuthMechanism.MONGODB_AWS],
        ['OIDC|SCRAM-SHA-256', AuthMechanism.MONGODB_SCRAM_SHA256],
    ])('preserves %s byte-identical when the driver first matches %s', (pattern, mechanism): void => {
        const userInfo = mechanism === AuthMechanism.MONGODB_AWS ? '' : 'user@';
        const original =
            `mongodb://${userInfo}db.example.com/?authMechanism=${encodeURIComponent(pattern)}` +
            '&authMechanismProperties=ENVIRONMENT:k8s&ssl=false&appName=keep%20spaces';
        const before = new MongoClient(original).options;
        expect(before.credentials?.mechanism).toBe(mechanism);

        const sanitized = removeConflictingOidcMechanism(original);
        expect(sanitized).toBe(original);
        const after = new MongoClient(sanitized).options;
        expect(after.credentials).toEqual(before.credentials);
        expect(after.tls).toBe(before.tls);
        expect(after.appName).toBe(before.appName);
    });

    it('preserves invalid DB-OIDC byte-identical and leaves the normal driver parse error intact', (): void => {
        const original =
            'mongodb://db.example.com/?authMechanism=DB-OIDC&authMechanismProperties=ENVIRONMENT:k8s&tls=false';
        const sanitized = removeConflictingOidcMechanism(original);
        expect(sanitized).toBe(original);
        for (const uri of [original, sanitized]) {
            expect(() => new MongoClient(uri)).toThrow(MongoParseError);
            expect(() => new MongoClient(uri)).toThrow(/authMechanism one of .*got DB-OIDC/);
        }
    });

    it.each(['[', '('])('propagates the same invalid-pattern error as the installed driver for %s', (pattern): void => {
        const original = `mongodb://db.example.com/?authMechanism=${encodeURIComponent(pattern)}`;
        expect(() => new MongoClient(original)).toThrow(SyntaxError);
        expect(() => removeConflictingOidcMechanism(original)).toThrow(SyntaxError);
        expect(() => removeConflictingOidcMechanism(original)).toThrow(/Invalid regular expression/);
    });

    it('handles the SRV query form without a slash without resolving DNS', (): void => {
        const sanitized = removeConflictingOidcMechanism(
            'mongodb+srv://db.example.com?AUTHMECHANISM=MONGODB-OIDC&AuthMechanismProperties=ENVIRONMENT:azure&ssl=false',
        );
        const effective = new MongoClient(sanitized).options;
        expect(effective.credentials?.mechanism).not.toBe('MONGODB-OIDC');
        expect(effective.credentials?.mechanismProperties.ENVIRONMENT).toBeUndefined();
        expect(effective.tls).toBe(false);
    });

    it.each([
        'mongodb://user:dummy@db.example.com/?authMechanism=SCRAM-SHA-1&ssl=false&appName=keep%20spaces',
        'mongodb://user:dummy@db.example.com/?AUTHMECHANISM=SCRAM-SHA-256&TLS=true&tlsInsecure=true',
        'mongodb://user@db.example.com/?authMechanism=GSSAPI&authMechanismProperties=SERVICE_NAME:documentdb&authSource=%24external&ssl=true&tlsAllowInvalidHostnames=true',
        'mongodb://CN%3Doffline@db.example.com/?authMechanism=MONGODB-X509&authSource=%24external&tls=true&tlsInsecure=true',
        'mongodb://db.example.com/?authMechanismProperties=SERVICE_NAME:documentdb&ssl=false',
        'mongodb://db.example.com/?authMechanismProperties=ENVIRONMENT:azure&tls=false',
        'mongodb+srv://db.example.com?ssl=false&appName=keep%20spaces',
        'mongodb://db.example.com/?TLS=true&tlsAllowInvalidCertificates=true',
    ])('returns non-OIDC input byte-identical with effective native/TLS options unchanged: %s', (original): void => {
        const sanitized = removeConflictingOidcMechanism(original);
        expect(sanitized).toBe(original);
        const before = new MongoClient(original).options;
        const after = new MongoClient(sanitized).options;
        expect(after.credentials).toEqual(before.credentials);
        expect(after.credentials?.mechanism).not.toBe('MONGODB-OIDC');
        expect(after.tls).toBe(before.tls);
        expect(after.tlsInsecure).toBe(before.tlsInsecure);
        expect(after.tlsAllowInvalidHostnames).toBe(before.tlsAllowInvalidHostnames);
        expect(after.tlsAllowInvalidCertificates).toBe(before.tlsAllowInvalidCertificates);
        expect(after.rejectUnauthorized).toBe(before.rejectUnauthorized);
        expect(after.appName).toBe(before.appName);
    });

    it('does not reserialize a non-OIDC input that the utility normalizes', (): void => {
        const original = '  mongodb://db.example.com/?appName=@offline@&ssl=false  ';
        expect(removeConflictingOidcMechanism(original)).toBe(original);
    });

    it.each(['', 'not a connection string', 'http://db.example.com/', 'mongodb://'])(
        'propagates the existing URI parse error for invalid input: %s',
        (original): void => {
            expect(() => removeConflictingOidcMechanism(original)).toThrow(/Invalid scheme|Protocol and host list/);
        },
    );
});
