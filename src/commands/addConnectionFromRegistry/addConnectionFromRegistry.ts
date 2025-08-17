/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import vscode from 'vscode';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { Views } from '../../documentdb/Views';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { type DocumentDBResourceItem } from '../../plugins/service-azure/discovery-tree/documentdb/DocumentDBResourceItem';
import { ConnectionStorageService, ConnectionType, type ConnectionItem } from '../../services/connectionStorageService';
import { revealConnectionsViewElement } from '../../tree/api/revealConnectionsViewElement';
import {
    buildConnectionsViewTreePath,
    waitForConnectionsViewReady,
} from '../../tree/connections-view/connectionsViewHelpers';
import { UserFacingError } from '../../utils/commandErrorHandling';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { generateDocumentDBStorageId } from '../../utils/storageUtils';

export async function addConnectionFromRegistry(context: IActionContext, node: DocumentDBResourceItem): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    return vscode.window.withProgress(
        {
            location: { viewId: Views.ConnectionsView },
            cancellable: false,
        },
        async () => {
            const newConnectionString = await ext.state.runWithTemporaryDescription(
                node.id,
                l10n.t('Working…'),
                async () => {
                    context.telemetry.properties.experience = node.experience.api;

                    return node.getConnectionString();
                },
            );

            if (!newConnectionString) {
                throw new Error(l10n.t('Unable to retrieve connection string for the selected cluster.'));
            }

            const parsedCS = new DocumentDBConnectionString(newConnectionString);
            const joinedHosts = [...parsedCS.hosts].sort().join(',');

            //  Sanity Check 1/2: is there a connection with the same username + host in there?
            const existingConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);

            const existingDuplicateConnection = existingConnections.find((connection) => {
                const secret = connection.secrets?.connectionString;
                if (!secret) {
                    return false; // Skip if no secret string is found
                }

                const itemCS = new DocumentDBConnectionString(secret);
                return itemCS.username === parsedCS.username && [...itemCS.hosts].sort().join(',') === joinedHosts;
            });

            if (existingDuplicateConnection) {
                // Reveal the existing duplicate connection
                const connectionPath = buildConnectionsViewTreePath(existingDuplicateConnection.id, false);
                await revealConnectionsViewElement(context, connectionPath, {
                    select: true,
                    focus: false,
                    expand: false, // Don't expand to avoid login prompts
                });

                throw new UserFacingError(l10n.t('A connection with the same username and host already exists.'), {
                    details: l10n.t(
                        'The existing connection has been selected in the Connections View.\n\nSelected connection name:\n"{0}"',
                        existingDuplicateConnection.name,
                    ),
                });
            }

            const newConnectionLabel =
                parsedCS.username && parsedCS.username.length > 0 ? `${parsedCS.username}@${joinedHosts}` : joinedHosts;

            const storageId = generateDocumentDBStorageId(newConnectionString);

            const storageItem: ConnectionItem = {
                id: storageId,
                name: newConnectionLabel,
                properties: { api: API.MongoClusters, availableAuthMethods: [] },
                secrets: { connectionString: newConnectionString },
            };

            await ConnectionStorageService.save(ConnectionType.Clusters, storageItem, true);

            await vscode.commands.executeCommand(`connectionsView.focus`);
            ext.connectionsBranchDataProvider.refresh();
            await waitForConnectionsViewReady(context);

            // Reveal the connection
            const connectionPath = buildConnectionsViewTreePath(storageItem.id, false);
            await revealConnectionsViewElement(context, connectionPath, {
                select: true,
                focus: false,
                expand: false, // Don't expand immediately to avoid login prompts
            });

            showConfirmationAsInSettings(l10n.t('New connection has been added to your DocumentDB Connections.'));
        },
    );
}
