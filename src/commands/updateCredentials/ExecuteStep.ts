/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { DocumentDBConnectionString } from '../../documentdb/utils/DocumentDBConnectionString';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { type UpdateCredentialsWizardContext } from './UpdateCredentialsWizardContext';

/**
 * Saves updated credentials to storage.
 *
 * This step:
 * 1. Removes embedded username/password from the connection string
 * 2. Updates the auth method-specific configuration (native auth or Entra ID)
 * 3. Saves the updated connection to storage
 *
 * Note: Cache clearing and error state management happen after the wizard completes
 * in the main updateCredentials function, not in this execution step.
 */
export class ExecuteStep extends AzureWizardExecuteStep<UpdateCredentialsWizardContext> {
    public priority: number = 100;

    public async execute(context: UpdateCredentialsWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
        const connectionCredentials = await ConnectionStorageService.get(context.storageId, resourceType);

        if (!connectionCredentials) {
            ext.outputChannel.error(l10n.t('Failed to save credentials: connection not found in storage.'));
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
            if (authMethod === AuthMethodId.NativeAuth && context.nativeAuthConfig) {
                // Update native auth config from structured config
                connectionCredentials.secrets.nativeAuthConfig = {
                    connectionUser: context.nativeAuthConfig.connectionUser,
                    connectionPassword: context.nativeAuthConfig.connectionPassword,
                };
            } else if (authMethod === AuthMethodId.MicrosoftEntraID && context.entraIdAuthConfig) {
                // For Entra ID, clear any native auth configs
                connectionCredentials.secrets.nativeAuthConfig = undefined;

                // Update Entra ID auth config from structured config
                connectionCredentials.secrets.entraIdAuthConfig = {
                    tenantId: context.entraIdAuthConfig.tenantId,
                    subscriptionId: context.entraIdAuthConfig.subscriptionId,
                };
            } else if (authMethod === AuthMethodId.MicrosoftEntraID) {
                // For Entra ID without config, clear any native auth configs
                connectionCredentials.secrets.nativeAuthConfig = undefined;

                // Clear any existing Entra ID config if no new config provided
                connectionCredentials.secrets.entraIdAuthConfig = undefined;
            }

            connectionCredentials.properties.selectedAuthMethod = context.selectedAuthenticationMethod?.toString();

            try {
                await ConnectionStorageService.save(resourceType, connectionCredentials, true);
            } catch (pushError) {
                ext.outputChannel.error(l10n.t('Failed to save credentials: {0}', String(pushError)));
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
