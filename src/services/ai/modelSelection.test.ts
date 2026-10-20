/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import {
    getAvailableModels,
    QUERY_INSIGHTS_SELECTED_MODEL_KEY,
    resolveQueryInsightsModel,
    setSavedModelId,
} from './modelSelection';

const mocks = vi.hoisted(() => ({
    selectChatModels: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
}));

vi.mock('vscode', () => ({
    lm: { selectChatModels: mocks.selectChatModels },
    l10n: { t: (message: string): string => message },
}));
vi.mock('../../extensionVariables', () => ({
    ext: {
        context: { globalState: { get: mocks.get, update: mocks.update } },
        outputChannel: { warn: vi.fn() },
    },
}));

function model(id: string, family = id): vscode.LanguageModelChat {
    return {
        id,
        family,
        vendor: 'copilot',
        name: id,
        version: '1',
        maxInputTokens: 1000,
        countTokens: vi.fn(),
        sendRequest: vi.fn(),
    };
}

describe('Query Insights model selection', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        mocks.selectChatModels.mockResolvedValue([]);
    });

    it('omits auto, deduplicates ids and adds the utility alias without changing list order', async () => {
        mocks.selectChatModels
            .mockResolvedValueOnce([model('auto'), model('first'), model('first'), model('second')])
            .mockResolvedValueOnce([model('copilot-utility')]);

        const result = await getAvailableModels();

        expect(result.models.map((entry) => entry.id)).toEqual(['first', 'second', 'copilot-utility']);
        expect(result.effectiveModelId).toBe('first');
        expect(result.models[2].isUtility).toBe(true);
        expect(mocks.selectChatModels).toHaveBeenLastCalledWith({ vendor: 'copilot', family: 'copilot-utility' });
    });

    it('resolves explicit, then saved, then first available, including stale preferences', async () => {
        mocks.get.mockReturnValue('saved');
        mocks.selectChatModels.mockResolvedValue([model('first'), model('saved'), model('copilot-utility')]);

        expect((await resolveQueryInsightsModel('copilot-utility'))?.source).toBe('explicit');
        expect((await resolveQueryInsightsModel('missing'))?.model.id).toBe('saved');
        expect((await getAvailableModels()).effectiveModelId).toBe('saved');

        mocks.get.mockReturnValue('removed');
        expect((await resolveQueryInsightsModel())?.source).toBe('first-available');
        expect((await getAvailableModels()).effectiveModelId).toBe('first');
    });

    it('returns an empty result when model discovery fails or no models exist', async () => {
        expect(await resolveQueryInsightsModel()).toBeUndefined();
        mocks.selectChatModels.mockRejectedValueOnce(new Error('unavailable'));
        expect(await getAvailableModels()).toEqual({ models: [], savedModelId: null, effectiveModelId: null });
    });

    it('persists and clears the shared preference', async () => {
        await setSavedModelId('selected');
        await setSavedModelId(null);
        expect(mocks.update.mock.calls).toEqual([
            [QUERY_INSIGHTS_SELECTED_MODEL_KEY, 'selected'],
            [QUERY_INSIGHTS_SELECTED_MODEL_KEY, undefined],
        ]);
    });
});
