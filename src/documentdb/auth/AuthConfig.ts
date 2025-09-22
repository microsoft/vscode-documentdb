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
    readonly subscriptionId?: string;

    /**
     * Additional Entra ID specific configuration can be added here as needed.
     * Examples: clientId, scope, authority, etc.
     */
}

/**
 * Union type representing all supported authentication configurations.
 * This type can be extended with additional auth methods in the future
 * (e.g., certificate-based auth, OAuth, etc.) without breaking existing code.
 */
export type AuthConfig = NativeAuthConfig | EntraIdAuthConfig;
