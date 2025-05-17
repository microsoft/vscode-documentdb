/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import ConnectionString from 'mongodb-connection-string-url';
import { API } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { type StorageItem, StorageNames, StorageService } from '../../services/storageService';
import { generateDocumentDBStorageId } from '../../utils/storageUtils';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

export class ExecuteStep extends AzureWizardExecuteStep<NewConnectionWizardContext> {
    public priority: number = 100;

    public async execute(context: NewConnectionWizardContext): Promise<void> {
        const api = context.experience?.api ?? API.DocumentDB;
        const connectionString = context.connectionString!;
        const parentId = context.parentId;

        const parsedCS = new ConnectionString(connectionString);

        const label =
            parsedCS.username && parsedCS.username.length > 0
                ? `${parsedCS.username}@${parsedCS.hosts.join(',')}`
                : parsedCS.hosts.join(',');

        return ext.state.showCreatingChild(
            parentId,
            l10n.t('Creating "{nodeName}"…', { nodeName: label }),
            async () => {
                await new Promise((resolve) => setTimeout(resolve, 250));

                const storageId = generateDocumentDBStorageId(connectionString);

                const storageItem: StorageItem = {
                    id: storageId,
                    name: label,
                    properties: { isEmulator: false, api: api },
                    secrets: [connectionString],
                };

                await StorageService.get(StorageNames.Connections).push('clusters', storageItem, true);

                if (parentId === undefined || parentId === '') {
                    // Refresh the connections tree when adding a new root-level connection
                    // (No need to refresh when adding a child node)
                    ext.connectionsBranchDataProvider.refresh();

                    // TODO: Find the actual tree element by ID before revealing it
                    // const treeItem = await ext.connectionsBranchDataProvider.findItemById(storageItem.id); // `findItemById` is a placeholder, does not exist in the current code
                    // if (treeItem) {
                    //     ext.connectionsTreeView.reveal(treeItem, { select: true, focus: true });
                    // }
                }
            },
        );
    }

    public shouldExecute(context: NewConnectionWizardContext): boolean {
        return !!context.connectionString;
    }
}
