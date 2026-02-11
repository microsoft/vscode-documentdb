/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';

/**
 * Options for sending a message to the language model
 */
export interface CopilotMessageOptions {
    /* The preferred model to use
       If the specified model is not available, will fall back to available models
    */
    preferredModel?: string;

    /* List of fallback models */
    fallbackModels?: string[];

    /* AbortSignal for cancellation support */
    signal?: AbortSignal;

    // TODO:
    /* Temperature setting for the model (if supported later) */
    // temperature?: number;

    /* Maximum tokens for the response (if supported later) */
    // maxTokens?: number;
}

/**
 * Response from the Copilot service
 */
export interface CopilotResponse {
    /* The generated text response */
    text: string;
    /* The model used to generate the response */
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
        const result = await callWithTelemetryAndErrorHandling(
            'vscode-documentdb.copilot.sendMessage',
            async (context: IActionContext) => {
                // Get all available models from VS Code
                const availableModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });

                const preferredModels = this.getPreferredModels(options);
                const selectedModel = this.selectBestModel(availableModels, preferredModels);

                if (!selectedModel) {
                    throw new Error(
                        l10n.t(
                            'No suitable language model found. Please ensure GitHub Copilot is installed and you have an active subscription.',
                        ),
                    );
                }

                context.telemetry.properties.modelUsed = selectedModel.id;

                try {
                    const response = await this.sendToModel(selectedModel, messages, options);
                    return {
                        text: response,
                        modelUsed: selectedModel.id,
                    };
                } catch (error) {
                    if (error instanceof UserCancelledError) {
                        throw error;
                    }
                    context.telemetry.properties.llmError = 'llmGenerateResponseCallFailed';
                    throw error;
                }
            },
        );

        if (!result) {
            // If signal was aborted, propagate cancellation silently
            if (options?.signal?.aborted) {
                throw new UserCancelledError('AbortSignal');
            }
            throw new Error(l10n.t('Failed to get response from language model'));
        }

        return result;
    }

    /**
     * Builds the ordered list of preferred models
     */
    private static getPreferredModels(options?: CopilotMessageOptions): string[] {
        const models: string[] = [];

        if (options?.preferredModel) {
            models.push(options.preferredModel);
        }

        if (options?.fallbackModels && options.fallbackModels.length > 0) {
            models.push(...options.fallbackModels);
        }

        return models;
    }

    /**
     * Selects the best available model based on preference order
     *
     * @param availableModels - All available models from VS Code
     * @param preferredModels - Ordered list of preferred model families
     * @returns The best matching model, or the first available model if no matches
     */
    private static selectBestModel(
        availableModels: vscode.LanguageModelChat[],
        preferredModels: string[],
    ): vscode.LanguageModelChat | undefined {
        if (availableModels.length === 0) {
            return undefined;
        }

        if (preferredModels.length !== 0) {
            for (const preferredModel of preferredModels) {
                const matchingModel = availableModels.find((model) => model.id === preferredModel);
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
        options?: CopilotMessageOptions,
    ): Promise<string> {
        const signal = options?.signal;

        // If already aborted, throw immediately
        if (signal?.aborted) {
            throw new UserCancelledError('AbortSignal');
        }

        // Bridge AbortSignal → vscode.CancellationToken so the LLM API can stop streaming
        const cts = new vscode.CancellationTokenSource();
        const onAbort = () => cts.cancel();
        signal?.addEventListener('abort', onAbort);

        try {
            // Github copilot LLM API currently doesn't support temperature or maxTokens in
            // LanguageModelChatRequestOptions, but we keep them here for potential future use
            const requestOptions: vscode.LanguageModelChatRequestOptions = {};

            const chatResponse = await model.sendRequest(messages, requestOptions, cts.token);

            // Collect the streaming response, checking for cancellation between chunks
            let fullResponse = '';
            for await (const fragment of chatResponse.text) {
                if (signal?.aborted) {
                    break;
                }
                fullResponse += fragment;
            }

            if (signal?.aborted) {
                ext.outputChannel.trace(l10n.t('[Query Insights AI] Copilot call cancelled during streaming'));
                throw new UserCancelledError('AbortSignal');
            }

            return fullResponse;
        } finally {
            signal?.removeEventListener('abort', onAbort);
            cts.dispose();
        }
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
