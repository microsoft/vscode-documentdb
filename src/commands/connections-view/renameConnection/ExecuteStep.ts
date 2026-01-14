/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { l10n as vscodel10n, window } from 'vscode';
import { ConnectionStorageService, ConnectionType } from '../../../services/connectionStorageService';
import {
    refreshParentInConnectionsView,
    withConnectionsViewProgress,
} from '../../../tree/connections-view/connectionsViewHelpers';
import { nonNullValue } from '../../../utils/nonNull';
import { type RenameConnectionWizardContext } from './RenameConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<RenameConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: RenameConnectionWizardContext): Promise<void> {
        // Set telemetry properties
        context.telemetry.properties.connectionType = context.isEmulator
            ? ConnectionType.Emulators
            : ConnectionType.Clusters;

        await withConnectionsViewProgress(async () => {
            const resourceType = context.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
            const connection = await ConnectionStorageService.get(context.storageId, resourceType);

            if (connection) {
                connection.name = nonNullValue(
                    context.newConnectionName,
                    'context.newConnectionName',
                    'ExecuteStep.ts',
                );

                try {
                    await ConnectionStorageService.save(resourceType, connection, true);
                } catch (pushError) {
                    console.error(`Failed to rename the connection "${context.storageId}":`, pushError);
                    void window.showErrorMessage(vscodel10n.t('Failed to rename the connection.'));
                }
            } else {
                console.error(`Connection with ID "${context.storageId}" not found in storage.`);
                void window.showErrorMessage(vscodel10n.t('Failed to rename the connection.'));
            }

            refreshParentInConnectionsView(context.treeItemPath);
        });
    }

    public shouldExecute(context: RenameConnectionWizardContext): boolean {
        return !!context.newConnectionName && context.newConnectionName !== context.originalConnectionName;
    }
}
