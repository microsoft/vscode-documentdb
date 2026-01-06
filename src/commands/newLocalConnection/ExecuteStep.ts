/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { type ConnectionItem, ConnectionStorageService, ConnectionType, ItemType } from '../../services/connectionStorageService';
import { UserFacingError } from '../../utils/commandErrorHandling';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';
import { nonNullValue } from '../../utils/nonNull';
import { generateDocumentDBStorageId } from '../../utils/storageUtils';
import { NewEmulatorConnectionMode, type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<NewLocalConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewLocalConnectionWizardContext): Promise<void> {
        const parentId = context.parentTreeElementId;
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

        const newConnectionStringParsed = new DocumentDBConnectionString(context.connectionString);
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

        //  Sanity Check 1/2: is there a connection with the same username + host in there?
        const existingConnections = await ConnectionStorageService.getAll(ConnectionType.Emulators);

        const existingDuplicateConnection = existingConnections.find((connection) => {
            const secret = connection.secrets?.connectionString;
            if (!secret) {
                return false; // Skip if no secret string is found
            }

            const itemCS = new DocumentDBConnectionString(secret);
            return (
                itemCS.username === newConnectionStringParsed.username &&
                [...itemCS.hosts].sort().join(',') === joinedHosts
            );
        });

        if (existingDuplicateConnection) {
            throw new UserFacingError(l10n.t('A connection with the same username and host already exists.'), {
                details: l10n.t('The existing connection name:\n"{0}"', existingDuplicateConnection.name),
            });
        }

        let newConnectionLabel =
            newConnectionStringParsed.username && newConnectionStringParsed.username.length > 0
                ? `${newConnectionStringParsed.username}@${joinedHosts}`
                : joinedHosts;

        return ext.state.showCreatingChild(parentId, l10n.t('Creating new connection…'), async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));

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
                    emulatorConfiguration: { isEmulator, disableEmulatorSecurity: !!disableEmulatorSecurity },
                    availableAuthMethods: [],
                },
                secrets: {
                    connectionString: nonNullValue(connectionString, 'secrets.connectionString', 'ExecuteStep.ts'),
                },
            };

            await ConnectionStorageService.save(ConnectionType.Emulators, storageItem, true);

            // We're not refreshing the tree here, the new connection is a child node, the parent node will refresh itself

            showConfirmationAsInSettings(l10n.t('New connection has been added.'));
        });
    }

    public shouldExecute(context: NewLocalConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
