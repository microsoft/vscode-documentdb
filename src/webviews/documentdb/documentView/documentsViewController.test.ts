/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { ConnectionUnavailableError } from '../../../documentdb/ConnectionUnavailableError';
import { getConnectionSurfaces } from '../../../documentdb/connectionSurfaces';
import { type OpenAppWebviewOptions, type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import {
    type DocumentsViewWebviewConfigurationType,
    openDocumentWebview,
} from './documentsViewController';
import { type RouterContext } from './documentsViewRouter';

const mocks = vi.hoisted(() => ({
    getBinding: vi.fn(),
    getEpoch: vi.fn(() => 1),
    getLatchReason: vi.fn(),
    resolveBoundClient: vi.fn(),
    unlatch: vi.fn(),
    getCredentials: vi.fn(),
    executeCommand: vi.fn(),
    postMessage: vi.fn(),
}));

vi.mock('../../../documentdb/ClustersClient', () => ({ ClustersClient: mocks }));
vi.mock('../../../documentdb/CredentialCache', () => ({ CredentialCache: { getCredentials: mocks.getCredentials } }));
vi.mock('../../_integration/openAppWebview', () => ({ openAppWebview: vi.fn() }));
vi.mock('../../../extensionVariables', async () => {
    const vscodeMock = await import('vscode');
    return { ext: { context: { extensionUri: vscodeMock.Uri.file('/fixture/extension') } } };
});

const clusterId = 'cluster';
const originalBinding = { clusterId, fingerprint: 'identity-a', generation: 1 };
const newerBinding = { clusterId, fingerprint: 'identity-b', generation: 2 };
const opened: { readonly dispose: () => void; readonly context: RouterContext }[] = [];

function openPanel(binding = originalBinding): RouterContext {
    const config: DocumentsViewWebviewConfigurationType = {
        id: 'document',
        clusterId,
        viewId: 'connectionsView',
        databaseName: 'database',
        collectionName: 'collection',
        documentId: '{"$oid":"000000000000000000000001"}',
        mode: 'edit',
    };
    openDocumentWebview(config, binding);
    return opened.at(-1)?.context as RouterContext;
}

beforeEach((): void => {
    vi.clearAllMocks();
    for (const openedPanel of opened.splice(0)) {
        openedPanel.dispose();
    }
    mocks.getBinding.mockReturnValue(originalBinding);
    mocks.getLatchReason.mockReturnValue(undefined);
    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(mocks.executeCommand);
    vi.mocked(openAppWebview).mockImplementation(
        <T>(options: OpenAppWebviewOptions<T>): AppWebviewController<T> => {
            const disposeListeners = new Set<() => void>();
            let disposed = false;
            const dispose = (): void => {
                if (disposed) {
                    return;
                }
                disposed = true;
                for (const listener of disposeListeners) {
                    listener();
                }
            };
            const context = options.context as RouterContext;
            opened.push({ dispose, context });
            return {
                panel: {
                    title: options.title,
                    webview: { postMessage: mocks.postMessage },
                },
                isDisposed: false,
                onDisposed: (listener: () => void) => {
                    disposeListeners.add(listener);
                    return { dispose: () => disposeListeners.delete(listener) } as vscode.Disposable;
                },
                dispose,
            } as unknown as AppWebviewController<T>;
        },
    );
});

it('registers the panel, sends typed disable payloads and unregisters on dispose', (): void => {
    const context = openPanel();
    const [surface] = getConnectionSurfaces(clusterId);

    expect(surface).toMatchObject({ kind: 'documentView' });
    surface.disable('userDisconnected');
    expect(mocks.postMessage).toHaveBeenCalledWith({
        type: 'documentView.connectionUnavailable',
        unavailable: {
            reason: 'userDisconnected',
            title: expect.any(String),
            detail: expect.any(String),
            action: 'retry',
        },
    });

    opened[0].dispose();
    expect(getConnectionSurfaces(clusterId)).toEqual([]);
    expect(context.binding).toBe(originalBinding);
});

it('resumes a same-identity binding without replaying document operations', async (): Promise<void> => {
    const context = openPanel();
    mocks.resolveBoundClient.mockResolvedValue({ binding: { ...originalBinding, generation: 2 } });

    await expect(
        context.recoverUnavailable({ action: 'retry' }),
    ).resolves.toEqual({ recovered: { text: 'Reconnected' } });
    expect(mocks.unlatch).not.toHaveBeenCalled();
    expect(mocks.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(originalBinding, {
        trigger: 'documentView',
    });
    expect(context.binding).toBe(originalBinding);
});

it('keeps the original binding after an identity change', async (): Promise<void> => {
    const context = openPanel();
    mocks.getBinding.mockReturnValue(newerBinding);
    mocks.resolveBoundClient.mockResolvedValue({ binding: newerBinding });
    const described = context.describeUnavailable('identityChanged');
    expect(described.unavailable.action).toBe('close');

    await expect(
        context.recoverUnavailable({ action: 'retry' }),
    ).resolves.toEqual(described);
    expect(mocks.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(originalBinding, { trigger: 'documentView' });
    expect(context.binding).toBe(originalBinding);
});

it('does not prompt on Retry and closes only on Close view', async (): Promise<void> => {
    const context = openPanel();
    const described = context.describeUnavailable('signInRequired');
    expect(described.unavailable.action).toBe('retry');
    mocks.resolveBoundClient.mockRejectedValueOnce(new ConnectionUnavailableError('signInRequired'));

    await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toEqual(
        described,
    );
    expect(mocks.executeCommand).not.toHaveBeenCalled();

    expect(getConnectionSurfaces(clusterId)).toHaveLength(1);
    context.describeUnavailable('connectionRemoved');
    await context.recoverUnavailable({ action: 'close' });
    expect(getConnectionSurfaces(clusterId)).toEqual([]);
});

it('keeps a removed connection unavailable when an old Retry action arrives', async (): Promise<void> => {
    const context = openPanel();
    context.describeUnavailable('userDisconnected');
    mocks.getLatchReason.mockReturnValue('connectionRemoved');

    await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toMatchObject({
        unavailable: { reason: 'connectionRemoved', action: 'close' },
    });
    expect(mocks.unlatch).not.toHaveBeenCalled();
    expect(mocks.resolveBoundClient).not.toHaveBeenCalled();
    expect(getConnectionSurfaces(clusterId)).toHaveLength(1);
});
