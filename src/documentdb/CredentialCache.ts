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
    /**
     * The stable cluster identifier used as the cache key.
     * - Connections View: storageId (UUID, stable across folder moves)
     * - Azure Resources View: Sanitized Azure Resource ID (/ replaced with _)
     *
     * ⚠️ This is NOT the tree item ID (treeId), which changes when items move.
     */
    clusterId: string;
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
    /**
     * Cache mapping cluster IDs to their authentication credentials.
     *
     * KEY: `clusterId` - The stable cluster identifier (NOT the tree item ID)
     *   - Connections View items: Use `cluster.clusterId` (= storageId, stable UUID)
     *   - Azure Resources View items: Use `cluster.clusterId` (= Azure Resource ID)
     *
     * ⚠️ WARNING: Do NOT use `treeId` or `this.id` as the cache key!
     * Tree IDs change when items are moved between folders, causing cache misses.
     *
     * VALUE: Cached credentials including connection string, auth config, etc.
     *
     * Note: Some SDKs for Azure differ the case on some resources ("DocumentDb" vs "DocumentDB"),
     * so we use a CaseInsensitiveMap for lookups.
     */
    private static _store: CaseInsensitiveMap<CachedClusterCredentials> = new CaseInsensitiveMap();

    /**
     * Gets the connection string with embedded password for the specified cluster.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   ⚠️ Use cluster.clusterId, NOT treeId.
     */
    public static getConnectionStringWithPassword(clusterId: string): string {
        return CredentialCache._store.get(clusterId)?.connectionStringWithPassword as string;
    }

    /**
     * Checks if credentials exist for the specified cluster.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   ⚠️ Use cluster.clusterId, NOT treeId.
     */
    public static hasCredentials(clusterId: string): boolean {
        return CredentialCache._store.has(clusterId) as boolean;
    }

    /**
     * Gets the emulator configuration for the specified cluster.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   ⚠️ Use cluster.clusterId, NOT treeId.
     */
    public static getEmulatorConfiguration(clusterId: string): EmulatorConfiguration | undefined {
        return CredentialCache._store.get(clusterId)?.emulatorConfiguration;
    }

    /**
     * Gets the Entra ID configuration for the specified cluster.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   ⚠️ Use cluster.clusterId, NOT treeId.
     */
    public static getEntraIdConfig(clusterId: string): EntraIdAuthConfig | undefined {
        return CredentialCache._store.get(clusterId)?.entraIdConfig;
    }

    /**
     * Gets the native authentication configuration for the specified cluster.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   ⚠️ Use cluster.clusterId, NOT treeId.
     */
    public static getNativeAuthConfig(clusterId: string): NativeAuthConfig | undefined {
        return CredentialCache._store.get(clusterId)?.nativeAuthConfig;
    }

    /**
     * Gets the connection user for native authentication.
     * Returns undefined for non-native authentication methods like Entra ID.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   ⚠️ Use cluster.clusterId, NOT treeId.
     */
    public static getConnectionUser(clusterId: string): string | undefined {
        return CredentialCache._store.get(clusterId)?.nativeAuthConfig?.connectionUser;
    }

    /**
     * Gets the connection password for native authentication.
     * Returns undefined for non-native authentication methods like Entra ID.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   ⚠️ Use cluster.clusterId, NOT treeId.
     */
    public static getConnectionPassword(clusterId: string): string | undefined {
        return CredentialCache._store.get(clusterId)?.nativeAuthConfig?.connectionPassword;
    }

    /**
     * Gets the full cached credentials for the specified cluster.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   ⚠️ Use cluster.clusterId, NOT treeId.
     */
    public static getCredentials(clusterId: string): CachedClusterCredentials | undefined {
        return CredentialCache._store.get(clusterId);
    }

    /**
     * Deletes cached credentials for the specified cluster.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   ⚠️ Use cluster.clusterId, NOT treeId.
     */
    public static deleteCredentials(clusterId: string): void {
        CredentialCache._store.delete(clusterId);
    }

    /**
     * Sets the credentials for a given connection string and stores them in the credential cache.
     *
     * @deprecated Use {@link CredentialCache.setAuthCredentials} instead and provide an explicit AuthMethod.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   - Connections View: storageId (UUID from ConnectionStorageService)
     *   - Azure Resources View: Azure Resource ID
     *   ⚠️ Do NOT pass treeId here - it changes when items move between folders.
     * @param connectionString - The connection string to which the credentials will be added.
     * @param username - The username to be used for authentication.
     * @param password - The password to be used for authentication.
     * @param emulatorConfiguration - The emulator configuration object (optional).
     */
    public static setCredentials(
        clusterId: string,
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
            clusterId: clusterId,
            connectionStringWithPassword: connectionStringWithPassword,
            connectionString: connectionString,
            nativeAuthConfig: {
                connectionUser: username,
                connectionPassword: password,
            },
            emulatorConfiguration: emulatorConfiguration,
        };

        CredentialCache._store.set(clusterId, credentials);
    }

    /**
     * Stores authentication-aware credentials for a given cluster in the cache.
     * Supports various authentication methods including Entra/Microsoft identity and SCRAM.
     *
     * @param clusterId - The stable cluster identifier for cache lookup.
     *   - Connections View: storageId (UUID from ConnectionStorageService)
     *   - Azure Resources View: Azure Resource ID
     *   ⚠️ Do NOT pass treeId here - it changes when items move between folders.
     * @param authMethod - The authentication method/mechanism to be used (e.g. SCRAM, X509, Azure/Entra flows).
     * @param connectionString - The connection string to which optional credentials will be added.
     * @param nativeAuthConfig - The native authentication configuration (optional, for username/password auth).
     * @param emulatorConfiguration - The emulator configuration object (optional, only relevant for local workspace connections).
     * @param entraIdConfig - The Entra ID configuration object (optional, only relevant for Microsoft Entra ID authentication).
     */
    public static setAuthCredentials(
        clusterId: string,
        authMethod: AuthMethodIdType,
        connectionString: string,
        nativeAuthConfig?: NativeAuthConfig,
        emulatorConfiguration?: EmulatorConfiguration,
        entraIdConfig?: EntraIdAuthConfig,
    ): void {
        const username = nativeAuthConfig?.connectionUser ?? '';
        const password = nativeAuthConfig?.connectionPassword ?? '';

        const connectionStringWithPassword = addAuthenticationDataToConnectionString(
            connectionString,
            username,
            password,
        );

        const credentials: CachedClusterCredentials = {
            clusterId: clusterId,
            connectionStringWithPassword: connectionStringWithPassword,
            connectionString: connectionString,
            emulatorConfiguration: emulatorConfiguration,
            authMechanism: authMethod,
            entraIdConfig: entraIdConfig,
            nativeAuthConfig: nativeAuthConfig,
        };

        CredentialCache._store.set(clusterId, credentials);
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
            if (secrets.entraIdAuthConfig) {
                selectedAuthMethod = AuthMethodId.MicrosoftEntraID;
            } else if (secrets.nativeAuthConfig) {
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
        if (secrets.entraIdAuthConfig) {
            // Preserve all optional fields for backward compatibility
            cacheEntraIdConfig = { ...secrets.entraIdAuthConfig };
        }

        // Use structured configurations
        const username = secrets.nativeAuthConfig?.connectionUser ?? '';
        const password = secrets.nativeAuthConfig?.connectionPassword ?? '';

        // Use the existing setAuthCredentials method to ensure consistent behavior
        CredentialCache.setAuthCredentials(
            connectionItem.id,
            selectedAuthMethod,
            secrets.connectionString,
            username || password ? { connectionUser: username, connectionPassword: password } : undefined,
            emulatorConfiguration,
            cacheEntraIdConfig,
        );
    }
}
