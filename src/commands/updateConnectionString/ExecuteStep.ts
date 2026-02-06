/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { showConfirmationAsInSettings } from '../../utils/dialogs/showConfirmation';
import { nonNullValue } from '../../utils/nonNull';
import { type UpdateCSWizardContext } from './UpdateCSWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<UpdateCSWizardContext> {
    public priority: number = 100;

    public async execute(context: UpdateCSWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
        const connection = await ConnectionStorageService.get(context.storageId, resourceType);

        if (!connection || !connection.secrets?.connectionString) {
            ext.outputChannel.error(
                l10n.t('Failed to update connection: connection not found in storage or missing connection string.'),
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
        } catch (pushError) {
            ext.outputChannel.error(l10n.t('Failed to update connection: {0}', String(pushError)));
            void window.showErrorMessage(l10n.t('Failed to update the connection.'));
        }

        showConfirmationAsInSettings(l10n.t('Connection updated successfully.'));
    }

    public shouldExecute(context: UpdateCSWizardContext): boolean {
        return !!context.newConnectionString && context.newConnectionString !== context.originalConnectionString;
    }
}
