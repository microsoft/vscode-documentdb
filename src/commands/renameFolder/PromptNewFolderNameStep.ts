/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { FolderStorageService } from '../../services/folderStorageService';
import { nonNullOrEmptyValue } from '../../utils/nonNull';
import { type RenameFolderWizardContext } from './RenameFolderWizardContext';

export class PromptNewFolderNameStep extends AzureWizardPromptStep<RenameFolderWizardContext> {
    public async prompt(context: RenameFolderWizardContext): Promise<void> {
        const originalName = nonNullOrEmptyValue(
            context.originalFolderName,
            'context.originalFolderName',
            'PromptNewFolderNameStep.ts',
        );

        const newFolderName = await context.ui.showInputBox({
            prompt: l10n.t('Enter new folder name'),
            value: originalName,
            validateInput: async (value: string) => {
                if (!value || value.trim().length === 0) {
                    return l10n.t('Folder name cannot be empty');
                }

                // Don't validate if the name hasn't changed
                if (value.trim() === originalName) {
                    return undefined;
                }

                // Check for duplicate folder names at the same level
                const existingFolders = await FolderStorageService.getChildren(context.parentFolderId);
                if (existingFolders.some((folder) => folder.name === value.trim() && folder.id !== context.folderId)) {
                    return l10n.t('A folder with this name already exists at this level');
                }

                return undefined;
            },
        });

        context.newFolderName = newFolderName.trim();
    }

    public shouldPrompt(): boolean {
        return true;
    }
}
