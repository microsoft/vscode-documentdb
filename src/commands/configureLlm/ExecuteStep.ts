/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { LlmConfigurationService } from '../../services/LlmConfigurationService';
import { type ConfigureLlmWizardContext } from './ConfigureLlmWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<ConfigureLlmWizardContext> {
    public priority: number = 100;

    public async execute(context: ConfigureLlmWizardContext): Promise<void> {
        if (!context.provider || !context.apiKey) {
            throw new Error(l10n.t('Provider and API key are required'));
        }

        const llmService = LlmConfigurationService.getInstance();
        
        await llmService.setConfiguration({
            provider: context.provider,
            endpoint: context.endpoint,
            apiKey: context.apiKey,
        });

        void vscode.window.showInformationMessage(
            l10n.t('LLM configuration saved successfully. Enhanced features are now available.')
        );
    }

    public shouldExecute(context: ConfigureLlmWizardContext): boolean {
        return !!context.provider && !!context.apiKey;
    }
}