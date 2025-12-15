/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Views } from '../../documentdb/Views';
import { FolderStorageService } from '../../services/folderStorageService';
import { type FolderItem } from '../../tree/connections-view/FolderItem';
import { refreshView } from '../refreshView/refreshView';
import { ExecuteStep } from './ExecuteStep';
import { PromptNewFolderNameStep } from './PromptNewFolderNameStep';
import { type RenameFolderWizardContext } from './RenameFolderWizardContext';

export async function renameFolder(context: IActionContext, folderItem: FolderItem): Promise<void> {
    if (!folderItem) {
        throw new Error(l10n.t('No folder selected.'));
    }

    // Get folder data to get parentId
    const folderData = await FolderStorageService.get(folderItem.folderId);

    const wizardContext: RenameFolderWizardContext = {
        ...context,
        folderId: folderItem.folderId,
        originalFolderName: folderItem.name,
        parentFolderId: folderData?.parentId,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Rename Folder'),
        promptSteps: [new PromptNewFolderNameStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    await refreshView(context, Views.ConnectionsView);
}
