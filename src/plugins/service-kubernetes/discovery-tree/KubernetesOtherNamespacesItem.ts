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
    public readonly contextValue: string = 'discoveryKubernetesOtherNamespaces';

    constructor(
        public readonly parentId: string,
        private readonly namespaces: readonly string[],
    ) {
        this.id = `${parentId}/__documentdb-empty-namespaces`;
    }

    public getChildren(): ExtTreeElementBase[] {
        return this.namespaces.map((namespace) =>
            createGenericElementWithContext({
                contextValue: 'informational;discoveryKubernetesEmptyNamespace',
                id: `${this.id}/${namespace}`,
                label: namespace,
                iconPath: new vscode.ThemeIcon('symbol-namespace'),
            }),
        );
    }

    public getTreeItem(): vscode.TreeItem {
        // The label alone carries the meaning; the explanation lives in the tooltip so the
        // always-visible row stays short. No em dashes in generated user-facing strings.
        const tooltip = new vscode.MarkdownString(
            vscode.l10n.t(
                'Namespaces that were scanned but where no DocumentDB target was found. These are grouped here to keep the list of connectable namespaces uncluttered. Expand to see which namespaces were checked.',
            ),
        );

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: vscode.l10n.t('Other namespaces'),
            tooltip,
            // Use 'symbol-folder' instead of 'folder': VS Code's tree Aligner treats
            // ThemeIcon('folder')/('file') specially and hides them under file-icon
            // themes that lack folder icons, which also breaks sibling alignment.
            // See the detailed note in src/tree/connections-view/FolderItem.ts.
            iconPath: new vscode.ThemeIcon('symbol-folder'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
