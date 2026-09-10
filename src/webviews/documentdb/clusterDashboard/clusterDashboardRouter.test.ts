/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type initWebviewTrpc as InitWebviewTrpc } from '@microsoft/vscode-ext-webview';
import { type Document, type MongoClient } from 'mongodb';
import * as vscode from 'vscode';

import { API } from '../../../DocumentDBExperiences';

const mockResolveClusterNode = jest.fn();
const mockResolveNamespaceNode = jest.fn();
const mockUpdateGlobalSetting = jest.fn();

jest.mock('vscode', () => ({
    commands: { executeCommand: jest.fn() },
    l10n: { t: jest.fn((message: string) => message) },
}));

jest.mock('../../../commands/openCollectionView/openCollectionView', () => ({
    openCollectionViewInternal: jest.fn(),
}));

jest.mock('../../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: jest.fn() },
}));

jest.mock('../../../extensionVariables', () => ({
    ext: { settingsKeys: { showDashboardOnConnect: 'documentDB.userInterface.showDashboardOnConnect' } },
}));

jest.mock('../../../services/SettingsService', () => ({
    SettingsService: { updateGlobalSetting: (...args: unknown[]) => mockUpdateGlobalSetting(...args) },
}));

jest.mock('../../../utils/readOnlyJsonDocumentProvider', () => ({
    readOnlyJsonDocumentProvider: { openDocument: jest.fn() },
}));

jest.mock('./resolveNamespaceNode', () => ({
    resolveClusterNode: (...args: unknown[]) => mockResolveClusterNode(...args) as unknown,
    resolveNamespaceNode: (...args: unknown[]) => mockResolveNamespaceNode(...args) as unknown,
    describeMissingNamespace: () => 'missing-namespace-explanation',
}));

jest.mock('../../_integration/trpc', () => {
    const { initWebviewTrpc } = jest.requireActual<{ initWebviewTrpc: typeof InitWebviewTrpc }>(
        '@microsoft/vscode-ext-webview',
    );
    const trpc = initWebviewTrpc();
    return {
        createCallerFactory: trpc.createCallerFactory,
        publicProcedureWithTelemetry: trpc.publicProcedure,
        router: trpc.router,
    };
});

import { createCallerFactory, type WithTelemetry } from '../../_integration/trpc';
import { clusterDashboardRouter, collectRawCommandReplies, type RouterContext } from './clusterDashboardRouter';

// The suite swaps `publicProcedureWithTelemetry` for a plain procedure, so the action context
// the telemetry middleware would inject has to be supplied here instead.
function createContext(onNamespaceBusy?: RouterContext['onNamespaceBusy']): WithTelemetry<RouterContext> {
    return {
        dbExperience: API.DocumentDB,
        webviewName: 'clusterDashboard',
        clusterId: 'cluster-id',
        clusterDisplayName: 'Test cluster',
        viewId: 'connectionsView',
        dashboardSessionId: 'dashboard-session',
        onNamespaceBusy,
        actionContext: {
            telemetry: { properties: {}, measurements: {} },
            errorHandling: {},
            ui: {},
            valuesToMask: [],
        } as unknown as WithTelemetry<RouterContext>['actionContext'],
    };
}

describe('collectRawCommandReplies', () => {
    it('keeps each command invocation beside its raw response or error', async () => {
        const command = jest.fn(async (invocation: Document): Promise<Document> => {
            if (invocation.serverStatus === 1) {
                throw new Error('not authorized');
            }

            return { ok: 1, commandName: Object.keys(invocation)[0] };
        });
        const client = {
            db: () => ({ admin: () => ({ command }) }),
        } as unknown as MongoClient;

        const diagnostics = await collectRawCommandReplies(client);

        // A refusal is recorded rather than dropped: "vCore refuses serverStatus" is a
        // finding a bug report needs, not a gap to hide.
        expect(diagnostics.map(({ command }) => command)).toEqual([
            { buildInfo: 1 },
            { serverStatus: 1 },
            { hello: 1 },
            { replSetGetStatus: 1 },
            { hostInfo: 1 },
            { listShards: 1 },
        ]);
        expect(diagnostics[0]).toEqual({
            database: 'admin',
            command: { buildInfo: 1 },
            result: { ok: true, response: { ok: 1, commandName: 'buildInfo' } },
        });
        expect(diagnostics[1]).toEqual({
            database: 'admin',
            command: { serverStatus: 1 },
            result: { ok: false, error: 'not authorized' },
        });
    });
});

