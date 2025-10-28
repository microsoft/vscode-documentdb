/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    CROSS_COLLECTION_QUERY_PROMPT_TEMPLATE,
    SINGLE_COLLECTION_QUERY_PROMPT_TEMPLATE,
} from '../commands/llmEnhancedCommands/promptTemplates';
import { QueryGenerationType } from '../commands/llmEnhancedCommands/queryGenerationCommands';

/**
 * Service for loading prompt templates from custom files or built-in templates
 */
export class PromptTemplateService {
    private static readonly configSection = 'documentDB.llm';
    // private static readonly templateCache: Map<CommandType | QueryGenerationType, string> = new Map();
    private static readonly templateCache: Map<QueryGenerationType, string> = new Map();

    // /**
    //  * Gets the prompt template for index advisor
    //  * @param commandType The type of command (find, aggregate, or count)
    //  * @returns The prompt template string
    //  */
    // public static async getIndexAdvisorPromptTemplate(commandType: CommandType): Promise<string> {
    //     // Get configuration
    //     const config = vscode.workspace.getConfiguration(this.configSection);
    //     const cacheEnabled = config.get<boolean>('enablePromptCache', true);

    //     // Check if have a cached template
    //     if (cacheEnabled) {
    //         const cached = this.templateCache.get(commandType);
    //         if (cached) {
    //             return cached;
    //         }
    //     }

    //     // Get the configuration key for this command type
    //     const configKey = this.getIndexAdvisorConfigKey(commandType);

    //     // Check if a custom template path is configured
    //     const customTemplatePath = config.get<string | null>(configKey);

    //     let template: string;

    //     if (customTemplatePath) {
    //         try {
    //             // Load custom template from file
    //             template = await this.loadTemplateFromFile(customTemplatePath, commandType.toString());
    //             void vscode.window.showInformationMessage(
    //                 l10n.t('Using custom prompt template for {type} query: {path}', {
    //                     type: commandType,
    //                     path: customTemplatePath,
    //                 }),
    //             );
    //         } catch (error) {
    //             // Log error and fall back to built-in template
    //             void vscode.window.showWarningMessage(
    //                 l10n.t('Failed to load custom prompt template from {path}: {error}. Using built-in template.', {
    //                     path: customTemplatePath,
    //                     error: error instanceof Error ? error.message : String(error),
    //                 }),
    //             );
    //             template = this.getBuiltInIndexAdvisorTemplate(commandType);
    //         }
    //     } else {
    //         // Use built-in template
    //         template = this.getBuiltInIndexAdvisorTemplate(commandType);
    //     }

    //     // Cache the template (if caching is enabled)
    //     if (cacheEnabled) {
    //         this.templateCache.set(commandType, template);
    //     }

    //     return template;
    // }

    /**
     * Gets the prompt template for query generation
     * @param generationType The type of query generation (cross-collection or single-collection)
     * @returns The prompt template string
     */
    public static async getQueryGenerationPromptTemplate(generationType: QueryGenerationType): Promise<string> {
        // Get configuration
        const config = vscode.workspace.getConfiguration(this.configSection);
        const cacheEnabled = config.get<boolean>('enablePromptCache', true);

        // Check if have a cached template
        if (cacheEnabled) {
            const cached = this.templateCache.get(generationType);
            if (cached) {
                return cached;
            }
        }

        // Get the configuration key for this generation type
        const configKey = this.getQueryGenerationConfigKey(generationType);

        // Check if a custom template path is configured
        const customTemplatePath = config.get<string | null>(configKey);

        let template: string;

        if (customTemplatePath) {
            try {
                template = await this.loadTemplateFromFile(customTemplatePath, generationType.toString());
                void vscode.window.showInformationMessage(
                    l10n.t('Using custom prompt template for {type} query generation: {path}', {
                        type: generationType,
                        path: customTemplatePath,
                    }),
                );
            } catch (error) {
                void vscode.window.showWarningMessage(
                    l10n.t('Failed to load custom prompt template from {path}: {error}. Using built-in template.', {
                        path: customTemplatePath,
                        error: error instanceof Error ? error.message : String(error),
                    }),
                );
                template = this.getBuiltInQueryGenerationTemplate(generationType);
            }
        } else {
            // Use built-in template
            template = this.getBuiltInQueryGenerationTemplate(generationType);
        }

        // Cache the template
        if (cacheEnabled) {
            this.templateCache.set(generationType, template);
        }

        return template;
    }

