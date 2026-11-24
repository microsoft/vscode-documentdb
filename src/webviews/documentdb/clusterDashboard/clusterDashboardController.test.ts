/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@vscode/l10n', () => ({
    t: vi.fn((message: string) => message),
}));

vi.mock('vscode', async (importOriginal) => ({
    ...(await importOriginal<typeof vscode>()),
    ViewColumn: { One: 1 },
    Uri: { joinPath: vi.fn((base: unknown, ...parts: string[]) => ({ base, parts })) },
    commands: { registerCommand: vi.fn(), executeCommand: vi.fn() },
    window: { showErrorMessage: vi.fn() },
}));

vi.mock('@microsoft/vscode-azext-utils', async (importOriginal) => ({
    ...(await importOriginal<{ callWithTelemetryAndErrorHandling: typeof callWithTelemetryAndErrorHandling }>()),
    callWithTelemetryAndErrorHandling: vi.fn(async (_eventId: string, callback: (context: unknown) => Promise<void>) =>
        callback({ telemetry: { properties: {}, measurements: {} }, errorHandling: {} }),
    ),
}));

vi.mock('../../../extensionVariables', () => ({
    ext: { context: { extensionUri: { scheme: 'file', path: '/extension' } } },
}));

vi.mock('../../_integration/openAppWebview', () => ({
    openAppWebview: vi.fn(() => createFakeController()),
}));

vi.mock('../../../commands/openCollectionView/openCollectionView', () => ({
    openCollectionViewInternal: vi.fn(async () => undefined),
}));

vi.mock('../../../documentdb/ClustersClient', () => ({
    ClustersClient: {
        getBinding: vi.fn(),
        getEpoch: vi.fn(),
        getLatchReason: vi.fn(),
        resolveBoundClient: vi.fn(),
        unlatch: vi.fn(),
    },
}));
vi.mock('../../../documentdb/CredentialCache', () => ({ CredentialCache: { getCredentials: vi.fn() } }));

vi.mock('./resolveNamespaceNode', () => ({
    resolveNamespaceNode: vi.fn(async () => ({ id: 'tree-node' })),
    describeMissingNamespace: vi.fn(() => 'missing-namespace-explanation'),
}));

import * as vscode from 'vscode';
import { openCollectionViewInternal } from '../../../commands/openCollectionView/openCollectionView';
import { ClustersClient } from '../../../documentdb/ClustersClient';
import { getConnectionSurfaces } from '../../../documentdb/connectionSurfaces';
import { ConnectionUnavailableError } from '../../../documentdb/ConnectionUnavailableError';
import { CredentialCache } from '../../../documentdb/CredentialCache';
import { openAppWebview } from '../../_integration/openAppWebview';
import { CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS } from './clusterDashboardContextMenu';
import { openClusterDashboardWebview, registerClusterDashboardContextMenuCommands } from './clusterDashboardController';
import { type RouterContext } from './clusterDashboardRouter';
import { resolveNamespaceNode } from './resolveNamespaceNode';

/**
 * Minimal stand-in for the parts of `AppWebviewController` this factory touches:
 * `isDisposed` (panel reuse) and `onDisposed` (cleanup wiring).
 */
type FakeController = {
    isDisposed: boolean;
    onDisposed: (handler: () => void) => void;
    revealToForeground: Mock;
    dispose: () => void;
    panel: { webview: { postMessage: Mock }; visible: boolean; onDidChangeViewState: Mock };
};

function createFakeController(): FakeController {
    const handlers: Array<() => void> = [];

    return {
        isDisposed: false,
        revealToForeground: vi.fn(),
        panel: {
            webview: { postMessage: vi.fn().mockResolvedValue(true) },
            visible: true,
            onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
        },
        onDisposed(handler: () => void): void {
            handlers.push(handler);
        },
        dispose(): void {
            this.isDisposed = true;
            handlers.forEach((handler) => handler());
        },
    };
}

const CLUSTER = 'cluster-under-test';
const binding = { clusterId: CLUSTER, fingerprint: 'host-only-dashboard-fingerprint', generation: 1 };

