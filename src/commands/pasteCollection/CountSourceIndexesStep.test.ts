/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { openUrl, UserCancelledError } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type GetSourceIndexSummaryOptions } from '../../services/taskService/data-api/indexes/CollectionIndexCopier';
import { CountSourceIndexesStep } from './CountSourceIndexesStep';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';
import { createIndexCopier } from './createIndexCopier';

const showErrorMessage = vscode.window.showErrorMessage as unknown as jest.MockedFunction<
    (message: string, options: vscode.MessageOptions, ...items: string[]) => Thenable<string | undefined>
>;

jest.mock('../../extensionVariables', () => ({
    ext: { outputChannel: { warn: jest.fn() } },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    ...jest.requireActual('@microsoft/vscode-azext-utils'),
    openUrl: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('vscode');

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

    it('shows a loading pick and records a safe source index count', async () => {
        const getSourceIndexSummary = jest.fn().mockResolvedValue({
            count: 3,
            uniqueIndexNames: [],
            ttlIndexNames: [],
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
        expect(getSourceIndexSummary).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
        expect(context.sourceIndexCount).toBe(3);
        expect(context.sourceUniqueIndexNames).toEqual([]);
        expect(context.sourceTtlIndexNames).toEqual([]);
        expect(context.telemetry.measurements.sourceIndexCount).toBe(3);
    });

    it.each([
        { uniqueIndexNames: ['email_1'], ttlIndexNames: [], expectedUniqueCount: 1, expectedTtlCount: 0 },
        { uniqueIndexNames: [], ttlIndexNames: ['expiresAt_1'], expectedUniqueCount: 0, expectedTtlCount: 1 },
    ])('refuses document-affecting source indexes', async (summary) => {
        const getSourceIndexSummary = jest.fn().mockResolvedValue({ count: 2, ...summary });
        jest.mocked(createIndexCopier).mockReturnValue({ getSourceIndexSummary } as unknown as ReturnType<
            typeof createIndexCopier
        >);
        const context = createContext();

        await expect(new CountSourceIndexesStep().prompt(context)).rejects.toThrow(UserCancelledError);

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'Cannot copy TTL or unique indexes with documents',
            expect.objectContaining({
                modal: true,
                detail: expect.stringMatching(
                    /reject documents\.\n\nAffected indexes: .+\n\nChoose "No, only copy documents"/,
                ),
            }),
            'Learn More',
        );
        expect(context.telemetry.properties.wizardFailureReason).toBe('documentAffectingIndexes');
        expect(context.telemetry.measurements.sourceUniqueIndexCount).toBe(summary.expectedUniqueCount);
        expect(context.telemetry.measurements.sourceTtlIndexCount).toBe(summary.expectedTtlCount);
    });

    it('opens the collection-paste guidance from Learn More before cancelling', async () => {
        showErrorMessage.mockResolvedValue('Learn More');
        jest.mocked(createIndexCopier).mockReturnValue({
            getSourceIndexSummary: jest.fn().mockResolvedValue({
                count: 2,
                uniqueIndexNames: ['email_1'],
                ttlIndexNames: [],
            }),
        } as unknown as ReturnType<typeof createIndexCopier>);

        await expect(new CountSourceIndexesStep().prompt(createContext())).rejects.toThrow(UserCancelledError);

        expect(openUrl).toHaveBeenCalledWith(
            'https://microsoft.github.io/vscode-documentdb/user-manual/copy-and-paste#why-collection-paste-refuses-ttl-and-unique-indexes',
        );
    });

    it('aborts with the reason when counting fails', async () => {
        const getSourceIndexSummary = jest.fn().mockRejectedValue(new Error('count failed'));
        jest.mocked(createIndexCopier).mockReturnValue({ getSourceIndexSummary } as unknown as ReturnType<
            typeof createIndexCopier
        >);
        const context = createContext();

        await expect(new CountSourceIndexesStep().prompt(context)).rejects.toThrow(
            'Failed to read source indexes: count failed',
        );

        expect(context.sourceIndexCount).toBeUndefined();
        expect(context.telemetry.properties.sourceIndexCountError).toBe('Error');
        expect(ext.outputChannel.warn).toHaveBeenCalledWith('[IndexCopy] Failed to count source indexes: count failed');
    });

    it('does not prompt when index copying is disabled', () => {
        const step = new CountSourceIndexesStep();

        expect(step.shouldPrompt(createContext(false))).toBe(false);
        expect(createIndexCopier).not.toHaveBeenCalled();
    });

    it('aborts the count when the loading pick is cancelled', async () => {
        let receivedSignal: AbortSignal | undefined;
        const getSourceIndexSummary = jest.fn().mockImplementation(
            (options: GetSourceIndexSummaryOptions) =>
                new Promise((_resolve, reject) => {
                    receivedSignal = options.signal;
                    options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
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
