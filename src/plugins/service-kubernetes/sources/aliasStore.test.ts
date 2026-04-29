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

import {
    _resetAliasCacheForTests,
    aliasFor,
    aliasMapForSource,
    clearAliasesForSource,
    KUBECONFIG_ALIASES_WORKSPACE,
    pruneAliasesForSource,
    readAliases,
    setAlias,
} from './aliasStore';
import { KUBECONFIG_STORAGE_NAME } from './sourceStore';

const ALIAS_KEY = `test-extension.${KUBECONFIG_STORAGE_NAME}/${KUBECONFIG_ALIASES_WORKSPACE}/contextAliases`;

beforeEach(() => {
    globalStateBacking.clear();
    secretStorageBacking.clear();
    _resetAliasCacheForTests();
});

describe('aliasStore', () => {
    it('returns an empty list when no aliases are persisted', async () => {
        expect(await readAliases()).toEqual([]);
        expect(await aliasFor('source-1', 'ctx-a')).toBeUndefined();
        expect(await aliasMapForSource('source-1')).toEqual(new Map());
    });

    it('persists a new alias and returns it via the lookup helpers', async () => {
        await setAlias('source-1', 'arn:aws:eks:us-east-1:123:cluster/prod', 'Prod EKS');

        expect(await aliasFor('source-1', 'arn:aws:eks:us-east-1:123:cluster/prod')).toBe('Prod EKS');
        expect(await aliasMapForSource('source-1')).toEqual(
            new Map([['arn:aws:eks:us-east-1:123:cluster/prod', 'Prod EKS']]),
        );
        expect(await readAliases()).toEqual([
            {
                sourceId: 'source-1',
                contextName: 'arn:aws:eks:us-east-1:123:cluster/prod',
                alias: 'Prod EKS',
            },
        ]);
    });

    it('replaces an existing alias for the same (sourceId, contextName) instead of duplicating it', async () => {
        await setAlias('source-1', 'ctx-a', 'first');
        await setAlias('source-1', 'ctx-a', 'second');

        expect(await readAliases()).toEqual([{ sourceId: 'source-1', contextName: 'ctx-a', alias: 'second' }]);
    });

    it('keeps aliases for the same context name across different sources isolated', async () => {
        await setAlias('source-a', 'shared-ctx', 'A label');
        await setAlias('source-b', 'shared-ctx', 'B label');

        expect(await aliasFor('source-a', 'shared-ctx')).toBe('A label');
        expect(await aliasFor('source-b', 'shared-ctx')).toBe('B label');
    });

    it('treats empty / whitespace alias as "clear"', async () => {
        await setAlias('source-1', 'ctx-a', 'My label');
        await setAlias('source-1', 'ctx-a', '   ');

        expect(await aliasFor('source-1', 'ctx-a')).toBeUndefined();
        expect(await readAliases()).toEqual([]);
    });

    it('treats undefined alias as "clear" without throwing when there is no existing entry', async () => {
        await setAlias('source-1', 'ctx-a', undefined);

        expect(await readAliases()).toEqual([]);
    });

    it('trims surrounding whitespace before persisting', async () => {
        await setAlias('source-1', 'ctx-a', '  Prod  ');

        expect(await aliasFor('source-1', 'ctx-a')).toBe('Prod');
    });

    it('removes only the matching alias on clearAliasesForSource', async () => {
        await setAlias('source-1', 'ctx-a', 'A');
        await setAlias('source-1', 'ctx-b', 'B');
        await setAlias('source-2', 'ctx-a', 'C');

        await clearAliasesForSource('source-1');

        expect(await readAliases()).toEqual([{ sourceId: 'source-2', contextName: 'ctx-a', alias: 'C' }]);
    });

    it('clearAliasesForSource is a no-op when nothing matches', async () => {
        await setAlias('source-1', 'ctx-a', 'A');

        await clearAliasesForSource('source-other');

        expect(await readAliases()).toEqual([{ sourceId: 'source-1', contextName: 'ctx-a', alias: 'A' }]);
    });

    it('pruneAliasesForSource drops only entries whose contextName is no longer known', async () => {
        await setAlias('source-1', 'ctx-a', 'A');
        await setAlias('source-1', 'ctx-b', 'B');
        await setAlias('source-2', 'ctx-c', 'C');

        await pruneAliasesForSource('source-1', ['ctx-a']);

        const remaining = await readAliases();
        expect(remaining).toEqual(
            expect.arrayContaining([
                { sourceId: 'source-1', contextName: 'ctx-a', alias: 'A' },
                { sourceId: 'source-2', contextName: 'ctx-c', alias: 'C' },
            ]),
        );
        expect(remaining).toHaveLength(2);
    });

    it('pruneAliasesForSource is a no-op when every alias is still valid', async () => {
        await setAlias('source-1', 'ctx-a', 'A');

        await pruneAliasesForSource('source-1', ['ctx-a', 'ctx-b']);

        expect(await readAliases()).toEqual([{ sourceId: 'source-1', contextName: 'ctx-a', alias: 'A' }]);
    });

    it('ignores malformed entries on read', async () => {
        globalStateBacking.set(ALIAS_KEY, {
            id: 'contextAliases',
            name: 'Kubernetes context aliases',
            version: '1',
            properties: {
                entries: [
                    { sourceId: 'source-1', contextName: 'ctx-a', alias: 'ok' },
                    { sourceId: '', contextName: 'ctx-b', alias: 'bad-source' },
                    { sourceId: 'source-1', contextName: '', alias: 'bad-ctx' },
                    { sourceId: 'source-1', contextName: 'ctx-c', alias: 42 as unknown as string },
                    null,
                    undefined,
                ],
            },
        });

        expect(await readAliases()).toEqual([{ sourceId: 'source-1', contextName: 'ctx-a', alias: 'ok' }]);
    });
});
