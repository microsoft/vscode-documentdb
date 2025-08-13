/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { CopyPasteCollectionTask } from '../../services/tasks/copy-and-paste/CopyPasteCollectionTask';
import { ConflictResolutionStrategy, type CopyPasteConfig } from '../../services/tasks/copy-and-paste/copyPasteConfig';
import { DocumentDbDocumentReader } from '../../services/tasks/copy-and-paste/documentdb/documentDbDocumentReader';
import { DocumentDbDocumentWriter } from '../../services/tasks/copy-and-paste/documentdb/documentDbDocumentWriter';
import { TaskService } from '../../services/taskService';
import { CollectionItem } from '../../tree/documentdb/CollectionItem';

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
            // Currently we only support aborting and skipping on conflict
            // onConflict: ConflictResolutionStrategy.Abort,
            // onConflict: ConflictResolutionStrategy.Skip,
            onConflict: ConflictResolutionStrategy.Overwrite,
        };

        // Create task with documentDB document providers
        // Need to check reader and writer implementations before creating the task
        // For now, we only support DocumentDB collections
        const reader = new DocumentDbDocumentReader();
        const writer = new DocumentDbDocumentWriter();
        const task = new CopyPasteCollectionTask(config, reader, writer);

        // // Get total number of documents in the source collection
        // const totalDocuments = await reader.countDocuments(
        //     config.source.connectionId,
        //     config.source.databaseName,
        //     config.source.collectionName,
        // );

        // Register task with the task service
        TaskService.registerTask(task);

        // Remove manual logging; now handled by Task base class
        // task.onDidChangeState((event) => {
        //     if (event.newState === TaskState.Completed) {
        //         const summary = task.getStatus();
        //         ext.outputChannel.appendLine(
        //             l10n.t("✅ Task '{taskName}' completed successfully. {message}", {
        //                 taskName: task.name,
        //                 message: summary.message || '',
        //             }),
        //         );
        //     } else if (event.newState === TaskState.Stopped) {
        //         ext.outputChannel.appendLine(
        //             l10n.t("⏹️ Task '{taskName}' was stopped. {message}", {
        //                 taskName: task.name,
        //                 message: task.getStatus().message || '',
        //             }),
        //         );
        //     } else if (event.newState === TaskState.Failed) {
        //         const summary = task.getStatus();
        //         ext.outputChannel.appendLine(
        //             l10n.t("⚠️ Task '{taskName}' failed. {message}", {
        //                 taskName: task.name,
        //                 message: summary.message || '',
        //             }),
        //         );
        //     }
        // });

        // ext.outputChannel.appendLine(l10n.t("▶️ Task '{taskName}' starting...", { taskName: 'Copy Collection' }));

        // Start the copy-paste task
        await task.start();
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(l10n.t('Failed to copy collection: {0}', errorMessage));

        // Remove duplicate output log; Task base class logs failures centrally
        // ext.outputChannel.appendLine(
        //     l10n.t('⚠️ Task failed. {errorMessage}', {
        //         errorMessage: errorMessage,
        //     }),
        // );

        throw error;
    }
}
