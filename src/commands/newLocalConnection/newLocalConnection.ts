/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzureWizard,
    type AzureWizardExecuteStep,
    type AzureWizardPromptStep,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { type FolderItem } from '../../tree/connections-view/FolderItem';
import { type LocalEmulatorsItem } from '../../tree/connections-view/LocalEmulators/LocalEmulatorsItem';
import { NewEmulatorConnectionItemCV } from '../../tree/connections-view/LocalEmulators/NewEmulatorConnectionItemCV';
import { ExecuteStep } from './ExecuteStep';
import { PromptMongoRUEmulatorConnectionStringStep } from './mongo-ru/PromptMongoRUEmulatorConnectionStringStep';
import { PromptMongoRUEmulatorSecurityStep } from './mongo-ru/PromptMongoRUEmulatorSecurityStep';
import { type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';
import { PromptConnectionTypeStep } from './PromptConnectionTypeStep';
import { PromptPasswordStep } from './PromptPasswordStep';
import { PromptPortStep } from './PromptPortStep';
import { PromptUsernameStep } from './PromptUsernameStep';

/**
 * Executes the local connection wizard with the given parent info.
 */
async function executeLocalConnectionWizard(
    context: IActionContext,
    parentTreeElementId: string,
    parentStorageId?: string,
): Promise<void> {
    const portString = vscode.workspace.getConfiguration().get(ext.settingsKeys.localPort);
    const portNumber = Number(portString);

    const wizardContext: NewLocalConnectionWizardContext = {
        ...context,
        parentTreeElementId,
        parentStorageId,
        port: isNaN(portNumber) ? undefined : portNumber,
    };

    const title = l10n.t('New Local Connection');
    const steps: AzureWizardPromptStep<NewLocalConnectionWizardContext>[] = [
        new PromptConnectionTypeStep(API.DocumentDB),
        new PromptMongoRUEmulatorConnectionStringStep(),
        new PromptPortStep(),
        new PromptUsernameStep(),
        new PromptPasswordStep(),
        new PromptMongoRUEmulatorSecurityStep(),
    ];
    const executeSteps: AzureWizardExecuteStep<NewLocalConnectionWizardContext>[] = [new ExecuteStep()];

    const wizard = new AzureWizard(wizardContext, {
        title: title,
        promptSteps: steps,
        executeSteps: executeSteps,
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();
}

/**
 * Command to create a new local connection from the helper node.
 * Called when clicking on the "New Local Connection..." tree item.
 */
export async function newLocalConnection(context: IActionContext, node: NewEmulatorConnectionItemCV): Promise<void> {
    if (!(node instanceof NewEmulatorConnectionItemCV)) {
        throw new Error(l10n.t('Invalid node type.'));
    }

    // The helper node doesn't have a storage ID, connections created here are at root level
    await executeLocalConnectionWizard(context, node.parentId, undefined);
}

/**
 * Command to create a new local connection inside a folder or LocalEmulators section.
 * Called from context menu on folders in the emulators section.
 */
export async function newLocalConnectionInFolder(
    context: IActionContext,
    folder: FolderItem | LocalEmulatorsItem,
): Promise<void> {
    // Check if it's a LocalEmulatorsItem (no storageId) or FolderItem (has storageId)
    const parentStorageId = 'storageId' in folder ? folder.storageId : undefined;
    await executeLocalConnectionWizard(context, folder.id, parentStorageId);
}