function open(clusterId: string, selectedDatabaseName?: string): FakeController {
    return openClusterDashboardWebview(
        {
            clusterId,
            clusterDisplayName: clusterId,
            viewId: 'connectionsView',
            refreshIntervalMs: 5_000,
            showDashboardOnConnect: false,
            selectedDatabaseName,
        },
        { ...binding, clusterId },
    ) as unknown as FakeController;
}

describe('openClusterDashboardWebview panel lifecycle', () => {
    it('attributes the original session without retagging it when another URL reuses the panel', (): void => {
        vi.clearAllMocks();
        const config = {
            clusterId: 'url-dashboard',
            clusterDisplayName: 'Cluster',
            viewId: 'discoveryView',
            refreshIntervalMs: 5000,
            showDashboardOnConnect: false,
        };
        const firstBinding = { ...binding, clusterId: config.clusterId };
        const firstLink = { deepLinkCorrelationId: 'first-click', deepLinkSource: 'portal' };
        const first = openClusterDashboardWebview(config, firstBinding, firstLink);
        const second = openClusterDashboardWebview(
            config,
            { ...firstBinding, fingerprint: 'replacement' },
            { deepLinkCorrelationId: 'second-click', deepLinkSource: 'docs' },
        );
        expect(second).toBe(first);
        expect(openAppWebview).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
                context: expect.objectContaining({ ...firstLink, binding: firstBinding }),
                config: expect.not.objectContaining({ binding: expect.anything() }),
            }),
        );
        first.dispose();
    });

    it('reuses the existing panel instead of opening a duplicate', () => {
        const first = open(CLUSTER);
        const second = open(CLUSTER);

        // A duplicate panel would double the polling load against the same cluster.
        expect(second).toBe(first);
        expect(first.revealToForeground).toHaveBeenCalledTimes(1);

        first.dispose();
    });

    it('opens separate panels for different databases in the same cluster', () => {
        const first = open(CLUSTER, 'sales');
        const second = open(CLUSTER, 'inventory');

        expect(second).not.toBe(first);

        first.dispose();
        second.dispose();
    });

    it('opens a fresh panel once the previous one was disposed', () => {
        const first = open(CLUSTER);
        first.dispose();

        const second = open(CLUSTER);

        expect(second).not.toBe(first);

        second.dispose();
    });

    it('registers the dashboard, pushes an unavailable payload and unregisters on dispose', () => {
        vi.clearAllMocks();
        vi.mocked(ClustersClient.getBinding).mockReturnValue(binding);
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue(undefined);
        const controller = open(CLUSTER);
        const [surface] = getConnectionSurfaces(CLUSTER);

        expect(surface).toMatchObject({ kind: 'clusterDashboard' });
        surface.disable('userDisconnected');
        expect(controller.panel.webview.postMessage).toHaveBeenCalledWith({
            type: 'clusterDashboard.connectionUnavailable',
            unavailable: {
                reason: 'userDisconnected',
                title: expect.any(String),
                detail: expect.any(String),
                action: 'retry',
            },
        });

        controller.dispose();
        expect(getConnectionSurfaces(CLUSTER)).toEqual([]);
    });
});

