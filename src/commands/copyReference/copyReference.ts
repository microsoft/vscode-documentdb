/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

export async function copyDatabaseReference(_context: IActionContext, node: DatabaseItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    const reference = node.databaseInfo.name;
    await vscode.env.clipboard.writeText(reference);
    void vscode.window.showInformationMessage(l10n.t('The reference has been copied to the clipboard'));
}

export async function copyCollectionReference(_context: IActionContext, node: CollectionItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    const reference = `${node.databaseInfo.name}.${node.collectionInfo.name}`;
    await vscode.env.clipboard.writeText(reference);
    void vscode.window.showInformationMessage(l10n.t('The reference has been copied to the clipboard'));
}
