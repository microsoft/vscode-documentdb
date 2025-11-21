/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { type DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';

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
        return;
    }

    // Set telemetry for the first node
    context.telemetry.properties.experience = connectionsToDelete[0].experience.api;
    context.telemetry.measurements.connectionsToDelete = connectionsToDelete.length;

    // Confirmation logic - different messages for single vs. multiple deletions
    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Are you sure?'),
        connectionsToDelete.length === 1
            ? l10n.t('Delete "{connectionName}"?', { connectionName: connectionsToDelete[0].cluster.name }) +
              '\n' +
              l10n.t('This cannot be undone.')
            : l10n.t('Delete {count} connections?', { count: connectionsToDelete.length }) +
              '\n' +
              l10n.t('This cannot be undone.'),
        'delete',
    );

    if (!confirmed) {
        throw new UserCancelledError();
    }

    // Resilient deletion loop - continue on failure
    let successCount = 0;
    let failureCount = 0;

    for (const connection of connectionsToDelete) {
        try {
            await ext.state.showDeleting(connection.id, async () => {
                if (connection.cluster.emulatorConfiguration?.isEmulator) {
                    await ConnectionStorageService.delete(ConnectionType.Emulators, connection.storageId);
                } else {
                    await ConnectionStorageService.delete(ConnectionType.Clusters, connection.storageId);
                }
            });

            // delete cached credentials from memory
            CredentialCache.deleteCredentials(connection.id);

            // Log success
            ext.outputChannel.info(
                l10n.t('Successfully removed connection "{connectionName}".', {
                    connectionName: connection.cluster.name,
                }),
            );
            successCount++;
        } catch (error) {
            // Log error and continue with next connection
            ext.outputChannel.error(
                l10n.t('Failed to remove connection "{connectionName}": {error}', {
                    connectionName: connection.cluster.name,
                    error: error instanceof Error ? error.message : String(error),
                }),
            );
            failureCount++;
        }
    }

    // Refresh the tree view
    ext.connectionsBranchDataProvider.refresh();

    // Set telemetry for successfully deleted connections
    context.telemetry.measurements.connectionsDeleted = successCount;

    // Show summary message
    if (connectionsToDelete.length === 1) {
        // For single connection, show success or error message
        if (successCount === 1) {
            showConfirmationAsInSettings(l10n.t('The selected connection has been removed.'));
        } else {
            // Error is already logged to outputChannel, so throw error to show notification
            throw new Error(
                l10n.t('Failed to remove connection "{connectionName}".', {
                    connectionName: connectionsToDelete[0].cluster.name,
                }),
            );
        }
    } else {
        // Show summary for multiple deletions
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
