/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';

export async function retryAuthentication(context: IActionContext, node: ClusterItemBase): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    if (new RegExp(`\\b${Views.ConnectionsView}\\b`, 'i').test(node.contextValue)) {
        ext.connectionsBranchDataProvider.resetNodeErrorState(node.id);
        return ext.connectionsBranchDataProvider.refresh(node);
    }

    if (new RegExp(`\\b${Views.DiscoveryView}\\b`, 'i').test(node.contextValue)) {
        ext.discoveryBranchDataProvider.resetNodeErrorState(node.id);
        return ext.discoveryBranchDataProvider.refresh(node);
    }

    throw new Error(l10n.t('Unsupported view for an authentication retry.'));
}
