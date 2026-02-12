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

    /** Tree-view node ID, used to reset error state on reconnect. */
    nodeId?: string;

    /** Always false for connection string updates (no error-node path). */
    isErrorState: boolean;
    /** Always false for connection string updates (no reconnect prompt). */
    reconnectAfterError: boolean;
}
