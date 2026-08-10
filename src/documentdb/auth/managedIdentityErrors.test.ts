/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { classifyManagedIdentityError, describeManagedIdentityError } from './managedIdentityErrors';

/**
 * Messages captured from the real credential by `managedIdentityEndpoint.harness.test.ts`. Every
 * one of them arrives as a `CredentialUnavailableError`, which is why the name is not a signal.
 */
const OBSERVED = {
    multipleIdentities:
        'ManagedIdentityCredential: Authentication failed. Message invalid_request: Error(s): Not Available - Timestamp: Not Available - Description: Multiple user assigned identities exist, please specify the clientId / resourceId of the identity in the token request - Correlation ID: Not Available',
    identityNotFound:
        'ManagedIdentityCredential: Authentication failed. Message invalid_request: Error(s): Not Available - Timestamp: Not Available - Description: Identity not found - Correlation ID: Not Available',
    unreachable:
        'ManagedIdentityCredential: Network unreachable. Message: network_error: See https://aka.ms/msal.js.errors#network_error for details',
};

function credentialUnavailable(message: string): Error {
    const error = new Error(message);
    error.name = 'CredentialUnavailableError';
    return error;
}

describe('classifyManagedIdentityError', () => {
    it('detects the multiple-identity case', () => {
        expect(classifyManagedIdentityError(credentialUnavailable(OBSERVED.multipleIdentities))).toBe(
            'multipleIdentities',
        );
    });

    it('detects an unreachable identity endpoint', () => {
        expect(classifyManagedIdentityError(credentialUnavailable(OBSERVED.unreachable))).toBe('noEndpoint');
    });

    it('detects an identity that is not assigned to the machine', () => {
        expect(classifyManagedIdentityError(credentialUnavailable(OBSERVED.identityNotFound))).toBe(
            'identityNotAssigned',
        );
    });

    it('does not treat the shared CredentialUnavailableError name as a signal on its own', () => {
        // All three real cases share this name, so a name-only match would misclassify every one of
        // them as "no endpoint".
        expect(classifyManagedIdentityError(credentialUnavailable('something entirely new'))).toBe('other');
    });

    it('looks through the cause chain, because MSAL wraps the informative message', () => {
        const inner = { name: 'ServerError', errorMessage: 'Description: Multiple managed identities are configured' };
        const outer = credentialUnavailable('Authentication failed');
        (outer as Error & { cause?: unknown }).cause = inner;

        expect(classifyManagedIdentityError(outer)).toBe('multipleIdentities');
    });

    it('reads a duck-typed error that lost its prototype crossing a worker boundary', () => {
        expect(
            classifyManagedIdentityError({ name: 'CredentialUnavailableError', message: OBSERVED.unreachable }),
        ).toBe('noEndpoint');
    });

    it('falls back to "other" for anything unrecognized', () => {
        expect(classifyManagedIdentityError(new Error('something went sideways'))).toBe('other');
        expect(classifyManagedIdentityError(undefined)).toBe('other');
        expect(classifyManagedIdentityError({})).toBe('other');
    });
});

describe('describeManagedIdentityError', () => {
    it('names the cause and the remedy for the multiple-identity incident', () => {
        const message = describeManagedIdentityError(credentialUnavailable(OBSERVED.multipleIdentities));
        expect(message).toMatch(/more than one managed identity/i);
        expect(message).toMatch(/client ID/i);
    });

    it('names the Azure VM requirement when no endpoint answered', () => {
        expect(describeManagedIdentityError(credentialUnavailable(OBSERVED.unreachable))).toMatch(/Azure VM/);
    });

    it('includes the client ID when a specific identity is not assigned', () => {
        const message = describeManagedIdentityError(credentialUnavailable(OBSERVED.identityNotFound), 'abc-123');
        expect(message).toContain('abc-123');
    });

    it('omits the client ID placeholder for a system-assigned identity', () => {
        const message = describeManagedIdentityError(credentialUnavailable(OBSERVED.identityNotFound));
        expect(message).toMatch(/not assigned to this machine/);
        expect(message).not.toContain('{0}');
    });

    it('passes unrecognized failures through with a prefix and without the error name', () => {
        expect(describeManagedIdentityError(new Error('boom'))).toBe('Managed Identity authentication failed: boom');
    });

    it('never throws for a non-Error input', () => {
        expect(() => describeManagedIdentityError('plain string')).not.toThrow();
        expect(() => describeManagedIdentityError(null)).not.toThrow();
    });
});
