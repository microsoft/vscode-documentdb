/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n, window } from 'vscode';
import { ConnectionStorageService, ConnectionType } from '../../services/connectionStorageService';
import { nonNullValue } from '../../utils/nonNull';
import { type RenameConnectionWizardContext } from './RenameConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<RenameConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: RenameConnectionWizardContext): Promise<void> {
        const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
        const items = await ConnectionStorageService.getAll(resourceType);

        // TODO: create a getItem method in storageService, otherwise too many secrets
        // are being read from the storage
        const item = items.find((item) => item.id === context.storageId);

        if (item) {
            item.name = nonNullValue(context.newConnectionName);

            try {
                await ConnectionStorageService.save(resourceType, item, true);
            } catch (pushError) {
                console.error(`Failed to rename the item "${context.storageId}":`, pushError);
                void window.showErrorMessage(l10n.t('Failed to rename the connection.'));
            }
        } else {
            console.error(`Item with ID "${context.storageId}" not found in storage.`);
            void window.showErrorMessage(l10n.t('Failed to rename the connection.'));
        }
    }

    public shouldExecute(context: RenameConnectionWizardContext): boolean {
        return !!context.newConnectionName && context.newConnectionName !== context.originalConnectionName;
    }
}
