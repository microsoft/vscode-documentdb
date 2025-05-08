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
import { API } from '../../AzureDBExperiences';
import { NewEmulatorConnectionItemCV } from '../../tree/connections-view/LocalEmulators/NewEmulatorConnectionItemCV';
import { NewEmulatorConnectionItem } from '../../tree/workspace-view/documentdb/LocalEmulators/NewEmulatorConnectionItem';
import { ExecuteStep } from './ExecuteStep';
import { PromptMongoRUEmulatorConnectionStringStep } from './mongo-ru/PromptMongoRUEmulatorConnectionStringStep';
import { PromptMongoRUEmulatorSecurityStep } from './mongo-ru/PromptMongoRUEmulatorSecurityStep';
import { type NewEmulatorConnectionWizardContext } from './NewEmulatorConnectionWizardContext';
import { PromptEmulatorPortStep } from './PromptEmulatorPortStep';
import { PromptEmulatorTypeStep } from './PromptEmulatorTypeStep';
import { ProvidePasswordStep } from './ProvidePasswordStep';
import { ProvideUserNameStep } from './ProvideUsernameStep';

export async function newEmulatorConnection(
    context: IActionContext,
    node: NewEmulatorConnectionItem | NewEmulatorConnectionItemCV,
) {
    const wizardContext: NewEmulatorConnectionWizardContext = {
        ...context,
        parentTreeElementId: node.parentId,
    };

    let title: string = '';
    const steps: AzureWizardPromptStep<NewEmulatorConnectionWizardContext>[] = [];
    const executeSteps: AzureWizardExecuteStep<NewEmulatorConnectionWizardContext>[] = [];

    if (node instanceof NewEmulatorConnectionItem || node instanceof NewEmulatorConnectionItemCV) {
        title = l10n.t('New Local Connection');

        const api = node instanceof NewEmulatorConnectionItemCV ? API.DocumentDB : API.MongoDB;

        steps.push(
            new PromptEmulatorTypeStep(api),
            new PromptMongoRUEmulatorConnectionStringStep(),
            new PromptEmulatorPortStep(),
            new ProvideUserNameStep(),
            new ProvidePasswordStep(),
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
