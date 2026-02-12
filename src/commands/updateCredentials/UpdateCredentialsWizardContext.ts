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

    /** Tree-view node ID, used to reset error state on reconnect. */
    nodeId?: string;

    /** True when the wizard was triggered from an error/retry node. */
    isErrorState: boolean;
    /** Set by the reconnect prompt; clears error state to trigger a new connection. */
    reconnectAfterError: boolean;
}
