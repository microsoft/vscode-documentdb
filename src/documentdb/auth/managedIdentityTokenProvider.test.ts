/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getManagedIdentityAccessToken } from './managedIdentityTokenProvider';

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

    it('constructs one credential for concurrent first requests to the same identity', async () => {
        const clientId = 'abcdefab-1234-5678-90ab-abcdefabcdef';

        await Promise.all([
            getManagedIdentityAccessToken(['scope'], clientId),
            getManagedIdentityAccessToken(['scope'], clientId),
        ]);

        expect(mockManagedIdentityCredential).toHaveBeenCalledTimes(1);
        expect(mockManagedIdentityCredential).toHaveBeenCalledWith({ clientId });
        expect(mockGetToken).toHaveBeenCalledTimes(2);
    });
});