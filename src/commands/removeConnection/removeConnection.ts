/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { StorageNames, StorageService } from '../../services/storageService';
import { DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { type ClusterItem } from '../../tree/workspace-view/documentdb/ClusterItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function removeAzureConnection(
    context: IActionContext,
    node?: ClusterItem | DocumentDBClusterItem,
): Promise<void> {
    if (!node) {
        return;
    }

    await removeConnection(context, node);
}

export async function removeConnection(
    context: IActionContext,
    node: ClusterItem | DocumentDBClusterItem,
): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;
    let confirmed = false;

    await ext.state.showDeleting(node.id, async () => {
        // ask for confirmation
        confirmed = await getConfirmationAsInSettings(
            l10n.t('Are you sure?'),
            l10n.t('Delete "{connectionName}"?', { connectionName: node.cluster.name }) +
                '\n' +
                l10n.t('This cannot be undone.'),
            'delete',
        );
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

    showConfirmationAsInSettings(l10n.t('The selected connection has been removed.'));
}
