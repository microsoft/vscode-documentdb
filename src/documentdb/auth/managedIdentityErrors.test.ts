/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { classifyManagedIdentityError, describeManagedIdentityError } from './managedIdentityErrors';

describe('classifyManagedIdentityError', () => {
    it('detects the multiple-identity case', () => {
        expect(
            classifyManagedIdentityError(
                new Error('Multiple user assigned identities exist, please specify the clientId'),
            ),
        ).toBe('multipleIdentities');
    });

    it('detects an unreachable identity endpoint', () => {
        const error = new Error('ManagedIdentityCredential is unavailable. No response received.');
        error.name = 'CredentialUnavailableError';
        expect(classifyManagedIdentityError(error)).toBe('noEndpoint');
    });

    it('detects an identity that is not assigned to the machine', () => {
        expect(classifyManagedIdentityError(new Error('Identity not found'))).toBe('identityNotAssigned');
    });

    it('looks through the cause chain, because MSAL wraps the informative message', () => {
        const inner = new Error('Multiple managed identities are configured on this resource');
        const outer = new Error('Authentication failed', { cause: inner });
        expect(classifyManagedIdentityError(outer)).toBe('multipleIdentities');
    });

    it('falls back to "other" for anything unrecognized', () => {
        expect(classifyManagedIdentityError(new Error('something went sideways'))).toBe('other');
        expect(classifyManagedIdentityError(undefined)).toBe('other');
        expect(classifyManagedIdentityError({})).toBe('other');
    });
});

describe('describeManagedIdentityError', () => {
    it('names the cause and the remedy for the multiple-identity incident', () => {
        const message = describeManagedIdentityError(new Error('multiple user assigned identities'));
        expect(message).toMatch(/more than one managed identity/i);
        expect(message).toMatch(/client ID/i);
    });

    it('names the Azure VM requirement when no endpoint answered', () => {
        const error = new Error('CredentialUnavailableError: no response');
        expect(describeManagedIdentityError(error)).toMatch(/Azure VM/);
    });

    it('includes the client ID when a specific identity is not assigned', () => {
        const message = describeManagedIdentityError(new Error('Identity not found'), 'abc-123');
        expect(message).toContain('abc-123');
    });

    it('omits the client ID placeholder for a system-assigned identity', () => {
        const message = describeManagedIdentityError(new Error('Identity not found'));
        expect(message).toMatch(/not assigned to this machine/);
        expect(message).not.toContain('{0}');
    });

    it('passes unrecognized failures through with a prefix', () => {
        expect(describeManagedIdentityError(new Error('boom'))).toBe('Managed Identity authentication failed: boom');
    });

    it('never throws for a non-Error input', () => {
        expect(() => describeManagedIdentityError('plain string')).not.toThrow();
        expect(() => describeManagedIdentityError(null)).not.toThrow();
    });
});
