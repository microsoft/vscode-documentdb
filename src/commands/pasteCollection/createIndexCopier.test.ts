/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentDbCollectionIndexCopier } from '../../services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';
import { createIndexCopier } from './createIndexCopier';

jest.mock('../../services/taskService/data-api/indexes/DocumentDbCollectionIndexCopier');

function createContext(isTargetExistingCollection: boolean): PasteCollectionWizardContext {
    return {
        sourceConnectionId: 'source',
        sourceConnectionName: 'Source',
        sourceDatabaseName: 'sourceDatabase',
        sourceCollectionName: 'sourceCollection',
        targetConnectionId: 'target',
        targetConnectionName: 'Target',
        targetDatabaseName: 'targetDatabase',
        targetCollectionName: isTargetExistingCollection ? 'existingCollection' : undefined,
        newCollectionName: isTargetExistingCollection ? undefined : 'newCollection',
        isTargetExistingCollection,
        copyIndexes: true,
        telemetry: { properties: {}, measurements: {} },
    } as PasteCollectionWizardContext;
}

describe('createIndexCopier', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it.each([
        [true, 'existingCollection'],
        [false, 'newCollection'],
    ])('uses the resolved target collection when existing is %s', (isTargetExistingCollection, collectionName) => {
        const context = createContext(isTargetExistingCollection);

        createIndexCopier(context);

        expect(DocumentDbCollectionIndexCopier).toHaveBeenCalledWith(
            { clusterId: 'source', databaseName: 'sourceDatabase', collectionName: 'sourceCollection' },
            { clusterId: 'target', databaseName: 'targetDatabase', collectionName },
        );
    });
});