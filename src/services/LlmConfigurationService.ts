/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../extensionVariables';
import { SettingUtils } from './SettingsService';

export enum LlmProvider {
    AzureOpenAI = 'azure-openai',
    OpenAI = 'openai',
}

export interface LlmConfiguration {
    provider: LlmProvider;
    endpoint?: string;
    apiKey?: string;
}

/**
 * Service for managing LLM (Large Language Model) configuration
 */
export class LlmConfigurationService {
    private static instance: LlmConfigurationService;
    private readonly settingsUtils = new SettingUtils();
    private readonly secretKeyPrefix = 'documentDB.llm';

    private constructor() {}

    public static getInstance(): LlmConfigurationService {
        if (!LlmConfigurationService.instance) {
            LlmConfigurationService.instance = new LlmConfigurationService();
        }
        return LlmConfigurationService.instance;
    }

    /**
     * Check if LLM is configured
     */
    public isConfigured(): boolean {
        const provider = this.getProvider();
        return provider !== undefined;
    }

    /**
     * Get configured LLM provider
     */
    public getProvider(): LlmProvider | undefined {
        return this.settingsUtils.getGlobalSetting<LlmProvider>(ext.settingsKeys.llmProvider.split('.').pop()!, ext.prefix);
    }

    /**
     * Get configured LLM endpoint
     */
    public getEndpoint(): string | undefined {
        return this.settingsUtils.getGlobalSetting<string>(ext.settingsKeys.llmEndpoint.split('.').pop()!, ext.prefix);
    }

    /**
     * Get stored API key for the configured provider
     */
    public async getApiKey(): Promise<string | undefined> {
        const provider = this.getProvider();
        if (!provider) {
            return undefined;
        }
        
        const secretKey = `${this.secretKeyPrefix}.${provider}.apiKey`;
        return await ext.secretStorage.get(secretKey);
    }

    /**
     * Get full LLM configuration
     */
    public async getConfiguration(): Promise<LlmConfiguration | undefined> {
        const provider = this.getProvider();
        if (!provider) {
            return undefined;
        }

        const endpoint = this.getEndpoint();
        const apiKey = await this.getApiKey();

        return {
            provider,
            endpoint,
            apiKey,
        };
    }

    /**
     * Set LLM configuration
     */
    public async setConfiguration(config: LlmConfiguration): Promise<void> {
        // Save provider and endpoint in settings
        await this.settingsUtils.updateGlobalSetting(
            ext.settingsKeys.llmProvider.split('.').pop()!,
            config.provider,
            ext.prefix,
        );

        if (config.endpoint) {
            await this.settingsUtils.updateGlobalSetting(
                ext.settingsKeys.llmEndpoint.split('.').pop()!,
                config.endpoint,
                ext.prefix,
            );
        }

        // Save API key securely
        if (config.apiKey) {
            const secretKey = `${this.secretKeyPrefix}.${config.provider}.apiKey`;
            await ext.secretStorage.store(secretKey, config.apiKey);
        }
    }

    /**
     * Clear LLM configuration
     */
    public async clearConfiguration(): Promise<void> {
        const provider = this.getProvider();
        
        // Clear settings
        await this.settingsUtils.updateGlobalSetting(
            ext.settingsKeys.llmProvider.split('.').pop()!,
            undefined,
            ext.prefix,
        );
        await this.settingsUtils.updateGlobalSetting(
            ext.settingsKeys.llmEndpoint.split('.').pop()!,
            undefined,
            ext.prefix,
        );

        // Clear API key from secret storage
        if (provider) {
            const secretKey = `${this.secretKeyPrefix}.${provider}.apiKey`;
            await ext.secretStorage.delete(secretKey);
        }
    }
}