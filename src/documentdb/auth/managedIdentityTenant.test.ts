/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const reportManagedIdentityFailureReason = jest.fn();
jest.mock('./managedIdentityTelemetry', () => ({
    reportManagedIdentityFailureReason: (...args: unknown[]) => reportManagedIdentityFailureReason(...args),
}));

import { readTenantIdFromAccessToken, verifyManagedIdentityTenant } from './managedIdentityTenant';

const CLUSTER_TENANT = 'aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';
const OTHER_TENANT = 'cccccccc-4444-5555-6666-dddddddddddd';
const CLIENT_ID = '11111111-2222-3333-4444-555555555555';

/** Builds an unsigned token whose payload carries the given claims. Only the payload is ever read. */
function tokenWithClaims(claims: Record<string, unknown>): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `header.${payload}.signature`;
}

describe('readTenantIdFromAccessToken', () => {
    it('reads the tid claim', () => {
        expect(readTenantIdFromAccessToken(tokenWithClaims({ tid: CLUSTER_TENANT }))).toBe(CLUSTER_TENANT);
    });

    it('returns undefined when there is no tid claim', () => {
        expect(readTenantIdFromAccessToken(tokenWithClaims({ oid: 'something' }))).toBeUndefined();
    });

    it('never throws on a malformed token', () => {
        expect(readTenantIdFromAccessToken('not-a-token')).toBeUndefined();
        expect(readTenantIdFromAccessToken('')).toBeUndefined();
        expect(readTenantIdFromAccessToken('a.!!!not-base64!!!.c')).toBeUndefined();
    });
});

describe('verifyManagedIdentityTenant', () => {
    beforeEach(() => {
        reportManagedIdentityFailureReason.mockReset();
    });

    it('throws a message naming both tenants when they differ', () => {
        const token = tokenWithClaims({ tid: OTHER_TENANT });

        expect(() => verifyManagedIdentityTenant(token, CLUSTER_TENANT, CLIENT_ID)).toThrow(
            /cannot authenticate across tenants/i,
        );

        try {
            verifyManagedIdentityTenant(token, CLUSTER_TENANT, CLIENT_ID);
        } catch (error) {
            const message = error instanceof Error ? error.message : '';
            expect(message).toContain(OTHER_TENANT);
            expect(message).toContain(CLUSTER_TENANT);
        }
    });

    it('reports the tenantMismatch reason', () => {
        expect(() =>
            verifyManagedIdentityTenant(tokenWithClaims({ tid: OTHER_TENANT }), CLUSTER_TENANT, CLIENT_ID),
        ).toThrow();

        expect(reportManagedIdentityFailureReason).toHaveBeenCalledWith('tenantMismatch', CLIENT_ID);
    });

    it('accepts a matching tenant', () => {
        expect(() =>
            verifyManagedIdentityTenant(tokenWithClaims({ tid: CLUSTER_TENANT }), CLUSTER_TENANT, undefined),
        ).not.toThrow();
    });

    it('compares tenants case insensitively', () => {
        expect(() =>
            verifyManagedIdentityTenant(
                tokenWithClaims({ tid: CLUSTER_TENANT.toUpperCase() }),
                CLUSTER_TENANT,
                undefined,
            ),
        ).not.toThrow();
    });

    it('does nothing when the cluster tenant is unknown, which is the pasted connection string case', () => {
        expect(() =>
            verifyManagedIdentityTenant(tokenWithClaims({ tid: OTHER_TENANT }), undefined, undefined),
        ).not.toThrow();
        expect(reportManagedIdentityFailureReason).not.toHaveBeenCalled();
    });

    it('does nothing when the token carries no tid, so a format change cannot break sign-in', () => {
        expect(() => verifyManagedIdentityTenant(tokenWithClaims({}), CLUSTER_TENANT, undefined)).not.toThrow();
        expect(() => verifyManagedIdentityTenant('garbage', CLUSTER_TENANT, undefined)).not.toThrow();
        expect(reportManagedIdentityFailureReason).not.toHaveBeenCalled();
    });
});
