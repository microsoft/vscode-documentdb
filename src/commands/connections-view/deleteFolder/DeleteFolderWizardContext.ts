/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type ConnectionType } from '../../../services/connectionStorageService';
import { type TaskInfo } from '../../../services/taskService/taskServiceResourceTracking';

export interface DeleteFolderWizardContext extends IActionContext {
    /** The folder being deleted */
    folderItem: {
        id: string;
        storageId: string;
        name: string;
    };

    /** Connection type for the folder */
    connectionType: ConnectionType;

    /** Conflicting tasks found during verification - populated during verification */
    conflictingTasks: TaskInfo[];

    /** Number of folders that will be deleted (including the folder itself) - populated during verification */
    foldersToDelete: number;

    /** Number of connections that will be deleted - populated during verification */
    connectionsToDelete: number;

    /** User confirmed the deletion */
    confirmed: boolean;

    /** Deletion statistics for telemetry */
    deletedFolders: number;
    deletedConnections: number;
}
