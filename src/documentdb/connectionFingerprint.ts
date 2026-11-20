/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

export type ConnectionPrincipal =
    | { kind: 'native'; username: string }
    | { kind: 'entra'; providerId: string; accountId: string; tenantId?: string }
    | { kind: 'managedIdentity'; clientId?: string }
    | { kind: 'none' };

export function computeConnectionFingerprint(input: {
    connectionString: string;
    principal: ConnectionPrincipal;
}): string {
    // Match only the password in the URI authority, without decoding or reserializing the URI.
    const uri = input.connectionString.replace(/^([^:/?#]+:\/\/[^:/?#@]*:)[^/?#@]*(?=@)/, '$1');
    const identity = JSON.stringify([uri, principalParts(input.principal)]);
    return createHash('sha256').update(identity).digest('hex').slice(0, 32);
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
