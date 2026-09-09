/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('@vscode/l10n', () => ({
    t: jest.fn((message: string) => message),
}));

jest.mock('vscode', () => ({
    ViewColumn: { One: 1 },
    Uri: { joinPath: jest.fn((base: unknown, ...parts: string[]) => ({ base, parts })) },
    commands: { registerCommand: jest.fn(), executeCommand: jest.fn() },
    window: { showErrorMessage: jest.fn() },
}));

jest.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: jest.fn(
        async (_eventId: string, callback: (context: unknown) => Promise<void>) =>
            callback({ telemetry: { properties: {}, measurements: {} } }),
    ),
}));

jest.mock('../../../extensionVariables', () => ({
    ext: { context: { extensionUri: { scheme: 'file', path: '/extension' } } },
}));

jest.mock('../../_integration/openAppWebview', () => ({
    openAppWebview: jest.fn(() => createFakeController()),
}));

jest.mock('../../../commands/openCollectionView/openCollectionView', () => ({
    openCollectionViewInternal: jest.fn(async () => undefined),
}));

jest.mock('./resolveNamespaceNode', () => ({
    resolveNamespaceNode: jest.fn(async () => ({ id: 'tree-node' })),
}));

import * as vscode from 'vscode';
import { openCollectionViewInternal } from '../../../commands/openCollectionView/openCollectionView';
import { CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS } from './clusterDashboardContextMenu';
import { openClusterDashboardWebview, registerClusterDashboardContextMenuCommands } from './clusterDashboardController';
import { resolveNamespaceNode } from './resolveNamespaceNode';

/**
 * Minimal stand-in for the parts of `AppWebviewController` this factory touches:
 * `isDisposed` (panel reuse) and `onDisposed` (cleanup wiring).
 */
type FakeController = {
    isDisposed: boolean;
    onDisposed: (handler: () => void) => void;
    revealToForeground: jest.Mock;
    dispose: () => void;
    panel: { webview: { postMessage: jest.Mock } };
};

function createFakeController(): FakeController {
    const handlers: Array<() => void> = [];

    return {
        isDisposed: false,
        revealToForeground: jest.fn(),
        panel: { webview: { postMessage: jest.fn().mockResolvedValue(true) } },
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

function open(clusterId: string, selectedDatabaseName?: string): FakeController {
    return openClusterDashboardWebview({
        clusterId,
        clusterDisplayName: clusterId,
        viewId: 'connectionsView',
        refreshIntervalMs: 5_000,
        feedbackSignalsEnabled: false,
        selectedDatabaseName,
    }) as unknown as FakeController;
}

describe('openClusterDashboardWebview panel lifecycle', () => {
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
});

describe('cluster dashboard native context menu commands', () => {
    function registerAndOpen(): {
        handlers: Map<string, (context: unknown) => Promise<void>>;
        controller: FakeController;
    } {
        jest.clearAllMocks();
        const handlers = new Map<string, (context: unknown) => Promise<void>>();
        jest.mocked(vscode.commands.registerCommand).mockImplementation((commandId, handler) => {
            handlers.set(commandId, handler as (context: unknown) => Promise<void>);
            return { dispose: jest.fn() };
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

    it('reports a row whose tree node cannot be found instead of failing silently', async () => {
        const { handlers, controller } = registerAndOpen();
        jest.mocked(resolveNamespaceNode).mockResolvedValueOnce(undefined);

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.deleteDatabase)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'sales',
        });

        expect(vscode.window.showErrorMessage).toHaveBeenCalled();
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
