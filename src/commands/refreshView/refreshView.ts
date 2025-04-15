/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';

export async function refreshView(_context: IActionContext, view: Views): Promise<void> {
    switch (view) {
        case Views.ConnectionsView:
            ext.connectionsBranchDataProvider.refresh();
            break;
        case Views.DiscoveryView:
            ext.discoveryBranchDataProvider.refresh();
            break;
        default:
            throw new Error(`Unknown view: ${view}`);
    }
}
