/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionString } from 'mongodb-connection-string-url';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { type StorageItem, StorageNames, StorageService } from '../../services/storageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';
import { nonNullValue } from '../../utils/nonNull';
import { generateDocumentDBStorageId } from '../../utils/storageUtils';
import { NewEmulatorConnectionMode, type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<NewLocalConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewLocalConnectionWizardContext): Promise<void> {
        const parentId = context.parentTreeElementId;
        let connectionString = context.connectionString;
        const port = context.port;
        const experience = context.experience;

        switch (context.mode) {
            case NewEmulatorConnectionMode.Preconfigured:
                if (connectionString === undefined || port === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString, port, and api must be defined.'));
                }
                break;
            case NewEmulatorConnectionMode.CustomConnectionString:
                if (connectionString === undefined || experience === undefined) {
                    throw new Error(l10n.t('Internal error: connectionString must be defined.'));
                }
                break;
            default:
                throw new Error(l10n.t('Internal error: mode must be defined.'));
        }

        const parsedCS = new ConnectionString(connectionString);
        const joinedHosts = [...parsedCS.hosts].sort().join(',');

        //  Sanity Check 1/2: is there a connection with the same username + host in there?
        const existingConnections = await StorageService.get(StorageNames.Connections).getItems('emulators');

        const existingDuplicateConnection = existingConnections.find((item) => {
            const secret = item.secrets?.[0];
            if (!secret) {
                return false; // Skip if no secret string is found
            }

            const itemCS = new ConnectionString(secret);
            return itemCS.username === parsedCS.username && [...itemCS.hosts].sort().join(',') === joinedHosts;
        });

        if (existingDuplicateConnection) {
            throw new Error(
                l10n.t('A connection "{existingName}" with the same username and host already exists.', {
                    existingName: existingDuplicateConnection.name,
                }),
            );
        }

        let newConnectionLabel =
            parsedCS.username && parsedCS.username.length > 0 ? `${parsedCS.username}@${joinedHosts}` : joinedHosts;

        return ext.state.showCreatingChild(parentId, l10n.t('Creating new connection…'), async () => {
            await new Promise((resolve) => setTimeout(resolve, 250));

            let isEmulator: boolean = true;
            let disableEmulatorSecurity: boolean | undefined;

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

            switch (experience.api) {
                case API.MongoDB:
                case API.MongoClusters:
                case API.DocumentDB:
                    {
                        const mongoConfig = context.mongoEmulatorConfiguration as EmulatorConfiguration;
                        isEmulator = mongoConfig?.isEmulator ?? true;
                        disableEmulatorSecurity = mongoConfig?.disableEmulatorSecurity;

                        if (context.userName || context.password) {
                            const parsedConnectionString = new ConnectionString(nonNullValue(connectionString));
                            parsedConnectionString.username = context.userName ?? '';
                            parsedConnectionString.password = context.password ?? '';

                            connectionString = parsedConnectionString.toString();
                        }
                    }
                    break;
                // Add additional cases here for APIs that require different handling
                default: {
                    isEmulator = context.isCoreEmulator ?? true;
                    break;
                }
            }

            const storageItem: StorageItem = {
                id: generateDocumentDBStorageId(connectionString!),
                name: newConnectionLabel,
                properties: {
                    api: experience.api === API.DocumentDB ? API.MongoClusters : experience.api,
                    isEmulator,
                    ...(disableEmulatorSecurity && { disableEmulatorSecurity }),
                },
                secrets: [nonNullValue(connectionString)],
            };

            await StorageService.get(StorageNames.Connections).push('emulators', storageItem, true);

            ext.connectionsBranchDataProvider.refresh();

            showConfirmationAsInSettings(l10n.t('New connection has been added.'));
        });
    }

    public shouldExecute(context: NewLocalConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
