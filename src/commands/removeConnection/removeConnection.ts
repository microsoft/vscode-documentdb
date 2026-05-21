/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { SchemaStore } from '../../documentdb/SchemaStore';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { checkCanProceedAndInformUser } from '../../services/taskService/resourceUsageHelper';
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

export async function removeConnection(
    context: IActionContext,
    node?: DocumentDBClusterItem,
    nodes?: DocumentDBClusterItem[],
): Promise<void> {
    // Determine the list of connections to delete
    let connectionsToDelete: DocumentDBClusterItem[];
    if (nodes && nodes.length > 0) {
        connectionsToDelete = nodes;
    } else if (node) {
        connectionsToDelete = [node];
    } else {
        connectionsToDelete = [];
    }

    if (connectionsToDelete.length === 0) {
        ext.outputChannel.warn(l10n.t('No connections selected to remove.'));
        return;
    }

    // Set telemetry for the first node
    context.telemetry.properties.experience = connectionsToDelete[0].experience.api;
    context.telemetry.measurements.connectionsToDelete = connectionsToDelete.length;

    // Check if any running tasks are using these connections
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

    // Confirmation logic - different messages for single vs. multiple deletions
    const expectedConfirmationWord =
        connectionsToDelete.length === 1 ? 'delete' : connectionsToDelete.length.toString();
    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Are you sure?'),
        connectionsToDelete.length === 1
            ? l10n.t('Delete "{connectionName}"?', { connectionName: connectionsToDelete[0].cluster.name }) +
                  '\n' +
                  l10n.t('This cannot be undone.')
            : l10n.t('Delete {count} connections?', { count: connectionsToDelete.length }) +
                  '\n' +
                  l10n.t('This cannot be undone.'),
        expectedConfirmationWord,
    );

    if (!confirmed) {
        throw new UserCancelledError();
    }

    // Resilient deletion loop - continue on failure
    let successCount = 0;
    let failureCount = 0;

    await withConnectionsViewProgress(async () => {
        for (const connection of connectionsToDelete) {
            try {
                await ext.state.showDeleting(connection.id, async () => {
                    if (connection.cluster.emulatorConfiguration?.isEmulator) {
                        await ConnectionStorageService.delete(ConnectionType.Emulators, connection.storageId);
                    } else {
                        await ConnectionStorageService.delete(ConnectionType.Clusters, connection.storageId);
                    }
                });

                // delete cached credentials from memory using stable clusterId (not treeId)
                CredentialCache.deleteCredentials(connection.cluster.clusterId);

                // clear cached schema data for this cluster
                SchemaStore.getInstance().clearCluster(connection.cluster.clusterId);

                successCount++;
            } catch (error) {
                ext.outputChannel.error(
                    l10n.t('Failed to remove connection "{connectionName}": {error}', {
                        connectionName: connection.cluster.name,
                        error: error instanceof Error ? error.message : String(error),
                    }),
                );

                // Intentionally capturing only the last error in telemetry properties.
                // The errorCount metric provides full context on how many deletions failed.
                context.telemetry.properties.error = 'RemoveConnectionError';
                context.telemetry.properties.errorMessage = error instanceof Error ? error.message : String(error);

                failureCount++;
            }
        }

        refreshParentInConnectionsView(connectionsToDelete[0].id);
    });

    // Set telemetry for deletion results
    context.telemetry.measurements.connectionsDeleted = successCount;
    context.telemetry.measurements.errorCount = failureCount;

    // Show summary message
    if (connectionsToDelete.length === 1) {
        if (successCount === 1) {
            showConfirmationAsInSettings(l10n.t('The selected connection has been removed.'));
        } else {
            throw new Error(
                l10n.t('Failed to remove connection "{connectionName}".', {
                    connectionName: connectionsToDelete[0].cluster.name,
                }),
            );
        }
    } else {
        const summaryMessage =
            failureCount === 0
                ? l10n.t('Successfully removed {count} connections.', { count: successCount })
                : l10n.t('Removed {successCount} of {total} connections. {failureCount} failed.', {
                      successCount,
                      total: connectionsToDelete.length,
                      failureCount,
                  });
        showConfirmationAsInSettings(summaryMessage);
    }
}
