/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the type of authentication method to use with MongoDB Atlas API
 */
export enum AtlasAuthType {
    /** OAuth 2.0 Client Credentials flow */
    OAuth2 = 'oauth2',
    /** HTTP Digest Authentication */
    DigestAuth = 'digestAuth',
}

/**
 * OAuth 2.0 Client Credentials for MongoDB Atlas API
 */
export interface AtlasOAuth2Credentials {
    readonly type: AtlasAuthType.OAuth2;
    readonly clientId: string;
    readonly clientSecret: string;
}

/**
 * HTTP Digest Authentication credentials for MongoDB Atlas API
 */
export interface AtlasDigestCredentials {
    readonly type: AtlasAuthType.DigestAuth;
    readonly publicKey: string;
    readonly privateKey: string;
}

/**
 * Union type for all supported Atlas credential types
 */
export type AtlasCredentials = AtlasOAuth2Credentials | AtlasDigestCredentials;

/**
 * OAuth 2.0 access token with metadata
 */
export interface AtlasOAuth2Token {
    readonly accessToken: string;
    readonly tokenType: string;
    readonly expiresIn: number;
    readonly expiresAt: Date;
}

/**
 * Result of credential validation
 */
export interface CredentialValidationResult {
    readonly isValid: boolean;
    readonly error?: string;
}