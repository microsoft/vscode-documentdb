/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ItemType } from '../../../services/connectionStorageService';
import { nonNullOrEmptyValue, nonNullValue } from '../../../utils/nonNull';
import { randomUtils } from '../../../utils/randomUtils';
import { type CreateFolderWizardContext } from './CreateFolderWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<CreateFolderWizardContext> {
    public priority: number = 100;

    public async execute(context: CreateFolderWizardContext): Promise<void> {
        const folderName = nonNullOrEmptyValue(context.folderName, 'context.folderName', 'ExecuteStep.ts');
        const connectionType = nonNullValue(context.connectionType, 'context.connectionType', 'ExecuteStep.ts');

        const folderId = randomUtils.getRandomUUID();

        // Create folder as a ConnectionItem with type 'folder'
        await ConnectionStorageService.save(
            connectionType,
            {
                id: folderId,
                name: folderName,
                properties: {
                    type: ItemType.Folder,
                    parentId: context.parentFolderId,
                    api: API.DocumentDB,
                    availableAuthMethods: [],
                },
                secrets: {
                    connectionString: '',
                },
            },
            false,
        );

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
