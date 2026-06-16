/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { executeApiKeyFlow } from './AtlasApiKeyFlow';
import { executeOAuthDeviceFlow } from './AtlasOAuthDeviceFlow';
import { executeServiceAccountFlow } from './AtlasServiceAccountFlow';
import { type AtlasAuthMethod } from './AtlasSession';
import { type AtlasSessionManager } from './AtlasSessionManager';

/**
 * Executes the authentication flow corresponding to the selected Atlas auth method.
 *
 * This is the single source of truth that maps an {@link AtlasAuthMethod} to its flow, so that
 * every entry point (tree sign-in, Manage Credentials, new-connection wizard) stays in sync.
 *
 * @returns true if authentication was successful, false if cancelled or failed.
 */
export function executeAtlasAuthFlow(
    authMethod: AtlasAuthMethod,
    sessionManager: AtlasSessionManager,
): Promise<boolean> {
    switch (authMethod) {
        case 'oauth':
            return executeOAuthDeviceFlow(sessionManager);
        case 'serviceaccount':
            return executeServiceAccountFlow(sessionManager);
        case 'apikey':
            return executeApiKeyFlow(sessionManager);
    }
}