describe('cluster dashboard unavailable recovery', () => {
    function openRecoveryContext(): { readonly controller: FakeController; readonly context: RouterContext } {
        vi.clearAllMocks();
        vi.mocked(ClustersClient.getBinding).mockReturnValue(binding);
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue(undefined);
        vi.mocked(CredentialCache.getCredentials).mockReturnValue(undefined);
        const controller = open(CLUSTER);
        const options = vi.mocked(openAppWebview).mock.calls.at(-1)?.[0];
        return { controller, context: options?.context as RouterContext };
    }

    it('resumes the same identity without reloading the dashboard', async () => {
        const { controller, context } = openRecoveryContext();
        vi.mocked(ClustersClient.resolveBoundClient).mockResolvedValue({
            binding: { ...binding, generation: 2 },
        } as never);

        context.describeUnavailable('userDisconnected');
        await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toEqual({
            recovered: { text: 'Reconnected' },
        });
        expect(context.binding).toEqual(binding);
        expect(ClustersClient.unlatch).not.toHaveBeenCalled();
        expect(ClustersClient.resolveBoundClient).toHaveBeenCalledExactlyOnceWith(binding, {
            trigger: 'clusterDashboard',
        });
        expect(controller.panel.webview.postMessage).not.toHaveBeenCalled();
        controller.dispose();
    });

    it('does not clear a newer removal or credential rejection latch', async () => {
        for (const latchReason of ['connectionRemoved', 'credentialsRejected'] as const) {
            const { controller, context } = openRecoveryContext();
            context.describeUnavailable('userDisconnected');
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue(latchReason);

            await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toMatchObject({
                unavailable: { reason: latchReason, action: latchReason === 'connectionRemoved' ? 'close' : 'retry' },
            });
            expect(ClustersClient.unlatch).not.toHaveBeenCalled();
            expect(ClustersClient.resolveBoundClient).not.toHaveBeenCalled();
            controller.dispose();
        }
    });

    it('keeps a latch that appears while Retry is resolving', async () => {
        const { controller, context } = openRecoveryContext();
        let latchReason: 'connectionRemoved' | undefined;
        vi.mocked(ClustersClient.getLatchReason).mockImplementation(() => latchReason);
        vi.mocked(ClustersClient.resolveBoundClient).mockImplementation(async () => {
            latchReason = 'connectionRemoved';
            return { binding } as never;
        });
        context.describeUnavailable('userDisconnected');

        await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toMatchObject({
            unavailable: { reason: 'connectionRemoved', action: 'close' },
        });
        expect(context.binding).toEqual(binding);
        controller.dispose();
    });

    it('keeps the overlay if sign-in is needed or the connection identity changes', async () => {
        const { controller, context } = openRecoveryContext();
        vi.mocked(ClustersClient.resolveBoundClient).mockRejectedValueOnce(
            new ConnectionUnavailableError('signInRequired'),
        );

        const described = context.describeUnavailable('signInRequired');
        await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toEqual(described);

        const replacement = { ...binding, fingerprint: 'identity-b', generation: 2 };
        vi.mocked(ClustersClient.getBinding).mockReturnValue(replacement);
        vi.mocked(ClustersClient.resolveBoundClient).mockResolvedValue({ binding: replacement } as never);
        await expect(context.recoverUnavailable({ action: 'retry' })).resolves.toMatchObject({
            unavailable: { reason: 'identityChanged', action: 'close' },
        });
        expect(context.binding).toEqual(binding);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        controller.dispose();
    });
});

