/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents an OAuth 2.0 access token with metadata
 */
export interface AccessToken {
    /** The access token string */
    access_token: string;
    /** Token type (typically 'Bearer') */
    token_type: string;
    /** Token expiry time in seconds from now */
    expires_in: number;
    /** Actual expiry timestamp (calculated) */
    expires_at: number;
    /** Optional refresh token */
    refresh_token?: string;
    /** Token scope */
    scope?: string;
}

/**
 * OAuth 2.0 Client Credentials for MongoDB Atlas
 */
export interface OAuthCredentials {
    /** OAuth client ID (public key) */
    clientId: string;
    /** OAuth client secret (private key) */
    clientSecret: string;
    /** Token endpoint URL */
    tokenEndpoint: string;
    /** Required scopes for Atlas API access */
    scope?: string;
}

/**
 * HTTP Digest Authentication credentials for MongoDB Atlas API
 */
export interface DigestCredentials {
    /** Public API key */
    publicKey: string;
    /** Private API key */
    privateKey: string;
    /** Base URL for Atlas API */
    baseUrl: string;
}

/**
 * Authentication request configuration
 */
export interface AuthRequest {
    /** HTTP method */
    method: string;
    /** Request URL */
    url: string;
    /** Request headers */
    headers?: Record<string, string>;
    /** Request body */
    body?: string;
}

/**
 * Authenticated request with authorization headers
 */
export interface AuthenticatedRequest extends AuthRequest {
    /** Updated headers with authentication */
    headers: Record<string, string>;
}

/**
 * Configuration for HTTP retry behavior
 */
export interface RetryConfig {
    /** Maximum number of retry attempts */
    maxAttempts: number;
    /** Base delay in milliseconds */
    baseDelayMs: number;
    /** Maximum delay in milliseconds */
    maxDelayMs: number;
    /** Jitter factor (0-1) */
    jitterFactor: number;
}

/**
 * HTTP error with retry information
 */
export interface HttpError extends Error {
    /** HTTP status code */
    status: number;
    /** Response headers */
    headers?: Record<string, string>;
    /** Response body */
    body?: string;
    /** Whether this error is retryable */
    retryable?: boolean;
    /** Retry-After header value in seconds */
    retryAfter?: number;
}