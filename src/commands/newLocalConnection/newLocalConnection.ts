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
import { NewEmulatorConnectionItemCV } from '../../tree/connections-view/LocalEmulators/NewEmulatorConnectionItemCV';
import { ExecuteStep } from './ExecuteStep';
import { PromptMongoRUEmulatorConnectionStringStep } from './mongo-ru/PromptMongoRUEmulatorConnectionStringStep';
import { PromptMongoRUEmulatorSecurityStep } from './mongo-ru/PromptMongoRUEmulatorSecurityStep';
import { type NewLocalConnectionWizardContext } from './NewLocalConnectionWizardContext';
import { PromptConnectionTypeStep } from './PromptConnectionTypeStep';
import { PromptPasswordStep } from './PromptPasswordStep';
import { PromptPortStep } from './PromptPortStep';
import { PromptUsernameStep } from './PromptUsernameStep';

export async function newLocalConnection(context: IActionContext, node: NewEmulatorConnectionItemCV) {
    const portString = vscode.workspace.getConfiguration().get(ext.settingsKeys.localPort);
    const portNumber = Number(portString);

    const wizardContext: NewLocalConnectionWizardContext = {
        ...context,
        parentTreeElementId: node.parentId,
        port: isNaN(portNumber) ? undefined : portNumber,
    };

    let title: string = '';
    const steps: AzureWizardPromptStep<NewLocalConnectionWizardContext>[] = [];
    const executeSteps: AzureWizardExecuteStep<NewLocalConnectionWizardContext>[] = [];

    if (node instanceof NewEmulatorConnectionItemCV) {
        title = l10n.t('New Local Connection');

        steps.push(
            new PromptConnectionTypeStep(API.DocumentDB),
            new PromptMongoRUEmulatorConnectionStringStep(),
            new PromptPortStep(),
            new PromptUsernameStep(),
            new PromptPasswordStep(),
            new PromptMongoRUEmulatorSecurityStep(),
        );
        executeSteps.push(new ExecuteStep());
    }

    const wizard = new AzureWizard(wizardContext, {
        title: title,
        promptSteps: steps,
        executeSteps: executeSteps,
        showLoadingPrompt: true,
    });

    await wizard.prompt();
    await wizard.execute();
}
