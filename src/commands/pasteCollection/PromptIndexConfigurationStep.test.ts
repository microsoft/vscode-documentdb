/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClustersClient } from '../../documentdb/ClustersClient';
import { DocumentDbIndexService } from '../../services/taskService/data-api/indexes/DocumentDbIndexService';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';
import { PromptIndexConfigurationStep } from './PromptIndexConfigurationStep';

jest.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: jest.fn() },
}));

jest.mock('../../services/taskService/data-api/indexes/DocumentDbIndexService');

function createContext(selection: 'copy' | 'skip'): PasteCollectionWizardContext {
    return {
        sourceConnectionId: 'source',
        sourceConnectionName: 'Source',
        sourceDatabaseName: 'database',
        sourceCollectionName: 'collection',
        sourceCollectionSize: 1,
        targetConnectionId: 'target',
        targetConnectionName: 'Target',
        targetDatabaseName: 'database',
        isTargetExistingCollection: false,
        copyIndexes: false,
        telemetry: { properties: {}, measurements: {} },
        ui: {
            showQuickPick: jest.fn().mockResolvedValue({ id: selection }),
        },
    } as unknown as PasteCollectionWizardContext;
}

describe('PromptIndexConfigurationStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('does not read source indexes for a document-only copy', async () => {
        const context = createContext('skip');

        await new PromptIndexConfigurationStep().prompt(context);

        expect(context.copyIndexes).toBe(false);
        expect(ClustersClient.getClient).not.toHaveBeenCalled();
        expect(DocumentDbIndexService).not.toHaveBeenCalled();
    });

    it('counts source indexes when index copy is selected', async () => {
        const countCopyableIndexes = jest.fn().mockResolvedValue(3);
        jest.mocked(ClustersClient.getClient).mockResolvedValue({} as never);
        jest.mocked(DocumentDbIndexService).mockImplementation(
            () => ({ countCopyableIndexes }) as unknown as DocumentDbIndexService,
        );
        const context = createContext('copy');

        await new PromptIndexConfigurationStep().prompt(context);

        expect(context.copyIndexes).toBe(true);
        expect(countCopyableIndexes).toHaveBeenCalledTimes(1);
        expect(context.sourceIndexCount).toBe(3);
        expect(context.telemetry.measurements.sourceIndexCount).toBe(3);
    });

    it('fails the paste flow when selected index counting fails', async () => {
        const countCopyableIndexes = jest.fn().mockRejectedValue(new Error('count failed'));
        jest.mocked(ClustersClient.getClient).mockResolvedValue({} as never);
        jest.mocked(DocumentDbIndexService).mockImplementation(
            () => ({ countCopyableIndexes }) as unknown as DocumentDbIndexService,
        );
        const context = createContext('copy');

        await expect(new PromptIndexConfigurationStep().prompt(context)).rejects.toThrow('count failed');
    });
});
