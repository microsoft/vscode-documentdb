/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardExecuteStep } from '@microsoft/vscode-azext-utils';
import { withConnectionRemoval } from '../../../documentdb/connectionTeardown';
import { ext } from '../../../extensionVariables';
import { ConnectionStorageService, ItemType } from '../../../services/connectionStorageService';
import {
    refreshParentInConnectionsView,
    withConnectionsViewProgress,
} from '../../../tree/connections-view/connectionsViewHelpers';
import { type DeleteFolderWizardContext } from './DeleteFolderWizardContext';
import { enumerateConnectionsInFolder } from '../verificationUtils';

/**
 * Step to execute the folder deletion operation.
 * Recursively deletes all descendants and then the folder itself.
 */
export class ExecuteStep extends AzureWizardExecuteStep<DeleteFolderWizardContext> {
    public priority: number = 100;

    public async execute(context: DeleteFolderWizardContext): Promise<void> {
        // TODO: [IMPROVEMENT] Add error handling for partial failures (H-2)
        // Currently, if an operation fails midway, items may be in an inconsistent state.
        // Consider: 1) Collecting errors and reporting partial success, or 2) Implementing rollback

        // Initialize counters
        context.deletedFolders = 0;
        context.deletedConnections = 0;

            const ids = await enumerateConnectionsInFolder(context.folderItem.storageId, context.connectionType);
        try {
            await withConnectionRemoval(ids, async (removeConnection) => {
                await withConnectionsViewProgress(async () => {
                    await ext.state.showDeleting(context.folderItem.id, async () => {
                        await this.deleteRecursive(context, context.folderItem.storageId, removeConnection);
                        await ConnectionStorageService.delete(context.connectionType, context.folderItem.storageId);
                        context.deletedFolders++;
                    });
                });
            });
        } finally {
            refreshParentInConnectionsView(context.folderItem.id);
        }

        // Record telemetry measurements
        context.telemetry.measurements.deletedFolders = context.deletedFolders;
        context.telemetry.measurements.deletedConnections = context.deletedConnections;
        context.telemetry.measurements.totalItemsDeleted = context.deletedFolders + context.deletedConnections;
        context.telemetry.properties.hadSubitems =
            context.deletedFolders + context.deletedConnections > 1 ? 'true' : 'false';
    }

    /**
     * Recursively delete all descendants of a folder
     */
    private async deleteRecursive(
        context: DeleteFolderWizardContext,
        parentId: string,
        removeConnection: (clusterId: string, deleteStored: () => Promise<void>) => Promise<void>,
    ): Promise<void> {
        const children = await ConnectionStorageService.getChildren(parentId, context.connectionType);

        for (const child of children) {
            // Recursively delete child folders first
            if (child.properties.type === ItemType.Folder) {
                await this.deleteRecursive(context, child.id, removeConnection);
                await ConnectionStorageService.delete(context.connectionType, child.id);
                context.deletedFolders++;
            } else {
                await removeConnection(child.id, () => ConnectionStorageService.delete(context.connectionType, child.id));
                context.deletedConnections++;
            }
        }
    }

    public shouldExecute(context: DeleteFolderWizardContext): boolean {
        return context.confirmed;
    }
}
