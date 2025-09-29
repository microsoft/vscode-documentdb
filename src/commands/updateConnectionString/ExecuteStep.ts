/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { McpService } from '../../services/McpService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { nonNullValue } from '../../utils/nonNull';
import { type UpdateCSWizardContext } from './UpdateCSWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<UpdateCSWizardContext> {
    public priority: number = 100;

    public async execute(context: UpdateCSWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
        const connection = await ConnectionStorageService.get(context.storageId, resourceType);

        if (!connection || !connection.secrets?.connectionString) {
            console.error(
                `Connection with ID "${context.storageId}" not found in storage or missing connection string.`,
            );
            void window.showErrorMessage(l10n.t('Failed to update the connection.'));
            return;
        }

        try {
            connection.secrets = {
                ...connection.secrets,
                connectionString: nonNullValue(
                    context.newConnectionString?.toString(),
                    'context.newConnectionString',
                    'ExecuteStep.ts',
                ),
            };

            await ConnectionStorageService.save(resourceType, connection, true);

            // Sync the updated connection with MCP service (non-blocking)
            try {
                const mcpService = McpService.getInstance();
                const updatedConnectionString = connection.secrets.connectionString;
                // Reconstruct full connection string with credentials if available
                if (connection.secrets.userName || connection.secrets.password) {
                    const { DocumentDBConnectionString } = await import('../../documentdb/utils/DocumentDBConnectionString');
                    const mcpConnectionString = new DocumentDBConnectionString(updatedConnectionString);
                    if (connection.secrets.userName) mcpConnectionString.username = connection.secrets.userName;
                    if (connection.secrets.password) mcpConnectionString.password = connection.secrets.password;
                    await mcpService.syncConnection(mcpConnectionString.toString());
                } else {
                    await mcpService.syncConnection(updatedConnectionString);
                }
            } catch (mcpError) {
                // MCP sync is optional - log but don't fail the connection update
                console.warn('MCP sync failed:', mcpError);
            }
        } catch (pushError) {
            console.error(`Failed to update the connection "${context.storageId}":`, pushError);
            void window.showErrorMessage(l10n.t('Failed to update the connection.'));
        }

        showConfirmationAsInSettings(l10n.t('Connection updated successfully.'));
    }

    public shouldExecute(context: UpdateCSWizardContext): boolean {
        return !!context.newConnectionString && context.newConnectionString !== context.originalConnectionString;
    }
}
