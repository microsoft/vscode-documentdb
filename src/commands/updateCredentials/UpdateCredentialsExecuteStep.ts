/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import ConnectionString from 'mongodb-connection-string-url';
import { l10n, window } from 'vscode';
import { StorageNames, StorageService } from '../../services/storageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class UpdateCredentialsExecuteStep extends AzureWizardExecuteStep<UpdateCredentialsWizardContext> {
    public priority: number = 100;

    public async execute(context: UpdateCredentialsWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? 'emulators' : 'clusters';

        const storage = StorageService.get(StorageNames.Connections);
        const items = await storage.getItems(resourceType);

        // TODO: create a getItem method in storageService, otherwise too many secrets
        // are being read from the storage
        const item = items.find((item) => item.id === context.storageId);

        if (item && item.secrets?.[0] && context.username && context.password) {
            // Update the connection string with the new username and password

            const connectionString = item.secrets[0];

            const parsedConnectionString = new ConnectionString(connectionString);
            parsedConnectionString.username = context.username;
            parsedConnectionString.password = context.password;

            // Update the item in storage
            item.secrets = [parsedConnectionString.toString()];

            try {
                await storage.push(resourceType, item, true);
            } catch (pushError) {
                console.error(`Failed to save credentials for item "${context.storageId}":`, pushError);
                void window.showErrorMessage(l10n.t('Failed to save credentials.'));
            }

            showConfirmationAsInSettings(l10n.t('Credentials updated successfully.'));
        } else {
            console.error(`Item with ID "${context.storageId}" not found in storage.`);
            void window.showErrorMessage(l10n.t('Failed to save credentials.'));
        }
    }

    public shouldExecute(): boolean {
        return true;
    }
}
