/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';

export async function createMongoDocument(context: IActionContext, node: CollectionItem): Promise<void> {
    context.telemetry.properties.experience = node?.experience.api;

    if (!node) {
        throw new Error(vscode.l10n.t('No node selected.'));
    }

    // Extract viewId from the cluster model, or infer from treeId prefix
    const viewId = node.cluster.viewId ?? inferViewIdFromTreeId(node.cluster.treeId);

    await vscode.commands.executeCommand('vscode-documentdb.command.internal.documentView.open', {
        clusterId: node.cluster.clusterId,
        viewId: viewId,
        databaseName: node.databaseInfo.name,
        collectionName: node.collectionInfo.name,
        mode: 'add',
    });
}

/**
 * Infers the viewId from the treeId prefix.
 * This is a fallback for cases where viewId is not explicitly set on the cluster model.
 */
function inferViewIdFromTreeId(treeId: string): string {
    if (treeId.startsWith(Views.ConnectionsView)) {
        return Views.ConnectionsView;
    } else if (treeId.startsWith(Views.DiscoveryView)) {
        return Views.DiscoveryView;
    } else if (treeId.startsWith(Views.AzureResourcesView)) {
        return Views.AzureResourcesView;
    } else if (treeId.startsWith(Views.AzureWorkspaceView)) {
        return Views.AzureWorkspaceView;
    }
    // Default fallback - this shouldn't happen in practice
    return Views.ConnectionsView;
}
