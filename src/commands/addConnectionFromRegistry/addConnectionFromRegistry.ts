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
import { ConnectionStorageService, ConnectionType, type ConnectionItem } from '../../services/connectionStorageService';
import { revealConnectionsViewElement } from '../../tree/api/revealConnectionsViewElement';
import {
    buildConnectionsViewTreePath,
    waitForConnectionsViewReady,
} from '../../tree/connections-view/connectionsViewHelpers';
import { type ClusterItemBase } from '../../tree/documentdb/ClusterItemBase';
import { UserFacingError } from '../../utils/commandErrorHandling';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { generateDocumentDBStorageId } from '../../utils/storageUtils';

export async function addConnectionFromRegistry(context: IActionContext, node: ClusterItemBase): Promise<void> {
    if (!node) {
        throw new Error(l10n.t('No node selected.'));
    }

    // Include journey correlation ID in telemetry for funnel analysis
    // This is for statistics only - does not influence functionality
    if (node.journeyCorrelationId) {
        context.telemetry.properties.journeyCorrelationId = node.journeyCorrelationId;
    }

    // FYI: As of Sept 2025 this command is used in two views: the discovery view and the azure resources view
    const sourceViewId =
        node.contextValue.includes('documentDbBranch') || node.contextValue.includes('ruBranch')
            ? Views.AzureResourcesView
            : Views.DiscoveryView;

    if (sourceViewId === Views.AzureResourcesView) {
        // Show a modal dialog informing the user that the details will be saved for future use
        const continueButton = l10n.t('Yes, continue');
        const message = l10n.t(
            'Connection: "{selectedConnectionName}"\n\nThe connection will be added to the "Connections View" in the "DocumentDB for VS Code" extension. The "Connections View" will be opened once this process completes.\n\nDo you want to continue?',
            {
                selectedConnectionName: node.cluster.name,
            },
        );

        const result = await vscode.window.showInformationMessage(message, { modal: true }, continueButton);

        if (result !== continueButton) {
            return; // User cancelled
        }
    }

    return vscode.window.withProgress(
        {
            location: { viewId: Views.ConnectionsView },
            cancellable: false,
        },
        async () => {
            const credentials = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
                context.telemetry.properties.experience = node.experience.api;

                return node.getCredentials();
            });

            if (!credentials) {
                throw new Error(l10n.t('Unable to retrieve credentials for the selected cluster.'));
            }

            const parsedCS = new DocumentDBConnectionString(credentials.connectionString);
            const username = credentials.nativeAuthConfig?.connectionUser || parsedCS.username;
            parsedCS.username = '';

            const joinedHosts = [...parsedCS.hosts].sort().join(',');

            //  Sanity Check 1/2: is there a connection with the same username + host in there?
            const existingConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);

            const existingDuplicateConnection = existingConnections.find((existingConnection) => {
                const existingCS = new DocumentDBConnectionString(existingConnection.secrets.connectionString);
                const existingHostsJoined = [...existingCS.hosts].sort().join(',');
                // Use nativeAuthConfig for comparison
                const existingUsername = existingConnection.secrets.nativeAuthConfig?.connectionUser;
                return existingUsername === username && existingHostsJoined === joinedHosts;
            });

            if (existingDuplicateConnection) {
                // Reveal the existing duplicate connection
                await vscode.commands.executeCommand(`connectionsView.focus`);
                ext.connectionsBranchDataProvider.refresh();
                await waitForConnectionsViewReady(context);

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

            let newConnectionLabel = username && username.length > 0 ? `${username}@${joinedHosts}` : joinedHosts;

            // Sanity Check 2/2: is there a connection with the same 'label' in there?
            // If so, append a number to the label.
            // This scenario is possible as users are allowed to rename their connections.
            let existingDuplicateLabel = existingConnections.find(
                (connection) => connection.name === newConnectionLabel,
            );

            // If a connection with the same label exists, append a number to the label
            while (existingDuplicateLabel) {
                /**
                 * Matches and captures parts of a connection label string.
                 *
                 * The regular expression `^(.*?)(\s*\(\d+\))?$` is used to parse the connection label into two groups:
                 * - The first capturing group `(.*?)` matches the main part of the label (non-greedy match of any characters).
                 * - The second capturing group `(\s*\(\d+\))?` optionally matches a numeric suffix enclosed in parentheses,
                 *   which may be preceded by whitespace. For example, " (123)".
                 *
                 * Examples:
                 * - Input: "ConnectionName (123)" -> Match: ["ConnectionName (123)", "ConnectionName", " (123)"]
                 * - Input: "ConnectionName" -> Match: ["ConnectionName", "ConnectionName", undefined]
                 */
                const match = newConnectionLabel.match(/^(.*?)(\s*\(\d+\))?$/);
                if (match) {
                    const baseName = match[1];
                    const count = match[2] ? parseInt(match[2].replace(/\D/g, ''), 10) + 1 : 1;
                    newConnectionLabel = `${baseName} (${count})`;
                }
                existingDuplicateLabel = existingConnections.find(
                    (connection) => connection.name === newConnectionLabel,
                );
            }

            // Now, we're safe to create a new connection with the new unique label

            const storageId = generateDocumentDBStorageId(parsedCS.toString());

            const connectionItem: ConnectionItem = {
                id: storageId,
                name: newConnectionLabel,
                properties: { api: API.DocumentDB, availableAuthMethods: credentials.availableAuthMethods },
                secrets: {
                    connectionString: parsedCS.toString(),
                    nativeAuthConfig: credentials.nativeAuthConfig,
                    entraIdAuthConfig: credentials.entraIdAuthConfig,
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
