/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface UpdateCredentialsWizardContext extends IActionContext {
    // target item details
    isEmulator: boolean;
    storageId: string;

    // user input
    username: string | undefined;
    password: string | undefined;
}
