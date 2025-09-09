/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Main auth provider exports
export { AuthProvider, AuthProviderFactory } from './AuthProvider';
export { OAuthAuthProvider } from './OAuthAuthProvider';
export { DigestAuthProvider } from './DigestAuthProvider';
export { TokenCache } from './TokenCache';

// Type exports
export {
    type AccessToken,
    type AuthRequest,
    type AuthenticatedRequest,
    type DigestCredentials,
    type HttpError,
    type OAuthCredentials,
    type RetryConfig,
} from './types';

// Utility exports
export { CredentialStorage, CredentialType } from '../utils/credentialStorage';
export { HttpUtils, DEFAULT_RETRY_CONFIG } from '../utils/httpUtils';