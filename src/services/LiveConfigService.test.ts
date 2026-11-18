/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveConfigService } from './LiveConfigService';

const { state, update, warn } = vi.hoisted(() => {
    const state = new Map<string, unknown>();
    return {
        state,
        update: vi.fn(async (key: string, value: unknown): Promise<void> => {
            state.set(key, value);
        }),
        warn: vi.fn(),
    };
});

vi.mock('../extensionVariables', () => ({
    ext: {
        context: { globalState: { get: (key: string) => state.get(key), update } },
        outputChannel: { warn },
    },
}));

const legacyKey = 'atlas-mongodb-discovery.viewMode';

describe('Atlas view mode migration', () => {
    beforeEach(() => {
        state.clear();
        vi.clearAllMocks();
    });

    it.each(['tree', 'list'])('copies a legacy %s choice once and retains the original', async (mode) => {
        state.set(legacyKey, mode);
        await LiveConfigService.migrateAtlasViewMode();
        await LiveConfigService.migrateAtlasViewMode();

        expect(update).toHaveBeenCalledTimes(1);
        expect(state.get(legacyKey)).toBe(mode);
        state.delete(legacyKey);
        expect(LiveConfigService.getAtlasViewMode()).toBe(mode);
    });

    it('does not overwrite a newer choice with a legacy value', async () => {
        state.set(legacyKey, 'list');
        await LiveConfigService.setAtlasViewMode('tree');
        await LiveConfigService.migrateAtlasViewMode();

        expect(update).toHaveBeenCalledTimes(1);
        expect(LiveConfigService.getAtlasViewMode()).toBe('tree');
    });

    it('uses the legacy choice if the copy fails', async () => {
        state.set(legacyKey, 'list');
        update.mockRejectedValueOnce(new Error('Storage unavailable'));
        await expect(LiveConfigService.migrateAtlasViewMode()).rejects.toThrow('Storage unavailable');
        expect(LiveConfigService.getAtlasViewMode()).toBe('list');
    });

    it('ignores malformed legacy state and defaults to Tree', async () => {
        state.set(legacyKey, 'unknown');
        await LiveConfigService.migrateAtlasViewMode();

        expect(warn).toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(LiveConfigService.getAtlasViewMode()).toBe('tree');
    });
});
