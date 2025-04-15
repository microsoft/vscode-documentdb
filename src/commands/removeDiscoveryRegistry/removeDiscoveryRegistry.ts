/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';

export async function removeDiscoveryRegistry(_context: IActionContext, node?: TreeElementBase): Promise<void> {
    if (!node) {
        return;
    }

    // Get active discovery provider IDs from global state
    const activeDiscoveryProviderIds = ext.context.globalState.get<string[]>('activeDiscoveryProviderIds', []);

    // Filter out 'azure-discovery' from the active providers
    const updatedProviderIds = activeDiscoveryProviderIds.filter((id) => id !== 'azure-discovery');

    // Update global state with the filtered list
    await ext.context.globalState.update('activeDiscoveryProviderIds', updatedProviderIds);

    // Refresh the discovery branch data provider to show the updated list
    ext.discoveryBranchDataProvider.refresh();
}
