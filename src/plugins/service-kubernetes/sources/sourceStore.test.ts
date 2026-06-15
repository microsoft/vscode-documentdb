/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const globalStateBacking = new Map<string, unknown>();
const secretStorageBacking = new Map<string, string>();

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((message: string, ...args: string[]) =>
            args.reduce<string>((m, value, index) => m.replace(`{${String(index)}}`, value), message),
        ),
    },
}));

jest.mock('../../../extensionVariables', () => ({
    ext: {
        context: {
            extension: { id: 'test-extension' },
            subscriptions: { push: (): void => {} },
            globalState: {
                get: <T>(key: string, defaultValue?: T): T | undefined => {
                    const value = globalStateBacking.has(key) ? (globalStateBacking.get(key) as T) : undefined;
                    return value === undefined ? defaultValue : value;
                },
                update: async (key: string, value: unknown): Promise<void> => {
                    if (value === undefined) {
                        globalStateBacking.delete(key);
                    } else {
                        globalStateBacking.set(key, value);
                    }
                },
                keys: () => Array.from(globalStateBacking.keys()),
            },
        },
        secretStorage: {
            get: async (key: string): Promise<string | undefined> =>
                secretStorageBacking.has(key) ? secretStorageBacking.get(key) : undefined,
            store: async (key: string, value: string): Promise<void> => {
                secretStorageBacking.set(key, value);
            },
            delete: async (key: string): Promise<void> => {
                secretStorageBacking.delete(key);
            },
            onDidChange: (): { dispose: () => void } => ({ dispose: (): void => {} }),
        },
    },
}));

import * as path from 'path';
import { StorageService } from '../../../services/storageService';
import { DEFAULT_SOURCE_ID } from '../config';
import {
    addDefaultSource,
    addFileSource,
    addInlineSource,
    getSource,
    KUBECONFIG_STORAGE_NAME,
    KUBECONFIG_STORAGE_WORKSPACE,
    readHiddenSourceIds,
    readInlineYaml,
    readSources,
    removeSource,
    renameSource,
    resetSourceStoreCacheForMigration,
    setHiddenSourceIds,
    tryAddFileSource,
} from './sourceStore';

const STORAGE_PREFIX = `test-extension.${KUBECONFIG_STORAGE_NAME}/${KUBECONFIG_STORAGE_WORKSPACE}/`;

beforeEach(() => {
    globalStateBacking.clear();
    secretStorageBacking.clear();
    // Drop cached StorageImpl instances so the per-instance `getItems` cache does not leak a
    // previous test's snapshot into the next test (backing maps are cleared above, but that
    // in-memory cache is not).
    StorageService._resetForTests();
    resetSourceStoreCacheForMigration();
});

describe('readSources', () => {
    it('returns an empty list when nothing has been persisted', async () => {
        expect(await readSources()).toEqual([]);
    });

    it('returns persisted records sorted by their `order` property', async () => {
        const fileRecord = await addFileSource('/abs/team.yaml');
        const defaultRecord = await addDefaultSource();
        const inlineRecord = await addInlineSource('apiVersion: v1');

        const sources = await readSources();
        // Default added with order = -1 so it sorts to the front; remaining
        // entries follow insertion order.
        expect(sources.map((s) => s.id)).toEqual([defaultRecord.id, fileRecord.id, inlineRecord.id]);
    });
});

describe('addDefaultSource', () => {
    it('inserts the singleton default and returns it on subsequent calls', async () => {
        const a = await addDefaultSource();
        const b = await addDefaultSource();
        expect(a.id).toBe(DEFAULT_SOURCE_ID);
        expect(b.id).toBe(DEFAULT_SOURCE_ID);
        expect((await readSources()).filter((s) => s.kind === 'default')).toHaveLength(1);
    });

    it('lets the user remove and re-add the default with the same reserved id', async () => {
        const created = await addDefaultSource();
        await removeSource(created.id);
        expect((await readSources()).some((s) => s.kind === 'default')).toBe(false);

        const recreated = await addDefaultSource();
        expect(recreated.id).toBe(DEFAULT_SOURCE_ID);
    });
});

describe('addFileSource', () => {
    it('persists a new file source with the basename as label', async () => {
        const record = await addFileSource('/abs/team.yaml');
        expect(record.kind).toBe('file');
        expect(record.label).toBe('team.yaml');
        // addFileSource calls path.normalize on the input, which converts forward
        // slashes to backslashes on Windows. Normalize the expected value the same
        // way so the assertion passes on both POSIX and Windows hosts.
        expect(record.path).toBe(path.normalize('/abs/team.yaml'));
        expect((await readSources()).some((s) => s.id === record.id)).toBe(true);
    });

    it('reuses an existing record when the path matches (dedup)', async () => {
        const first = await addFileSource('/abs/team.yaml');
        const second = await addFileSource('/abs/team.yaml');
        expect(second.id).toBe(first.id);
        expect((await readSources()).filter((s) => s.kind === 'file')).toHaveLength(1);
    });

    it('disambiguates labels when basenames collide', async () => {
        const a = await addFileSource('/work/team.yaml');
        const b = await addFileSource('/personal/team.yaml');
        expect(a.label).toBe('team.yaml');
        expect(b.label).toBe('team.yaml (2)');
    });
});

