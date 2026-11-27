/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHmac, generateKeySync } from 'node:crypto';

const connectionFingerprintKey = generateKeySync('hmac', { length: 256 });

export type ConnectionPrincipal =
    | { kind: 'native'; username: string }
    | { kind: 'entra'; providerId: string; accountId: string; tenantId?: string }
    | { kind: 'managedIdentity'; clientId?: string }
    | { kind: 'none' };

/** An opaque equality key for the current extension host, not a password verifier. See .github/codeql-exceptions.md. */
export function computeConnectionFingerprint(input: {
    connectionString: string;
    principal: ConnectionPrincipal;
}): string {
    // Match only the password in the URI authority, without decoding or reserializing the URI.
    const uriWithoutAuthorityPassword = input.connectionString.replace(/^([^:/?#]+:\/\/[^:/?#@]*:)[^/?#@]*(?=@)/, '$1');
    const identityMaterial = JSON.stringify([uriWithoutAuthorityPassword, principalParts(input.principal)]);
    return createHmac('sha256', connectionFingerprintKey).update(identityMaterial).digest('hex').slice(0, 32);
}

function principalParts(principal: ConnectionPrincipal): readonly (string | null)[] {
    switch (principal.kind) {
        case 'native':
            return [principal.kind, principal.username];
        case 'entra':
            return [principal.kind, principal.providerId, principal.accountId, principal.tenantId ?? null];
        case 'managedIdentity':
            // A missing client ID denotes system-assigned, not a particular instance of that identity.
            return [principal.kind, principal.clientId ?? null];
        case 'none':
            return [principal.kind];
    }
}
