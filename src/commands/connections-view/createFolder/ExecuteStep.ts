/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { Views } from '../../../documentdb/Views';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ItemType } from '../../../services/connectionStorageService';
import { revealConnectionsViewElement } from '../../../tree/api/revealConnectionsViewElement';
import { waitForConnectionsViewReady } from '../../../tree/connections-view/connectionsViewHelpers';
import { nonNullOrEmptyValue, nonNullValue } from '../../../utils/nonNull';
import { randomUtils } from '../../../utils/randomUtils';
import { type CreateFolderWizardContext } from './CreateFolderWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<CreateFolderWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateFolderWizardContext): Promise<void> {
        const folderName = nonNullOrEmptyValue(context.folderName, 'context.folderName', 'ExecuteStep.ts');
        const connectionType = nonNullValue(context.connectionType, 'context.connectionType', 'ExecuteStep.ts');

        // Use the parent tree ID for showing progress, or the view root if creating at root level
        const progressNodeId = context.parentTreeId ?? Views.ConnectionsView;

        // Show progress indicator on the parent folder while creating and revealing
        // The automatic refresh on completion clears the temporary description
        await ext.state.runWithTemporaryDescription(progressNodeId, l10n.t('Working…'), async () => {
            const folderId = randomUtils.getRandomUUID();

            // Create folder as a ConnectionItem with type 'folder'
            await ConnectionStorageService.save(
                connectionType,
                {
                    id: folderId,
                    name: folderName,
                    properties: {
                        type: ItemType.Folder,
                        parentId: context.parentFolderId,
                        api: API.DocumentDB,
                        availableAuthMethods: [],
                    },
                    secrets: {
                        connectionString: '',
                    },
                },
                false,
            );

            ext.outputChannel.trace(
                l10n.t('Created new folder: {folderName} in folder with ID {parentFolderId}', {
                    folderName: folderName,
                    parentFolderId: context.parentFolderId ?? 'root',
                }),
            );

            // Focus and reveal the new folder
            await vscode.commands.executeCommand(`connectionsView.focus`);
            await waitForConnectionsViewReady(context);

            // Build the reveal path based on whether this is in a subfolder
            const folderPath = context.parentTreeId
                ? `${context.parentTreeId}/${folderId}`
                : `${Views.ConnectionsView}/${folderId}`;

            await revealConnectionsViewElement(context, folderPath, {
                select: true,
                focus: true,
                expand: false,
            });
        });
    }

    public shouldExecute(context: CreateFolderWizardContext): boolean {
        return !!context.folderName;
    }
}