describe('cluster dashboard native context menu commands', () => {
    function registerAndOpen(): {
        handlers: Map<string, (context: unknown) => Promise<void>>;
        controller: FakeController;
    } {
        vi.clearAllMocks();
        vi.mocked(ClustersClient.getBinding).mockReturnValue(binding);
        vi.mocked(ClustersClient.getEpoch).mockReturnValue(0);
        vi.mocked(ClustersClient.getLatchReason).mockReturnValue(undefined);
        const handlers = new Map<string, (context: unknown) => Promise<void>>();
        vi.mocked(vscode.commands.registerCommand).mockImplementation((commandId, handler) => {
            handlers.set(commandId, handler as (context: unknown) => Promise<void>);
            return { dispose: vi.fn() };
        });
        registerClusterDashboardContextMenuCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);

        return { handlers, controller: open(CLUSTER, 'sales') };
    }

    it('opens the collection view on the host rather than relaying through the webview', async () => {
        const { handlers, controller } = registerAndOpen();

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.manageIndexes)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'sales',
            clusterDashboardCollection: 'orders',
        });

        expect(openCollectionViewInternal).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                clusterId: CLUSTER,
                databaseName: 'sales',
                collectionName: 'orders',
                initialTab: 'tab_indexes',
            }),
        );
        expect(controller.panel.webview.postMessage).not.toHaveBeenCalled();

        controller.dispose();
    });

    it('runs a tree command against the row`s tree node', async () => {
        const { handlers, controller } = registerAndOpen();

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.deleteCollection)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'sales',
            clusterDashboardCollection: 'orders',
        });

        expect(resolveNamespaceNode).toHaveBeenCalledWith('connectionsView', CLUSTER, 'sales', 'orders');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.dropCollection',
            { id: 'tree-node' },
            null,
            { source: 'webview;clusterDashboard' },
        );
        expect(controller.panel.webview.postMessage).toHaveBeenNthCalledWith(1, {
            type: 'clusterDashboard.namespaceBusy',
            databaseName: 'sales',
            collectionName: 'orders',
            operation: 'delete',
            busy: true,
        });
        expect(controller.panel.webview.postMessage).toHaveBeenNthCalledWith(2, {
            type: 'clusterDashboard.inventoryChanged',
            databaseName: 'sales',
        });
        expect(controller.panel.webview.postMessage).toHaveBeenNthCalledWith(3, {
            type: 'clusterDashboard.namespaceBusy',
            databaseName: 'sales',
            collectionName: 'orders',
            operation: 'delete',
            busy: false,
        });

        controller.dispose();
    });

    it('does not forward a delete if the connection latches during its busy message', async () => {
        const { handlers, controller } = registerAndOpen();
        controller.panel.webview.postMessage.mockImplementationOnce(async () => {
            vi.mocked(ClustersClient.getLatchReason).mockReturnValue('userDisconnected');
            return true;
        });

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.deleteCollection)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'sales',
            clusterDashboardCollection: 'orders',
        });

        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        expect(controller.panel.webview.postMessage).toHaveBeenLastCalledWith({
            type: 'clusterDashboard.connectionUnavailable',
            unavailable: {
                reason: 'userDisconnected',
                title: expect.any(String),
                detail: expect.any(String),
                action: 'retry',
            },
        });
        controller.dispose();
    });

    it('refreshes inventory after paste returns', async () => {
        const { handlers, controller } = registerAndOpen();

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.pasteCollection)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'sales',
        });

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.pasteCollection',
            { id: 'tree-node' },
            null,
            { source: 'webview;clusterDashboard' },
        );
        expect(controller.panel.webview.postMessage).toHaveBeenCalledWith({
            type: 'clusterDashboard.inventoryChanged',
            databaseName: 'sales',
        });

        controller.dispose();
    });

    it('refreshes inventory after import returns, since it changes the figures on screen', async () => {
        const { handlers, controller } = registerAndOpen();

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.importDocuments)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'sales',
            clusterDashboardCollection: 'orders',
        });

        expect(controller.panel.webview.postMessage).toHaveBeenCalledWith({
            type: 'clusterDashboard.inventoryChanged',
            databaseName: 'sales',
        });

        controller.dispose();
    });

    it('leaves inventory alone after export, which changes nothing', async () => {
        const { handlers, controller } = registerAndOpen();

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.exportDocuments)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'sales',
            clusterDashboardCollection: 'orders',
        });

        expect(controller.panel.webview.postMessage).not.toHaveBeenCalled();

        controller.dispose();
    });

    it('reports a row whose tree node cannot be found instead of failing silently', async () => {
        const { handlers, controller } = registerAndOpen();
        vi.mocked(resolveNamespaceNode).mockResolvedValueOnce(undefined);

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.deleteDatabase)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'sales',
        });

        // The same non-modal surface and the same shared explanation the create procedures
        // use for this precondition; a modal here made one failure feel like two.
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('missing-namespace-explanation');
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();

        controller.dispose();
    });

    it('asks the panel to step into a database, the one action the host cannot take', async () => {
        const { handlers, controller } = registerAndOpen();

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.viewCollections)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'inventory',
        });

        expect(controller.panel.webview.postMessage).toHaveBeenCalledWith({
            type: 'clusterDashboard.showCollections',
            databaseName: 'inventory',
        });

        controller.dispose();
    });
});
