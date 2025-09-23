/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<UpdateCredentialsWizardContext> {
    public priority: number = 100;

    public async execute(context: UpdateCredentialsWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
        const connectionCredentials = await ConnectionStorageService.get(context.storageId, resourceType);

        if (!connectionCredentials) {
            console.error(`Connection with ID "${context.storageId}" not found in storage.`);
            void window.showErrorMessage(l10n.t('Failed to save credentials.'));
            return;
        }

        if (connectionCredentials && connectionCredentials.secrets?.connectionString) {
            // Update the connection string with the new username and password

            const connectionString = connectionCredentials.secrets.connectionString;

            const parsedConnectionString = new DocumentDBConnectionString(connectionString);
            parsedConnectionString.username = '';
            parsedConnectionString.password = '';

            // Update the item in storage
            const authMethod = context.selectedAuthenticationMethod;

            // Update connection string (remove embedded credentials)
            connectionCredentials.secrets = {
                ...connectionCredentials.secrets,
                connectionString: parsedConnectionString.toString(),
            };

            // Update auth method specific configurations
            if (authMethod === AuthMethodId.NativeAuth && context.nativeAuth) {
                // Update native auth config from structured config
                connectionCredentials.secrets.nativeAuth = {
                    connectionUser: context.nativeAuth.connectionUser,
                    connectionPassword: context.nativeAuth.connectionPassword,
                };
            } else if (authMethod === AuthMethodId.MicrosoftEntraID) {
                // For Entra ID, clear any native auth configs
                connectionCredentials.secrets.nativeAuth = undefined;

                // Entra ID config will be set up during authentication flow
                // No need to store it here as it's retrieved from Azure context
            }

            connectionCredentials.properties.selectedAuthMethod = context.selectedAuthenticationMethod?.toString();

            try {
                await ConnectionStorageService.save(resourceType, connectionCredentials, true);
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
