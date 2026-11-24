/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { type PasteCollectionWizardContext } from './PasteCollectionWizardContext';
import { PromptConflictResolutionStep } from './PromptConflictResolutionStep';

describe('PromptConflictResolutionStep', () => {
    it('offers the four conflict strategies in the existing order', async () => {
        const showQuickPick = vi.fn().mockResolvedValue({ id: 'abort' });
        const context = { ui: { showQuickPick } } as unknown as PasteCollectionWizardContext;

        await new PromptConflictResolutionStep().prompt(context);

        expect(showQuickPick).toHaveBeenCalledOnce();
        const items = showQuickPick.mock.calls[0][0] as { id: string; label: string }[];
        expect(items.map(({ id, label }) => ({ id, label }))).toEqual([
            { id: 'abort', label: 'Abort on first error' },
            { id: 'skip', label: 'Skip and Log (continue)' },
            { id: 'overwrite', label: 'Overwrite existing documents' },
            { id: 'generateNewIds', label: 'Generate new _id values' },
        ]);
    });
});
