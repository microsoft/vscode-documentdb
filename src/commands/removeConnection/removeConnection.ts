/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import {
    refreshParentInConnectionsView,
    withConnectionsViewProgress,
} from '../../tree/connections-view/connectionsViewHelpers';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function removeAzureConnection(context: IActionContext, node: DocumentDBClusterItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    await removeConnection(context, node);
}

export async function removeConnection(context: IActionContext, node: DocumentDBClusterItem): Promise<void> {
    context.telemetry.properties.experience = node.experience.api;
    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Are you sure?'),
        l10n.t('Delete "{connectionName}"?', { connectionName: node.cluster.name }) +
            '\n' +
            l10n.t('This cannot be undone.'),
        'delete',
    );

    if (!confirmed) {
        throw new UserCancelledError();
    }

    // continue with deletion

    await withConnectionsViewProgress(async () => {
        await ext.state.showDeleting(node.id, async () => {
            if ((node as DocumentDBClusterItem).cluster.emulatorConfiguration?.isEmulator) {
                await ConnectionStorageService.delete(ConnectionType.Emulators, node.storageId);
            } else {
                await ConnectionStorageService.delete(ConnectionType.Clusters, node.storageId);
            }
        });

        // delete cached credentials from memory
        CredentialCache.deleteCredentials(node.id);

        refreshParentInConnectionsView(node.id);
    });

    showConfirmationAsInSettings(l10n.t('The selected connection has been removed.'));
}
