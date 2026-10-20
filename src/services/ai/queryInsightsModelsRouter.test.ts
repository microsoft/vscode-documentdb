/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandType } from '../../commands/llmEnhancedCommands/indexAdvisorCommands';
import { queryInsightsModelsRouter } from '../../webviews/documentdb/queryInsightsShared/queryInsightsModelsRouter';

const mocks = vi.hoisted(() => ({
    getAvailableModels: vi.fn(),
    setSavedModelId: vi.fn(),
    getPromptSourceInfo: vi.fn(),
}));
vi.mock('./modelSelection', () => ({
    getAvailableModels: mocks.getAvailableModels,
    setSavedModelId: mocks.setSavedModelId,
}));
vi.mock('../promptTemplateService', () => ({
    getIndexAdvisorPromptSourceInfo: mocks.getPromptSourceInfo,
}));
vi.mock('../../commands/llmEnhancedCommands/indexAdvisorCommands', () => ({
    CommandType: { Find: 'find', Aggregate: 'aggregate', Count: 'count' },
}));
vi.mock('../../webviews/_integration/trpc', async () => {
    const { initTRPC } = await import('@trpc/server');
    const trpc = initTRPC.create();
    return { router: trpc.router, publicProcedureWithTelemetry: trpc.procedure };
});

describe('Shared Query Insights model RPCs', () => {
    const result = { models: [], savedModelId: null, effectiveModelId: null, effectiveReason: null };
    const caller = queryInsightsModelsRouter.createCaller({});

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getAvailableModels.mockResolvedValue(result);
    });

    it('exposes discovery without requiring a connection context', async () => {
        expect(await caller.getAvailableModels()).toEqual(result);
    });

    it('persists or clears a choice and returns the effective selection', async () => {
        expect(await caller.setSelectedModel({ modelId: 'picked' })).toEqual(result);
        await caller.setSelectedModel({ modelId: null });
        expect(mocks.setSavedModelId.mock.calls).toEqual([['picked'], [null]]);
    });

    it('reads prompt settings for the requested command type', async () => {
        mocks.getPromptSourceInfo.mockReturnValue({ source: 'custom-file', path: 'local.md' });
        expect(await caller.getPromptSourceInfo({ commandType: CommandType.Aggregate })).toEqual({
            source: 'custom-file',
            path: 'local.md',
        });
        expect(mocks.getPromptSourceInfo).toHaveBeenCalledWith(CommandType.Aggregate);
    });

    it('rejects empty model ids and unsupported command types', async () => {
        await expect(caller.setSelectedModel({ modelId: '' })).rejects.toThrow();
        await expect(caller.getPromptSourceInfo({ commandType: 'drop' as CommandType })).rejects.toThrow();
        expect(mocks.setSavedModelId).not.toHaveBeenCalled();
        expect(mocks.getPromptSourceInfo).not.toHaveBeenCalled();
    });
});
