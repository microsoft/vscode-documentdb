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

const mockFetchToken = jest.fn();
jest.mock('./AtlasServiceAccountClient', () => {
    class AtlasTokenErrorMock extends Error {
        constructor(
            message: string,
            public readonly statusCode: number,
            public readonly code?: string,
        ) {
            super(message);
            this.name = 'AtlasTokenError';
        }
    }
    return {
        AtlasTokenError: AtlasTokenErrorMock,
        fetchServiceAccountToken: (...args: unknown[]) => mockFetchToken(...args) as unknown,
    };
});

import { StorageService } from '../../../services/storageService';
import {
    readAtlasCredentialSecrets,
    resetAtlasCredentialStoreCache,
    upsertAtlasCredential,
} from '../credentials/atlasCredentialStore';
import { AtlasCredentialSessionRegistry } from './AtlasCredentialSessionRegistry';
import { AtlasTokenError } from './AtlasServiceAccountClient';

beforeEach(() => {
    globalStateBacking.clear();
    secretStorageBacking.clear();
    StorageService._resetForTests();
    resetAtlasCredentialStoreCache();
    mockFetchToken.mockReset();
});

describe('AtlasCredentialSessionRegistry', () => {
    it('builds an API Key session straight from stored secrets', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'pub-1',
            privateKey: 'priv-1',
        });

        await expect(new AtlasCredentialSessionRegistry().getSession(record.id)).resolves.toEqual({
            type: 'apikey',
            publicKey: 'pub-1',
            privateKey: 'priv-1',
        });
        expect(mockFetchToken).not.toHaveBeenCalled();
    });

    it('returns undefined for a credential with no stored secrets', async () => {
        await expect(new AtlasCredentialSessionRegistry().getSession('missing')).resolves.toBeUndefined();
    });

    it('mints a Service Account token and caches it on the credential', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });
        mockFetchToken.mockResolvedValue({ access_token: 'token-1', token_type: 'Bearer', expires_in: 3600 });

        const session = await new AtlasCredentialSessionRegistry().getSession(record.id);

        expect(session).toEqual({ type: 'serviceaccount', accessToken: 'token-1' });
        await expect(readAtlasCredentialSecrets(record.id)).resolves.toMatchObject({ accessToken: 'token-1' });
    });

    it('reuses a cached token that has not expired', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });
        mockFetchToken.mockResolvedValue({ access_token: 'token-1', token_type: 'Bearer', expires_in: 3600 });

        await new AtlasCredentialSessionRegistry().getSession(record.id);
        // A brand-new registry has an empty in-memory map, so this exercises the stored token.
        const session = await new AtlasCredentialSessionRegistry().getSession(record.id);

        expect(session).toEqual({ type: 'serviceaccount', accessToken: 'token-1' });
        expect(mockFetchToken).toHaveBeenCalledTimes(1);
    });

    it('re-mints when the cached token is inside the expiry skew', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });
        // Expires in 30 seconds; the 60 second skew must treat it as already expired.
        mockFetchToken.mockResolvedValueOnce({ access_token: 'token-1', token_type: 'Bearer', expires_in: 30 });
        await new AtlasCredentialSessionRegistry().getSession(record.id);

        mockFetchToken.mockResolvedValueOnce({ access_token: 'token-2', token_type: 'Bearer', expires_in: 3600 });
        const session = await new AtlasCredentialSessionRegistry().getSession(record.id);

        expect(session).toEqual({ type: 'serviceaccount', accessToken: 'token-2' });
        expect(mockFetchToken).toHaveBeenCalledTimes(2);
    });

    it('isolates a failing token refresh from a healthy peer credential', async () => {
        const broken = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-broken',
            clientSecret: 'secret-broken',
        });
        const healthy = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-healthy',
            clientSecret: 'secret-healthy',
        });

        mockFetchToken.mockImplementation((clientId: string) =>
            clientId === 'client-broken'
                ? Promise.reject(new AtlasTokenError('invalid_client', 401, 'invalid_client'))
                : Promise.resolve({ access_token: 'token-ok', token_type: 'Bearer', expires_in: 3600 }),
        );

        const registry = new AtlasCredentialSessionRegistry();

        await expect(registry.getSession(broken.record.id)).resolves.toBeUndefined();
        await expect(registry.getSession(healthy.record.id)).resolves.toEqual({
            type: 'serviceaccount',
            accessToken: 'token-ok',
        });
        // The rejected credential keeps its secret so the user can fix Atlas and retry.
        await expect(readAtlasCredentialSecrets(broken.record.id)).resolves.toMatchObject({
            clientSecret: 'secret-broken',
        });
    });

    it.each([
        [429, 'rate limited'],
        [503, 'service unavailable'],
    ])('rethrows a transient token failure (%s) instead of reporting a rejected credential', async (status) => {
        // A `429` / `5xx` must not collapse to `undefined` (which the discovery pass maps to a
        // credential-rejected error). Rethrowing lets the classifier report rate-limit / network.
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });
        mockFetchToken.mockRejectedValue(new AtlasTokenError('transient', status));

        await expect(new AtlasCredentialSessionRegistry().getSession(record.id)).rejects.toBeInstanceOf(AtlasTokenError);
    });

    it('rethrows a network failure (TypeError) from token acquisition', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });
        mockFetchToken.mockRejectedValue(new TypeError('fetch failed'));

        await expect(new AtlasCredentialSessionRegistry().getSession(record.id)).rejects.toBeInstanceOf(TypeError);
    });

    it('picks up a replaced secret after the credential is invalidated', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'apikey',
            publicKey: 'pub-1',
            privateKey: 'priv-1',
        });

        const registry = new AtlasCredentialSessionRegistry();
        await registry.getSession(record.id);

        await upsertAtlasCredential({ authMethod: 'apikey', publicKey: 'pub-1', privateKey: 'priv-2' });
        registry.invalidate(record.id);

        await expect(registry.getSession(record.id)).resolves.toMatchObject({ privateKey: 'priv-2' });
    });

    it('exposes a refresher scoped to a single credential', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });
        mockFetchToken.mockResolvedValue({ access_token: 'token-fresh', token_type: 'Bearer', expires_in: 3600 });

        const registry = new AtlasCredentialSessionRegistry();
        const refreshed = await registry.refresherFor(record.id).tryRefreshIfPossible();

        expect(refreshed).toEqual({ type: 'serviceaccount', accessToken: 'token-fresh' });
    });

    it('shares one in-flight resolution between concurrent callers', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });
        mockFetchToken.mockResolvedValue({ access_token: 'token-1', token_type: 'Bearer', expires_in: 3600 });

        const registry = new AtlasCredentialSessionRegistry();
        await Promise.all([registry.getSession(record.id), registry.getSession(record.id)]);

        expect(mockFetchToken).toHaveBeenCalledTimes(1);
    });

    it('shares one in-flight refresh between concurrent callers', async () => {
        // A credential's discovery pass issues its organization and project requests together, so
        // a rejected token makes both ask for a new one at the same moment. Without dedupe that
        // minted two throwaway tokens for a single credential.
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });
        mockFetchToken.mockResolvedValue({ access_token: 'token-fresh', token_type: 'Bearer', expires_in: 3600 });

        const registry = new AtlasCredentialSessionRegistry();
        const [first, second] = await Promise.all([
            registry.refreshSession(record.id),
            registry.refreshSession(record.id),
        ]);

        expect(mockFetchToken).toHaveBeenCalledTimes(1);
        expect(first).toEqual({ type: 'serviceaccount', accessToken: 'token-fresh' });
        expect(second).toEqual(first);
    });

    it('does not repopulate the in-memory cache from a resolve invalidated mid-flight (MEDIUM-4)', async () => {
        const { record } = await upsertAtlasCredential({
            authMethod: 'serviceaccount',
            clientId: 'client-1',
            clientSecret: 'secret-1',
        });

        let resolveToken!: (value: { access_token: string; token_type: string; expires_in: number }) => void;
        mockFetchToken.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    resolveToken = resolve as typeof resolveToken;
                }),
        );

        const registry = new AtlasCredentialSessionRegistry();
        const pending = registry.getSession(record.id);

        // Let resolveSession read the secret and reach the deferred token mint (its generation is
        // captured synchronously, before this point).
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Invalidate while the mint is still in flight: the resolve that finishes next is stale.
        registry.invalidate(record.id);

        // Resolve with a token already inside the expiry skew, so the follow-up read must re-mint.
        resolveToken({ access_token: 'stale-token', token_type: 'Bearer', expires_in: 30 });
        await pending;

        mockFetchToken.mockResolvedValueOnce({ access_token: 'fresh-token', token_type: 'Bearer', expires_in: 3600 });
        const session = await registry.getSession(record.id);

        // If the stale resolve had repopulated the in-memory cache, getSession would return
        // 'stale-token' without minting again.
        expect(session).toEqual({ type: 'serviceaccount', accessToken: 'fresh-token' });
        expect(mockFetchToken).toHaveBeenCalledTimes(2);
    });
});
