/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';

export class SwitchToDocumentDbItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem_activateDocumentDbView';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/activateDocumentDbView`;
    }

    public getTreeItem(): vscode.TreeItem {
        const tooltip = new vscode.MarkdownString(
            l10n.t(
                'The "MongoDB Connections" functionality has moved from the "Azure Databases" to the "DocumentDB for VS Code" extension.\n\n' +
                    'Your connections have been migrated to the new view.\n\n' +
                    'Click to switch to the new extension view.',
            ),
        );

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Switch to the new "Connections View"…'),
            description: l10n.t('Connections have moved'),
            tooltip,
            iconPath: new vscode.ThemeIcon('arrow-swap'),
            command: {
                command: 'vscode-documentdb.command.internal.revealView',
                title: '',
                arguments: [Views.ConnectionsView],
            },
        };
    }
}
