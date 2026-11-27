/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, it, vi } from 'vitest';
import { getConnectionSurfaces } from '../../../documentdb/connectionSurfaces';
import { DocumentViewMode } from '../../../documentdb/DocumentViewMode';
import { LiveConfigService } from '../../../services/LiveConfigService';
import {
    type AppWebviewController,
    openAppWebview,
    type OpenAppWebviewOptions,
} from '../../_integration/openAppWebview';
import { openCollectionWebview } from './collectionViewController';
import { type RouterContext } from './collectionViewRouter';

const mocks = vi.hoisted(() => ({
    getBinding: vi.fn(),
    getEpoch: vi.fn(() => 1),
    getLatchReason: vi.fn(),
    resolveBoundClient: vi.fn(),
    unlatch: vi.fn(),
    getCredentials: vi.fn(),
    postMessage: vi.fn(),
    sessionBinding: vi.fn(),
}));
const state = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../../../documentdb/ClustersClient', () => ({ ClustersClient: mocks }));
vi.mock('../../../documentdb/ClusterSession', () => ({
    ClusterSession: {
        getSession: () => ({
            getBinding: mocks.sessionBinding,
        }),
    },
}));
vi.mock('../../../documentdb/CredentialCache', () => ({ CredentialCache: { getCredentials: mocks.getCredentials } }));
vi.mock('../../../services/SettingsService', () => ({
    SettingsService: { getSetting: () => undefined },
}));
vi.mock('../../_integration/openAppWebview', () => ({ openAppWebview: vi.fn() }));
vi.mock('../../../extensionVariables', async () => {
    const vscodeMock = await import('vscode');
    return {
        ext: {
            context: {
                extensionUri: vscodeMock.Uri.file('/fixture/extension'),
                globalState: {
                    get: (key: string) => state.get(key),
                    update: async (key: string, value: unknown) => {
                        state.set(key, value);
                    },
                },
            },
        },
    };
});

const clusterId = 'cluster';
const originalBinding = { clusterId, fingerprint: 'identity-a', generation: 1 };
const newerBinding = { clusterId, fingerprint: 'identity-b', generation: 2 };
const opened: { readonly dispose: () => void }[] = [];
let context: RouterContext;

beforeEach((): void => {
    vi.clearAllMocks();
    state.clear();
    for (const panel of opened.splice(0)) {
        panel.dispose();
    }
    mocks.getBinding.mockReturnValue(originalBinding);
    mocks.getLatchReason.mockReturnValue(undefined);
    mocks.sessionBinding.mockReturnValue(originalBinding);
    vi.mocked(openAppWebview).mockImplementation(<T>(options: OpenAppWebviewOptions<T>): AppWebviewController<T> => {
        const listeners = new Set<() => void>();
        let disposed = false;
        const dispose = (): void => {
            if (disposed) {
                return;
            }
            disposed = true;
            for (const listener of listeners) {
                listener();
            }
        };
        context = options.context as RouterContext;
        opened.push({ dispose });
        return {
            panel: { title: options.title, webview: { postMessage: mocks.postMessage } },
            isDisposed: false,
            onDisposed: (listener: () => void) => {
                listeners.add(listener);
                return { dispose: () => listeners.delete(listener) };
            },
            dispose,
        } as unknown as AppWebviewController<T>;
    });
});

function openPanel(collectionName = 'collection'): void {
    openCollectionWebview({
        sessionId: 'session',
        clusterId,
        clusterDisplayName: 'Cluster',
        viewId: 'connectionsView',
        databaseName: 'database',
        collectionName,
    });
}

it('registers the Collection View and pushes a typed unavailable payload', (): void => {
    openPanel();
    const [surface] = getConnectionSurfaces(clusterId);

    surface.disable('userDisconnected');
    expect(mocks.postMessage).toHaveBeenCalledWith({
        type: 'collectionView.connectionUnavailable',
        unavailable: {
            reason: 'userDisconnected',
            title: expect.any(String),
            detail: expect.any(String),
            action: 'retry',
        },
    });

    opened[0].dispose();
    expect(getConnectionSurfaces(clusterId)).toEqual([]);
});

it('reconnects the existing session without replaying a query', async (): Promise<void> => {
    openPanel();
    mocks.resolveBoundClient.mockResolvedValue({ binding: { ...originalBinding, generation: 2 } });

    await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toEqual({
        recovered: { text: 'Reconnected' },
    });
    expect(mocks.unlatch).not.toHaveBeenCalled();
    expect(mocks.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(originalBinding, { trigger: 'collectionView' });
});

it('does not rebind to a different identity', async (): Promise<void> => {
    openPanel();
    mocks.getBinding.mockReturnValue(newerBinding);
    mocks.resolveBoundClient.mockResolvedValue({ binding: newerBinding });

    await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toMatchObject({
        unavailable: { reason: 'identityChanged', action: 'close' },
    });
    expect(mocks.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(originalBinding, { trigger: 'collectionView' });
});

it('does not let stale Retry clear a removal latch', async (): Promise<void> => {
    openPanel();
    context.describeUnavailable('userDisconnected');
    mocks.getLatchReason.mockReturnValue('connectionRemoved');

    await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toMatchObject({
        unavailable: { reason: 'connectionRemoved', action: 'close' },
    });
    expect(mocks.unlatch).not.toHaveBeenCalled();
    expect(mocks.resolveBoundClient).not.toHaveBeenCalled();
});

it('defaults to Table and uses the latest choice when opening or reopening a collection', async (): Promise<void> => {
    openPanel('first');
    await LiveConfigService.setCollectionDocumentView(DocumentViewMode.TREE);
    openPanel('second');
    await LiveConfigService.setCollectionDocumentView(DocumentViewMode.JSON);
    openPanel('first');
    await LiveConfigService.setCollectionDocumentView(DocumentViewMode.TABLE);
    openPanel('second');

    expect(vi.mocked(openAppWebview).mock.calls.map(([options]) => options.config)).toEqual([
        expect.objectContaining({ collectionName: 'first', initialDocumentView: DocumentViewMode.TABLE }),
        expect.objectContaining({ collectionName: 'second', initialDocumentView: DocumentViewMode.TREE }),
        expect.objectContaining({ collectionName: 'first', initialDocumentView: DocumentViewMode.JSON }),
        expect.objectContaining({ collectionName: 'second', initialDocumentView: DocumentViewMode.TABLE }),
    ]);
});
