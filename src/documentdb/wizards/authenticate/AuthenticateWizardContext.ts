/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

import { type AuthMethodId } from '../../auth/AuthMethod';

export interface AuthenticateWizardContext extends IActionContext {
    /** These values have to be provided for the wizard to function correctly. */
    adminUserName: string | undefined;
    resourceName: string;

    /**
     * Available authentication methods.
     * These are raw strings that may include unknown methods not yet in our AuthMethodId enum.
     */
    availableAuthMethods?: string[];

    /** These values will be populated by the wizard. */

    /** States whether the username was set during the wizard flow. */
    isUserNameUpdated?: boolean;
    selectedUserName?: string;

    /** States whether the password was set during the wizard flow. */
    isPasswordUpdated?: boolean;
    password?: string;

    isAuthMethodUpdated?: boolean;
    /**
     * The selected authentication method.
     */
    selectedAuthMethod?: AuthMethodId;

    aborted?: boolean;

    /**
     * Determines whether credentials should be saved to storage.
     * Set this to true when persisted credentials need to be updated.
     *
     * If set to true, both, the username and password will be saved to storage.
     */
    saveCredentials?: boolean;
}