describe('tryAddFileSource', () => {
    it('reports created=true on first add and created=false on dedup', async () => {
        const first = await tryAddFileSource('/abs/team.yaml');
        expect(first.created).toBe(true);
        expect(first.record.kind).toBe('file');

        const second = await tryAddFileSource('/abs/team.yaml');
        expect(second.created).toBe(false);
        expect(second.record.id).toBe(first.record.id);

        expect((await readSources()).filter((s) => s.kind === 'file')).toHaveLength(1);
    });

    it('serializes concurrent adds for the SAME path — exactly one record, one created:true', async () => {
        // This is the race the in-flight map guards against: without it, two
        // concurrent callers would both see "not present" in the cache snapshot
        // and both write distinct UUID records for the same normalized path.
        const [a, b, c] = await Promise.all([
            tryAddFileSource('/abs/team.yaml'),
            tryAddFileSource('/abs/team.yaml'),
            tryAddFileSource('/abs/team.yaml'),
        ]);

        const createdFlags = [a.created, b.created, c.created];
        expect(createdFlags.filter((v) => v === true)).toHaveLength(1);
        expect(createdFlags.filter((v) => v === false)).toHaveLength(2);

        // All three callers see the SAME record id (the winner's).
        expect(a.record.id).toBe(b.record.id);
        expect(b.record.id).toBe(c.record.id);

        // Storage holds exactly one file-kind record for that path.
        const fileRecords = (await readSources()).filter((s) => s.kind === 'file');
        expect(fileRecords).toHaveLength(1);
        expect(fileRecords[0].path).toBe(path.normalize('/abs/team.yaml'));
    });

    it('does NOT serialize adds for DIFFERENT paths', async () => {
        // Sanity check that the per-path lock doesn't accidentally serialize
        // unrelated adds (which would hurt throughput and could mask future
        // regressions in the keying logic).
        const [a, b] = await Promise.all([tryAddFileSource('/work/alpha.yaml'), tryAddFileSource('/work/beta.yaml')]);

        expect(a.created).toBe(true);
        expect(b.created).toBe(true);
        expect(a.record.id).not.toBe(b.record.id);
        expect((await readSources()).filter((s) => s.kind === 'file')).toHaveLength(2);
    });

    it('serializes the leader-fails-then-follower-retry path so only ONE record is written', async () => {
        // Regression test for the leader-failure fallback race: when the
        // in-flight leader rejects, every follower wakes from `await inFlight`
        // and must re-acquire the lock before becoming the new leader. Without
        // the while-true loop, N followers would each call doTryAddFileSource
        // directly and produce N records (the round-3 race, just gated behind
        // a transient failure). With the loop, only one follower becomes the
        // new leader; the rest see its in-flight entry and report created:false.

        // Inject a one-shot failure on the FIRST globalState.update call so
        // the original leader's pushItem rejects. Subsequent calls succeed.
        // We can simulate this without going through `jest.spyOn` on the
        // mocked module because the mock's `update` writes through to the
        // shared `globalStateBacking` Map — temporarily monkey-patching
        // `globalStateBacking.set` is the simplest one-shot fault injector.
        let storageWriteCount = 0;
        const realSet = globalStateBacking.set.bind(globalStateBacking);
        globalStateBacking.set = ((key: string, value: unknown) => {
            storageWriteCount++;
            if (storageWriteCount === 1) {
                throw new Error('transient storage failure');
            }
            return realSet(key, value);
        }) as typeof globalStateBacking.set;

        try {
            const settled = await Promise.allSettled([
                tryAddFileSource('/abs/team.yaml'),
                tryAddFileSource('/abs/team.yaml'),
                tryAddFileSource('/abs/team.yaml'),
            ]);

            // Exactly one rejection (the original leader) and two fulfilled
            // results among the followers.
            const rejected = settled.filter((s) => s.status === 'rejected');
            expect(rejected).toHaveLength(1);

            const fulfilled = settled.filter(
                (s): s is Extract<typeof s, { status: 'fulfilled' }> => s.status === 'fulfilled',
            );
            expect(fulfilled).toHaveLength(2);

            // Among the two fulfilled: exactly one new-leader create + one
            // dedup follower. (If the race were still open, both could be
            // `created: true` with distinct record ids.)
            const createdCount = fulfilled.filter((s) => s.value.created === true).length;
            expect(createdCount).toBe(1);
            expect(fulfilled[0].value.record.id).toBe(fulfilled[1].value.record.id);

            // Storage holds exactly one file-kind record for the path.
            const fileRecords = (await readSources()).filter((s) => s.kind === 'file');
            expect(fileRecords).toHaveLength(1);
        } finally {
            globalStateBacking.set = realSet;
        }
    });
});

