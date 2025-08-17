/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { ConnectionStorageService, ConnectionType, type ConnectionItem } from '../../services/connectionStorageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<UpdateCredentialsWizardContext> {
    public priority: number = 100;

    public async execute(context: UpdateCredentialsWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
        const items = await ConnectionStorageService.get(resourceType);

        // TODO: create a getItem method in storageService, otherwise too many secrets
        // are being read from the storage
        const item = items.find((item) => item.id === context.storageId) as ConnectionItem | undefined;

        if (!item) {
            console.error(`Item with ID "${context.storageId}" not found in storage.`);
            void window.showErrorMessage(l10n.t('Failed to save credentials.'));
            return;
        }

        if (item && item.secrets?.connectionString) {
            // Update the connection string with the new username and password

            const connectionString = item.secrets.connectionString;

            const parsedConnectionString = new DocumentDBConnectionString(connectionString);
            parsedConnectionString.username = context.username || '';
            parsedConnectionString.password = context.password || '';

            // Update the item in storage
            item.secrets = { ...item.secrets, connectionString: parsedConnectionString.toString() };

            try {
                await ConnectionStorageService.save(resourceType, item, true);
            } catch (pushError) {
                console.error(`Failed to save credentials for item "${context.storageId}":`, pushError);
                void window.showErrorMessage(l10n.t('Failed to save credentials.'));
                return;
            }

            showConfirmationAsInSettings(l10n.t('Credentials updated successfully.'));
        }
    }

    public shouldExecute(): boolean {
        return true;
    }
}
