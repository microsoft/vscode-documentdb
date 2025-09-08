/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';

const containsDelimited = (fullContext: string | undefined, value: string): boolean => {
    if (!fullContext) {
        return false;
    }
    return new RegExp(`\\b${value}\\b`, 'i').test(fullContext);
};

export async function retryAuthentication(_context: IActionContext, node: ClusterItemBase): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    const contextValue = node.contextValue;

    switch (true) {
        case containsDelimited(contextValue, Views.ConnectionsView):
            ext.connectionsBranchDataProvider.resetNodeErrorState(node.id);
            return ext.connectionsBranchDataProvider.refresh(node);

        case containsDelimited(contextValue, Views.DiscoveryView):
            ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
            return ext.discoveryBranchDataProvider.refresh(node);

        case containsDelimited(contextValue, Views.AzureResourcesView): {
            if (containsDelimited(contextValue, 'ruBranch')) {
                ext.azureResourcesRUBranchDataProvider.resetNodeErrorState(node.id);
                return ext.azureResourcesRUBranchDataProvider.refresh(node);
            }
            if (containsDelimited(contextValue, 'documentDbBranch')) {
                ext.azureResourcesVCoreBranchDataProvider.resetNodeErrorState(node.id);
                return ext.azureResourcesVCoreBranchDataProvider.refresh(node);
            }
            break;
        }
    }

    throw new Error(l10n.t('Unsupported view for an authentication retry.'));
}
