/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { Views } from '../../documentdb/Views';
import { type FolderItem } from '../../tree/connections-view/FolderItem';
import { refreshView } from '../refreshView/refreshView';
import { type CreateFolderWizardContext } from './CreateFolderWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { PromptFolderNameStep } from './PromptFolderNameStep';

/**
 * Command to create a new folder in the connections view.
 * Can be invoked from the connections view header or from a folder's context menu.
 */
export async function createFolder(context: IActionContext, parentFolder?: FolderItem): Promise<void> {
    const wizardContext: CreateFolderWizardContext = {
        ...context,
        parentFolderId: parentFolder?.folderId,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: parentFolder
            ? l10n.t('Create Subfolder in "{folderName}"', { folderName: parentFolder.name })
            : l10n.t('Create New Folder'),
        promptSteps: [new PromptFolderNameStep()],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();

    // Refresh the connections view
    await refreshView(context, Views.ConnectionsView);
}
