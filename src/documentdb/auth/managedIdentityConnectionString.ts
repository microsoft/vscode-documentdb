/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { type ManagedIdentityAuthConfig } from './AuthConfig';
import { DOCUMENTDB_TOKEN_RESOURCE } from './entraScopes';

/**
 * The `authMechanismProperties` entry that marks a connection string as using the driver-native
 * Azure machine flow. We read it, we write it, and we never hand it to the driver (decision D1).
 */
export const AZURE_ENVIRONMENT_PROPERTY = 'ENVIRONMENT:azure';

/** The full `authMechanismProperties` value emitted by `Copy Connection String` (decision D1a). */
export const MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES = `ENVIRONMENT:azure,TOKEN_RESOURCE:${DOCUMENTDB_TOKEN_RESOURCE}`;

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ManagedIdentityHint {
    /** Client ID taken from the username position, when it is GUID-shaped. */
    readonly clientId?: string;
    /**
     * `explicit` when `ENVIRONMENT:azure` was present, so the user's intent is unambiguous and the
     * identity prompt can be skipped. `weak` when only OIDC plus a GUID-shaped username was found,
     * which is suggestive but still worth confirming.
     */
    readonly confidence: 'explicit' | 'weak';
}

/**
 * Reads managed identity intent out of a pasted connection string.
 *
 * Must be called **before** any credential-stripping, because the client ID rides in the username
 * position and is gone once the username is cleared.
 */
export function detectManagedIdentityHint(cs: DocumentDBConnectionString): ManagedIdentityHint | undefined {
    if (!usesOidc(cs)) {
        return undefined;
    }

    const clientId = readGuidUsername(cs);

    if (hasAzureEnvironmentProperty(cs)) {
        return { clientId, confidence: 'explicit' };
    }

    if (clientId) {
        return { clientId, confidence: 'weak' };
    }

    return undefined;
}

/**
 * Removes the parts of the connection string that were inputs to the detection decision.
 *
 * They must not survive into storage: `authMechanismProperties` in the URL competes with
 * `MongoClientOptions.authMechanismProperties`, and a leftover username would later be read back as
 * a native-auth credential.
 */
export function stripManagedIdentityMarkers(cs: DocumentDBConnectionString): void {
    cs.username = '';
    cs.password = '';
    cs.searchParams.delete('authMechanism');
    cs.searchParams.delete('authMechanismProperties');
}

/** Builds the stored configuration for a hint. An empty object means the system-assigned identity. */
export function managedIdentityConfigFromHint(hint: ManagedIdentityHint): ManagedIdentityAuthConfig {
    return hint.clientId ? { clientId: hint.clientId } : {};
}

function usesOidc(cs: DocumentDBConnectionString): boolean {
    return (cs.searchParams.get('authMechanism') ?? '').trim().toUpperCase() === 'MONGODB-OIDC';
}

function hasAzureEnvironmentProperty(cs: DocumentDBConnectionString): boolean {
    const raw = cs.searchParams.get('authMechanismProperties');
    if (!raw) {
        return false;
    }

    return raw
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .includes(AZURE_ENVIRONMENT_PROPERTY.toLowerCase());
}

/**
 * Returns the username only when it is GUID-shaped.
 *
 * A username that is present but not GUID-shaped is deliberately ignored rather than guessed at:
 * the method selection still stands and the identity step gets to ask.
 */
function readGuidUsername(cs: DocumentDBConnectionString): string | undefined {
    const username = (cs.username ?? '').trim();
    return GUID_PATTERN.test(username) ? username : undefined;
}
