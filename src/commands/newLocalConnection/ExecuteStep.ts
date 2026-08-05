/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { redactCredentialsFromConnectionString } from '../../documentdb/utils/connectionStringHelpers';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import {
    type ConnectionItem,
    ConnectionStorageService,
    ConnectionType,
    ItemType,
} from '../../services/connectionStorageService';
import { QuickStartService } from '../../services/localQuickStart/QuickStartService';
import {
    buildFullTreePath,
    focusAndRevealInConnectionsView,
    refreshParentInConnectionsView,
    withConnectionsViewProgress,
} from '../../tree/connections-view/connectionsViewHelpers';
import { UserFacingError } from '../../utils/commandErrorHandling';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';
import { nonNullValue } from '../../utils/nonNull';
import { generateDocumentDBStorageId } from '../../utils/storageUtils';
import { findQuickStartInstanceForHosts, normalizeEndpointList } from './localEndpoint';
import { NewEmulatorConnectionMode, type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';

/** Tree path of the Quick Start managed-instance row in the Connections view. */
const QUICK_START_INSTANCE_TREE_PATH = 'connectionsView/localQuickStart/instance';

export class ExecuteStep extends AzureWizardExecuteStep<NewLocalConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewLocalConnectionWizardContext): Promise<void> {
        const experience = context.experience;

        switch (context.mode) {
            case NewEmulatorConnectionMode.Preconfigured:
                if (context.connectionString === undefined || context.port === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString, port, and api must be defined.'));
                }
                break;
            case NewEmulatorConnectionMode.CustomConnectionString:
                if (context.connectionString === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString must be defined.'));
                }
                break;
            default:
                throw new Error(l10n.t('Internal error: mode must be defined.'));
        }

        const newConnectionStringParsed = new DocumentDBConnectionString(context.connectionString.trim());
        newConnectionStringParsed.username = context.userName ?? '';
        newConnectionStringParsed.password = context.password ?? '';

        newConnectionStringParsed.hosts = newConnectionStringParsed.hosts.map((host) => {
            if (context.port) {
                const [hostname] = host.split(':');
                return `${hostname}:${context.port}`;
            }
            return host;
        });

        const joinedHosts = [...newConnectionStringParsed.hosts].sort().join(',');
        // Compared instead of `joinedHosts` for duplicate detection: `localhost`, `127.0.0.1`, and
        // `[::1]` are the same endpoint, and the raw strings are not (#858).
        const normalizedHosts = normalizeEndpointList(newConnectionStringParsed.hosts);

        // Sanity Check 0/2: does the Quick Start managed instance already serve this endpoint?
        // It is service-owned and in-memory rather than a stored connection, so the stored-connection
        // scan below cannot see it — which is how a bug-bash user ended up adding a second entry for
        // an instance Quick Start had already put in the Connections view (#858).
        const quickStartInstance = findQuickStartInstanceForHosts(
            newConnectionStringParsed.hosts,
            QuickStartService.listStatuses(),
        );
        if (quickStartInstance) {
            context.telemetry.properties.quickStartEndpointCollision = 'true';
            const openExisting = l10n.t('Open Existing');
            const addAnyway = l10n.t('Add Anyway');
            const choice = await vscode.window.showWarningMessage(
                l10n.t(
                    '“{0}” already uses localhost:{1}.',
                    quickStartInstance.displayName,
                    // `findQuickStartInstanceForHosts` only matches instances that HAVE a port.
                    String(quickStartInstance.port),
                ),
                {
                    modal: true,
                    detail: l10n.t(
                        'Quick Start added this instance to the Connections view, so there is no need to add it by hand. You can still create a separate connection if you want a different configuration for the same endpoint.',
                    ),
                },
                openExisting,
                addAnyway,
            );
            context.telemetry.properties.quickStartCollisionChoice =
                choice === addAnyway ? 'addAnyway' : choice === openExisting ? 'openExisting' : 'cancel';
            if (choice !== addAnyway) {
                if (choice === openExisting) {
                    await focusAndRevealInConnectionsView(context, QUICK_START_INSTANCE_TREE_PATH, {
                        select: true,
                        focus: true,
                        expand: false,
                    });
                }
                // Dismissing the dialog cancels the wizard rather than creating the duplicate it
                // just warned about.
                throw new UserCancelledError();
            }
        }

