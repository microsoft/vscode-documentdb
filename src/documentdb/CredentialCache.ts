/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ConnectionItem } from '../services/connectionStorageService';
import { CaseInsensitiveMap } from '../utils/CaseInsensitiveMap';
import { type EmulatorConfiguration } from '../utils/emulatorConfiguration';
import { type EntraIdAuthConfig, type NativeAuthConfig } from './auth/AuthConfig';
import { AuthMethodId, type AuthMethodId as AuthMethodIdType } from './auth/AuthMethod';
import { addAuthenticationDataToConnectionString } from './utils/connectionStringHelpers';

export interface CachedClusterCredentials {
    mongoClusterId: string;
    connectionStringWithPassword?: string;
    connectionString: string;

    authMechanism?: AuthMethodIdType;
    // Optional, as it's only relevant for local workspace connetions
    emulatorConfiguration?: EmulatorConfiguration;

    // Authentication method specific configurations
    nativeAuthConfig?: NativeAuthConfig;
    entraIdConfig?: EntraIdAuthConfig;
}

/**
 * @deprecated Use CachedClusterCredentials instead. This alias is provided for backward compatibility.
 */
export type ClustersCredentials = CachedClusterCredentials;

export class CredentialCache {
    // the id of the cluster === the tree item id -> cluster credentials
    // Some SDKs for azure differ the case on some resources ("DocumentDb" vs "DocumentDB")
    private static _store: CaseInsensitiveMap<CachedClusterCredentials> = new CaseInsensitiveMap();

    public static getConnectionStringWithPassword(mongoClusterId: string): string {
        return CredentialCache._store.get(mongoClusterId)?.connectionStringWithPassword as string;
    }

    public static hasCredentials(mongoClusterId: string): boolean {
        return CredentialCache._store.has(mongoClusterId) as boolean;
    }

    public static getEmulatorConfiguration(mongoClusterId: string): EmulatorConfiguration | undefined {
        return CredentialCache._store.get(mongoClusterId)?.emulatorConfiguration;
    }

    public static getEntraIdConfig(mongoClusterId: string): EntraIdAuthConfig | undefined {
        return CredentialCache._store.get(mongoClusterId)?.entraIdConfig;
    }

    public static getNativeAuthConfig(mongoClusterId: string): NativeAuthConfig | undefined {
        return CredentialCache._store.get(mongoClusterId)?.nativeAuthConfig;
    }

    /**
     * Gets the connection user for native authentication.
     * Returns undefined for non-native authentication methods like Entra ID.
     */
    public static getConnectionUser(mongoClusterId: string): string | undefined {
        return CredentialCache._store.get(mongoClusterId)?.nativeAuthConfig?.connectionUser;
    }

    /**
     * Gets the connection password for native authentication.
     * Returns undefined for non-native authentication methods like Entra ID.
     */
    public static getConnectionPassword(mongoClusterId: string): string | undefined {
        return CredentialCache._store.get(mongoClusterId)?.nativeAuthConfig?.connectionPassword;
    }

    public static getCredentials(mongoClusterId: string): CachedClusterCredentials | undefined {
        return CredentialCache._store.get(mongoClusterId);
    }

    public static deleteCredentials(mongoClusterId: string): void {
        CredentialCache._store.delete(mongoClusterId);
    }

    /**
     * Sets the credentials for a given connection string and stores them in the credential cache.
     *
     * @deprecated Use {@link CredentialCache.setAuthCredentials} instead and provide an explicit AuthMethod.
     *
     * @param id - The credential id. It's supposed to be the same as the tree item id of the mongo cluster item to simplify the lookup.
     * @param connectionString - The connection string to which the credentials will be added.
     * @param username - The username to be used for authentication.
     * @param password - The password to be used for authentication.
     * @param emulatorConfiguration - The emulator configuration object (optional).
     */
    public static setCredentials(
        mongoClusterId: string,
        connectionString: string,
        username: string,
        password: string,
        emulatorConfiguration?: EmulatorConfiguration,
    ): void {
        console.warn(
            'CredentialCache.setCredentials is deprecated. Please migrate to CredentialCache.setAuthCredentials and provide an explicit AuthMethod.',
        );

        const connectionStringWithPassword = addAuthenticationDataToConnectionString(
            connectionString,
            username,
            password,
        );

        const credentials: CachedClusterCredentials = {
            mongoClusterId: mongoClusterId,
            connectionStringWithPassword: connectionStringWithPassword,
            connectionString: connectionString,
            nativeAuthConfig: {
                connectionUser: username,
                connectionPassword: password,
            },
            emulatorConfiguration: emulatorConfiguration,
        };

        CredentialCache._store.set(mongoClusterId, credentials);
    }

