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
        outputChannel: { trace: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), appendLine: jest.fn() },
    },
}));

import { StorageService } from '../../../services/storageService';
import {
    cacheServiceAccountToken,
    getAtlasCredential,
    readAtlasCredentials,
    readAtlasCredentialSecrets,
    removeAllAtlasCredentials,
    removeAtlasCredential,
    replaceAtlasCredentialSecrets,
    resetAtlasCredentialStoreCache,
    updateAtlasCredentialMetadata,
    upsertAtlasCredential,
} from './atlasCredentialStore';

beforeEach(() => {
    globalStateBacking.clear();
    secretStorageBacking.clear();
    StorageService._resetForTests();
    resetAtlasCredentialStoreCache();
});

describe('atlasCredentialStore', () => {
    it('stores an API Key credential with a stable id and non-secret identity hint', async () => {
        const { record, created } = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'abcdefgh1234',
            privateKey: 'private-key-value',
        });

        expect(created).toBe(true);
        expect(record.id).toEqual(expect.any(String));
        expect(record.authMethod).toBe('apikey');
        expect(record.identityHint).toBe('abcdefgh');
        expect(record.order).toBe(0);

        const secrets = await readAtlasCredentialSecrets(record.id);
        expect(secrets).toEqual({
            authMethod: 'apikey',
            publicKey: 'abcdefgh1234',
            privateKey: 'private-key-value',
        });
    });

    it('keeps several credentials independent, in insertion order', async () => {
        const first = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'aaaaaaaa1',
            privateKey: 'p1',
        });
        const second = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'bbbbbbbb-2222',
            clientSecret: 's2',
        });

        const records = await readAtlasCredentials();
        expect(records.map((r) => r.id)).toEqual([first.record.id, second.record.id]);
        expect(records[1].order).toBe(1);

        await expect(readAtlasCredentialSecrets(first.record.id)).resolves.toMatchObject({ publicKey: 'aaaaaaaa1' });
        await expect(readAtlasCredentialSecrets(second.record.id)).resolves.toMatchObject({
            clientId: 'bbbbbbbb-2222',
        });
    });

    it('reuses the record id when the same Atlas identity is re-entered', async () => {
        const first = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'abcdefgh1234',
            privateKey: 'old-private',
        });

        const second = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'abcdefgh1234',
            privateKey: 'new-private',
        });

        expect(second.created).toBe(false);
        expect(second.record.id).toBe(first.record.id);
        await expect(readAtlasCredentialSecrets(first.record.id)).resolves.toMatchObject({
            privateKey: 'new-private',
        });
        expect(await readAtlasCredentials()).toHaveLength(1);
    });

    it('replaces secrets in place without disturbing metadata or id', async () => {
        const { record } = await upsertAtlasCredential(
            { authMethod: 'serviceaccount', clientId: 'client-1', clientSecret: 'secret-1' },
            { label: 'Team key', orgId: 'org-1', orgName: 'Acme Corp' },
        );

        const updated = await replaceAtlasCredentialSecrets(record.id, {
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-2',
        });

        expect(updated?.id).toBe(record.id);
        expect(updated?.label).toBe('Team key');
        expect(updated?.orgName).toBe('Acme Corp');
        await expect(readAtlasCredentialSecrets(record.id)).resolves.toMatchObject({ clientSecret: 'secret-2' });
    });

    it('updates metadata without dropping secrets', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'pub-key-1',
            privateKey: 'priv-key-1',
        });

        await updateAtlasCredentialMetadata(record.id, { orgId: 'org-9', orgName: 'Beta Ltd' });

        const reloaded = await getAtlasCredential(record.id);
        expect(reloaded?.orgName).toBe('Beta Ltd');
        await expect(readAtlasCredentialSecrets(record.id)).resolves.toMatchObject({ privateKey: 'priv-key-1' });
    });

    it('caches a Service Account token against one credential only', async () => {
        const target = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-a',
            clientSecret: 'secret-a',
        });
        const peer = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-b',
            clientSecret: 'secret-b',
        });

        await cacheServiceAccountToken(target.record.id, 'token-a', 1_800_000);

        await expect(readAtlasCredentialSecrets(target.record.id)).resolves.toMatchObject({
            accessToken: 'token-a',
            expiresAt: '1800000',
        });
        await expect(readAtlasCredentialSecrets(peer.record.id)).resolves.toMatchObject({
            accessToken: undefined,
        });
    });

    it('removes one credential without touching its peers', async () => {
        const first = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'pub-1',
            privateKey: 'priv-1',
        });
        const second = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'pub-2',
            privateKey: 'priv-2',
        });

        await removeAtlasCredential(first.record.id);

        expect((await readAtlasCredentials()).map((r) => r.id)).toEqual([second.record.id]);
        await expect(readAtlasCredentialSecrets(first.record.id)).resolves.toBeUndefined();
        await expect(readAtlasCredentialSecrets(second.record.id)).resolves.toMatchObject({ privateKey: 'priv-2' });
    });

    it('removes every credential for sign out of all', async () => {
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-1' });
        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-2', privateKey: 'priv-2' });

        await expect(removeAllAtlasCredentials()).resolves.toBe(2);
        await expect(readAtlasCredentials()).resolves.toEqual([]);
    });

    it('survives a reload by reading records back from storage', async () => {
        const { record } = await upsertAtlasCredential(
            { authMethod: 'apikey', publicKey: 'restored-key', privateKey: 'restored-secret' },
            { label: 'Restored' },
        );

        // Simulate an extension reload: fresh storage instances, empty in-memory cache.
        StorageService._resetForTests();
        resetAtlasCredentialStoreCache();

        const records = await readAtlasCredentials();
        expect(records).toHaveLength(1);
        expect(records[0].id).toBe(record.id);
        expect(records[0].label).toBe('Restored');
        await expect(readAtlasCredentialSecrets(record.id)).resolves.toMatchObject({
            publicKey: 'restored-key',
            privateKey: 'restored-secret',
        });
    });
});
