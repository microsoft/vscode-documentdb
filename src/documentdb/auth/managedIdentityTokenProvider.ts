/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TokenCredential } from '@azure/identity';
import { describeManagedIdentityError } from './managedIdentityErrors';

/**
 * One credential per identity, for the lifetime of the window.
 *
 * `ManagedIdentityCredential` keeps its own token cache, and for managed identity a cache miss is a
 * real network round trip to the identity endpoint, unlike the interactive path where the VS Code
 * session is already cached. Reusing the credential is what makes that cache useful.
 */
const credentialsByClientId = new Map<string, TokenCredential>();

/**
 * Acquires a managed identity access token on the main thread.
 *
 * Worker threads request tokens over IPC rather than importing `@azure/identity` themselves, so that
 * there is a single credential and a single token cache per window.
 *
 * @throws An error whose message is already user-readable (see `describeManagedIdentityError`).
 */
export async function getManagedIdentityAccessToken(
    scopes: string[],
    clientId: string | undefined,
): Promise<{ accessToken: string; expiresOnTimestamp: number }> {
    const credential = await getCredential(clientId);

    let token: { token: string; expiresOnTimestamp: number } | null;
    try {
        token = await credential.getToken(scopes);
    } catch (error) {
        throw new Error(describeManagedIdentityError(error, clientId));
    }

    if (!token) {
        throw new Error(describeManagedIdentityError(undefined, clientId));
    }

    return { accessToken: token.token, expiresOnTimestamp: token.expiresOnTimestamp };
}

async function getCredential(clientId: string | undefined): Promise<TokenCredential> {
    const key = clientId ?? '';
    const cached = credentialsByClientId.get(key);
    if (cached) {
        return cached;
    }

    // Dynamic import: @azure/identity pulls in MSAL and must stay out of the activation path.
    const { ManagedIdentityCredential } = await import('@azure/identity');
    const credential = clientId ? new ManagedIdentityCredential({ clientId }) : new ManagedIdentityCredential();
    credentialsByClientId.set(key, credential);
    return credential;
}
