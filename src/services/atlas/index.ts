/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Main service
export { AtlasAuthService } from './AtlasAuthService';

// Types
export {
    AtlasAuthType,
    type AtlasCredentials,
    type AtlasOAuth2Credentials,
    type AtlasDigestCredentials,
    type AtlasOAuth2Token,
    type CredentialValidationResult,
} from './types/AtlasCredentials';

export {
    type AtlasAuthConfig,
    DEFAULT_ATLAS_AUTH_CONFIG,
} from './types/AtlasAuthConfig';

export {
    type AtlasAuthHeader,
    type AtlasAuthResult,
    type TokenRefreshResult,
} from './types/AtlasAuthResult';

// Storage
export { AtlasCredentialStorage } from './storage/AtlasCredentialStorage';

// Auth handlers (for advanced usage)
export { OAuth2Handler } from './auth/OAuth2Handler';
export { DigestAuthHandler } from './auth/DigestAuthHandler';

// HTTP utilities
export { AtlasHttpClient } from './utils/httpClient';