/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Authentication header result that can be used in HTTP requests
 */
export interface AtlasAuthHeader {
    readonly Authorization: string;
}

/**
 * Result of authentication operations
 */
export interface AtlasAuthResult {
    readonly success: boolean;
    readonly authHeader?: AtlasAuthHeader;
    readonly error?: string;
    readonly requiresReauthentication?: boolean;
}

/**
 * Result of token refresh operations
 */
export interface TokenRefreshResult {
    readonly success: boolean;
    readonly newToken?: string;
    readonly expiresAt?: Date;
    readonly error?: string;
}