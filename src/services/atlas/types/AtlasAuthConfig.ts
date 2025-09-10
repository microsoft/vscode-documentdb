/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Configuration options for Atlas authentication
 */
export interface AtlasAuthConfig {
    /** Atlas API base URL - defaults to MongoDB Atlas Management API v2 */
    readonly apiBaseUrl?: string;
    /** OAuth 2.0 token endpoint URL */
    readonly tokenEndpoint?: string;
    /** Request timeout in milliseconds */
    readonly timeoutMs?: number;
    /** Whether to automatically refresh tokens */
    readonly autoRefreshToken?: boolean;
    /** Token refresh threshold in seconds before expiry */
    readonly refreshThresholdSeconds?: number;
}

/**
 * Default configuration values for Atlas authentication
 */
export const DEFAULT_ATLAS_AUTH_CONFIG: Required<AtlasAuthConfig> = {
    apiBaseUrl: 'https://cloud.mongodb.com/api/atlas/v2',
    tokenEndpoint: 'https://cloud.mongodb.com/api/atlas/v2/auth/login',
    timeoutMs: 30000,
    autoRefreshToken: true,
    refreshThresholdSeconds: 300, // 5 minutes
} as const;