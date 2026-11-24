/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Example starts here.
import { type TaskService, type TaskStatus, whenTerminal } from '@microsoft/vscode-ext-tasks';
import {
    ConflictResolutionStrategy,
    type DocumentReader,
    type StreamingDocumentWriter,
} from '@microsoft/vscode-ext-tasks-data-transfer';
import { CopyPasteCollectionTask } from '@microsoft/vscode-ext-tasks-data-transfer/copy-collection';

export async function copyCollection(
    service: TaskService,
    reader: DocumentReader,
    writer: StreamingDocumentWriter,
): Promise<TaskStatus> {
    const task = new CopyPasteCollectionTask(
        {
            copyOperationCorrelationId: crypto.randomUUID(),
            source: { clusterId: 'source-id', databaseName: 'source-db', collectionName: 'items' },
            target: { clusterId: 'target-id', databaseName: 'target-db', collectionName: 'items' },
            onConflict: ConflictResolutionStrategy.Abort,
            copyIndexes: false,
        },
        reader,
        writer,
    );
    service.registerTask(task);
    await task.start();
    await whenTerminal(task);
    return task.getStatus();
}
