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

describe.each([
    {
        provider: 'Atlas',
        legacyKey: 'atlas-mongodb-discovery.viewMode',
        defaultMode: 'tree',
        get: 'getAtlasViewMode',
        set: 'setAtlasViewMode',
        migrate: 'migrateAtlasViewMode',
    },
    {
        provider: 'Kubernetes',
        legacyKey: 'kubernetes-discovery.viewMode',
        defaultMode: 'list',
        get: 'getKubernetesViewMode',
        set: 'setKubernetesViewMode',
        migrate: 'migrateKubernetesViewMode',
    },
] as const)('$provider view mode migration', ({ legacyKey, defaultMode, get, set, migrate }) => {
    beforeEach(() => {
        state.clear();
        vi.clearAllMocks();
    });

    it.each(['tree', 'list'])('copies a legacy %s choice once and retains the original', async (mode) => {
        state.set(legacyKey, mode);
        await LiveConfigService[migrate]();
        await LiveConfigService[migrate]();

        expect(update).toHaveBeenCalledTimes(1);
        expect(state.get(legacyKey)).toBe(mode);
        state.delete(legacyKey);
        expect(LiveConfigService[get]()).toBe(mode);
    });

    it('does not overwrite a newer choice with a legacy value', async () => {
        state.set(legacyKey, 'list');
        await LiveConfigService[set]('tree');
        await LiveConfigService[migrate]();

        expect(update).toHaveBeenCalledTimes(1);
        expect(LiveConfigService[get]()).toBe('tree');
    });

    it('uses the legacy choice if the copy fails', async () => {
        const mode = defaultMode === 'tree' ? 'list' : 'tree';
        state.set(legacyKey, mode);
        update.mockRejectedValueOnce(new Error('Storage unavailable'));
        await expect(LiveConfigService[migrate]()).rejects.toThrow('Storage unavailable');
        expect(LiveConfigService[get]()).toBe(mode);
    });

    it(`ignores malformed legacy state and defaults to ${defaultMode}`, async () => {
        state.set(legacyKey, 'unknown');
        await LiveConfigService[migrate]();

        expect(warn).toHaveBeenCalled();
        expect(update).not.toHaveBeenCalled();
        expect(LiveConfigService[get]()).toBe(defaultMode);
    });
});
