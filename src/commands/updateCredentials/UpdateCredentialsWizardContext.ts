/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type EntraIdAuthConfig, type NativeAuthConfig } from '../../documentdb/auth/AuthConfig';
import { type AuthMethodId } from '../../documentdb/auth/AuthMethod';

export interface UpdateCredentialsWizardContext extends IActionContext {
    // target item details
    isEmulator: boolean;
    storageId: string;
    clusterId: string;

    availableAuthenticationMethods: AuthMethodId[];

    // structured authentication configurations
    nativeAuthConfig?: NativeAuthConfig;
    entraIdAuthConfig?: EntraIdAuthConfig;

    selectedAuthenticationMethod?: AuthMethodId;

    // reconnection — true when there was an active session before credential update
    hasActiveSession: boolean;
    shouldReconnect: boolean;
}