        //  Sanity Check 1/2: is there a connection with the same username + host in there?
        const existingConnections = await ConnectionStorageService.getAll(ConnectionType.Emulators);

        const existingDuplicateConnection = existingConnections.find((connection) => {
            const secret = connection.secrets?.connectionString;
            if (!secret) {
                ext.outputChannel.trace(
                    `[NewLocalConnection] Skipping stored connection "${connection.name}" (id: ${connection.id}) — empty connection string`,
                );
                return false; // Skip if no secret string is found
            }

            try {
                const itemCS = new DocumentDBConnectionString(secret);
                return (
                    itemCS.username === newConnectionStringParsed.username &&
                    normalizeEndpointList(itemCS.hosts) === normalizedHosts
                );
            } catch (error) {
                const rawMessage = error instanceof Error ? error.message : String(error);
                ext.outputChannel.warn(
                    `[NewLocalConnection] Stored connection "${connection.name}" (id: ${connection.id}) has an invalid connection string and was skipped during duplicate check: ${redactCredentialsFromConnectionString(rawMessage)}`,
                );
                return false;
            }
        });

        if (existingDuplicateConnection) {
            // Reveal the existing duplicate connection.
            // Use buildFullTreePath to correctly handle connections inside folders —
            // buildConnectionsViewTreePath produces a flat path that omits folder ancestors,
            // causing findNodeById to fail silently when the connection is in a folder.
            const connectionPath = await buildFullTreePath(existingDuplicateConnection.id, ConnectionType.Emulators);
            await focusAndRevealInConnectionsView(context, connectionPath, {
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
            newConnectionStringParsed.username && newConnectionStringParsed.username.length > 0
                ? `${newConnectionStringParsed.username}@${joinedHosts}`
                : joinedHosts;

        return withConnectionsViewProgress(async () => {
            let isEmulator: boolean = true;
            let disableEmulatorSecurity: boolean | undefined;

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
                } else {
                    // Fallback to prevent endless loop if regex fails - use timestamp for guaranteed uniqueness
                    newConnectionLabel = `${newConnectionLabel} (${Date.now()})`;
                }
                existingDuplicateLabel = existingConnections.find(
                    (connection) => connection.name === newConnectionLabel,
                );
            }

            // Now, we're safe to create a new connection with the new unique label

            switch (experience.api) {
                case API.CosmosDBMongoRU:
                case API.DocumentDB:
                    {
                        const mongoConfig = context.mongoEmulatorConfiguration as EmulatorConfiguration;
                        isEmulator = mongoConfig?.isEmulator ?? true;
                        disableEmulatorSecurity = mongoConfig?.disableEmulatorSecurity;
                    }
                    break;
                // Add additional cases here for APIs that require different handling
                default: {
                    isEmulator = context.isCoreEmulator ?? true;
                    break;
                }
            }

            const connectionString = newConnectionStringParsed.toString();

            const storageItem: ConnectionItem = {
                id: generateDocumentDBStorageId(connectionString),
                name: newConnectionLabel,
                properties: {
                    type: ItemType.Connection,
                    api: experience.api === API.DocumentDB ? API.DocumentDB : experience.api,
                    parentId: context.parentStorageId, // Set parent folder ID if in a subfolder
                    emulatorConfiguration: { isEmulator, disableEmulatorSecurity: !!disableEmulatorSecurity },
                    availableAuthMethods: [],
                },
                secrets: {
                    connectionString: nonNullValue(connectionString, 'secrets.connectionString', 'ExecuteStep.ts'),
                },
            };

            await ConnectionStorageService.save(ConnectionType.Emulators, storageItem, true);

            // Build the reveal path and focus on the new connection
            const connectionPath = `${context.parentTreeElementId}/${storageItem.id}`;

            // Refresh the parent to show the new connection
            refreshParentInConnectionsView(connectionPath);

            // Focus and reveal the new connection
            await focusAndRevealInConnectionsView(context, connectionPath);

            showConfirmationAsInSettings(l10n.t('New connection has been added.'));
        });
    }

    public shouldExecute(context: NewLocalConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
