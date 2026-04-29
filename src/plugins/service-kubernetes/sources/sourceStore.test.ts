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
        },
    },
}));

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
} from './sourceStore';

const STORAGE_PREFIX = `test-extension.${KUBECONFIG_STORAGE_NAME}/${KUBECONFIG_STORAGE_WORKSPACE}/`;

beforeEach(() => {
    globalStateBacking.clear();
    secretStorageBacking.clear();
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
        expect(record.path).toBe('/abs/team.yaml');
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
