/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { LlmProvider } from '../../services/LlmConfigurationService';
import { type ConfigureLlmWizardContext } from './ConfigureLlmWizardContext';

export class PromptApiKeyStep extends AzureWizardPromptStep<ConfigureLlmWizardContext> {
    public async prompt(context: ConfigureLlmWizardContext): Promise<void> {
        if (!context.provider) {
            throw new Error(l10n.t('Provider must be selected first'));
        }

        let prompt: string;
        let placeholder: string;
        
        if (context.provider === LlmProvider.AzureOpenAI) {
            prompt = l10n.t('Enter your Azure OpenAI API key');
            placeholder = l10n.t('API key from Azure portal');
        } else {
            prompt = l10n.t('Enter your OpenAI API key');
            placeholder = l10n.t('sk-...');
        }

        const apiKey = await context.ui.showInputBox({
            prompt,
            placeHolder: placeholder,
            password: true,
            ignoreFocusOut: true,
            validateInput: (input) => this.validateApiKey(input, context.provider!),
        });

        context.apiKey = apiKey.trim();
    }

    public shouldPrompt(context: ConfigureLlmWizardContext): boolean {
        return !!context.provider;
    }

    private validateApiKey(apiKey: string, provider: LlmProvider): string | undefined {
        if (!apiKey) {
            return l10n.t('API key is required');
        }

        if (provider === LlmProvider.OpenAI && !apiKey.startsWith('sk-')) {
            return l10n.t('OpenAI API key should start with "sk-"');
        }

        if (apiKey.length < 10) {
            return l10n.t('API key seems too short');
        }

        return undefined;
    }
}