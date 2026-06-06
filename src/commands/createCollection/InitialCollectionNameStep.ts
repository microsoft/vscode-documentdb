/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type CreateDatabaseWizardContext } from '../createDatabase/CreateDatabaseWizardContext';
import { CollectionNameStep } from './CollectionNameStep';

export class InitialCollectionNameStep extends AzureWizardPromptStep<CreateDatabaseWizardContext> {
    public hideStepCount: boolean = true;

    private readonly baseStep = new CollectionNameStep();

    public async prompt(context: CreateDatabaseWizardContext): Promise<void> {
        const prompt: string = l10n.t('Enter an initial collection name for the new database.');
        context.collectionName = (
            await context.ui.showInputBox({
                prompt,
                validateInput: (name?: string) => this.baseStep.validateInput(name),
            })
        ).trim();

        context.valuesToMask.push(context.collectionName);
    }

    public shouldPrompt(context: CreateDatabaseWizardContext): boolean {
        return !!context.requiresInitialCollection && !context.collectionName;
    }
}
