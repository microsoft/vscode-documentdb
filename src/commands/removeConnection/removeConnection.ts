/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type AzExtTreeItem, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { PostgresServerTreeItem } from '../../postgres/tree/PostgresServerTreeItem';
import { StorageNames, StorageService } from '../../services/storageService';
import { CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { AttachedAccountSuffix } from '../../tree/v1-legacy-api/AttachedAccountsTreeItem';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { type ClusterItem } from '../../tree/workspace-view/documentdb/ClusterItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { pickWorkspaceResource } from '../../utils/pickItem/pickAppResource';

export async function removeConnectionV1(context: IActionContext, node?: AzExtTreeItem): Promise<void> {
    const cosmosDBTopLevelContextValues: string[] = [PostgresServerTreeItem.contextValue];

    const children = await ext.attachedAccountsNode.loadAllChildren(context);
    if (children.length < 2) {
        const message = l10n.t('There are no Attached Accounts.');
        void vscode.window.showInformationMessage(message);
    } else {
        if (!node) {
            node = await ext.rgApi.workspaceResourceTree.showTreeItemPicker<AzExtTreeItem>(
                cosmosDBTopLevelContextValues.map((val: string) => (val += AttachedAccountSuffix)),
                context,
            );
        }

        if (!node) {
            return undefined;
        }

        await ext.attachedAccountsNode.detach(node);
        await ext.rgApi.workspaceResourceTree.refresh(context, ext.attachedAccountsNode);
    }
}

export async function removeAzureConnection(
    context: IActionContext,
    node?: CosmosDBAccountAttachedResourceItem | ClusterItemBase,
): Promise<void> {
    if (!node) {
        node = await pickWorkspaceResource<CosmosDBAccountAttachedResourceItem | ClusterItemBase>(context, {
            type: [WorkspaceResourceType.AttachedAccounts, WorkspaceResourceType.MongoClusters],
            expectedChildContextValue: ['treeItem.account', 'treeItem.mongoCluster'],
        });
    }

    if (!node) {
        return;
    }

    await removeConnection(context, node);
}

export async function removeConnection(
    context: IActionContext,
    node: CosmosDBAccountResourceItemBase | ClusterItemBase | DocumentDBClusterItem,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;
    let confirmed = false;
    let connectionName: string;
    let storageType: WorkspaceResourceType;
    let refreshProvider: { refresh: () => void };
    if (node instanceof ClusterItemBase) {
        connectionName = node.cluster.name;
        storageType = WorkspaceResourceType.MongoClusters;
        refreshProvider = ext.mongoClustersWorkspaceBranchDataProvider;
    } else if (node instanceof CosmosDBAccountAttachedResourceItem) {
        connectionName = node.account.name;
        storageType = WorkspaceResourceType.AttachedAccounts;
        refreshProvider = ext.cosmosDBWorkspaceBranchDataProvider;
    } else {
        throw new Error(l10n.t('Unknown node type for deletion'));
    }

    await ext.state.showDeleting(node.id, async () => {
        // ask for confirmation
        confirmed = await getConfirmationAsInSettings(
            l10n.t('Are you sure?'),
            l10n.t('Delete "{connectionName}"?', { connectionName }) + '\n' + l10n.t('This cannot be undone.'),
            'delete',
        );

        if (confirmed) {
            const resourceId = node.storageId;
            await StorageService.get(StorageNames.Workspace).delete(storageType, resourceId);
            showConfirmationAsInSettings(l10n.t('The selected connection has been removed from your workspace.'));
        }
        refreshProvider.refresh();
    });
    if (!confirmed) {
        throw new UserCancelledError();
    }

    // continue with deletion

    if (node instanceof DocumentDBClusterItem) {
        await ext.state.showDeleting(node.id, async () => {
            if ((node as DocumentDBClusterItem).cluster.emulatorConfiguration?.isEmulator) {
                await StorageService.get(StorageNames.Connections).delete('emulators', node.id);
            } else {
                await StorageService.get(StorageNames.Connections).delete('clusters', node.id);
            }
        });

        // delete cached credentials from memory
        CredentialCache.deleteCredentials(node.id);

        ext.connectionsBranchDataProvider.refresh();
    } else if (node instanceof ClusterItemBase) {
        await ext.state.showDeleting(node.id, async () => {
            await StorageService.get(StorageNames.Workspace).delete(WorkspaceResourceType.MongoClusters, node.id);
        });

        ext.mongoClustersWorkspaceBranchDataProvider.refresh();
    }

    if (node instanceof CosmosDBAccountResourceItemBase) {
        await ext.state.showDeleting(node.id, async () => {
            await StorageService.get(StorageNames.Workspace).delete(WorkspaceResourceType.AttachedAccounts, node.id);
        });

        ext.cosmosDBWorkspaceBranchDataProvider.refresh();
    }

    showConfirmationAsInSettings(l10n.t('The selected connection has been removed.'));
}
