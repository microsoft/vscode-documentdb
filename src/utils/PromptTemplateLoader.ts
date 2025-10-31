/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs/promises';
import * as path from 'path';

import { ext } from '../extensionVariables';

/**
 * Lazy loader for prompt template files with caching support.
 * Prompt templates are stored as markdown files in the resources/prompts directory
 * and loaded on demand to avoid bloating the extension bundle size.
 */
class PromptTemplateLoader {
    private readonly cache = new Map<string, string>();
    private readonly promptsDir = 'resources/prompts';

    /**
     * Loads a prompt template file with caching.
     * The template is loaded from disk on first access and cached for subsequent calls.
     *
     * @param filename The name of the template file (e.g., 'find-query-prompt-template.md')
     * @returns The template content as a string
     */
    async loadTemplate(filename: string): Promise<string> {
        // Check cache first
        const cached = this.cache.get(filename);
        if (cached !== undefined) {
            return cached;
        }

        // Load from disk
        const templatePath = path.join(ext.context.extensionPath, this.promptsDir, filename);
        const content = await fs.readFile(templatePath, 'utf-8');

        // Cache and return
        this.cache.set(filename, content);
        return content;
    }

    /**
     * Clears the template cache.
     * Useful for testing or memory management.
     */
    clearCache(): void {
        this.cache.clear();
    }

    /**
     * Gets the current cache size.
     * Useful for debugging and telemetry.
     */
    get cacheSize(): number {
        return this.cache.size;
    }
}

/**
 * Singleton instance of the PromptTemplateLoader.
 * Use this instance to load prompt templates throughout the extension.
 */
export const promptTemplateLoader = new PromptTemplateLoader();
