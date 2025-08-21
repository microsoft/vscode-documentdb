/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep, type IAzureQuickPickItem } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { LlmProvider } from '../../services/LlmConfigurationService';
import { type ConfigureLlmWizardContext } from './ConfigureLlmWizardContext';

export class PromptProviderStep extends AzureWizardPromptStep<ConfigureLlmWizardContext> {
    public async prompt(context: ConfigureLlmWizardContext): Promise<void> {
        const picks: IAzureQuickPickItem<LlmProvider>[] = [
            {
                label: l10n.t('Azure OpenAI'),
                description: l10n.t('Microsoft Azure OpenAI Service'),
                data: LlmProvider.AzureOpenAI,
            },
            {
                label: l10n.t('OpenAI'),
                description: l10n.t('OpenAI API'),
                data: LlmProvider.OpenAI,
            },
        ];

        const selection = await context.ui.showQuickPick(picks, {
            placeHolder: l10n.t('Select LLM provider'),
            ignoreFocusOut: true,
        });

        context.provider = selection.data;
    }

    public shouldPrompt(): boolean {
        return true;
    }
}