/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { TokenResourceResolutionError, type ResolvedTokenResource } from '../documentdbTokenResource';
import { connectionFailureRows, describeTokenClaims, formatPreviewReport, type PreviewReport } from './report';

const secret = 'private-person@example.invalid';
const id = '11111111-2222-3333-4444-555555555555';
const host = 'private-cluster.internal.example.invalid';
const resource = 'https://ossrdbms-aad.database.usgovcloudapi.net';
const resolved: ResolvedTokenResource = {
    resource, scope: `${resource}/.default`, cloudCategory: 'usgov', reason: 'setting',
    details: { configuredCloud: 'AzureUSGovernment', hostCloud: 'AzureUSGovernment', tokenResource: resource },
};

function jwt(claims: unknown): string {
    return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

function report(overrides: Partial<PreviewReport> = {}): PreviewReport {
    return {
        step: 2, surface: 'extension', extensionVersion: '1.2.3', vscodeVersion: '1.100.0',
        platform: 'linux', arch: 'x64', timestamp: '2026-10-26T10:09:16.000Z',
        startupCorrelationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', resolved, ...overrides,
    };
}

describe('preview report redaction', () => {
    it('copies a fenced report with only approved JWT fields and derived matches', () => {
        const token = jwt({
            aud: resource, iss: `https://login.microsoftonline.us/${id}/v2.0`,
            ver: '2.0', tid: id, azp: id, oid: id, sub: secret,
            upn: secret, preferred_username: secret, exp: Date.now() / 1000 + 60,
        });
        const output = formatPreviewReport(report({ token, tenantId: id, elapsedMs: 1234 }));
        expect(output).toMatch(/^```text\n[\s\S]+\n```$/);
        for (const value of [secret, id, token, 'preferred_username', 'upn', 'oid']) {
            expect(output).not.toContain(value);
        }
        expect(output).toContain('Audience matches: yes');
        expect(output).toContain('Tenant (tid): present');
        expect(output).toContain('Tenant matches configured cluster tenant: yes');
        expect(output).toContain('login.microsoftonline.us (usgov)');
        expect(output).toContain('Token acquisition (ms): 1234');
        expect(output).toContain('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    });

    it.each([1, 2, 3] as const)('projects hostile custom, error and context values at step %s', (step) => {
        const malicious = `${secret} mongodb://${host}/${id} \`\`\`\nraw`;
        const output = formatPreviewReport(report({
            step, extensionVersion: malicious, vscodeVersion: malicious, startupCorrelationId: malicious,
            timestamp: malicious, platform: malicious, arch: malicious,
            resolved: { ...resolved, resource: `https://${host}`, details: {
                authProvider: malicious, configuredCloud: malicious, hostCloud: malicious,
                brokerImplementation: malicious, imdsAzEnvironment: malicious, arbitrary: malicious,
                tokenResource: `https://${host}`,
            } },
            token: jwt({ aud: `https://${host}`, iss: `https://${host}/${id}`, tid: id, azp: id, ver: malicious }),
            error: Object.assign(new Error(malicious), { name: malicious, code: malicious, codeName: malicious }),
            diagnosis: { providerId: malicious, message: malicious },
            probes: [{ probe: 'ping', ok: false, error: new Error(malicious) }],
        }));
        expect(output).not.toContain(secret);
        expect(output).not.toContain(id);
        expect(output).not.toContain(host);
        expect(output).not.toContain('mongodb://');
        expect(output.match(/```/g)).toHaveLength(2);
    });

    it('projects resolution failures instead of copying their details or raw message', () => {
        const output = formatPreviewReport(report({
            step: 1, resolved: undefined,
            error: new TokenResourceResolutionError(secret, 'cloudMismatch', {
                hostCloud: 'AzureUSGovernment', tokenResource: `https://${host}`, configuredCloud: secret,
            }),
        }));
        expect(output).toContain('This cluster is in');
        expect(output).toContain('*.azure.us');
        expect(output).not.toContain(secret);
        expect(output).not.toContain(host);
    });

    it('uses describeAuthError and the existing classifier without raw MSAL text', () => {
        const output = formatPreviewReport(report({ error: new Error(`AADSTS65002 ${secret} ${host}`) }));
        expect(output).toContain('aadsts=AADSTS65002');
        expect(output).toContain('firstPartyPreauthorization');
        expect(output).toContain('Only Microsoft can change this');
        expect(output).not.toContain(secret);
        expect(output).not.toContain(host);
    });

    it.each([
        [{ code: 18, codeName: 'AuthenticationFailed' }, 'rejected authentication'],
        [{ code: 'ENOTFOUND', name: 'MongoNetworkError' }, 'network or timeout'],
        [{ code: id, name: secret, codeName: host }, 'no conclusion'],
    ])('categorizes driver metadata safely: %j', (fields, expected) => {
        const rows = JSON.stringify(connectionFailureRows(Object.assign(new Error(secret), fields)));
        expect(rows).toContain(expected);
        expect(rows).not.toContain(secret);
        expect(rows).not.toContain(host);
        expect(rows).not.toContain(id);
    });

    it('explains an allowlist rejection without echoing its rejected host', () => {
        const rows = JSON.stringify(connectionFailureRows(new Error(
            `Host '${host}' is not valid for OIDC authentication with ALLOWED_HOSTS of '*.azure.us'`,
        )));
        expect(rows).toContain('token was not sent');
        expect(rows).not.toContain(host);
    });
});

describe('local token claim classifications', () => {
    it.each(['', 'opaque', 'a.!.c', 'a.e30=.c', jwt(null), jwt([]), 'a.ey.c'])('handles malformed or opaque tokens: %s', (token) => {
        expect(JSON.stringify(describeTokenClaims(token, resource))).toContain('malformed or opaque');
    });

    it.each([
        ['https://login.microsoftonline.com/tenant', 'public'],
        ['https://sts.windows.net/tenant', 'public'],
        ['https://login.microsoftonline.us/tenant', 'usgov'],
        ['https://login.chinacloudapi.cn/tenant', 'china'],
        [`https://${host}/tenant`, 'unknown issuer'],
        [`https://login.microsoftonline.us.${host}/tenant`, 'unknown issuer'],
        ['not a URL', 'unknown issuer'],
        ['https://constructor/tenant', 'unknown issuer'],
    ])('classifies only known issuer hosts: %s', (iss, expected) => {
        const output = JSON.stringify(describeTokenClaims(jwt({ aud: resource, iss }), resource));
        expect(output).toContain(expected);
        expect(output).not.toContain(host);
    });

    it.each([
        [undefined, undefined, false, 'other', 'not configured'],
        [id, 'different', false, 'other', 'no'],
        ['14d82eec-204b-4c2f-b7e8-296a70dab67e', id, false, 'other', 'yes'],
        ['aebc6443-996d-45c2-90f0-388ff96faa56', id, false, 'VS Code', 'yes'],
        [id, id, true, 'managed identity', 'yes'],
    ])('classifies clients and tenant presence/matches without identifiers', (appid, tenant, managedIdentity, client, match) => {
        const rows = Object.fromEntries(describeTokenClaims(jwt({ aud: resource, appid, tid: id }), resource, tenant, managedIdentity));
        expect(rows['Client category']).toBe(client);
        expect(rows['Tenant matches configured cluster tenant']).toBe(match);
        expect(JSON.stringify(rows)).not.toContain(id);
    });

    it('categorizes unknown audiences and unapproved versions but still compares custom resources', () => {
        const rows = Object.fromEntries(describeTokenClaims(jwt({
            aud: `https://${host}`, iss: `https://${host}/${id}`, ver: secret,
        }), `https://${host}`));
        expect(rows['Audience matches']).toBe('yes');
        expect(rows['Token audience (aud)']).toBe('custom resource (value withheld)');
        expect(rows['Token version']).toBe('other');
        expect(JSON.stringify(rows)).not.toContain(host);
        expect(JSON.stringify(rows)).not.toContain(secret);
    });
});
