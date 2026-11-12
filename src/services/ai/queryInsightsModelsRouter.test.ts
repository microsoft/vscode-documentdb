/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryInsightsModelsRouter } from '../../webviews/documentdb/queryInsightsShared/queryInsightsModelsRouter';

const mocks = vi.hoisted(() => ({
    getAvailableModels: vi.fn(),
    setSavedModelId: vi.fn(),
}));
vi.mock('./modelSelection', () => ({
    getAvailableModels: mocks.getAvailableModels,
    setSavedModelId: mocks.setSavedModelId,
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

    it('rejects empty model ids', async () => {
        await expect(caller.setSelectedModel({ modelId: '' })).rejects.toThrow();
        expect(mocks.setSavedModelId).not.toHaveBeenCalled();
    });
});
