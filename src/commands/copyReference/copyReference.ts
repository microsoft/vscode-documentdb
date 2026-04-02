/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

async function copyReferenceInternal<T extends DatabaseItem | CollectionItem>(
    node: T | undefined,
    getReference: (node: T) => string,
): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    const reference = getReference(node);
    await vscode.env.clipboard.writeText(reference);
    void vscode.window.showInformationMessage(l10n.t('The reference has been copied to the clipboard.'));
}

export async function copyDatabaseReference(_context: IActionContext, node: DatabaseItem): Promise<void> {
    await copyReferenceInternal(node, (n) => n.databaseInfo.name);
}

export async function copyCollectionReference(_context: IActionContext, node: CollectionItem): Promise<void> {
    await copyReferenceInternal(node, (n) => `${n.databaseInfo.name}.${n.collectionInfo.name}`);
}
