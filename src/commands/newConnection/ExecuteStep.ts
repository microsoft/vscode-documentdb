/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';

import { Views } from '../../documentdb/Views';
import { type StorageItem, StorageNames, StorageService } from '../../services/storageService';
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
                const connectionString = context.connectionString!;
                const parentId = context.parentId;

                const parsedCS = new DocumentDBConnectionString(connectionString);
                const joinedHosts = [...parsedCS.hosts].sort().join(',');

                //  Sanity Check 1/2: is there a connection with the same username + host in there?
                const existingConnections = await StorageService.get(StorageNames.Connections).getItems('clusters');

                const existingDuplicateConnection = existingConnections.find((item) => {
                    const secret = item.secrets?.[0];
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

                let newConnectionLabel =
                    parsedCS.username && parsedCS.username.length > 0
                        ? `${parsedCS.username}@${joinedHosts}`
                        : joinedHosts;

                // Sanity Check 2/2: is there a connection with the same 'label' in there?
                // If so, append a number to the label.
                // This scenario is possible as users are allowed to rename their connections.

                let existingDuplicateLabel = existingConnections.find((item) => item.name === newConnectionLabel);
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
                    existingDuplicateLabel = existingConnections.find((item) => item.name === newConnectionLabel);
                }

                // Now, we're safe to create a new connection with the new unique label

                const storageId = generateDocumentDBStorageId(connectionString);

                const storageItem: StorageItem = {
                    id: storageId,
                    name: newConnectionLabel,
                    properties: { isEmulator: false, api: api },
                    secrets: [connectionString],
                };

                await StorageService.get(StorageNames.Connections).push('clusters', storageItem, true);

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
