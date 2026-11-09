/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { type CachedClusterCredentials } from '../CredentialCache';
import { type AuthCallerPolicy } from './authCallerPolicy';
import { type AuthHandler } from './AuthHandler';
import { AuthMethodId } from './AuthMethod';
import { ManagedIdentityAuthHandler } from './ManagedIdentityAuthHandler';
import { MicrosoftEntraIDAuthHandler } from './MicrosoftEntraIDAuthHandler';
import { NativeAuthHandler } from './NativeAuthHandler';
import { NoAuthHandler } from './NoAuthHandler';

export { AuthInputUnavailableError, type AuthCallerPolicy, type AuthPhaseObserver } from './authCallerPolicy';

/**
 * Builds the auth handler for a method. Ordinary connects pass `{ interactive: true }`; connection
 * diagnostics pass `{ interactive: false }` so no sign-in UI is ever opened.
 */
export function createAuthHandler(
    authMethod: AuthMethodId,
    credentials: CachedClusterCredentials,
    policy: AuthCallerPolicy,
): AuthHandler {
    switch (authMethod) {
        case AuthMethodId.NativeAuth:
            return new NativeAuthHandler(credentials, policy);
        case AuthMethodId.MicrosoftEntraID:
            return new MicrosoftEntraIDAuthHandler(credentials, policy);
        case AuthMethodId.ManagedIdentity:
            return new ManagedIdentityAuthHandler(credentials, policy);
        case AuthMethodId.NoAuth:
            return new NoAuthHandler(credentials, policy);
        default:
            throw new Error(l10n.t('Unsupported authentication method: {0}', String(authMethod)));
    }
}
