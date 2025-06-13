/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { TaskService } from '../../services/taskService';
import { 
    ConflictResolutionStrategy, 
    CopyPasteCollectionTask, 
    MongoDocumentReader, 
    MongoDocumentWriter 
} from '../../services/copyPaste';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';

export async function pasteCollection(_context: IActionContext, targetNode: CollectionItem): Promise<void> {
    const sourceNode = ext.copiedCollectionNode;
    if (!sourceNode) {
        void vscode.window.showWarningMessage(
            vscode.l10n.t('No collection has been marked for copy. Please use Copy Collection first.'),
        );
        return;
    }

    const sourceInfo = vscode.l10n.t(
        'Source: Collection "{0}" from database "{1}", connectionId: {2}',
        sourceNode.collectionInfo.name,
        sourceNode.databaseInfo.name,
        sourceNode.cluster.id,
    );
    const targetInfo = vscode.l10n.t(
        'Target: Collection "{0}" from database "{1}", connectionId: {2}',
        targetNode.collectionInfo.name,
        targetNode.databaseInfo.name,
        targetNode.cluster.id,
    );

    // Show confirmation dialog
    const proceed = await vscode.window.showWarningMessage(
        vscode.l10n.t(
            'This will copy all documents from the source to the target collection.\n\n{0}\n{1}\n\nDo you want to proceed?',
            sourceInfo,
            targetInfo,
        ),
        { modal: true },
        vscode.l10n.t('Yes, Copy Documents'),
    );

    if (proceed !== vscode.l10n.t('Yes, Copy Documents')) {
        return;
    }

    // Create and register the copy-paste task
    const taskId = `copy-paste-${Date.now()}`;
    const config = {
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

    const reader = new MongoDocumentReader();
    const writer = new MongoDocumentWriter();
    const task = new CopyPasteCollectionTask(taskId, config, reader, writer);

    try {
        // Register and start the task
        TaskService.registerTask(task);
        
        void vscode.window.showInformationMessage(
            vscode.l10n.t('Copy operation started. Task ID: {0}', taskId),
        );

        await task.start();

        void vscode.window.showInformationMessage(
            vscode.l10n.t('Copy operation completed successfully!'),
        );
    } catch (error) {
        void vscode.window.showErrorMessage(
            vscode.l10n.t(
                'Copy operation failed: {0}',
                error instanceof Error ? error.message : String(error),
            ),
        );
    } finally {
        // Clean up the task
        try {
            await TaskService.deleteTask(taskId);
        } catch (cleanupError) {
            // Log cleanup error but don't throw
            console.warn('Failed to cleanup task:', cleanupError);
        }
    }
}
