/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type DocumentDBConnectionString } from '../utils/DocumentDBConnectionString';
import { DOCUMENTDB_TOKEN_RESOURCE } from './entraScopes';

/**
 * The `authMechanismProperties` entry that marks a connection string as using the driver-native
 * Azure machine flow. We read it, we write it, and we never hand it to the driver (decision D1).
 */
export const AZURE_ENVIRONMENT_PROPERTY = 'ENVIRONMENT:azure';

/** The full `authMechanismProperties` value emitted by `Copy Connection String` (decision D1a). */
export const MANAGED_IDENTITY_AUTH_MECHANISM_PROPERTIES = `ENVIRONMENT:azure,TOKEN_RESOURCE:${DOCUMENTDB_TOKEN_RESOURCE}`;

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What the connection string states, without interpreting or recommending an authentication flow. */
export interface ConnectionStringAuthFacts {
    readonly usesOidc: boolean;
    readonly declaresAzureMachineWorkflow: boolean;
    readonly tokenResource?: string;
    readonly username?: string;
    readonly usernameIsGuid: boolean;
}

/**
 * Reads authentication facts out of a pasted connection string.
 *
 * Must be called **before** any credential-stripping, because an identity can ride in the username
 * position and is gone once the username is cleared.
 */
export function getConnectionStringAuthFacts(cs: DocumentDBConnectionString): ConnectionStringAuthFacts {
    const username = (cs.username ?? '').trim() || undefined;
    const mechanismProperties = getAuthMechanismProperties(cs);

    return {
        usesOidc: (cs.searchParams.get('authMechanism') ?? '').trim().toUpperCase() === 'MONGODB-OIDC',
        declaresAzureMachineWorkflow: mechanismProperties.some(
            ([key, value]) => key.toUpperCase() === 'ENVIRONMENT' && value.toLowerCase() === 'azure',
        ),
        tokenResource: mechanismProperties.find(([key]) => key.toUpperCase() === 'TOKEN_RESOURCE')?.[1],
        username,
        usernameIsGuid: username ? GUID_PATTERN.test(username) : false,
    };
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

function getAuthMechanismProperties(cs: DocumentDBConnectionString): Array<[string, string]> {
    const raw = cs.searchParams.get('authMechanismProperties');
    if (!raw) {
        return [];
    }

    return raw.split(',').map((entry): [string, string] => {
        const separatorIndex = entry.indexOf(':');
        if (separatorIndex < 0) {
            return [entry.trim(), ''];
        }

        return [entry.slice(0, separatorIndex).trim(), entry.slice(separatorIndex + 1).trim()];
    });
}
