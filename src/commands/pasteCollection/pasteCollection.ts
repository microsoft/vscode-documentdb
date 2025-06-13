/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { CopyPasteCollectionTask } from '../../services/CopyPasteCollectionTask';
import { ConflictResolutionStrategy, type CopyPasteConfig } from '../../services/copyPasteTypes';
import { MongoDocumentReader, MongoDocumentWriter } from '../../services/MongoDocumentProvider';
import { TaskService, TaskState } from '../../services/taskService';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';

export async function pasteCollection(context: IActionContext, targetNode: CollectionItem): Promise<void> {
    const sourceNode = ext.copiedCollectionNode;
    if (!sourceNode) {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('No collection has been marked for copy. Please use Copy Collection first.'),
        );
        return;
    }

    if (!targetNode) {
        throw new Error(vscode.l10n.t('No target node selected.'));
    }

    // Confirm the copy operation with the user
    const sourceInfo = `${sourceNode.collectionInfo.name} (${sourceNode.databaseInfo.name})`;
    const targetInfo = `${targetNode.collectionInfo.name} (${targetNode.databaseInfo.name})`;
    
    const confirmMessage = vscode.l10n.t(
        'Copy collection "{0}" to "{1}"? This will add all documents from the source collection to the target collection.',
        sourceInfo,
        targetInfo,
    );

    const confirmation = await vscode.window.showWarningMessage(
        confirmMessage,
        { modal: true },
        vscode.l10n.t('Copy'),
        vscode.l10n.t('Cancel'),
    );

    if (confirmation !== vscode.l10n.t('Copy')) {
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
            onConflict: ConflictResolutionStrategy.Abort,
        };

        // Create task with MongoDB providers
        const reader = new MongoDocumentReader();
        const writer = new MongoDocumentWriter();
        const task = new CopyPasteCollectionTask(config, reader, writer);

        // Register task with the task service
        TaskService.registerTask(task);

        // Show progress notification
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: vscode.l10n.t('Copying collection...'),
                cancellable: true,
            },
            async (progress, token) => {
                // Handle cancellation
                token.onCancellationRequested(() => {
                    void task.stop();
                });

                // Start the task
                await task.start();

                // Monitor progress
                let lastProgress = 0;
                while (task.getStatus().state === TaskState.Running || task.getStatus().state === TaskState.Initializing) {
                    const status = task.getStatus();
                    const currentProgress = status.progress || 0;
                    
                    if (currentProgress > lastProgress) {
                        progress.report({
                            increment: currentProgress - lastProgress,
                            message: status.message,
                        });
                        lastProgress = currentProgress;
                    }

                    // Wait a bit before checking again
                    await new Promise((resolve) => setTimeout(resolve, 500));
                }

                // Final progress update
                const finalStatus = task.getStatus();
                if (finalStatus.state === TaskState.Completed) {
                    progress.report({
                        increment: 100 - lastProgress,
                        message: finalStatus.message,
                    });
                }
            },
        );

        // Check final status and show result
        const finalStatus = task.getStatus();
        if (finalStatus.state === TaskState.Completed) {
            void vscode.window.showInformationMessage(
                vscode.l10n.t('Collection copied successfully: {0}', finalStatus.message || ''),
            );
        } else if (finalStatus.state === TaskState.Failed) {
            const errorToThrow = finalStatus.error instanceof Error ? finalStatus.error : new Error('Copy operation failed');
            throw errorToThrow;
        } else if (finalStatus.state === TaskState.Stopped) {
            void vscode.window.showInformationMessage(vscode.l10n.t('Copy operation was cancelled.'));
        }
    } catch (error) {
        context.telemetry.properties.error = 'true';
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
            vscode.l10n.t('Failed to copy collection: {0}', errorMessage),
        );
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
