/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';

/**
 * Root tree item for MongoDB Atlas service discovery
 */
export class AtlasServiceRootItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;enableLearnMoreCommand;atlasService';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/atlas-service`;
    }

    public async getTreeItem(): Promise<vscode.TreeItem> {
        const treeItem = createGenericElementWithContext({
            id: this.id,
            label: l10n.t('MongoDB Atlas'),
            iconPath: new vscode.ThemeIcon('server-environment'),
            description: l10n.t('Discover Atlas Projects and Clusters'),
            contextValue: this.contextValue,
        });
        
        // Cast to vscode.TreeItem to set collapsibleState
        (treeItem as vscode.TreeItem).collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        return treeItem;
    }

    public async getChildren(): Promise<TreeElement[]> {
        // For minimal implementation, return empty array
        // In a full implementation, this would return Atlas projects
        return [];
    }
}