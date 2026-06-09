/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';

export class KubernetesOtherNamespacesItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'discovery.kubernetesOtherNamespaces';

    constructor(
        public readonly parentId: string,
        private readonly namespaces: readonly string[],
    ) {
        this.id = `${parentId}/__documentdb-empty-namespaces`;
    }

    public getChildren(): ExtTreeElementBase[] {
        return this.namespaces.map((namespace) =>
            createGenericElementWithContext({
                contextValue: 'informational;discovery.kubernetesEmptyNamespace',
                id: `${this.id}/${namespace}`,
                label: namespace,
                iconPath: new vscode.ThemeIcon('archive'),
            }),
        );
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: vscode.l10n.t('Others'),
            description: vscode.l10n.t('DocumentDB not detected'),
            // Use 'symbol-folder' instead of 'folder': VS Code's tree Aligner treats
            // ThemeIcon('folder')/('file') specially and hides them under file-icon
            // themes that lack folder icons, which also breaks sibling alignment.
            // See the detailed note in src/tree/connections-view/FolderItem.ts.
            iconPath: new vscode.ThemeIcon('symbol-folder'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