describe('clusterDashboardRouter create actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('opens the shell with the default database', async () => {
        const caller = createCallerFactory(clusterDashboardRouter)(createContext());

        await caller.openShell();

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('vscode-documentdb.command.shell.open.withInput', {
            clusterId: 'cluster-id',
            clusterDisplayName: 'Test cluster',
            databaseName: 'test',
        });
    });

    it('persists the dashboard-on-connect preference globally', async () => {
        const caller = createCallerFactory(clusterDashboardRouter)(createContext());

        await caller.setShowDashboardOnConnect(true);

        expect(mockUpdateGlobalSetting).toHaveBeenCalledWith('documentDB.userInterface.showDashboardOnConnect', true);
    });

    it('runs the existing copy-connection-string command against the resolved cluster node', async () => {
        const clusterNode = { id: 'cluster-tree-id' };
        mockResolveClusterNode.mockResolvedValue(clusterNode);
        const caller = createCallerFactory(clusterDashboardRouter)(createContext());

        await caller.copyConnectionString();

        expect(mockResolveClusterNode).toHaveBeenCalledWith('connectionsView', 'cluster-id');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.copyConnectionString',
            clusterNode,
        );
    });

    it('runs the existing data-migration command against the resolved cluster node', async () => {
        const clusterNode = { id: 'cluster-tree-id' };
        mockResolveClusterNode.mockResolvedValue(clusterNode);
        const caller = createCallerFactory(clusterDashboardRouter)(createContext());

        await caller.openDataMigration();

        expect(mockResolveClusterNode).toHaveBeenCalledWith('connectionsView', 'cluster-id');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.accessDataMigrationServices',
            clusterNode,
        );
    });

    it('runs the existing create-database command against the resolved cluster node', async () => {
        const clusterNode = { id: 'cluster-tree-id' };
        mockResolveClusterNode.mockResolvedValue(clusterNode);
        const onNamespaceBusy = jest.fn(async () => undefined);
        jest.mocked(vscode.commands.executeCommand).mockImplementationOnce(async (_command, ...args: unknown[]) => {
            const options = args[2] as { onNameResolved: (name: string) => Promise<void> };
            await options.onNameResolved('new-database');
            return 'new-database';
        });
        const caller = createCallerFactory(clusterDashboardRouter)(createContext(onNamespaceBusy));

        await caller.createDatabase({ activationSource: 'emptyState' });

        expect(mockResolveClusterNode).toHaveBeenCalledWith('connectionsView', 'cluster-id');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.createDatabase',
            clusterNode,
            null,
            expect.objectContaining({
                source: 'webview;clusterDashboard',
                activationSource: 'clusterDashboard:emptyState',
                onNameResolved: expect.any(Function),
            }),
        );
        expect(onNamespaceBusy).toHaveBeenCalledWith('new-database', undefined, true);
    });

    it('records which dashboard control asked for the database, and whether a name was confirmed', async () => {
        mockResolveClusterNode.mockResolvedValue({ id: 'cluster-tree-id' });
        const context = createContext();
        const caller = createCallerFactory(clusterDashboardRouter)(context);

        // The wizard swallows its own cancellation, so a resolved command with no name is the
        // shape of an abandoned dialog rather than a create.
        await caller.createDatabase({ activationSource: 'inventoryToolbar' });

        expect(context.actionContext.telemetry.properties).toMatchObject({
            activationSource: 'clusterDashboard:inventoryToolbar',
            dashboardSessionId: 'dashboard-session',
            viewId: 'connectionsView',
            nameConfirmed: 'false',
        });
    });

    it('runs the existing create-collection command against the resolved database node', async () => {
        const databaseNode = { id: 'cluster-tree-id/database' };
        mockResolveNamespaceNode.mockResolvedValue(databaseNode);
        const onNamespaceBusy = jest.fn(async () => undefined);
        jest.mocked(vscode.commands.executeCommand).mockImplementationOnce(async (_command, ...args: unknown[]) => {
            const options = args[2] as { onNameResolved: (name: string) => Promise<void> };
            await options.onNameResolved('new-collection');
        });
        const caller = createCallerFactory(clusterDashboardRouter)(createContext(onNamespaceBusy));

        await caller.createCollection({ databaseName: 'database', activationSource: 'inventoryToolbar' });

        expect(mockResolveNamespaceNode).toHaveBeenCalledWith('connectionsView', 'cluster-id', 'database');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.createCollection',
            databaseNode,
            null,
            expect.objectContaining({
                source: 'webview;clusterDashboard',
                activationSource: 'clusterDashboard:inventoryToolbar',
                onNameResolved: expect.any(Function),
            }),
        );
        expect(onNamespaceBusy).toHaveBeenCalledWith('database', 'new-collection', true);
    });
});
