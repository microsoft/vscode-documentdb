/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';

export async function removeDiscoveryRegistry(_context: IActionContext, node?: TreeElementBase): Promise<void> {
    if (
        // transition period code until the parent discovery is added
        !node ||
        !('parentId' in node) ||
        !node.parentId ||
        typeof node.parentId !== 'string' ||
        !node.parentId.includes('/')
    ) {
        return;
    }

    /**
     * We can extract the provider id from the node instead of hardcoding it
     * by accessing the node.parentId and looking from the strart for the id in the following format
     *
     * node.parentId = '${Views.DiscoveryView}/<providerId>/potential/parents'
     */
    const providerId = node.parentId.split('/')[1];
    const provider = DiscoveryService.getProvider(providerId);

    if (!provider) {
        ext.outputChannel.error(`Failed to access the service provider with the id "${providerId}".`);
        return;
    }

    // Get active discovery provider IDs from global state
    const activeDiscoveryProviderIds = ext.context.globalState.get<string[]>('activeDiscoveryProviderIds', []);

    const updatedProviderIds = activeDiscoveryProviderIds.filter((id) => id !== provider.id);

    // Update global state with the filtered list
    await ext.context.globalState.update('activeDiscoveryProviderIds', updatedProviderIds);

    // Refresh the discovery branch data provider to show the updated list
    ext.discoveryBranchDataProvider.refresh();
}
