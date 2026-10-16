/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionStorageService, ItemType, type ConnectionType } from '../../../services/connectionStorageService';
import { nonNullValue } from '../../../utils/nonNull';
import { type CreateFolderWizardContext } from './CreateFolderWizardContext';

export class PromptFolderNameStep extends AzureWizardPromptStep<CreateFolderWizardContext> {
    public async prompt(context: CreateFolderWizardContext): Promise<void> {
        const connectionType = nonNullValue(
            context.connectionType,
            'context.connectionType',
            'PromptFolderNameStep.ts',
        );

        const folderName = await context.ui.showInputBox({
            prompt: l10n.t('Enter folder name'),
            title: context.wizardTitle,
            validateInput: (value: string) => this.validateInput(value),
            asyncValidationTask: (value: string) => this.validateNameAvailable(context, value, connectionType),
        });

        context.folderName = folderName.trim();
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private validateInput(value: string | undefined): string | undefined {
        if (!value || value.trim().length === 0) {
            // Skip for now, asyncValidationTask takes care of this case
            return undefined;
        }

        // Add any synchronous format validation here if needed

        return undefined;
    }

    private async validateNameAvailable(
        context: CreateFolderWizardContext,
        value: string,
        connectionType: ConnectionType,
    ): Promise<string | undefined> {
        if (!value || value.trim().length === 0) {
            return l10n.t('Folder name cannot be empty');
        }

        try {
            // Check for duplicate folder names at the same level
            const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                value.trim(),
                context.parentFolderId,
                connectionType,
                ItemType.Folder,
            );

            if (isDuplicate) {
                return l10n.t('A folder with this name already exists at this level');
            }
        } catch (_error) {
            console.error(_error);
            return undefined; // Don't block the user from continuing if we can't validate the name
        }

        return undefined;
    }
}
