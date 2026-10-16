/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ConnectionStorageService, ItemType, type ConnectionType } from '../../../services/connectionStorageService';
import { nonNullOrEmptyValue, nonNullValue } from '../../../utils/nonNull';
import { type RenameFolderWizardContext } from './RenameFolderWizardContext';

export class PromptNewFolderNameStep extends AzureWizardPromptStep<RenameFolderWizardContext> {
    public async prompt(context: RenameFolderWizardContext): Promise<void> {
        const originalName = nonNullOrEmptyValue(
            context.originalFolderName,
            'context.originalFolderName',
            'PromptNewFolderNameStep.ts',
        );
        const connectionType = nonNullValue(
            context.connectionType,
            'context.connectionType',
            'PromptNewFolderNameStep.ts',
        );

        const newFolderName = await context.ui.showInputBox({
            title: l10n.t('Rename Folder'),
            prompt: l10n.t('Enter new folder name'),
            value: originalName,
            validateInput: (value: string) => this.validateInput(value),
            asyncValidationTask: (value: string) =>
                this.validateNameAvailable(context, value, originalName, connectionType),
        });

        context.newFolderName = newFolderName.trim();
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
        context: RenameFolderWizardContext,
        value: string,
        originalName: string,
        connectionType: ConnectionType,
    ): Promise<string | undefined> {
        if (!value || value.trim().length === 0) {
            return l10n.t('Folder name cannot be empty');
        }

        // Don't validate if the name hasn't changed
        if (value.trim() === originalName) {
            return undefined;
        }

        try {
            // Check for duplicate folder names at the same level
            const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                value.trim(),
                context.parentFolderId,
                connectionType,
                ItemType.Folder,
                context.folderId,
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
