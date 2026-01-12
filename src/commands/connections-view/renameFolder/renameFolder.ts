/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import { l10n as vscodel10n } from 'vscode';
import { ConnectionStorageService, ConnectionType } from '../../../services/connectionStorageService';
import { FolderItem } from '../../../tree/connections-view/FolderItem';
import { ExecuteStep } from './ExecuteStep';
import { PromptNewFolderNameStep } from './PromptNewFolderNameStep';
import { type RenameFolderWizardContext } from './RenameFolderWizardContext';

/**
 * Rename a folder
 */
export async function renameFolder(context: IActionContext, folderItem: FolderItem): Promise<void> {
    if (!folderItem) {
        throw new Error(vscodel10n.t('No folder selected.'));
    }

    // Determine connection type - for now, use Clusters as default
    const connectionType = folderItem?.connectionType ?? ConnectionType.Clusters;

    // Get folder data to get parentId
    const folderData = await ConnectionStorageService.get(folderItem.storageId, connectionType);

    const wizardContext: RenameFolderWizardContext = {
        ...context,
        folderId: folderItem.storageId,
        originalFolderName: folderItem.name,
        parentFolderId: folderData?.properties.parentId,
        connectionType: connectionType,
        treeItemPath: folderItem.id,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: vscodel10n.t('Rename Folder'),
        promptSteps: [new PromptNewFolderNameStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();
}
