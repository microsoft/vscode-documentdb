/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';

import { computeConnectionFingerprint, type ConnectionPrincipal } from './connectionFingerprint';

describe('computeConnectionFingerprint', () => {
    const connectionString = 'mongodb://user:test-password@Host.example:27017/db?authSource=admin&tls=true';
    const native = { kind: 'native', username: 'user' } as const;
    const entra = { kind: 'entra', providerId: 'public', accountId: 'account', tenantId: 'tenant' } as const;

    it('returns a deterministic 32-character lowercase hex fingerprint', () => {
        const fingerprint = computeConnectionFingerprint({ connectionString, principal: native });
        expect(fingerprint).toMatch(/^[a-f0-9]{32}$/);
        expect(computeConnectionFingerprint({ connectionString, principal: { ...native } })).toBe(fingerprint);
    });

    it.each([
        ['mongodb+srv', 'user%40example.com', 'old%40%3A%2F%3F%23%25', 'new%3a%40%2f%3f%23%25'],
        ['mongodb', 'account', 'dGVzdC9vbGQ%2B%2F%3D%3D', 'dGVzdC9uZXc%2B%2F%3D%3D'],
    ])('ignores password or key rotation in %s URIs', (scheme, username, oldPassword, newPassword) => {
        const principal = { kind: 'native', username } as const;
        const suffix = '@host.example/db?appName=test@client';
        const before = `${scheme}://${username}:${oldPassword}${suffix}`;
        const after = `${scheme}://${username}:${newPassword}${suffix}`;
        const fingerprint = computeConnectionFingerprint({ connectionString: before, principal });
        expect(computeConnectionFingerprint({ connectionString: after, principal })).toBe(fingerprint);
    });

    it.each([
        ['username', 'user:', 'User:'],
        ['host case', 'Host.example', 'host.example'],
        ['port', ':27017', ':27018'],
        ['database path', '/db?', '/other?'],
        ['path escape spelling', '/db?', '/%64b?'],
        ['authSource', 'authSource=admin', 'authSource=db'],
        ['query order', 'authSource=admin&tls=true', 'tls=true&authSource=admin'],
    ])('changes when the URI %s changes', (_edit, from, to) => {
        const fingerprint = computeConnectionFingerprint({ connectionString, principal: native });
        expect(
            computeConnectionFingerprint({ connectionString: connectionString.replace(from, to), principal: native }),
        ).not.toBe(fingerprint);
    });

    it('preserves a literal @ in the query without misreading the host port as a password', () => {
        const principal = { kind: 'none' } as const;
        const before = 'mongodb://host.example:27017?appName=test@client';
        const after = 'mongodb://host.example:27018?appName=test@client';
        expect(computeConnectionFingerprint({ connectionString: before, principal })).not.toBe(
            computeConnectionFingerprint({ connectionString: after, principal }),
        );
    });

    it('distinguishes all principal variants and each principal field', () => {
        const principals: ConnectionPrincipal[] = [
            native,
            { ...native, username: 'User' },
            entra,
            { ...entra, providerId: 'government' },
            { ...entra, accountId: 'other' },
            { ...entra, tenantId: 'other' },
            { kind: 'entra', providerId: entra.providerId, accountId: entra.accountId },
            { kind: 'managedIdentity', clientId: 'client-a' },
            { kind: 'managedIdentity', clientId: 'client-b' },
            { kind: 'managedIdentity' },
            { kind: 'none' },
        ];
        const fingerprints = principals.map((principal) => computeConnectionFingerprint({ connectionString, principal }));
        expect(new Set(fingerprints).size).toBe(principals.length);
    });

    it('keeps principal field boundaries unambiguous', () => {
        const first = { ...entra, providerId: 'cloud:region', accountId: 'account' };
        const second = { ...entra, providerId: 'cloud', accountId: 'region:account' };
        expect(computeConnectionFingerprint({ connectionString, principal: first })).not.toBe(
            computeConnectionFingerprint({ connectionString, principal: second }),
        );
    });
});
