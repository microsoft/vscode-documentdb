/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';

import { Views } from '../../documentdb/Views';
import { type ConnectionItem, ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { revealConnectionsViewElement } from '../../tree/api/revealConnectionsViewElement';
import {
    buildConnectionsViewTreePath,
    waitForConnectionsViewReady,
} from '../../tree/connections-view/connectionsViewHelpers';
import { UserFacingError } from '../../utils/commandErrorHandling';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { generateDocumentDBStorageId } from '../../utils/storageUtils';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        return vscode.window.withProgress(
            {
                location: { viewId: Views.ConnectionsView },
                cancellable: false,
            },
            async () => {
                const api = context.experience?.api ?? API.DocumentDB;
                const parentId = context.parentId;

                const newConnectionString = context.connectionString!;

                const newPassword = context.nativeAuth?.connectionPassword;
                const newUsername = context.nativeAuth?.connectionUser;

                const newAuthenticationMethod = context.selectedAuthenticationMethod;
                const newAvailableAuthenticationMethods =
                    context.availableAuthenticationMethods ??
                    (newAuthenticationMethod ? [newAuthenticationMethod] : []);

                const newParsedCS = new DocumentDBConnectionString(newConnectionString);
                const newJoinedHosts = [...newParsedCS.hosts].sort().join(',');

                //  Sanity Check 1/2: is there a connection with the same username + host in there?
                const existingConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);

                const existingDuplicateConnection = existingConnections.find((existingConnection) => {
                    const existingCS = new DocumentDBConnectionString(existingConnection.secrets.connectionString);
                    const existingHostsJoined = [...existingCS.hosts].sort().join(',');
                    // Use nativeAuth for comparison
                    const existingUsername = existingConnection.secrets.nativeAuth?.connectionUser;

                    return existingUsername === newUsername && existingHostsJoined === newJoinedHosts;
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

                // remove obsolete authMechanism entry
                if (newParsedCS.searchParams.get('authMechanism') === 'SCRAM-SHA-256') {
                    newParsedCS.searchParams.delete('authMechanism');
                }
                newParsedCS.username = '';
                newParsedCS.password = '';

                let newConnectionLabel =
                    newUsername && newUsername.length > 0 ? `${newUsername}@${newJoinedHosts}` : newJoinedHosts;

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

                const storageId = generateDocumentDBStorageId(newParsedCS.toString());

                const storageItem: ConnectionItem = {
                    id: storageId,
                    name: newConnectionLabel,
                    properties: {
                        api: api,
                        availableAuthMethods: newAvailableAuthenticationMethods,
                        selectedAuthMethod: newAuthenticationMethod,
                    },
                    secrets: {
                        connectionString: newParsedCS.toString(),
                        nativeAuth:
                            context.nativeAuth ??
                            (newAuthenticationMethod === AuthMethodId.NativeAuth && (newUsername || newPassword)
                                ? {
                                      connectionUser: newUsername ?? '',
                                      connectionPassword: newPassword,
                                  }
                                : undefined),
                        entraIdAuth: context.entraIdAuth,
                    },
                };

                await ConnectionStorageService.save(ConnectionType.Clusters, storageItem, true);

                // Refresh the connections tree when adding a new root-level connection
                if (parentId === undefined || parentId === '') {
                    await vscode.commands.executeCommand(`connectionsView.focus`);
                    ext.connectionsBranchDataProvider.refresh();
                    await waitForConnectionsViewReady(context);

                    // Reveal the connection
                    const connectionPath = buildConnectionsViewTreePath(storageId, false);
                    await revealConnectionsViewElement(context, connectionPath, {
                        select: true,
                        focus: true,
                        expand: false, // Don't expand immediately to avoid login prompts
                    });
                }

                showConfirmationAsInSettings(l10n.t('New connection has been added.'));
            },
        );
    }

    public shouldExecute(context: NewConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
