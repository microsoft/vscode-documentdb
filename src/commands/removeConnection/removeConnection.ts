/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { SchemaStore } from '../../documentdb/SchemaStore';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService } from '../../services/connectionStorageService';
import { checkCanProceedAndInformUser } from '../../services/taskService/resourceUsageHelper';
import {
    refreshParentInConnectionsView,
    withConnectionsViewProgress,
} from '../../tree/connections-view/connectionsViewHelpers';
import { DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { resolveStorageZone } from '../../tree/connections-view/models/ConnectionClusterModel';
import { type TreeElement } from '../../tree/TreeElement';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

export async function removeConnection(
    context: IActionContext,
    node?: TreeElement,
    nodes?: TreeElement[],
): Promise<void> {
    // VS Code multi-select passes an array of *all* selected tree elements, which can include
    // folders, placeholders, or other non-connection items. Filter to DocumentDBClusterItem only.
    const candidates: TreeElement[] = nodes && nodes.length > 0 ? nodes : node ? [node] : [];
    const connectionsToDelete: DocumentDBClusterItem[] = candidates.filter(
        (item): item is DocumentDBClusterItem => item instanceof DocumentDBClusterItem,
    );

    if (connectionsToDelete.length === 0) {
        ext.outputChannel.warn(l10n.t('No connections selected to remove.'));
        return;
    }

    context.telemetry.properties.experience = connectionsToDelete[0].experience.api;
    context.telemetry.measurements.connectionsToDelete = connectionsToDelete.length;

    // Check if any running tasks are using the selected connections
    for (const connection of connectionsToDelete) {
        const canProceed = await checkCanProceedAndInformUser(
            {
                clusterId: connection.cluster.clusterId,
            },
            l10n.t('remove this connection'),
        );

        if (!canProceed) {
            throw new UserCancelledError();
        }
    }

    // Build confirmation message adapted for single vs. multiple connections
    const confirmationMessage =
        connectionsToDelete.length === 1
            ? l10n.t('Delete "{connectionName}"?', { connectionName: connectionsToDelete[0].cluster.name }) +
              '\n' +
              l10n.t('This cannot be undone.')
            : l10n.t('Delete {count} connections?', { count: connectionsToDelete.length }) +
              '\n' +
              l10n.t('This cannot be undone.');

    const confirmed = await getConfirmationAsInSettings(l10n.t('Are you sure?'), confirmationMessage, 'delete');

    if (!confirmed) {
        throw new UserCancelledError();
    }

    // Resilient deletion loop — continues even if individual deletions fail
    let successCount = 0;
    let failureCount = 0;

    await withConnectionsViewProgress(async () => {
        for (const connection of connectionsToDelete) {
            try {
                await ext.state.showDeleting(connection.id, async () => {
                    await ConnectionStorageService.delete(resolveStorageZone(connection.cluster), connection.storageId);
                });

                // delete cached credentials from memory using stable clusterId (not treeId)
                CredentialCache.deleteCredentials(connection.cluster.clusterId);

                // clear cached schema data for this cluster
                SchemaStore.getInstance().clearCluster(connection.cluster.clusterId);

                refreshParentInConnectionsView(connection.id);
                successCount++;
            } catch (error) {
                failureCount++;
                const errorMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.error(
                    l10n.t('Failed to remove connection "{connectionName}": {error}', {
                        connectionName: connection.cluster.name,
                        error: errorMessage,
                    }),
                );
            }
        }
    });

    context.telemetry.measurements.connectionsDeleted = successCount;
    context.telemetry.measurements.errorCount = failureCount;

    // Show appropriate feedback
    if (failureCount > 0 && successCount > 0) {
        showConfirmationAsInSettings(
            l10n.t('Removed {successCount} of {totalCount} connections. {failureCount} failed.', {
                successCount,
                totalCount: connectionsToDelete.length,
                failureCount,
            }),
        );
    } else if (failureCount === 0) {
        showConfirmationAsInSettings(
            connectionsToDelete.length === 1
                ? l10n.t('The selected connection has been removed.')
                : l10n.t('All {count} connections have been removed.', { count: connectionsToDelete.length }),
        );
    } else {
        // All deletions failed — surface an error so the user isn't left wondering what happened.
        void vscode.window.showErrorMessage(
            connectionsToDelete.length === 1
                ? l10n.t('Failed to remove the selected connection. See the output channel for details.')
                : l10n.t('Failed to remove all {count} connections. See the output channel for details.', {
                      count: connectionsToDelete.length,
                  }),
        );
    }
}