    /**
     * Clears the template cache, forcing templates to be reloaded on next use
     */
    public static clearCache(): void {
        this.templateCache.clear();
    }

    // /**
    //  * Gets the configuration key for a command type
    //  * @param commandType The command type
    //  * @returns The configuration key
    //  */
    // private static getIndexAdvisorConfigKey(commandType: CommandType): string {
    //     switch (commandType) {
    //         case CommandType.Find:
    //             return 'findQueryPromptPath';
    //         case CommandType.Aggregate:
    //             return 'aggregateQueryPromptPath';
    //         case CommandType.Count:
    //             return 'countQueryPromptPath';
    //         default:
    //             throw new Error(l10n.t('Unknown command type: {type}', { type: commandType }));
    //     }
    // }

    /**
     * Gets the configuration key for a query generation type
     * @param generationType The query generation type
     * @returns The configuration key
     */
    private static getQueryGenerationConfigKey(generationType: QueryGenerationType): string {
        switch (generationType) {
            case QueryGenerationType.CrossCollection:
                return 'crossCollectionQueryPromptPath';
            case QueryGenerationType.SingleCollection:
                return 'singleCollectionQueryPromptPath';
            default:
                throw new Error(l10n.t('Unknown query generation type: {type}', { type: generationType }));
        }
    }

    // /**
    //  * Gets the built-in prompt template for a command type
    //  * @param commandType The command type
    //  * @returns The built-in template
    //  */
    // private static getBuiltInIndexAdvisorTemplate(commandType: CommandType): string {
    //     switch (commandType) {
    //         case CommandType.Find:
    //             return FIND_QUERY_PROMPT_TEMPLATE;
    //         case CommandType.Aggregate:
    //             return AGGREGATE_QUERY_PROMPT_TEMPLATE;
    //         case CommandType.Count:
    //             return COUNT_QUERY_PROMPT_TEMPLATE;
    //         default:
    //             throw new Error(l10n.t('Unknown command type: {type}', { type: commandType }));
    //     }
    // }

    /**
     * Gets the built-in prompt template for a query generation type
     * @param generationType The query generation type
     * @returns The built-in template
     */
    private static getBuiltInQueryGenerationTemplate(generationType: QueryGenerationType): string {
        switch (generationType) {
            case QueryGenerationType.CrossCollection:
                return CROSS_COLLECTION_QUERY_PROMPT_TEMPLATE;
            case QueryGenerationType.SingleCollection:
                return SINGLE_COLLECTION_QUERY_PROMPT_TEMPLATE;
            default:
                throw new Error(l10n.t('Unknown query generation type: {type}', { type: generationType }));
        }
    }

    /**
     * Loads a template from a file path
     * @param filePath The absolute or relative file path
     * @param templateType The template type identifier (for error messages)
     * @returns The template content
     */
    private static async loadTemplateFromFile(filePath: string, templateType: string): Promise<string> {
        try {
            let resolvedPath = filePath;
            if (!path.isAbsolute(filePath)) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    resolvedPath = path.join(workspaceFolders[0].uri.fsPath, filePath);
                }
            }

            // Check if file exists
            try {
                await fs.access(resolvedPath);
            } catch {
                throw new Error(
                    l10n.t('Template file not found: {path}', {
                        path: resolvedPath,
                    }),
                );
            }

            // Read the file
            const content = await fs.readFile(resolvedPath, 'utf-8');

            if (!content || content.trim().length === 0) {
                throw new Error(
                    l10n.t('Template file is empty: {path}', {
                        path: resolvedPath,
                    }),
                );
            }

            return content;
        } catch (error) {
            throw new Error(
                l10n.t('Failed to load template file for {type}: {error}', {
                    type: templateType,
                    error: error instanceof Error ? error.message : String(error),
                }),
            );
        }
    }
}
