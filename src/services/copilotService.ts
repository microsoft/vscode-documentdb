/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

/**
 * Options for sending a message to the language model
 */
export interface CopilotMessageOptions {
    // The preferred model family to use
    // If the specified model is not available, will fall back to available models
    preferredModel?: string;

    // List of fallback models to try if the preferred model is not available
    fallbackModels?: string[];

    // TODO:
    // Temperature setting for the model (if supported later)
}

/**
 * Response from the Copilot service
 */
export interface CopilotResponse {
    //The generated text response
    text: string;
    //The model used to generate the response
    modelUsed: string;
}

/**
 * Service for interacting with GitHub Copilot's LLM
 */
export class CopilotService {
    /**
     * Sends a message to the Copilot LLM and returns the response
     *
     * @param messages - Array of chat messages to send to the model
     * @param options - Options for the request
     * @returns The response from the model
     * @throws Error if no suitable model is available or if the user cancels
     */
    static async sendMessage(
        messages: vscode.LanguageModelChatMessage[],
        options?: CopilotMessageOptions,
    ): Promise<CopilotResponse> {
        // Get all available models from VS Code
        const availableModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });

        const preferredFamilies = this.getPreferredFamilies(options);
        const selectedModel = this.selectBestModel(availableModels, preferredFamilies);

        if (!selectedModel) {
            throw new Error(
                l10n.t(
                    'No suitable language model found. Please ensure GitHub Copilot is installed and you have an active subscription.',
                ),
            );
        }

        const response = await this.sendToModel(selectedModel, messages, options);
        return {
            text: response,
            modelUsed: selectedModel.id,
        };
    }

    /**
     * Builds the ordered list of preferred model families
     */
    private static getPreferredFamilies(options?: CopilotMessageOptions): string[] {
        const families: string[] = [];

        if (options?.preferredModel) {
            families.push(options.preferredModel);
        }

        if (options?.fallbackModels && options.fallbackModels.length > 0) {
            families.push(...options.fallbackModels);
        }

        return families;
    }

    /**
     * Selects the best available model based on preference order
     *
     * @param availableModels - All available models from VS Code
     * @param preferredFamilies - Ordered list of preferred model families
     * @returns The best matching model, or the first available model if no matches
     */
    private static selectBestModel(
        availableModels: vscode.LanguageModelChat[],
        preferredFamilies: string[],
    ): vscode.LanguageModelChat | undefined {
        if (availableModels.length === 0) {
            return undefined;
        }

        if (preferredFamilies.length !== 0) {
            for (const preferredFamily of preferredFamilies) {
                const matchingModel = availableModels.find((model) => model.family === preferredFamily);
                if (matchingModel) {
                    return matchingModel;
                }
            }
        }
        return availableModels[0];
    }

    /**
     * Sends messages to a specific model and collects the response
     */
    private static async sendToModel(
        model: vscode.LanguageModelChat,
        messages: vscode.LanguageModelChatMessage[],
        _options?: CopilotMessageOptions,
    ): Promise<string> {
        // Note: VS Code LM API currently doesn't support temperature or maxTokens in
        // LanguageModelChatRequestOptions, but we keep them here for potential future use
        const requestOptions: vscode.LanguageModelChatRequestOptions = {};

        const chatResponse = await model.sendRequest(messages, requestOptions);

        // Collect the streaming response
        let fullResponse = '';
        for await (const fragment of chatResponse.text) {
            fullResponse += fragment;
        }

        return fullResponse;
    }

    /**
     * Checks if LLMs are available
     *
     * @returns true if at least one model is available
     */
    static async isAvailable(): Promise<boolean> {
        const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
        return models.length > 0;
    }
}
