/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const globalStateBacking = new Map<string, unknown>();
const secretStorageBacking = new Map<string, string>();
const outputWarn = jest.fn();

jest.mock('vscode', () => ({
    ThemeIcon: class ThemeIcon {
        constructor(public readonly id: string) {}
    },
    l10n: {
        t: jest.fn((message: string) => message),
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
        outputChannel: {
            warn: outputWarn,
            appendLine: jest.fn(),
            error: jest.fn(),
        },
    },
}));

import {
    CUSTOM_KUBECONFIG_PATH_KEY,
    DEFAULT_SOURCE_ID,
    ENABLED_CONTEXTS_KEY,
    FILTERED_NAMESPACES_KEY,
    HIDDEN_CONTEXTS_KEY,
    INLINE_KUBECONFIG_SECRET_KEY,
    INLINE_KUBECONFIG_SECRET_PREFIX,
    KUBECONFIG_SOURCE_KEY,
    KUBECONFIG_SOURCES_KEY,
} from '../config';
import { _resetMigrationGuardForTests, ensureMigration } from './migrationV2';
import {
    KUBECONFIG_STORAGE_NAME,
    KUBECONFIG_STORAGE_WORKSPACE,
    resetSourceStoreCacheForMigration,
} from './sourceStore';

const STORAGE_PREFIX = `test-extension.${KUBECONFIG_STORAGE_NAME}/${KUBECONFIG_STORAGE_WORKSPACE}/`;
const SETTINGS_PREFIX = 'test-extension.kubernetes-discovery/settings/';
const MIGRATION_ITEM_KEY = `${SETTINGS_PREFIX}migration`;

beforeEach(() => {
    globalStateBacking.clear();
    secretStorageBacking.clear();
    outputWarn.mockClear();
    _resetMigrationGuardForTests();
    resetSourceStoreCacheForMigration();
});

describe('ensureMigration', () => {
    it('wipes v1 legacy keys on first run', async () => {
        globalStateBacking.set(KUBECONFIG_SOURCE_KEY, 'customFile');
        globalStateBacking.set(CUSTOM_KUBECONFIG_PATH_KEY, '/old/path');
        globalStateBacking.set(ENABLED_CONTEXTS_KEY, ['ctx-a']);
        globalStateBacking.set(HIDDEN_CONTEXTS_KEY, ['ctx-b']);
        globalStateBacking.set(FILTERED_NAMESPACES_KEY, { 'ctx-a': ['kube-system'] });
        secretStorageBacking.set(INLINE_KUBECONFIG_SECRET_KEY, 'apiVersion: v1');

        await ensureMigration();

        expect(globalStateBacking.has(KUBECONFIG_SOURCE_KEY)).toBe(false);
        expect(globalStateBacking.has(CUSTOM_KUBECONFIG_PATH_KEY)).toBe(false);
        expect(globalStateBacking.has(ENABLED_CONTEXTS_KEY)).toBe(false);
        expect(globalStateBacking.has(HIDDEN_CONTEXTS_KEY)).toBe(false);
        expect(globalStateBacking.has(FILTERED_NAMESPACES_KEY)).toBe(false);
        expect(secretStorageBacking.has(INLINE_KUBECONFIG_SECRET_KEY)).toBe(false);
        // Migration done flag now lives in StorageService, not raw globalState.
        const migrationItem = globalStateBacking.get(MIGRATION_ITEM_KEY) as
            | { properties: { done: boolean } }
            | undefined;
        expect(migrationItem?.properties.done).toBe(true);
    });

    it('seeds the singleton default into StorageService when no v2 array exists', async () => {
        await ensureMigration();

        const defaultKey = `${STORAGE_PREFIX}${DEFAULT_SOURCE_ID}`;
        expect(globalStateBacking.has(defaultKey)).toBe(true);
        const item = globalStateBacking.get(defaultKey) as { id: string; name: string; properties: { kind: string } };
        expect(item.id).toBe(DEFAULT_SOURCE_ID);
        expect(item.properties.kind).toBe('default');
    });

    it('imports v2 array entries into StorageService', async () => {
        const v2Array = [
            { id: DEFAULT_SOURCE_ID, kind: 'default', label: 'Default kubeconfig' },
            { id: 'file-1', kind: 'file', label: 'team.yaml', path: '/abs/team.yaml' },
            {
                id: 'inline-1',
                kind: 'inline',
                label: 'Pasted YAML 1',
                secretKey: `${INLINE_KUBECONFIG_SECRET_PREFIX}inline-1`,
            },
        ];
        globalStateBacking.set(KUBECONFIG_SOURCES_KEY, v2Array);
        secretStorageBacking.set(`${INLINE_KUBECONFIG_SECRET_PREFIX}inline-1`, 'apiVersion: v1');

        await ensureMigration();

        // v2 array key is gone.
        expect(globalStateBacking.has(KUBECONFIG_SOURCES_KEY)).toBe(false);

        // Each record landed in StorageService.
        const defaultItem = globalStateBacking.get(`${STORAGE_PREFIX}${DEFAULT_SOURCE_ID}`) as {
            id: string;
            name: string;
            properties: { kind: string; order: number };
        };
        expect(defaultItem).toMatchObject({ id: DEFAULT_SOURCE_ID });
        expect(defaultItem.properties.kind).toBe('default');
        expect(defaultItem.properties.order).toBe(0);

        const fileItem = globalStateBacking.get(`${STORAGE_PREFIX}file-1`) as {
            properties: { kind: string; path: string; order: number };
        };
        expect(fileItem.properties.kind).toBe('file');
        expect(fileItem.properties.path).toBe('/abs/team.yaml');
        expect(fileItem.properties.order).toBe(1);

        // Inline YAML moved into StorageService secret key.
        const inlineSecret = secretStorageBacking.get(`${STORAGE_PREFIX}inline-1/secrets`);
        expect(inlineSecret).toBeDefined();
        expect(JSON.parse(inlineSecret ?? '[]')).toEqual(['apiVersion: v1']);

        // Legacy inline secret cleaned up.
        expect(secretStorageBacking.has(`${INLINE_KUBECONFIG_SECRET_PREFIX}inline-1`)).toBe(false);
    });

    it('does not auto-seed default when v2 array existed without one', async () => {
        const v2Array = [{ id: 'file-1', kind: 'file', label: 'team.yaml', path: '/abs/team.yaml' }];
        globalStateBacking.set(KUBECONFIG_SOURCES_KEY, v2Array);

        await ensureMigration();

        // Default not auto-added because the v2 array specified the user wanted only file-1.
        expect(globalStateBacking.has(`${STORAGE_PREFIX}${DEFAULT_SOURCE_ID}`)).toBe(false);
        expect(globalStateBacking.has(`${STORAGE_PREFIX}file-1`)).toBe(true);
    });

    it('is idempotent within a session', async () => {
        await ensureMigration();
        const firstKeys = new Set(globalStateBacking.keys());

        await ensureMigration();
        const secondKeys = new Set(globalStateBacking.keys());
        expect(secondKeys).toEqual(firstKeys);
    });

    it('skips work when the v3 migration is already done', async () => {
        globalStateBacking.set(MIGRATION_ITEM_KEY, {
            id: 'migration',
            name: 'Kubernetes discovery migration',
            properties: { done: true, version: '3' },
        });
        globalStateBacking.set(HIDDEN_CONTEXTS_KEY, ['leftover']);

        await ensureMigration();

        // Legacy key remains because the wipe is gated on the StorageService done flag.
        expect(globalStateBacking.get(HIDDEN_CONTEXTS_KEY)).toEqual(['leftover']);
    });
});
