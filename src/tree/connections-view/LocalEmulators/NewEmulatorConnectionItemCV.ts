/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';

export class NewEmulatorConnectionItemCV implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'treeItem.newEmulatorConnection';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/newEmulatorConnection`;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('New Local Connection…'),
            iconPath: new vscode.ThemeIcon('plus'),
            command: {
                command: 'command.documentDB.connectionsView.newEmulatorConnection',
                title: '',
                arguments: [this],
            },
        };
    }
}