    /**
     * New implementation of setCredentials that adds support for authentication methods (authMechanism).
     * Introduced during the Entra ID integration to support Entra/Microsoft identity and other authentication flows.
     * This stores authentication-aware credentials for a given cluster in the cache.
     *
     * NOTE: The original `setCredentials` remains for compatibility but will be deprecated in a future change.
     *
     * @param mongoClusterId - The credential id. It's supposed to be the same as the tree item id of the mongo cluster item to simplify the lookup.
     * @param authMethod - The authentication method/mechanism to be used (e.g. SCRAM, X509, Azure/Entra flows).
     * @param connectionString - The connection string to which optional credentials will be added.
     * @param username - The username to be used for authentication (optional for some auth methods).
     * @param password - The password to be used for authentication (optional for some auth methods).
     * @param emulatorConfiguration - The emulator configuration object (optional, only relevant for local workspace connections).
     * @param entraIdConfig - The Entra ID configuration object (optional, only relevant for Microsoft Entra ID authentication).
     */
    public static setAuthCredentials(
        mongoClusterId: string,
        authMethod: AuthMethodIdType,
        connectionString: string,
        username: string = '',
        password: string = '',
        emulatorConfiguration?: EmulatorConfiguration,
        entraIdConfig?: EntraIdAuthConfig,
    ): void {
        const connectionStringWithPassword = addAuthenticationDataToConnectionString(
            connectionString,
            username,
            password,
        );

        const credentials: CachedClusterCredentials = {
            mongoClusterId: mongoClusterId,
            connectionStringWithPassword: connectionStringWithPassword,
            connectionString: connectionString,
            emulatorConfiguration: emulatorConfiguration,
            authMechanism: authMethod,
            entraIdConfig: entraIdConfig,
        };

        // Add native auth config only for non-Entra ID authentication methods
        if (authMethod !== AuthMethodId.MicrosoftEntraID && (username || password)) {
            credentials.nativeAuthConfig = {
                connectionUser: username,
                connectionPassword: password,
            };
        }

        CredentialCache._store.set(mongoClusterId, credentials);
    }

    /**
     * Bridge method to convert ConnectionItem's structured auth secrets into the runtime cache format.
     * This method handles the conversion between persistent storage (ConnectionItem) and memory cache (CachedClusterCredentials).
     *
     * The conversion handles:
     * - Determining auth method from available configurations
     * - Converting central auth configs to local cache format
     * - Maintaining backward compatibility with legacy username/password
     *
     * @param connectionItem - The persistent connection item with structured auth secrets
     * @param authMethod - Optional explicit auth method; if not provided, will be inferred from available configs
     * @param emulatorConfiguration - Optional emulator configuration for local connections
     */
    public static setFromConnectionItem(
        connectionItem: ConnectionItem,
        authMethod?: AuthMethodIdType,
        emulatorConfiguration?: EmulatorConfiguration,
    ): void {
        const { secrets } = connectionItem;

        // Determine auth method if not explicitly provided
        let selectedAuthMethod = authMethod;
        if (!selectedAuthMethod) {
            if (secrets.entraIdAuth) {
                selectedAuthMethod = AuthMethodId.MicrosoftEntraID;
            } else if (secrets.nativeAuth || secrets.userName || secrets.password) {
                selectedAuthMethod = AuthMethodId.NativeAuth;
            } else {
                // Use the selected method from properties or first available method
                selectedAuthMethod =
                    (connectionItem.properties.selectedAuthMethod as AuthMethodIdType) ??
                    (connectionItem.properties.availableAuthMethods[0] as AuthMethodIdType) ??
                    AuthMethodId.NativeAuth;
            }
        }

        // Convert central auth configs to local cache format
        let cacheEntraIdConfig: EntraIdAuthConfig | undefined;
        if (secrets.entraIdAuth) {
            cacheEntraIdConfig = {
                tenantId: secrets.entraIdAuth.tenantId ?? '', // Convert optional to required for backward compatibility
            };
        }

        // Use structured configs first, fall back to legacy fields
        const username = secrets.nativeAuth?.connectionUser ?? secrets.userName ?? '';
        const password = secrets.nativeAuth?.connectionPassword ?? secrets.password ?? '';

        // Use the existing setAuthCredentials method to ensure consistent behavior
        CredentialCache.setAuthCredentials(
            connectionItem.id,
            selectedAuthMethod,
            secrets.connectionString,
            username,
            password,
            emulatorConfiguration,
            cacheEntraIdConfig,
        );
    }
}
