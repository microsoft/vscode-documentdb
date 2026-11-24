/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getConnectionSurfaces } from '../../../documentdb/connectionSurfaces';
import { type OpenAppWebviewOptions, type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import {
    type DocumentsViewWebviewConfigurationType,
    openDocumentWebview,
} from './documentsViewController';
import { type RouterContext } from './documentsViewRouter';

const mocks = vi.hoisted(() => ({
    getBinding: vi.fn(),
    getLastVerifiedIdentity: vi.fn(),
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
    mocks.getLastVerifiedIdentity.mockReturnValue({
        kind: 'entra',
        accountId: 'account',
        accountLabel: 'Account B',
        tenantId: 'tenant',
        providerId: 'microsoft',
    });
    mocks.getCredentials.mockReturnValue({
        authMechanism: 'MicrosoftEntraID',
        entraIdConfig: { tenantId: 'tenant' },
    });
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
            text: expect.any(String),
            action: 'reconnect',
        },
    });

    opened[0].dispose();
    expect(getConnectionSurfaces(clusterId)).toEqual([]);
    expect(context.binding.current).toEqual(originalBinding);
});

it('resumes a same-identity binding without replaying document operations', async (): Promise<void> => {
    const context = openPanel();
    mocks.getLatchReason.mockReturnValueOnce('userDisconnected');
    mocks.resolveBoundClient.mockResolvedValue({ binding: { ...originalBinding, generation: 2 } });
    const described = context.describeUnavailable('userDisconnected');

    await expect(
        context.recoverUnavailable({ reason: 'userDisconnected', action: described.unavailable.action }),
    ).resolves.toEqual({ recovered: { text: 'Reconnected' } });
    expect(mocks.unlatch).toHaveBeenCalledExactlyOnceWith(clusterId);
    expect(mocks.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(originalBinding, {
        trigger: 'documentView',
    });
    expect(context.binding.current.generation).toBe(2);
});

it('requires an explicit rebind for a changed identity', async (): Promise<void> => {
    const context = openPanel();
    mocks.getBinding.mockReturnValue(newerBinding);
    mocks.resolveBoundClient.mockResolvedValue({ binding: newerBinding });
    const described = context.describeUnavailable('identityChanged');
    expect(described.unavailable.action).toBe('reconnect');

    await expect(
        context.recoverUnavailable({ reason: 'identityChanged', action: 'reconnect' }),
    ).resolves.toEqual({ recovered: { text: 'Now connected as Account B' } });
    expect(context.binding.current).toEqual(newerBinding);
});

it('uses the explicit sign-in command and closes only on Close', async (): Promise<void> => {
    const context = openPanel();
    const described = context.describeUnavailable('credentialsRejected');
    expect(described.unavailable.action).toBe('signInAgain');
    mocks.getBinding.mockReturnValue(originalBinding);

    await expect(context.recoverUnavailable({ reason: 'credentialsRejected', action: 'signInAgain' })).resolves.toEqual(
        described,
    );
    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith('vscode-documentdb.command.signInAgain', {
        clusterId,
    });

    expect(getConnectionSurfaces(clusterId)).toHaveLength(1);
    context.describeUnavailable('connectionRemoved');
    await context.recoverUnavailable({ reason: 'connectionRemoved', action: 'close' });
    expect(getConnectionSurfaces(clusterId)).toEqual([]);
});

it('keeps a removed connection unavailable when an old Reconnect action arrives', async (): Promise<void> => {
    const context = openPanel();
    context.describeUnavailable('userDisconnected');
    mocks.getLatchReason.mockReturnValue('connectionRemoved');

    await expect(context.recoverUnavailable({ reason: 'userDisconnected', action: 'reconnect' })).resolves.toMatchObject({
        unavailable: { reason: 'connectionRemoved', action: 'close' },
    });
    expect(mocks.unlatch).not.toHaveBeenCalled();
    expect(mocks.resolveBoundClient).not.toHaveBeenCalled();
    expect(getConnectionSurfaces(clusterId)).toHaveLength(1);
});

it('requires explicit rebind if sign-in succeeds with a different identity', async (): Promise<void> => {
    const context = openPanel();
    context.describeUnavailable('signInRequired');
    mocks.executeCommand.mockImplementationOnce(async () => {
        mocks.getBinding.mockReturnValue(newerBinding);
    });

    await expect(context.recoverUnavailable({ reason: 'signInRequired', action: 'signInAgain' })).resolves.toMatchObject({
        unavailable: { reason: 'identityChanged', action: 'reconnect' },
    });
    expect(context.binding.current).toBe(originalBinding);
});
