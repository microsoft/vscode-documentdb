/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type ConfigureLlmWizardContext } from './ConfigureLlmWizardContext';
import { ExecuteStep } from './ExecuteStep';
import { PromptApiKeyStep } from './PromptApiKeyStep';
import { PromptEndpointStep } from './PromptEndpointStep';
import { PromptProviderStep } from './PromptProviderStep';

export async function configureLlm(context: IActionContext): Promise<void> {
    const wizardContext: ConfigureLlmWizardContext = {
        ...context,
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Configure LLM Resource'),
        promptSteps: [
            new PromptProviderStep(),
            new PromptEndpointStep(),
            new PromptApiKeyStep(),
        ],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();
}