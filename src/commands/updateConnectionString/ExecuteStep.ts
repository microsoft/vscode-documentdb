/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { ConnectionStorageService, ConnectionType, type ConnectionItem } from '../../services/connectionStorageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { nonNullValue } from '../../utils/nonNull';
import { type UpdateCSWizardContext } from './UpdateCSWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<UpdateCSWizardContext> {
    public priority: number = 100;

    public async execute(context: UpdateCSWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
        const items = await ConnectionStorageService.getItems(resourceType);
        const item = items.find((i) => i.id === context.storageId) as ConnectionItem | undefined;

        if (!item || !item.secrets?.connectionString) {
            console.error(`Item with ID "${context.storageId}" not found in storage or missing connection string.`);
            void window.showErrorMessage(l10n.t('Failed to update the connection.'));
            return;
        }

        if (item) {
            // now, copy the credentials from the original connection string,
            // take it directly from the storage item
            // and update the new connection string with the credentials
            const originalCS_WithCredentials = new URL(item.secrets.connectionString || '');
            const newCS = new URL(context.newCS_NoCredentials || '');

            newCS.username = originalCS_WithCredentials.username;
            newCS.password = originalCS_WithCredentials.password;

            item.secrets = { ...item.secrets, connectionString: nonNullValue(newCS.toString()) };

            try {
                await ConnectionStorageService.push(resourceType, item, true);
            } catch (pushError) {
                console.error(`Failed to update the item "${context.storageId}":`, pushError);
                void window.showErrorMessage(l10n.t('Failed to update the connection.'));
            }
        } else {
            console.error(`Item with ID "${context.storageId}" not found in storage.`);
            void window.showErrorMessage(l10n.t('Failed to update the connection.'));
        }

        showConfirmationAsInSettings(l10n.t('Connection updated successfully.'));
    }

    public shouldExecute(context: UpdateCSWizardContext): boolean {
        return !!context.newCS_NoCredentials && context.newCS_NoCredentials !== context.originalCS_NoCredentials;
    }
}
