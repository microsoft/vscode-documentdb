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
            const newCredentials = await ext.state.runWithTemporaryDescription(
                node.id,
                l10n.t('Working…'),
                async () => {
                    context.telemetry.properties.experience = node.experience.api;

                    return node.getCredentials();
                },
            );

            if (!newCredentials) {
                throw new Error(l10n.t('Unable to retrieve credentials for the selected cluster.'));
            }

            const newParsedCS = new DocumentDBConnectionString(newCredentials.connectionString);
            newParsedCS.username = newCredentials.connectionUser || newParsedCS.username;
            const newJoinedHosts = [...newParsedCS.hosts].sort().join(',');

            //  Sanity Check 1/2: is there a connection with the same username + host in there?
            const existingConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);

            const existingDuplicateConnection = existingConnections.find((existingConnection) => {
                const existingCS = new DocumentDBConnectionString(existingConnection.secrets.connectionString);
                const existingHostsJoined = [...existingCS.hosts].sort().join(',');
                return (
                    existingConnection.secrets.userName === newParsedCS.username &&
                    existingHostsJoined === newJoinedHosts
                );
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
                newParsedCS.username && newParsedCS.username.length > 0
                    ? `${newParsedCS.username}@${newJoinedHosts}`
                    : newJoinedHosts;

            const storageId = generateDocumentDBStorageId(newCredentials.connectionString);

            const connectionItem: ConnectionItem = {
                id: storageId,
                name: newConnectionLabel,
                properties: { api: API.DocumentDB, availableAuthMethods: newCredentials.availableAuthMethods },
                secrets: {
                    connectionString: newCredentials.connectionString,
                    userName: newCredentials.connectionUser,
                    password: newCredentials.connectionPassword,
                },
            };

            await ConnectionStorageService.save(ConnectionType.Clusters, connectionItem, true);

            await vscode.commands.executeCommand(`connectionsView.focus`);
            ext.connectionsBranchDataProvider.refresh();
            await waitForConnectionsViewReady(context);

            // Reveal the connection
            const connectionPath = buildConnectionsViewTreePath(connectionItem.id, false);
            await revealConnectionsViewElement(context, connectionPath, {
                select: true,
                focus: false,
                expand: false, // Don't expand immediately to avoid login prompts
            });

            showConfirmationAsInSettings(l10n.t('New connection has been added to your DocumentDB Connections.'));
        },
    );
}
