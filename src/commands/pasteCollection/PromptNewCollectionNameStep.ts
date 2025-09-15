/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export class PromptNewCollectionNameStep extends AzureWizardPromptStep<PasteCollectionWizardContext> {
    public async prompt(context: PasteCollectionWizardContext): Promise<void> {
        // Generate default name with suffix if needed
        const defaultName = await this.generateDefaultCollectionName(context);

        // Record telemetry for default name generation
        context.telemetry.properties.defaultNameGenerated = 'true';
        context.telemetry.properties.defaultNameSameAsSource =
            defaultName === context.sourceCollectionName ? 'true' : 'false';
        context.telemetry.properties.defaultNameHasSuffix =
            defaultName !== context.sourceCollectionName ? 'true' : 'false';

        const newCollectionName = await context.ui.showInputBox({
            prompt: l10n.t('Please enter the name for the new collection'),
            value: defaultName,
            ignoreFocusOut: true,
            validateInput: (name: string) => this.validateCollectionName(name),
            asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
        });

        const finalName = newCollectionName.trim();

        // Record telemetry for user naming behavior
        context.telemetry.properties.userAcceptedDefaultName = finalName === defaultName ? 'true' : 'false';
        context.telemetry.properties.userModifiedDefaultName = finalName !== defaultName ? 'true' : 'false';
        context.telemetry.properties.finalNameSameAsSource =
            finalName === context.sourceCollectionName ? 'true' : 'false';

        // Record length statistics for analytics
        context.telemetry.measurements.sourceCollectionNameLength = context.sourceCollectionName.length;
        context.telemetry.measurements.defaultNameLength = defaultName.length;
        context.telemetry.measurements.finalNameLength = finalName.length;

        // Record name similarity metrics
        if (finalName !== defaultName) {
            try {
                // User modified the suggested name - track edit distance or other metrics
                const editOperations = this.calculateSimpleEditDistance(defaultName, finalName);
                if (typeof editOperations === 'number' && Number.isFinite(editOperations)) {
                    context.telemetry.measurements.nameEditDistance = editOperations;
                }
            } catch (error) {
                console.error('Failed to record name edit distance telemetry:', error);
                context.telemetry.properties.nameEditDistanceTelemetryError = 'true';
                context.telemetry.properties.nameEditDistanceTelemetryErrorType =
                    error instanceof Error ? error.name : 'unknown';
                context.telemetry.properties.nameEditDistanceTelemetryErrorMessage =
                    error instanceof Error ? error.message : String(error);
            }
        }

        context.newCollectionName = finalName;
    }

    public shouldPrompt(context: PasteCollectionWizardContext): boolean {
        // Only prompt if we're creating a new collection (pasting into database, not existing collection)
        return !context.isTargetExistingCollection;
    }

    private async generateDefaultCollectionName(context: PasteCollectionWizardContext): Promise<string> {
        const baseName = context.sourceCollectionName;
        let candidateName = baseName;

        try {
            const client = await ClustersClient.getClient(context.targetConnectionId);
            const existingCollections = await client.listCollections(context.targetDatabaseName);
            const existingNames = new Set(existingCollections.map((c) => c.name));

            // Find available name with intelligent suffix incrementing
            while (existingNames.has(candidateName)) {
                /**
                 * Matches and captures parts of a collection name string.
                 *
                 * The regular expression `^(.*?)(\s*\(\d+\))?$` is used to parse the collection name into two groups:
                 * - The first capturing group `(.*?)` matches the main part of the name (non-greedy match of any characters).
                 * - The second capturing group `(\s*\(\d+\))?` optionally matches a numeric suffix enclosed in parentheses,
                 *   which may be preceded by whitespace. For example, " (123)".
                 *
                 * Examples:
                 * - Input: "target (1)" -> Match: ["target (1)", "target", " (1)"] -> Result: "target (2)"
                 * - Input: "target" -> Match: ["target", "target", undefined] -> Result: "target (1)"
                 * - Input: "my-collection (42)" -> Match: ["my-collection (42)", "my-collection", " (42)"] -> Result: "my-collection (43)"
                 */
                const match = candidateName.match(/^(.*?)(\s*\(\d+\))?$/);
                if (match) {
                    const nameBase = match[1];
                    const count = match[2] ? parseInt(match[2].replace(/\D/g, ''), 10) + 1 : 1;
                    candidateName = `${nameBase} (${count})`;
                } else {
                    // Fallback if regex fails for some reason
                    candidateName = `${candidateName} (1)`;
                }
            }
        } catch (error) {
            // If we can't check existing collections, just use the base name
            console.warn('Could not check existing collections for default name generation:', error);

            // Add telemetry for error investigation
            context.telemetry.properties.defaultNameGenerationError = 'true';
            context.telemetry.properties.defaultNameGenerationErrorType =
                error instanceof Error ? error.name : 'unknown';
            context.telemetry.properties.defaultNameGenerationErrorMessage =
                error instanceof Error ? error.message : String(error);
        }

        return candidateName;
    }

    private validateCollectionName(name: string | undefined): string | undefined {
        name = name ? name.trim() : '';

        if (name.length === 0) {
            return undefined; // Let asyncValidationTask handle this
        }

        if (!/^[a-zA-Z_]/.test(name)) {
            return l10n.t('Collection names should begin with an underscore or a letter character.');
        }

        if (/[$]/.test(name)) {
            return l10n.t('Collection name cannot contain the $ character.');
        }

        if (name.includes('\0')) {
            return l10n.t('Collection name cannot contain the null character.');
        }

        if (name.startsWith('system.')) {
            return l10n.t('Collection name cannot begin with the system. prefix (Reserved for internal use).');
        }

        if (name.includes('.system.')) {
            return l10n.t('Collection name cannot contain .system.');
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: PasteCollectionWizardContext,
        name: string,
    ): Promise<string | undefined> {
        if (name.length === 0) {
            return l10n.t('Collection name is required.');
        }

        try {
            const client = await ClustersClient.getClient(context.targetConnectionId);
            const collections = await client.listCollections(context.targetDatabaseName);

            const existingCollection = collections.find((c) => c.name === name);
            if (existingCollection) {
                return l10n.t('A collection with the name "{0}" already exists', name);
            }
        } catch (error) {
            console.error('Error validating collection name availability:', error);
            // Don't block the user if we can't validate
            return undefined;
        }

        return undefined;
    }

    /**
     * Calculate a simple edit distance (Levenshtein distance) between two strings.
     * This helps track how much users modify the suggested name.
     */
    private calculateSimpleEditDistance(str1: string, str2: string): number {
        const matrix: number[][] = [];
        const len1 = str1.length;
        const len2 = str2.length;

        // Initialize matrix
        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
        }

        // Fill matrix
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                if (str1[i - 1] === str2[j - 1]) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j] + 1, // deletion
                        matrix[i][j - 1] + 1, // insertion
                        matrix[i - 1][j - 1] + 1, // substitution
                    );
                }
            }
        }

        return matrix[len1][len2];
    }
}
