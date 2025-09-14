/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type ConflictResolutionStrategy } from '../../services/tasks/copy-and-paste/copyPasteConfig';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { type DatabaseItem } from '../../tree/documentdb/DatabaseItem';

export interface PasteCollectionWizardContext extends IActionContext {
    // Source collection details (from copy operation)
    sourceCollectionName: string;
    sourceDatabaseName: string;
    sourceConnectionId: string;
    sourceConnectionName: string;

    // Target details
    targetNode: CollectionItem | DatabaseItem;
    targetConnectionId: string;
    targetConnectionName: string;
    targetDatabaseName: string;
    targetCollectionName?: string;
    isTargetExistingCollection: boolean;

    // User selections from wizard steps
    newCollectionName?: string;
    conflictResolutionStrategy?: ConflictResolutionStrategy;
    copyIndexes?: boolean;
}
