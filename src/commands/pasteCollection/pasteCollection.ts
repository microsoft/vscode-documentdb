/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { MongoDocumentReader, MongoDocumentWriter } from '../../documentdb/DocumentProvider';
import { ext } from '../../extensionVariables';
import { CopyPasteCollectionTask } from '../../services/tasks/CopyPasteCollectionTask';
import { TaskService, TaskState } from '../../services/taskService';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';
import { ConflictResolutionStrategy, type CopyPasteConfig } from '../../utils/copyPasteUtils';

export async function pasteCollection(_context: IActionContext, targetNode: CollectionItem): Promise<void> {
    const sourceNode = ext.copiedCollectionNode;
    if (!sourceNode) {
        void vscode.window.showWarningMessage(
            l10n.t('No collection has been marked for copy. Please use Copy Collection first.'),
        );
        return;
    }

    if (!targetNode) {
        throw new Error(vscode.l10n.t('No target node selected.'));
    }

    // Check type of sourceNode or targetNodeAdd commentMore actions
    // Currently we only support CollectionItem types
    // Later we need to check if they are supported types that with document reader and writer implementations
    if (!(sourceNode instanceof CollectionItem) || !(targetNode instanceof CollectionItem)) {
        void vscode.window.showWarningMessage(l10n.t('Invalid source or target node type.'));
        return;
    }

    const sourceInfo = l10n.t(
        'Source: Collection "{0}" from database "{1}", connectionId: {2}',
        sourceNode.collectionInfo.name,
        sourceNode.databaseInfo.name,
        sourceNode.cluster.id,
    );
    const targetInfo = l10n.t(
        'Target: Collection "{0}" from database "{1}", connectionId: {2}',
        targetNode.collectionInfo.name,
        targetNode.databaseInfo.name,
        targetNode.cluster.id,
    );

    // void vscode.window.showInformationMessage(`${sourceInfo}\n${targetInfo}`);
    // Confirm the copy operation with the userAdd commentMore actions
    const confirmMessage = l10n.t(
        'Copy "{0}"\nto "{1}"?\nThis will add all documents from the source collection to the target collection.',
        sourceInfo,
        targetInfo,
    );

    const confirmation = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, l10n.t('Copy'));

    if (confirmation !== l10n.t('Copy')) {
        return;
    }

    try {
        // Create copy-paste configuration
        const config: CopyPasteConfig = {
            source: {
                connectionId: sourceNode.cluster.id,
                databaseName: sourceNode.databaseInfo.name,
                collectionName: sourceNode.collectionInfo.name,
            },
            target: {
                connectionId: targetNode.cluster.id,
                databaseName: targetNode.databaseInfo.name,
                collectionName: targetNode.collectionInfo.name,
            },
            // Currently we only support aborting on conflict
            onConflict: ConflictResolutionStrategy.Abort,
        };

        // Create task with documentDB document providers
        // Need to check reader and writer implementations before creating the task
        // For now, we only support MongoDB collections
        const reader = new MongoDocumentReader();
        const writer = new MongoDocumentWriter();
        const task = new CopyPasteCollectionTask(config, reader, writer);

        // // Get total number of documents in the source collection
        // const totalDocuments = await reader.countDocuments(
        //     config.source.connectionId,
        //     config.source.databaseName,
        //     config.source.collectionName,
        // );

        // Register task with the task service
        TaskService.registerTask(task);

        // Start and monitor the task without showing a progress notification
        await task.start();

        // Wait for the task to complete
        while (task.getStatus().state === TaskState.Running || task.getStatus().state === TaskState.Initializing) {
            // Simple polling with a small delay
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Check final status and show result
        const finalStatus = task.getStatus();
        if (finalStatus.state === TaskState.Completed) {
            void vscode.window.showInformationMessage(
                l10n.t('Collection copied successfully: {0}', finalStatus.message || ''),
            );
        } else if (finalStatus.state === TaskState.Failed) {
            const errorToThrow =
                finalStatus.error instanceof Error ? finalStatus.error : new Error('Copy operation failed');
            throw errorToThrow;
        } else if (finalStatus.state === TaskState.Stopped) {
            void vscode.window.showInformationMessage(l10n.t('Copy operation was cancelled.'));
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(l10n.t('Failed to copy collection: {0}', errorMessage));
        throw error;
    } finally {
        // Clean up - remove the task from the service after completion
        try {
            const task = TaskService.listTasks().find((t) => t.type === 'copy-paste-collection');
            if (task) {
                await TaskService.deleteTask(task.id);
            }
        } catch (cleanupError) {
            // Log cleanup error but don't throw
            console.warn('Failed to clean up copy-paste task:', cleanupError);
        }
    }
}
