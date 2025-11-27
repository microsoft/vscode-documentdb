/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { type TreeElement } from '../../tree/TreeElement';

export async function filterProviderContent(context: IActionContext, node: TreeElement): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }
    /**
     * We can extract the provider id from the node instead of hardcoding it
     * by accessing the node.id and looking from the start for the id in the following format
     *
     * node.id = '${Views.DiscoveryView}/<providerId>/potential/elements/thisNodesId'
     *
     * first, we'll verify that the id is in the format expected, if not, we'll return with an error
     */

    const idSections = node.id.split('/');
    const isValidFormat =
        idSections.length >= 2 && idSections[0] === String(Views.DiscoveryView) && idSections[1].length > 0;

    if (!isValidFormat) {
        ext.outputChannel.error('Internal error: Node id is not in the expected format.');
        return;
    }

    const providerId = idSections[1];
    context.telemetry.properties.discoveryProviderId = providerId;
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
