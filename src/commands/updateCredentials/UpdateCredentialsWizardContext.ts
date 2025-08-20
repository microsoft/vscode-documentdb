/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AuthMethod } from '../../documentdb/auth/AuthMethod';

export interface UpdateCredentialsWizardContext extends IActionContext {
    // target item details
    isEmulator: boolean;
    storageId: string;

    availableAuthenticationMethods: AuthMethod[];

    // user input
    username?: string;
    password?: string;
    selectedAuthenticationMethod?: AuthMethod;
}
