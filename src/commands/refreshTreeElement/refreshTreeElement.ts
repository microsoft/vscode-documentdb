/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n } from 'vscode';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../../tree/TreeElement';

export async function refreshTreeElement(context: IActionContext, node: TreeElement): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    if (node && 'refresh' in node && typeof node.refresh === 'function') {
        await node.refresh.call(node, context);
        return;
    }

    if (node && 'contextValue' in node && typeof node.contextValue === 'string') {
        if (/discoveryView/i.test(node.contextValue)) {
            return ext.discoveryBranchDataProvider.refresh(node);
        }

        if (/connectionsView/i.test(node.contextValue)) {
            return ext.connectionsBranchDataProvider.refresh(node);
        }

        // if (/experience[.](mongocluster)/i.test(node.contextValue)) {
        //     return ext.mongoVCoreBranchDataProvider.refresh(node);
        // }
    }

    if (node && 'id' in node && typeof node.id === 'string') {
        return ext.state.notifyChildrenChanged(node.id);
    }
}
