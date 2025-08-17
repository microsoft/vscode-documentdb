/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { LlmProvider } from '../../services/LlmConfigurationService';
import { type ConfigureLlmWizardContext } from './ConfigureLlmWizardContext';

export class PromptEndpointStep extends AzureWizardPromptStep<ConfigureLlmWizardContext> {
    public async prompt(context: ConfigureLlmWizardContext): Promise<void> {
        if (!context.provider) {
            throw new Error(l10n.t('Provider must be selected first'));
        }

        let placeholder: string;
        let prompt: string;
        
        if (context.provider === LlmProvider.AzureOpenAI) {
            placeholder = l10n.t('https://your-resource.openai.azure.com/');
            prompt = l10n.t('Enter your Azure OpenAI endpoint URL');
        } else {
            placeholder = l10n.t('https://api.openai.com/v1');
            prompt = l10n.t('Enter OpenAI API endpoint (leave empty for default)');
        }

        const endpoint = await context.ui.showInputBox({
            prompt,
            placeHolder: placeholder,
            ignoreFocusOut: true,
            validateInput: (input) => this.validateEndpoint(input, context.provider!),
        });

        context.endpoint = endpoint.trim() || (context.provider === LlmProvider.OpenAI ? 'https://api.openai.com/v1' : undefined);
    }

    public shouldPrompt(context: ConfigureLlmWizardContext): boolean {
        return !!context.provider;
    }

    private validateEndpoint(endpoint: string, provider: LlmProvider): string | undefined {
        if (!endpoint && provider === LlmProvider.AzureOpenAI) {
            return l10n.t('Azure OpenAI endpoint is required');
        }

        if (endpoint && !endpoint.startsWith('https://')) {
            return l10n.t('Endpoint must use HTTPS');
        }

        return undefined;
    }
}