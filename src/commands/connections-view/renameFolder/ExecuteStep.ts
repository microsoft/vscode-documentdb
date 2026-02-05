/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService } from '../../../services/connectionStorageService';
import {
    refreshParentInConnectionsView,
    withConnectionsViewProgress,
} from '../../../tree/connections-view/connectionsViewHelpers';
import { nonNullOrEmptyValue, nonNullValue } from '../../../utils/nonNull';
import { type RenameFolderWizardContext } from './RenameFolderWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<RenameFolderWizardContext> {
    public priority: number = 100;

    public async execute(context: RenameFolderWizardContext): Promise<void> {
        const folderId = nonNullOrEmptyValue(context.folderId, 'context.folderId', 'ExecuteStep.ts');
        const newFolderName = nonNullOrEmptyValue(context.newFolderName, 'context.newFolderName', 'ExecuteStep.ts');
        const originalFolderName = nonNullOrEmptyValue(
            context.originalFolderName,
            'context.originalFolderName',
            'ExecuteStep.ts',
        );
        const connectionType = nonNullValue(context.connectionType, 'context.connectionType', 'ExecuteStep.ts');

        // Set telemetry properties
        context.telemetry.properties.connectionType = connectionType;

        // Don't do anything if the name hasn't changed
        if (newFolderName === originalFolderName) {
            context.telemetry.properties.nameChanged = 'false';
            return;
        }

        context.telemetry.properties.nameChanged = 'true';

        await withConnectionsViewProgress(async () => {
            const folder = nonNullValue(
                await ConnectionStorageService.get(folderId, connectionType),
                'ConnectionStorageService.get(folderId, connectionType)',
                'ExecuteStep.ts',
            );

            folder.name = newFolderName;
            await ConnectionStorageService.save(connectionType, folder, true);

            ext.outputChannel.appendLine(
                l10n.t('Renamed folder from "{oldName}" to "{newName}"', {
                    oldName: originalFolderName,
                    newName: newFolderName,
                }),
            );

            refreshParentInConnectionsView(context.treeItemPath);
        });
    }

    public shouldExecute(context: RenameFolderWizardContext): boolean {
        return !!context.newFolderName && context.newFolderName !== context.originalFolderName;
    }
}
