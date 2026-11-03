/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { MAX_TOKEN_PAYLOAD_BYTES, summarizeTokenClaims } from './tokenClaims';

const publicResource = 'https://ossrdbms-aad.database.windows.net';
const governmentResource = 'https://ossrdbms-aad.database.usgovcloudapi.net';
const tenant = '11111111-2222-3333-4444-555555555555';
const now = Date.UTC(2026, 9, 29, 12, 0, 0);
const nowSeconds = now / 1000;
const sentinel = 'SENTINEL-claim-value-7f3a';

function encode(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function jwt(claims: Readonly<Record<string, unknown>>): string {
    return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.c2lnbmF0dXJlLXNlbnRpbmVs`;
}

describe('summarizeTokenClaims', (): void => {
    it.each([
        [publicResource, 'match'],
        [`${publicResource}/`, 'match'],
        ['HTTPS://OSSRDBMS-AAD.DATABASE.WINDOWS.NET', 'match'],
        [governmentResource, 'different'],
        ['https://other.example.com/path', 'different'],
        ['00000000-1111-2222-3333-444444444444', 'notComparable'],
        ['opaque-audience', 'notComparable'],
        [42, 'notComparable'],
    ] as const)('compares audience %s with the requested resource as %s', (aud, expected): void => {
        const summary = summarizeTokenClaims(jwt({ aud }), { requestedResource: publicResource }, now);
        expect(summary).toMatchObject({ available: true, audience: expected });
    });

    it.each([
        ['https://sts.windows.net/tenant/', 'public'],
        ['https://login.microsoftonline.com/tenant/v2.0', 'public'],
        ['https://login.microsoftonline.us/tenant/v2.0', 'usgov'],
        ['https://sts.microsoftonline.us/tenant/', 'usgov'],
        ['https://login.chinacloudapi.cn/tenant/v2.0', 'china'],
        ['https://sts.chinacloudapi.cn/tenant/', 'china'],
        ['https://login.sovcloud-identity.fr/tenant/', 'other'],
        ['https://login.microsoftonline.com:8443/tenant/', 'other'],
        ['http://login.microsoftonline.com/tenant/', 'other'],
        [undefined, 'other'],
    ] as const)('classifies issuer %s as %s', (iss, expected): void => {
        expect(summarizeTokenClaims(jwt({ iss }), { requestedResource: publicResource }, now)).toMatchObject({
            issuerCloud: expected,
        });
    });

    it.each([
        [{ tid: tenant }, tenant.toUpperCase(), true, 'match'],
        [{ tid: tenant }, '99999999-2222-3333-4444-555555555555', true, 'different'],
        [{}, tenant, false, 'different'],
        [{ tid: tenant }, undefined, true, 'notConfigured'],
        [{ tid: tenant }, '  ', true, 'notConfigured'],
    ] as const)('reports tenant %j against %s', (claims, configuredTenantId, tenantPresent, tenantMatch): void => {
        expect(
            summarizeTokenClaims(jwt(claims), { requestedResource: publicResource, configuredTenantId }, now),
        ).toMatchObject({ tenantPresent, tenantMatch });
    });

    it('reports remaining lifetime and an expired token with a negative value that is never clamped', (): void => {
        expect(
            summarizeTokenClaims(jwt({ exp: nowSeconds + 3600 }), { requestedResource: publicResource }, now),
        ).toMatchObject({
            expiresInSeconds: 3600,
            expired: false,
        });
        expect(
            summarizeTokenClaims(jwt({ exp: nowSeconds - 120 }), { requestedResource: publicResource }, now),
        ).toMatchObject({
            expiresInSeconds: -120,
            expired: true,
        });
        expect(summarizeTokenClaims(jwt({}), { requestedResource: publicResource }, now)).toMatchObject({
            expiresInSeconds: null,
            expired: null,
        });
    });

    it('categorizes the token version and client', (): void => {
        const summarize = (claims: Readonly<Record<string, unknown>>): unknown =>
            summarizeTokenClaims(jwt(claims), { requestedResource: publicResource }, now);
        expect(summarize({ ver: '1.0', appid: 'aebc6443-996d-45c2-90f0-388ff96faa56' })).toMatchObject({
            tokenVersion: '1.0',
            clientCategory: 'vscode',
        });
        expect(summarize({ ver: '2.0', azp: 'AEBC6443-996D-45C2-90F0-388FF96FAA56' })).toMatchObject({
            tokenVersion: '2.0',
            clientCategory: 'vscode',
        });
        expect(summarize({ ver: '3.0', idtyp: 'app', xms_mirid: '/subscriptions/x/identity' })).toMatchObject({
            tokenVersion: 'unknown',
            clientCategory: 'managedIdentity',
        });
        expect(summarize({ idtyp: 'user', xms_mirid: '/subscriptions/x/identity' })).toMatchObject({
            clientCategory: 'other',
        });
        expect(summarize({ appid: 'another-client' })).toMatchObject({ clientCategory: 'other' });
    });

    it.each([
        ['an opaque token', 'opaque-access-token', 'notJwt'],
        ['two segments', `${encode({})}.${encode({})}`, 'notJwt'],
        ['four segments', `${encode({})}.${encode({})}.sig.extra`, 'notJwt'],
        ['non-base64url characters', `${encode({})}.${encode({})}=.sig`, 'notJwt'],
        ['an empty payload', `${encode({})}..sig`, 'notJwt'],
        [
            'a payload that is not JSON',
            `${encode({})}.${Buffer.from('not json').toString('base64url')}.sig`,
            'malformed',
        ],
        ['a JSON array payload', `${encode({})}.${encode([1, 2])}.sig`, 'malformed'],
        ['a JSON string payload', `${encode({})}.${encode('claims')}.sig`, 'malformed'],
    ])('is unavailable for %s', (_label, token, reason): void => {
        expect(summarizeTokenClaims(token, { requestedResource: publicResource }, now)).toEqual({
            available: false,
            reason,
        });
    });

    it('does not decode a payload over 64 KiB', (): void => {
        const large = jwt({ aud: publicResource, padding: 'x'.repeat(MAX_TOKEN_PAYLOAD_BYTES) });
        expect(summarizeTokenClaims(large, { requestedResource: publicResource }, now)).toEqual({
            available: false,
            reason: 'tooLarge',
        });
        const justUnder = jwt({ padding: 'x'.repeat(MAX_TOKEN_PAYLOAD_BYTES - 64) });
        expect(summarizeTokenClaims(justUnder, { requestedResource: publicResource }, now)).toMatchObject({
            available: true,
        });
    });

    it('keeps no token, signature or unlisted claim value', (): void => {
        const token = jwt({
            aud: publicResource,
            iss: `https://login.microsoftonline.com/${tenant}/v2.0`,
            tid: tenant,
            oid: `${sentinel}-oid`,
            upn: `${sentinel}-upn@contoso.example`,
            name: `${sentinel} Name`,
            unique_name: `${sentinel}-unique`,
            appid: `${sentinel}-appid`,
            xms_mirid: `/subscriptions/${sentinel}`,
            exp: nowSeconds + 60,
        });
        const serialized = JSON.stringify(
            summarizeTokenClaims(token, { requestedResource: publicResource, configuredTenantId: tenant }, now),
        );
        for (const forbidden of [token, sentinel, tenant, 'c2lnbmF0dXJlLXNlbnRpbmVs', 'ossrdbms', 'microsoftonline']) {
            expect(serialized).not.toContain(forbidden);
        }
        expect(JSON.parse(serialized)).toEqual({
            available: true,
            audience: 'match',
            issuerCloud: 'public',
            tokenVersion: 'unknown',
            clientCategory: 'managedIdentity',
            tenantPresent: true,
            tenantMatch: 'match',
            expiresInSeconds: 60,
            expired: false,
        });
    });
});