describe('addInlineSource', () => {
    it('stores YAML in StorageService secrets and returns a new record', async () => {
        const yaml = 'apiVersion: v1\nkind: Config\n';
        const record = await addInlineSource(yaml);
        expect(record.kind).toBe('inline');
        expect(record.label).toBe('Pasted YAML 1');

        const secretKey = `${STORAGE_PREFIX}${record.id}/secrets`;
        const stored = secretStorageBacking.get(secretKey);
        expect(stored).toBeDefined();
        expect(JSON.parse(stored ?? '[]')).toEqual([yaml.trim()]);
    });

    it('reuses an existing record when YAML matches an existing inline source', async () => {
        const yaml = 'apiVersion: v1\n';
        const first = await addInlineSource(yaml);
        const second = await addInlineSource(`  ${yaml}  \n`);
        expect(second.id).toBe(first.id);
        expect((await readSources()).filter((s) => s.kind === 'inline')).toHaveLength(1);
    });

    it('rejects empty YAML', async () => {
        await expect(addInlineSource('   \n  ')).rejects.toThrow(/empty/i);
    });

    it('numbers labels by inline-source count', async () => {
        const a = await addInlineSource('one: 1');
        const b = await addInlineSource('two: 2');
        const c = await addInlineSource('three: 3');
        expect(a.label).toBe('Pasted YAML 1');
        expect(b.label).toBe('Pasted YAML 2');
        expect(c.label).toBe('Pasted YAML 3');
    });
});

describe('renameSource', () => {
    it('updates the label of a non-default source', async () => {
        const created = await addFileSource('/abs/team.yaml');
        await renameSource(created.id, 'Work cluster');
        expect((await getSource(created.id))?.label).toBe('Work cluster');
    });

    it('renames the default source as well', async () => {
        const def = await addDefaultSource();
        await renameSource(def.id, 'My default');
        expect((await getSource(def.id))?.label).toBe('My default');
    });

    it('rejects empty labels', async () => {
        const created = await addFileSource('/abs/team.yaml');
        await expect(renameSource(created.id, '   ')).rejects.toThrow(/cannot be empty/i);
    });

    it('preserves inline secrets across rename', async () => {
        const created = await addInlineSource('apiVersion: v1');
        await renameSource(created.id, 'Renamed');
        const yaml = await readInlineYaml((await getSource(created.id))!);
        expect(yaml).toBe('apiVersion: v1');
    });
});

describe('removeSource', () => {
    it('removes a file source from the list', async () => {
        const created = await addFileSource('/abs/team.yaml');
        const removed = await removeSource(created.id);
        expect(removed?.id).toBe(created.id);
        expect(await getSource(created.id)).toBeUndefined();
    });

    it('removes an inline source and deletes its secret', async () => {
        const created = await addInlineSource('apiVersion: v1');
        const secretKey = `${STORAGE_PREFIX}${created.id}/secrets`;
        expect(secretStorageBacking.has(secretKey)).toBe(true);

        await removeSource(created.id);
        expect(secretStorageBacking.has(secretKey)).toBe(false);
    });

    it('removes the default source as well', async () => {
        const def = await addDefaultSource();
        const removed = await removeSource(def.id);
        expect(removed?.id).toBe(DEFAULT_SOURCE_ID);
        expect((await readSources()).some((s) => s.id === DEFAULT_SOURCE_ID)).toBe(false);
    });

    it('returns undefined for unknown ids', async () => {
        const result = await removeSource('does-not-exist');
        expect(result).toBeUndefined();
    });
});

describe('readInlineYaml', () => {
    it('returns YAML for an inline record', async () => {
        const created = await addInlineSource('apiVersion: v1');
        expect(await readInlineYaml(created)).toBe('apiVersion: v1');
    });

    it('returns undefined for non-inline records', async () => {
        const created = await addFileSource('/abs/team.yaml');
        expect(await readInlineYaml(created)).toBeUndefined();
    });
});

describe('hidden source ids', () => {
    it('readHiddenSourceIds returns persisted ids when written via setHiddenSourceIds', async () => {
        await setHiddenSourceIds(['a', 'b']);
        expect(await readHiddenSourceIds()).toEqual(['a', 'b']);
    });

    it('readHiddenSourceIds preserves the default source id when present', async () => {
        await setHiddenSourceIds([DEFAULT_SOURCE_ID, 'a']);
        expect(await readHiddenSourceIds()).toEqual([DEFAULT_SOURCE_ID, 'a']);
    });

    it('readHiddenSourceIds returns [] when nothing is stored', async () => {
        expect(await readHiddenSourceIds()).toEqual([]);
    });

    it('setHiddenSourceIds persists the default source id when supplied', async () => {
        await setHiddenSourceIds(['x', DEFAULT_SOURCE_ID, 'x', 'y']);
        expect(await readHiddenSourceIds()).toEqual(['x', DEFAULT_SOURCE_ID, 'y']);
    });

    it('removeSource also removes its id from the hidden list', async () => {
        const created = await addFileSource('/abs/team.yaml');
        await setHiddenSourceIds([created.id]);
        expect(await readHiddenSourceIds()).toEqual([created.id]);

        await removeSource(created.id);
        expect(await readHiddenSourceIds()).toEqual([]);
    });
});
