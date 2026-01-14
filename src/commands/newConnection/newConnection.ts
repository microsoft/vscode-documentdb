/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type FolderItem } from '../../tree/connections-view/FolderItem';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';
import { PromptConnectionModeStep } from './PromptConnectionModeStep';

/**
 * Executes the new connection wizard with the given parent info.
 */
async function executeNewConnectionWizard(
    context: IActionContext,
    parentId: string,
    parentTreeId?: string,
): Promise<void> {
    const wizardContext: NewConnectionWizardContext = {
        ...context,
        parentId,
        parentTreeId,
        properties: {},
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('New Connection'),
        // TODO: a plug here to esure merge-compatibility with the old code, simplify once the sync-merge procedure is done
        promptSteps: [new PromptConnectionModeStep()],
        executeSteps: [],
        showLoadingPrompt: true,
        hideStepCount: true, // it's incorrect as we have optional steps and subwizards: better hide the count
    });

    await wizard.prompt();
    await wizard.execute();
}

/**
 * Command to create a new cluster connection.
 * Invoked from the connections view navigation area.
 * Always creates a root-level connection in the Clusters section.
 */
export async function newConnection(context: IActionContext): Promise<void> {
    // Navigation button always creates at root level
    await executeNewConnectionWizard(context, '', undefined);
}

/**
 * Command to create a new cluster connection inside a folder.
 * Called from context menu on folders in the clusters section.
 */
export async function newConnectionInClusterFolder(context: IActionContext, folder: FolderItem): Promise<void> {
    await executeNewConnectionWizard(context, folder.storageId, folder.id);
}
