/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getManagedIdentityAccessToken } from './managedIdentityTokenProvider';

const mockOutputChannel = { info: jest.fn(), error: jest.fn() };
jest.mock('../../extensionVariables', () => ({
    ext: { get outputChannel(): typeof mockOutputChannel { return mockOutputChannel; } },
}));
jest.mock('./managedIdentityTelemetry', () => ({
    reportManagedIdentityTokenFailure: jest.fn(),
    reportManagedIdentityFailureReason: jest.fn(),
}));

function output(): string {
    return JSON.stringify([mockOutputChannel.info.mock.calls, mockOutputChannel.error.mock.calls]);
}

const mockGetToken = jest.fn();
const mockManagedIdentityCredential = jest.fn().mockImplementation(() => ({
    getToken: (...args: unknown[]) => mockGetToken(...args),
}));

jest.mock('@azure/identity', () => ({
    ManagedIdentityCredential: mockManagedIdentityCredential,
}));

describe('getManagedIdentityAccessToken', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetToken.mockResolvedValue({
            token: 'token',
            expiresOnTimestamp: Date.now() + 60_000,
        });
    });

    afterEach(() => {
        for (const secret of ['sensitive-client', 'sensitive-tenant', 'sensitive-token', 'sensitive-endpoint']) {
            expect(output()).not.toContain(secret);
        }
    });

    it('constructs one credential for concurrent first requests to the same identity', async () => {
        const clientId = 'abcdefab-1234-5678-90ab-abcdefabcdef';

        await Promise.all([
            getManagedIdentityAccessToken(['scope'], clientId),
            getManagedIdentityAccessToken(['scope'], clientId),
        ]);

        expect(mockManagedIdentityCredential).toHaveBeenCalledTimes(1);
        expect(mockManagedIdentityCredential).toHaveBeenCalledWith({ clientId });
        expect(mockGetToken).toHaveBeenCalledTimes(2);
        expect(output()).toContain('created');
        expect(output()).toContain('reusedAfterConcurrentImport');
    });

    it('logs system-assigned identity and credential reuse without claiming a token cache hit', async () => {
        await getManagedIdentityAccessToken(['scope'], undefined);
        await getManagedIdentityAccessToken(['scope'], undefined);

        expect(output()).toContain('systemAssigned');
        expect(output()).toContain('reused');
        expect(output()).toContain('managedIdentity.sdk.getToken');
        expect(output()).toContain('clusterTenantUnknown');
    });

    it('logs only endpoint and proxy presence, not environment values', async () => {
        const original = process.env.IDENTITY_ENDPOINT;
        process.env.IDENTITY_ENDPOINT = 'https://sensitive-endpoint/?token=sensitive-token';
        try {
            await getManagedIdentityAccessToken(['scope'], 'sensitive-client', 'sensitive-tenant');
        } finally {
            if (original === undefined) { delete process.env.IDENTITY_ENDPOINT; }
            else { process.env.IDENTITY_ENDPOINT = original; }
        }

        expect(output()).toContain('identityEndpointConfigured');
        expect(output()).toContain('userAssigned');
        expect(output()).toContain('tokenTenantUnavailable');
    });

    it.each([
        ['Multiple user assigned identities exist', 'multipleIdentities'],
        ['Network unreachable', 'endpointUnreachable'],
        ['Identity not found', 'identityNotAssigned'],
    ])('classifies SDK failure %s without raw messages', async (message, reason) => {
        mockGetToken.mockRejectedValueOnce(new Error(`${message}: sensitive-client sensitive-token`));

        await expect(getManagedIdentityAccessToken(['scope'], 'sensitive-client')).rejects.toThrow();

        expect(output()).toContain(reason);
        expect(output()).toContain('managedIdentity.sdk.getToken');
        expect(mockOutputChannel.error).toHaveBeenCalled();
    });

    it('traces an empty token response', async () => {
        mockGetToken.mockResolvedValueOnce(null);

        await expect(getManagedIdentityAccessToken(['scope'], undefined)).rejects.toThrow();

        expect(output()).toContain('emptyTokenResponse');
    });

    it.each([['sensitive-tenant', 'matched'], ['other-sensitive-tenant', 'tenantMismatch']])(
        'traces tenant verification for %s without token contents', async (clusterTenant, outcome) => {
            const token = `header.${Buffer.from(JSON.stringify({ tid: 'sensitive-tenant' })).toString('base64url')}.signature`;
            mockGetToken.mockResolvedValueOnce({ token, expiresOnTimestamp: Date.now() + 60_000 });
            const request = getManagedIdentityAccessToken(['scope'], 'sensitive-client', clusterTenant);
            if (outcome === 'matched') { await request; }
            else { await expect(request).rejects.toThrow(); }

            expect(output()).toContain(outcome);
            expect(output()).not.toContain(token);
        },
    );
});
