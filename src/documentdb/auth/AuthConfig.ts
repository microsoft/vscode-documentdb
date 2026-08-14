/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Configuration for native MongoDB authentication using username/password.
 * This represents the traditional authentication method where credentials
 * are directly provided for database connection.
 */
export interface NativeAuthConfig {
    /** The username for database authentication */
    readonly connectionUser: string;

    /** The password for database authentication */
    readonly connectionPassword?: string;
}

/**
 * Configuration for Entra ID (Azure Active Directory) authentication.
 * Supports both explicit tenant specification and tenant discovery scenarios.
 */
export interface EntraIdAuthConfig {
    /**
     * The Azure Active Directory tenant ID.
     * When provided, authentication will target this specific tenant.
     * When omitted, Azure SDK will attempt tenant discovery based on the user context.
     * This flexibility supports both single-tenant and multi-tenant scenarios.
     */
    readonly tenantId?: string;
    /**
     * The Azure subscription ID associated with the authentication context.
     * This is typically required when performing operations that are scoped to a specific Azure subscription,
     * such as resource management or billing. While `tenantId` identifies the Azure Active Directory tenant,
     * `subscriptionId` specifies the particular subscription within that tenant.
     * This field is optional and may not be needed for all authentication scenarios.
     */
    readonly subscriptionId?: string;

    /**
     * Additional Entra ID specific configuration can be added here as needed.
     * Examples: clientId, scope, authority, etc.
     */
}

/**
 * Configuration for authenticating with the managed identity of the Azure VM that is hosting
 * VS Code.
 *
 * An "empty" configuration (`{}`) is meaningful: it selects the system-assigned identity. Persisting
 * `undefined` instead would make the authentication method un-inferable after a window reload.
 */
export interface ManagedIdentityAuthConfig {
    /**
     * Client ID of a user-assigned managed identity.
     * Omitted for the system-assigned identity.
     * Required whenever the host has more than one candidate identity, because the instance metadata
     * service cannot disambiguate on its own.
     */
    readonly clientId?: string;

    /** Tenant that owns the target DocumentDB cluster, used to diagnose cross-tenant tokens. */
    readonly tenantId?: string;
}

/**
 * Union type representing all supported authentication configurations.
 * This type can be extended with additional auth methods in the future
 * (e.g., certificate-based auth, OAuth, etc.) without breaking existing code.
 */
export type AuthConfig = NativeAuthConfig | EntraIdAuthConfig | ManagedIdentityAuthConfig;
