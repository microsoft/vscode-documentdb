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
    commands: { registerCommand: jest.fn() },
}));

jest.mock('../../../extensionVariables', () => ({
    ext: { context: { extensionUri: { scheme: 'file', path: '/extension' } } },
}));

jest.mock('../../_integration/openAppWebview', () => ({
    openAppWebview: jest.fn(() => createFakeController()),
}));

import * as vscode from 'vscode';
import { CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS } from './clusterDashboardContextMenu';
import { openClusterDashboardWebview, registerClusterDashboardContextMenuCommands } from './clusterDashboardController';

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
    it('routes the row action to the matching dashboard panel', async () => {
        const handlers = new Map<string, (context: unknown) => Promise<void>>();
        jest.mocked(vscode.commands.registerCommand).mockImplementation((commandId, handler) => {
            handlers.set(commandId, handler as (context: unknown) => Promise<void>);
            return { dispose: jest.fn() };
        });
        registerClusterDashboardContextMenuCommands({ subscriptions: [] } as unknown as vscode.ExtensionContext);
        const controller = open(CLUSTER, 'sales');

        await handlers.get(CLUSTER_DASHBOARD_CONTEXT_MENU_COMMANDS.openCollection)?.({
            clusterDashboardClusterId: CLUSTER,
            clusterDashboardSelectedDatabase: 'sales',
            clusterDashboardDatabase: 'sales',
            clusterDashboardCollection: 'orders',
        });

        expect(controller.panel.webview.postMessage).toHaveBeenCalledWith({
            type: 'clusterDashboard.contextMenu',
            action: 'openCollection',
            databaseName: 'sales',
            collectionName: 'orders',
        });

        controller.dispose();
    });
});
