/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';

export interface UpdateCSWizardContext extends IActionContext {
    // target item details
    isEmulator: boolean;
    storageId: string;
    clusterId: string;

    originalConnectionString: string;
    newConnectionString?: string;

    // reconnection
    /**
     * When true, the wizard will offer a reconnect option after saving the
     * updated connection string. Set at wizard initialization time based on
     * whether there is an active session. There is no error node path for
     * connection string updates (by design), so only active sessions apply.
     */
    offerReconnect: boolean;
    shouldReconnect: boolean;
}
