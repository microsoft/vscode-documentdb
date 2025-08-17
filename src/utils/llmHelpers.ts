/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { configureLlm } from '../commands/configureLlm/configureLlm';
import { LlmConfigurationService } from '../services/LlmConfigurationService';
import { type IActionContext } from '@microsoft/vscode-azext-utils';

/**
 * Check if LLM is configured. If not, prompt the user to configure it.
 * @param context Action context for telemetry
 * @param commandName Name of the command being executed (for telemetry)
 * @returns Promise<boolean> - true if LLM is configured or user configured it, false if user declined
 */
export async function ensureLlmConfigured(context: IActionContext, _commandName: string): Promise<boolean> {
    const llmService = LlmConfigurationService.getInstance();
    
    if (llmService.isConfigured()) {
        return true;
    }

    // Show information dialog asking if user wants to configure LLM
    const configureButton = l10n.t('Configure LLM');
    const cancelButton = l10n.t('Not Now');
    
    const selection = await vscode.window.showInformationMessage(
        l10n.t('LLM Enhanced Features Not Available'),
        {
            modal: false,
            detail: l10n.t('To use enhanced features powered by AI, you need to configure an LLM resource (Azure OpenAI or OpenAI). Would you like to configure it now?'),
        },
        configureButton,
        cancelButton,
    );

    if (selection === configureButton) {
        try {
            await configureLlm(context);
            // Check if configuration was successful
            return llmService.isConfigured();
        } catch {
            // User cancelled configuration or error occurred
            context.telemetry.properties.llmConfigurationCancelled = 'true';
            return false;
        }
    }

    // User selected "Not Now" or dismissed dialog
    context.telemetry.properties.llmConfigurationDeclined = 'true';
    return false;
}