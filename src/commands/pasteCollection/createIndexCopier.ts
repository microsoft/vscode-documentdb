/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CollectionIndexCopier } from '../../services/taskService/data-api/indexes/CollectionIndexCopier';
import { createIndexCopier as createEndpointIndexCopier } from '../../services/taskService/data-api/indexes/createIndexCopier';
import { nonNullValue } from '../../utils/nonNull';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';

export function createIndexCopier(context: PasteCollectionWizardContext): CollectionIndexCopier {
    const targetCollectionName = context.isTargetExistingCollection
        ? nonNullValue(context.targetCollectionName, 'targetCollectionName', 'context.targetCollectionName')
        : nonNullValue(context.newCollectionName, 'newCollectionName', 'context.newCollectionName');

    return createEndpointIndexCopier(
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
