/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { FolderStorageService } from '../../services/folderStorageService';
import { nonNullOrEmptyValue, nonNullValue } from '../../utils/nonNull';
import { type RenameFolderWizardContext } from './RenameFolderWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<RenameFolderWizardContext> {
    public priority: number = 100;

    public async execute(context: RenameFolderWizardContext): Promise<void> {
        const folderId = nonNullOrEmptyValue(context.folderId, 'context.folderId', 'ExecuteStep.ts');
        const newFolderName = nonNullOrEmptyValue(context.newFolderName, 'context.newFolderName', 'ExecuteStep.ts');
        const originalFolderName = nonNullOrEmptyValue(
            context.originalFolderName,
            'context.originalFolderName',
            'ExecuteStep.ts',
        );

        // Don't do anything if the name hasn't changed
        if (newFolderName === originalFolderName) {
            return;
        }

        const folder = nonNullValue(await FolderStorageService.get(folderId), 'FolderStorageService.get(folderId)', 'ExecuteStep.ts');

        folder.name = newFolderName;
        await FolderStorageService.save(folder, true);

        ext.outputChannel.appendLine(
            l10n.t('Renamed folder from "{oldName}" to "{newName}"', {
                oldName: originalFolderName,
                newName: newFolderName,
            }),
        );
    }

    public shouldExecute(context: RenameFolderWizardContext): boolean {
        return !!context.newFolderName && context.newFolderName !== context.originalFolderName;
    }
}
