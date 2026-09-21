/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';
import { PromptIndexConfigurationStep } from './PromptIndexConfigurationStep';

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
        newCollectionName: 'targetCollection',
        isTargetExistingCollection: false,
        copyIndexes: false,
        sourceUniqueIndexNames: [],
        sourceTtlIndexNames: [],
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
    });

    it('enables index copying when selected', async () => {
        const context = createContext('copy');

        await new PromptIndexConfigurationStep().prompt(context);

        expect(context.copyIndexes).toBe(true);
        expect(context.ui.showQuickPick).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    id: 'copy',
                    detail: "Copy the source collection's secondary index definitions. TTL and unique indexes must be pasted separately.",
                }),
            ]),
            expect.any(Object),
        );
    });

    it('clears a previously loaded count when index copying is disabled', async () => {
        const context = createContext('skip');
        context.sourceIndexCount = 3;
        context.sourceUniqueIndexNames = ['email_1'];
        context.sourceTtlIndexNames = ['expiresAt_1'];

        await new PromptIndexConfigurationStep().prompt(context);

        expect(context.sourceIndexCount).toBeUndefined();
        expect(context.sourceUniqueIndexNames).toEqual([]);
        expect(context.sourceTtlIndexNames).toEqual([]);
    });
});
