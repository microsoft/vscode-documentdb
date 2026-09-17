/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDbCollectionIndexCopier } from '../../services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier';
import { nonNullValue } from '../../utils/nonNull';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export function createIndexCopier(context: PasteCollectionWizardContext): DocumentDbCollectionIndexCopier {
    const targetCollectionName = context.isTargetExistingCollection
        ? nonNullValue(context.targetCollectionName, 'targetCollectionName', 'context.targetCollectionName')
        : nonNullValue(context.newCollectionName, 'newCollectionName', 'context.newCollectionName');

    return new DocumentDbCollectionIndexCopier(
        {
            clusterId: context.sourceConnectionId,
            databaseName: context.sourceDatabaseName,
            collectionName: context.sourceCollectionName,
        },
        {
            clusterId: context.targetConnectionId,
            databaseName: context.targetDatabaseName,
            collectionName: targetCollectionName,
        },
    );
}
