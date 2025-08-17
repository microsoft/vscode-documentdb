/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<UpdateCredentialsWizardContext> {
    public priority: number = 100;

    public async execute(context: UpdateCredentialsWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
        const connection = await ConnectionStorageService.get(context.storageId, resourceType);

        if (!connection) {
            console.error(`Connection with ID "${context.storageId}" not found in storage.`);
            void window.showErrorMessage(l10n.t('Failed to save credentials.'));
            return;
        }

        if (connection && connection.secrets?.connectionString) {
            // Update the connection string with the new username and password

            const connectionString = connection.secrets.connectionString;

            const parsedConnectionString = new DocumentDBConnectionString(connectionString);
            parsedConnectionString.username = context.username || '';
            parsedConnectionString.password = context.password || '';

            // Update the item in storage

            connection.secrets = { ...connection.secrets, connectionString: parsedConnectionString.toString() };

            try {
                await ConnectionStorageService.save(resourceType, connection, true);
            } catch (pushError) {
                console.error(`Failed to save credentials for connection "${context.storageId}":`, pushError);
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
