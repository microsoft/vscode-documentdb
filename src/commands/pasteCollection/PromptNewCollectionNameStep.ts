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

        const newCollectionName = await context.ui.showInputBox({
            prompt: l10n.t('Please enter the name for the new collection'),
            value: defaultName,
            ignoreFocusOut: true,
            validateInput: (name: string) => this.validateCollectionName(name),
            asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
        });

        context.newCollectionName = newCollectionName.trim();
    }

    public shouldPrompt(context: PasteCollectionWizardContext): boolean {
        // Only prompt if we're creating a new collection (pasting into database, not existing collection)
        return !context.isTargetExistingCollection;
    }

    private async generateDefaultCollectionName(context: PasteCollectionWizardContext): Promise<string> {
        const baseName = context.sourceCollectionName;
        let candidateName = baseName;
        let counter = 1;

        try {
            const client = await ClustersClient.getClient(context.targetConnectionId);
            const existingCollections = await client.listCollections(context.targetDatabaseName);
            const existingNames = new Set(existingCollections.map((c) => c.name));

            // Find available name with suffix if needed
            while (existingNames.has(candidateName)) {
                candidateName = `${baseName} (${counter})`;
                counter++;
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
}
