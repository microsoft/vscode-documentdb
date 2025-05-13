/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';

export async function createMongoDocument(context: IActionContext, node: CollectionItem): Promise<void> {
    context.telemetry.properties.experience = node?.experience.api;

    if (!node) {
        throw new Error(vscode.l10n.t('No node selected.'));
    }

    await vscode.commands.executeCommand('vscode-documentdb.command.internal.documentView.open', {
        clusterId: node.cluster.id,
        databaseName: node.databaseInfo.name,
        collectionName: node.collectionInfo.name,
        mode: 'add',
    });
}
