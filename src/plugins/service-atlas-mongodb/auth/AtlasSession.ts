/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the authentication method used to connect to Atlas.
 */
export type AtlasAuthMethod = 'oauth' | 'apikey' | 'serviceaccount';

/**
 * Base session interface.
 */
interface AtlasSessionBase {
    readonly type: AtlasAuthMethod;
}

/**
 * OAuth 2.0 session with access and refresh tokens.
 */
export interface AtlasOAuthSession extends AtlasSessionBase {
    readonly type: 'oauth';
    readonly accessToken: string;
}

/**
 * API Key session with public/private key pair (HTTP Digest Auth).
 */
export interface AtlasApiKeySession extends AtlasSessionBase {
    readonly type: 'apikey';
    readonly publicKey: string;
    readonly privateKey: string;
}

/**
 * Service Account session using OAuth2 client_credentials grant.
 * Uses client_id/client_secret to obtain a Bearer access token.
 */
export interface AtlasServiceAccountSession extends AtlasSessionBase {
    readonly type: 'serviceaccount';
    readonly accessToken: string;
}

/**
 * Union type representing a valid Atlas session.
 */
export type AtlasSession = AtlasOAuthSession | AtlasApiKeySession | AtlasServiceAccountSession;

/**
 * Session state enumeration for the state machine.
 */
export enum AtlasSessionState {
    /** No session exists */
    None = 'none',
    /** Currently authenticating */
    Authenticating = 'authenticating',
    /** Active valid session */
    Active = 'active',
    /** Session expired, needs refresh or re-auth */
    Expired = 'expired',
}
