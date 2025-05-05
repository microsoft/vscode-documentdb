/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';

export async function filterProviderContent(context: IActionContext, node?: TreeElementBase): Promise<void> {
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

    if (!provider?.configureTreeItemFilter) {
        ext.outputChannel.error(`No filter function provided by the provider with the id "${providerId}".`);
        return;
    }

    // Call the filter function provided by the provider
    await provider.configureTreeItemFilter(context, node as TreeElement);

    // Refresh the discovery branch data provider to show the updated list
    ext.discoveryBranchDataProvider.refresh(node as TreeElement);
}
