/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ext } from '../../extensionVariables';
import { CountSourceIndexesStep } from './CountSourceIndexesStep';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';
import { createIndexCopier } from './createIndexCopier';

jest.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { warn: jest.fn() } },
}));

jest.mock('./createIndexCopier');

function createContext(copyIndexes: boolean = true): PasteCollectionWizardContext {
    return {
        copyIndexes,
        sourceUniqueIndexNames: [],
        sourceTtlIndexNames: [],
        telemetry: { properties: {}, measurements: {} },
        ui: {
            showQuickPick: jest.fn().mockImplementation(async (items: Promise<never>) => items),
        },
    } as unknown as PasteCollectionWizardContext;
}

describe('CountSourceIndexesStep', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('shows a loading pick and records the source index count', async () => {
        const getSourceIndexSummary = jest.fn().mockResolvedValue({
            count: 3,
            uniqueIndexNames: ['email_1'],
            ttlIndexNames: ['expiresAt_1'],
        });
        jest.mocked(createIndexCopier).mockReturnValue({ getSourceIndexSummary } as unknown as ReturnType<
            typeof createIndexCopier
        >);
        const context = createContext();

        await new CountSourceIndexesStep().prompt(context);

        expect(context.ui.showQuickPick).toHaveBeenCalledWith(expect.any(Promise), {
            loadingPlaceHolder: 'Counting source indexes…',
            suppressPersistence: true,
        });
        expect(getSourceIndexSummary).toHaveBeenCalledWith(expect.any(AbortSignal));
        expect(context.sourceIndexCount).toBe(3);
        expect(context.sourceUniqueIndexNames).toEqual(['email_1']);
        expect(context.sourceTtlIndexNames).toEqual(['expiresAt_1']);
        expect(context.telemetry.measurements.sourceIndexCount).toBe(3);
    });

    it('continues with an unknown count when counting fails', async () => {
        const getSourceIndexSummary = jest.fn().mockRejectedValue(new Error('count failed'));
        jest.mocked(createIndexCopier).mockReturnValue({ getSourceIndexSummary } as unknown as ReturnType<
            typeof createIndexCopier
        >);
        const context = createContext();

        await expect(new CountSourceIndexesStep().prompt(context)).resolves.toBeUndefined();

        expect(context.sourceIndexCount).toBeUndefined();
        expect(context.telemetry.properties.sourceIndexCountError).toBe('Error');
        expect(ext.outputChannel.warn).toHaveBeenCalledWith('[IndexCopy] Failed to count source indexes: count failed');
    });

    it('does not prompt when index copying is disabled', () => {
        expect(new CountSourceIndexesStep().shouldPrompt(createContext(false))).toBe(false);
    });

    it('aborts the count when the loading pick is cancelled', async () => {
        let receivedSignal: AbortSignal | undefined;
        const getSourceIndexSummary = jest.fn().mockImplementation(
            (signal: AbortSignal) =>
                new Promise((_resolve, reject) => {
                    receivedSignal = signal;
                    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
                }),
        );
        jest.mocked(createIndexCopier).mockReturnValue({ getSourceIndexSummary } as unknown as ReturnType<
            typeof createIndexCopier
        >);
        const context = createContext();
        jest.mocked(context.ui.showQuickPick).mockImplementation(async (items: Promise<never>) => {
            void items.catch(() => undefined);
            throw new Error('cancelled');
        });

        await expect(new CountSourceIndexesStep().prompt(context)).rejects.toThrow('cancelled');

        expect(receivedSignal?.aborted).toBe(true);
    });
});
