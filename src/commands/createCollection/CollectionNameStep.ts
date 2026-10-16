/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { ext } from '../../extensionVariables';
import { type CreateCollectionWizardContext } from './CreateCollectionWizardContext';

export class CollectionNameStep extends AzureWizardPromptStep<CreateCollectionWizardContext> {
    public hideStepCount: boolean = true;

    public async prompt(context: CreateCollectionWizardContext): Promise<void> {
        const prompt: string = l10n.t('Enter a collection name.');
        context.newCollectionName = (
            await context.ui.showInputBox({
                prompt,
                validateInput: (name?: string) => this.validateInput(name),
                asyncValidationTask: (name: string) => this.validateNameAvailable(context, name),
            })
        ).trim();

        context.valuesToMask.push(context.newCollectionName);
    }

    public shouldPrompt(context: CreateCollectionWizardContext): boolean {
        return !context.newCollectionName;
    }

    public validateInput(collectionName: string | undefined): string | undefined {
        collectionName = collectionName ? collectionName.trim() : '';

        if (collectionName.length === 0) {
            // skip this for now, asyncValidationTask takes care of this case, otherwise it's only warnings the user sees..
            return undefined;
        }

        if (!/^[a-zA-Z_]/.test(collectionName)) {
            return l10n.t('Collection names should begin with an underscore or a letter character.');
        }

        if (/[$]/.test(collectionName)) {
            return l10n.t('Collection name cannot contain the $.');
        }

        if (collectionName.includes('\0')) {
            return l10n.t('Collection name cannot contain the null character.');
        }

        if (collectionName.startsWith('system.')) {
            return l10n.t('Collection name cannot begin with the system. prefix (Reserved for internal use).');
        }

        if (collectionName.includes('.system.')) {
            return l10n.t('Collection name cannot contain .system.');
        }

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateCollectionWizardContext,
        name: string,
    ): Promise<string | undefined> {
        name = name.trim();

        if (name.length === 0) {
            return l10n.t('Collection name is required.');
        }

        try {
            const client = await ClustersClient.getClient(context.credentialsId);
            const collections = await client.listCollections(context.databaseId);

            if (collections.filter((c) => c.name === name).length > 0) {
                return l10n.t('The collection "{0}" already exists in the database "{1}".', name, context.databaseId);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(l10n.t('Error validating collection name availability: {0}', errorMessage));
            return undefined; // we don't want to block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
