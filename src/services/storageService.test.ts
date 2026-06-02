/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type StorageItem, StorageService } from './storageService';

// In-memory backing stores shared with the mocked `ext` below.
const globalStateStore = new Map<string, unknown>();
const secretStore = new Map<string, string>();

// Spy hooks so tests can count how often the underlying storage was actually read.
const secretGet = jest.fn((key: string): Promise<string | undefined> => Promise.resolve(secretStore.get(key)));

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((str: string) => str),
}));

jest.mock('../extensionVariables', () => ({
    ext: {
        context: {
            globalState: {
                keys: jest.fn(() => Array.from(globalStateStore.keys())),
                get: jest.fn((key: string) => globalStateStore.get(key)),
                update: jest.fn((key: string, value: unknown) => {
                    if (value === undefined) {
                        globalStateStore.delete(key);
                    } else {
                        globalStateStore.set(key, value);
                    }
                    return Promise.resolve();
                }),
            },
            extension: { id: 'test.extension' },
        },
        secretStorage: {
            get: (key: string) => secretGet(key),
            store: jest.fn((key: string, value: string) => {
                secretStore.set(key, value);
                return Promise.resolve();
            }),
            delete: jest.fn((key: string) => {
                secretStore.delete(key);
                return Promise.resolve();
            }),
        },
    },
}));

const WORKSPACE = 'clusters';

function seedItem(storageName: string, id: string, name: string, secret: string): void {
    globalStateStore.set(`${storageName}/${WORKSPACE}/${id}`, { id, name });
    secretStore.set(`${storageName}/${WORKSPACE}/${id}/secrets`, JSON.stringify([secret]));
}

describe('StorageImpl getItems caching', () => {
    let uniqueName = 0;

    beforeEach(() => {
        globalStateStore.clear();
        secretStore.clear();
        secretGet.mockClear();
        // Use a fresh storage name per test so the singleton/cache from a prior test never leaks.
        uniqueName++;
        jest.useRealTimers();
    });

    function freshStorage(): ReturnType<typeof StorageService.get> {
        return StorageService.get(`cache-test-${uniqueName}`);
    }

    it('coalesces concurrent getItems calls into a single storage read', async () => {
        const storage = freshStorage();
        const storageName = `test.extension.cache-test-${uniqueName}`;
        seedItem(storageName, 'a', 'Alpha', 'secret-a');
        seedItem(storageName, 'b', 'Beta', 'secret-b');

        const [first, second] = await Promise.all([storage.getItems(WORKSPACE), storage.getItems(WORKSPACE)]);

        expect(first).toHaveLength(2);
        expect(second).toHaveLength(2);
        // Two items => one secret read each for a single underlying load, not two loads.
        expect(secretGet).toHaveBeenCalledTimes(2);
    });

    it('serves a fresh snapshot from cache without re-reading storage', async () => {
        const storage = freshStorage();
        const storageName = `test.extension.cache-test-${uniqueName}`;
        seedItem(storageName, 'a', 'Alpha', 'secret-a');

        await storage.getItems(WORKSPACE);
        await storage.getItems(WORKSPACE);

        // The second call hit the cache; the secret was read only during the first load.
        expect(secretGet).toHaveBeenCalledTimes(1);
    });

    it('returns defensive copies so callers cannot mutate shared cached state', async () => {
        const storage = freshStorage();
        const storageName = `test.extension.cache-test-${uniqueName}`;
        seedItem(storageName, 'a', 'Alpha', 'secret-a');

        const first = (await storage.getItems(WORKSPACE)) as StorageItem[];
        first[0].secrets!.push('mutated');

        const second = (await storage.getItems(WORKSPACE)) as StorageItem[];
        expect(second[0].secrets).toEqual(['secret-a']);
    });

    it('invalidates the cache after push so the new item is visible', async () => {
        const storage = freshStorage();
        const storageName = `test.extension.cache-test-${uniqueName}`;
        seedItem(storageName, 'a', 'Alpha', 'secret-a');

        const before = await storage.getItems(WORKSPACE);
        expect(before).toHaveLength(1);

        await storage.push(WORKSPACE, { id: 'b', name: 'Beta', secrets: ['secret-b'] });

        const after = await storage.getItems(WORKSPACE);
        expect(after).toHaveLength(2);
    });

    it('invalidates the cache after delete so the removed item is gone', async () => {
        const storage = freshStorage();
        const storageName = `test.extension.cache-test-${uniqueName}`;
        seedItem(storageName, 'a', 'Alpha', 'secret-a');
        seedItem(storageName, 'b', 'Beta', 'secret-b');

        const before = await storage.getItems(WORKSPACE);
        expect(before).toHaveLength(2);

        await storage.delete(WORKSPACE, 'a');

        const after = await storage.getItems(WORKSPACE);
        expect(after.map((i) => i.id)).toEqual(['b']);
    });

    it('does not cache a failed read', async () => {
        const storage = freshStorage();
        const storageName = `test.extension.cache-test-${uniqueName}`;
        seedItem(storageName, 'a', 'Alpha', 'secret-a');

        secretGet.mockRejectedValueOnce(new Error('transient failure'));

        await expect(storage.getItems(WORKSPACE)).rejects.toThrow('transient failure');

        // The next call should retry (not replay the rejection) and succeed.
        const recovered = await storage.getItems(WORKSPACE);
        expect(recovered).toHaveLength(1);
    });
});
