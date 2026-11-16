/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { info: vi.fn(), error: vi.fn() } },
}));

import { type CachedClusterCredentials } from '../CredentialCache';
import { AuthMethodId } from './AuthMethod';
import { AuthInputUnavailableError, createAuthHandler, type AuthCallerPolicy } from './createAuthHandler';
import { ManagedIdentityAuthHandler } from './ManagedIdentityAuthHandler';
import { MicrosoftEntraIDAuthHandler } from './MicrosoftEntraIDAuthHandler';
import { NativeAuthHandler } from './NativeAuthHandler';
import { NoAuthHandler } from './NoAuthHandler';

const credentials: CachedClusterCredentials = {
    clusterId: 'cluster-1',
    connectionString: 'mongodb://localhost:27017/',
    connectionStringWithPassword: 'mongodb://localhost:27017/',
};

describe('createAuthHandler', () => {
    it.each([
        [AuthMethodId.NativeAuth, NativeAuthHandler],
        [AuthMethodId.MicrosoftEntraID, MicrosoftEntraIDAuthHandler],
        [AuthMethodId.ManagedIdentity, ManagedIdentityAuthHandler],
        [AuthMethodId.NoAuth, NoAuthHandler],
    ] as const)('maps %s to its handler', (authMethod, handlerClass) => {
        expect(createAuthHandler(authMethod, credentials, { interactive: true })).toBeInstanceOf(handlerClass);
    });

    it('throws the existing message for an unsupported method', () => {
        expect(() => createAuthHandler('Kerberos' as AuthMethodId, credentials, { interactive: true })).toThrow(
            'Unsupported authentication method: Kerberos',
        );
    });

    it.each([
        AuthMethodId.NativeAuth,
        AuthMethodId.MicrosoftEntraID,
        AuthMethodId.ManagedIdentity,
        AuthMethodId.NoAuth,
    ])('passes the caller policy to the %s handler', (authMethod) => {
        const policy: AuthCallerPolicy = { interactive: false, observer: {} };
        const handler = createAuthHandler(authMethod, credentials, policy);
        expect(handler).toHaveProperty('policy', policy);
        expect((handler as unknown as { readonly policy: AuthCallerPolicy }).policy).toBe(policy);
    });

    it('defaults directly constructed handlers to the interactive policy', () => {
        for (const handler of [
            new NativeAuthHandler(credentials),
            new MicrosoftEntraIDAuthHandler(credentials),
            new ManagedIdentityAuthHandler(credentials),
            new NoAuthHandler(credentials),
        ]) {
            expect(handler.policy).toEqual({ interactive: true });
        }
    });
});

describe('AuthInputUnavailableError', () => {
    it('names what is missing', () => {
        const error = new AuthInputUnavailableError('entraSession');
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('AuthInputUnavailableError');
        expect(error.missing).toBe('entraSession');
    });
});
