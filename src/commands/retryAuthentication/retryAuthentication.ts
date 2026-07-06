/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { inferViewIdFromTreeId, Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';

const containsDelimited = (fullContext: string | undefined, value: string): boolean => {
    if (!fullContext) {
        return false;
    }
    return new RegExp(`\\b${value}\\b`, 'i').test(fullContext);
};

type RetryableTreeNode = TreeElement & Partial<TreeElementWithContextValue>;

function getViewId(node: RetryableTreeNode): Views | undefined {
    if (containsDelimited(node.contextValue, Views.ConnectionsView)) {
        return Views.ConnectionsView;
    }

    if (containsDelimited(node.contextValue, Views.DiscoveryView)) {
        return Views.DiscoveryView;
    }

    if (containsDelimited(node.contextValue, Views.AzureResourcesView)) {
        return Views.AzureResourcesView;
    }

    if (
        typeof node.id === 'string' &&
        (node.id.startsWith(Views.ConnectionsView) ||
            node.id.startsWith(Views.DiscoveryView) ||
            node.id.startsWith(Views.AzureResourcesView) ||
            node.id.startsWith(Views.AzureWorkspaceView))
    ) {
        return inferViewIdFromTreeId(node.id);
    }

    return undefined;
}

export async function retryAuthentication(_context: IActionContext, node: RetryableTreeNode): Promise<void> {
    if (!node?.id) {
        throw new Error(l10n.t('No node selected.'));
    }

    const contextValue = node.contextValue;
    const viewId = getViewId(node);

    switch (viewId) {
        case Views.ConnectionsView:
            ext.connectionsBranchDataProvider.resetNodeErrorState(node.id);
            return ext.connectionsBranchDataProvider.refresh(node);

        case Views.DiscoveryView:
            ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
            return ext.discoveryBranchDataProvider.refresh(node);

        case Views.AzureResourcesView: {
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
