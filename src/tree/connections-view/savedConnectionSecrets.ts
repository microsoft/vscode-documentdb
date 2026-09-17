/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type EntraIdAuthConfig, type ManagedIdentityAuthConfig } from '../../documentdb/auth/AuthConfig';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { type ConnectionSecrets } from '../../services/connectionStorageService';

interface SavedConnectionSecretsInput {
    readonly connectionString: string;
    readonly authMethod: AuthMethodId;
    readonly username?: string;
    readonly password?: string;
    readonly entraIdAuthConfig?: EntraIdAuthConfig;
    readonly managedIdentityAuthConfig?: ManagedIdentityAuthConfig;
}

export function buildSavedConnectionSecrets(input: SavedConnectionSecretsInput): ConnectionSecrets {
    return {
        connectionString: input.connectionString,
        nativeAuthConfig:
            input.authMethod === AuthMethodId.NativeAuth && (input.username || input.password)
                ? {
                      connectionUser: input.username ?? '',
                      connectionPassword: input.password ?? '',
                  }
                : undefined,
        entraIdAuthConfig:
            input.authMethod === AuthMethodId.MicrosoftEntraID ? input.entraIdAuthConfig : undefined,
        managedIdentityAuthConfig:
            input.authMethod === AuthMethodId.ManagedIdentity ? (input.managedIdentityAuthConfig ?? {}) : undefined,
    };
}