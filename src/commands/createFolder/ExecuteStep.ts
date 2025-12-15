/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../../extensionVariables';
import { FolderStorageService } from '../../services/folderStorageService';
import { nonNullOrEmptyValue } from '../../utils/nonNull';
import { randomUtils } from '../../utils/randomUtils';
import { type CreateFolderWizardContext } from './CreateFolderWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<CreateFolderWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateFolderWizardContext): Promise<void> {
        const folderName = nonNullOrEmptyValue(context.folderName, 'context.folderName', 'ExecuteStep.ts');

        const folderId = randomUtils.getRandomUUID();

        await FolderStorageService.save({
            id: folderId,
            name: folderName,
            parentId: context.parentFolderId,
        });

        ext.outputChannel.appendLine(
            l10n.t('Created folder: {folderName}', {
                folderName: folderName,
            }),
        );
    }

    public shouldExecute(context: CreateFolderWizardContext): boolean {
        return !!context.folderName;
    }
}
