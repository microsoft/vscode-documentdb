/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import * as vscode from 'vscode';
import { openCollectionViewInternal } from './commands/openCollectionView/openCollectionView';
import { handleAzureResourceLinkRequest } from './deepLinks/handleAzureResourceLink';
import { AuthMethodId } from './documentdb/auth/AuthMethod';
import { NoAuthHandler } from './documentdb/auth/NoAuthHandler';
import { ClustersClient } from './documentdb/ClustersClient';
import { Views } from './documentdb/Views';
import { ext } from './extensionVariables';
import { buildConnectionsViewTreePath, revealInConnectionsView } from './tree/connections-view/connectionsViewHelpers';
import { type DiscoveryRevealResult } from './tree/discovery-view/discoveryViewHelpers';
import { type EmulatorConfiguration } from './utils/emulatorConfiguration';
import { globalUriHandler } from './vscodeUriHandler';

/** Telemetry recorded by the mocked azext wrapper, so routing decisions can be asserted. */
let lastTelemetry: Record<string, string> = {};
let lastValuesToMask: string[] = [];
let showUrlHandlingConfirmations = true;
const mockGetAllConnections = vi.fn().mockResolvedValue([]);
const mockSaveConnection = vi.fn().mockResolvedValue(undefined);

vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(
        async (
            _eventName: string,
            callback: (ctx: { telemetry: { properties: Record<string, string> }; valuesToMask: string[] }) => unknown,
        ) => {
            const context = {
                telemetry: { properties: {} as Record<string, string>, measurements: {} },
                valuesToMask: [] as string[],
            };
            try {
                return await callback(context);
            } finally {
                lastTelemetry = context.telemetry.properties;
                lastValuesToMask = context.valuesToMask;
            }
        },
    ),
    parseError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
}));

const mockOpenLocalQuickStart = vi.fn().mockResolvedValue(undefined);
vi.mock('./commands/localQuickStart/openLocalQuickStart', () => ({
    openLocalQuickStart: (...args: unknown[]) => mockOpenLocalQuickStart(...args),
}));

vi.mock('./deepLinks/handleAzureResourceLink', () => ({
    handleAzureResourceLinkRequest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./documentdb/ClustersClient', () => ({ ClustersClient: { exists: vi.fn() } }));

// Keep storage, tree navigation, and webview creation isolated from the URI handler.
vi.mock('./commands/openCollectionView/openCollectionView', () => ({ openCollectionViewInternal: vi.fn() }));
vi.mock('./services/connectionStorageService', () => ({
    ConnectionStorageService: {
        getAll: (...args: unknown[]) => mockGetAllConnections(...args),
        save: (...args: unknown[]) => mockSaveConnection(...args),
    },
    ConnectionType: { Clusters: 'clusters', Emulators: 'emulators' },
    ItemType: { Cluster: 'cluster', Connection: 'connection' },
}));
vi.mock('./services/legacyEmulatorMigration', () => ({ isLegacyEmulatorMigrationComplete: () => true }));
vi.mock('./tree/connections-view/connectionsViewHelpers', () => ({
    buildConnectionsViewTreePath: vi.fn(),
    revealInConnectionsView: vi.fn(),
    waitForConnectionsViewReady: vi.fn(),
    withConnectionsViewProgress: vi.fn(async (callback: () => Promise<unknown>): Promise<unknown> => callback()),
}));
vi.mock('./extensionVariables', () => ({
    ext: {
        outputChannel: {
            info: vi.fn(),
            trace: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            appendLine: vi.fn(),
        },
        settingsKeys: { showUrlHandlingConfirmations: 'showUrlHandlingConfirmations' },
        connectionsBranchDataProvider: { refresh: vi.fn(), findNodeById: vi.fn() },
    },
}));

function uriFor(path: string, query: string = ''): vscode.Uri {
    return { scheme: 'vscode', authority: 'ms-azuretools.vscode-documentdb', path, query } as vscode.Uri;
}

/** Runs the handler and returns the error it surfaced, or `undefined` when it succeeded. */
async function runHandler(path: string, query: string = ''): Promise<Error | undefined> {
    try {
        await globalUriHandler(uriFor(path, query));
        return undefined;
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
}

beforeEach(() => {
    vi.clearAllMocks();
    lastTelemetry = {};
    lastValuesToMask = [];
    showUrlHandlingConfirmations = true;
    mockGetAllConnections.mockResolvedValue([]);
    mockSaveConnection.mockResolvedValue(undefined);
    vi.mocked(handleAzureResourceLinkRequest).mockResolvedValue(undefined);
    vi.mocked(ClustersClient.exists).mockReturnValue(true);
    vi.mocked(ext.connectionsBranchDataProvider.findNodeById).mockResolvedValue(undefined);
    vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'withProgress').mockImplementation(
        async (_options, task): Promise<unknown> =>
            task({ report: vi.fn() }, new vscode.CancellationTokenSource().token),
    );
    (vscode.workspace.getConfiguration as Mock).mockReturnValue({
        get: vi.fn(() => showUrlHandlingConfirmations),
    });
    (vscode.window.showInformationMessage as Mock).mockResolvedValue('Open setup');
    (vscode.window.showWarningMessage as Mock).mockResolvedValue(undefined);
});

describe('globalUriHandler — diagnostic logging', () => {
    it('logs Azure parameter names and the allow-listed open target without locator values', async (): Promise<void> => {
        await runHandler('/connect/azure', 'resourceId=resource-private&tenantId=tenant-private&open=shell');

        expect(ext.outputChannel.info).toHaveBeenCalledExactlyOnceWith(
            '[DeepLink] Handling link: action=connect source=azure parameters=resourceId,tenantId,open open=shell',
        );
        const logged = [
            ...vi.mocked(ext.outputChannel.info).mock.calls,
            ...vi.mocked(ext.outputChannel.trace).mock.calls,
        ]
            .flat()
            .join(' ');
        expect(logged).not.toContain('resource-private');
        expect(logged).not.toContain('tenant-private');
    });

    it('never logs credentials supplied as an unknown query key', async (): Promise<void> => {
        await runHandler('/connect', 'mongodb://u:SENTINEL_PW@h');

        expect(ext.outputChannel.info).toHaveBeenCalledExactlyOnceWith(
            '[DeepLink] Handling link: action=connect source=connectionString parameters=none unknown=1',
        );
        expect(lastTelemetry.uriParamCount).toBe('1');
        expect(lastTelemetry.uriUnknownParamCount).toBe('1');
        const logged = [
            ...vi.mocked(ext.outputChannel.info).mock.calls,
            ...vi.mocked(ext.outputChannel.trace).mock.calls,
            ...vi.mocked(ext.outputChannel.debug).mock.calls,
            ...vi.mocked(ext.outputChannel.warn).mock.calls,
            ...vi.mocked(ext.outputChannel.error).mock.calls,
            ...vi.mocked(ext.outputChannel.appendLine).mock.calls,
        ]
            .flat()
            .join(' ');
        expect(logged).not.toContain('SENTINEL_PW');
    });

    it('logs known query keys in order with duplicates while counting unknown keys', async (): Promise<void> => {
        await runHandler('/connect', 'database=sales&SENTINEL_PW&open=shell&database=archive&Open=dashboard');

        expect(ext.outputChannel.info).toHaveBeenCalledExactlyOnceWith(
            '[DeepLink] Handling link: action=connect source=connectionString parameters=database,open,database unknown=2 open=shell',
        );
        expect(lastTelemetry.uriParamCount).toBe('5');
        expect(lastTelemetry.uriUnknownParamCount).toBe('2');
        const logged = [
            ...vi.mocked(ext.outputChannel.info).mock.calls,
            ...vi.mocked(ext.outputChannel.trace).mock.calls,
            ...vi.mocked(ext.outputChannel.debug).mock.calls,
            ...vi.mocked(ext.outputChannel.warn).mock.calls,
            ...vi.mocked(ext.outputChannel.error).mock.calls,
            ...vi.mocked(ext.outputChannel.appendLine).mock.calls,
        ]
            .flat()
            .join(' ');
        expect(logged).not.toContain('SENTINEL_PW');
    });

    it('never logs connection string credentials or hosts', async (): Promise<void> => {
        showUrlHandlingConfirmations = false;
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Add and open');
        expect(await runHandler('/connect', 'connectionString=mongodb%3A%2F%2Fuser%3Asecret%40host')).toBeUndefined();
        expect(mockSaveConnection).toHaveBeenCalledOnce();
        expect(revealInConnectionsView).toHaveBeenCalledOnce();

        const logged = [
            ...vi.mocked(ext.outputChannel.info).mock.calls,
            ...vi.mocked(ext.outputChannel.trace).mock.calls,
        ]
            .flat()
            .join(' ');
        expect(logged).not.toContain('secret');
        expect(logged).not.toContain('user');
        expect(logged).not.toContain('host');
        expect(ext.outputChannel.info).toHaveBeenCalledTimes(1);
    });

    it('logs only the error name when a failure message contains connection details', async (): Promise<void> => {
        showUrlHandlingConfirmations = false;
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Add and open');
        mockSaveConnection.mockRejectedValue(new Error('user secret host'));
        await runHandler('/connect', 'connectionString=mongodb%3A%2F%2Fuser%3Asecret%40host');

        expect(ext.outputChannel.error).toHaveBeenCalledWith(
            '[DeepLink] Failed: failureStage=handleRequest errorName=Error',
        );
        const logged = [
            ...vi.mocked(ext.outputChannel.info).mock.calls,
            ...vi.mocked(ext.outputChannel.trace).mock.calls,
            ...vi.mocked(ext.outputChannel.error).mock.calls,
        ]
            .flat()
            .join(' ');
        expect(logged).not.toContain('secret');
        expect(logged).not.toContain('user');
        expect(logged).not.toContain('host');
    });

    it('logs an unrecognized action', async (): Promise<void> => {
        await runHandler('/unknown');

        expect(ext.outputChannel.info).toHaveBeenCalledExactlyOnceWith(
            '[DeepLink] Handling link: action=unrecognized parameters=none',
        );
    });

    it('logs an unrecognized source once before refusing the link', async (): Promise<void> => {
        await runHandler('/connect/unknown');

        expect(ext.outputChannel.info).toHaveBeenCalledExactlyOnceWith(
            '[DeepLink] Handling link: action=connect source=unrecognized parameters=none',
        );
    });

    it('logs local links even when their resource type is refused', async (): Promise<void> => {
        await runHandler('/local/unknown');

        expect(ext.outputChannel.info).toHaveBeenCalledExactlyOnceWith(
            '[DeepLink] Handling link: action=local parameters=none',
        );
    });
});

describe('globalUriHandler — route parsing', () => {
    it('treats a link with no path as connect, so already-published links keep working', async () => {
        const error = await runHandler('', '');

        // Every link published before verbs existed has an empty path. "No verb" has to keep
        // meaning connect forever, because a link in a blog post cannot be recalled.
        expect(lastTelemetry.deepLinkVerb).toBe('connect');
        expect(lastTelemetry.deepLinkConnectSource).toBe('connectionString');
        // It reached connect's own validation rather than being rejected as an unknown route.
        expect(error?.message).toContain('connection string');
    });

    it('routes an explicit /connect the same way as the legacy form', async () => {
        const error = await runHandler('/connect', '');

        expect(lastTelemetry.deepLinkVerb).toBe('connect');
        expect(lastTelemetry.deepLinkConnectSource).toBe('connectionString');
        expect(error?.message).toContain('connection string');
    });

    it.each(['/connect/anything', '/connect/extra/path'])('rejects connect path qualifiers in %s', async (path) => {
        const error = await runHandler(path, 'connectionString=mongodb%3A%2F%2Fhost');

        expect(error?.message).toBe(
            'This DocumentDB connection link has an invalid path. Use /connect or /connect/azure.',
        );
        expect(lastTelemetry.failureStage).toBe('validateConnectPath');
        expect(lastTelemetry.deepLinkConnectSource).toBe('unrecognized');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it.each(['/connect/azure', '/CONNECT/Azure'])(
        'routes %s to the Azure resource handler',
        async (path): Promise<void> => {
            const error = await runHandler(path, 'resourceId=example');

            expect(error).toBeUndefined();
            expect(handleAzureResourceLinkRequest).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ telemetry: expect.objectContaining({ properties: lastTelemetry }) }),
                {
                    resourceId: 'example',
                    tenantId: undefined,
                    database: undefined,
                    collection: undefined,
                    open: undefined,
                },
            );
            expect(lastTelemetry.deepLinkConnectSource).toBe('azure');
            expect(lastTelemetry.failureStage).toBe('handleAzureRequest');
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        },
    );

    it.each(['/connect/aws', '/connect/azure/x', '/connect/../local'])(
        'rejects unsupported connect source paths in %s without opening local setup',
        async (path) => {
            const error = await runHandler(path, 'connectionString=mongodb%3A%2F%2Fhost');

            expect(error?.message).toBe(
                'This DocumentDB connection link has an invalid path. Use /connect or /connect/azure.',
            );
            expect(lastTelemetry.deepLinkConnectSource).toBe('unrecognized');
            expect(lastTelemetry.failureStage).toBe('validateConnectPath');
            expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
            expect(mockOpenLocalQuickStart).not.toHaveBeenCalled();
        },
    );

    it('opens the DocumentDB Local wizard for /local', async () => {
        const error = await runHandler('/local');

        expect(error).toBeUndefined();
        expect(mockOpenLocalQuickStart).toHaveBeenCalledTimes(1);
        expect(lastTelemetry.deepLinkVerb).toBe('local');
        expect(lastTelemetry.deepLinkLocalResourceType).toBe('documentdb');
    });

    it('opens the DocumentDB Local wizard for the explicit /local/documentdb form', async () => {
        const error = await runHandler('/local/documentdb');

        expect(error).toBeUndefined();
        expect(mockOpenLocalQuickStart).toHaveBeenCalledTimes(1);
        expect(lastTelemetry.deepLinkLocalResourceType).toBe('documentdb');
    });

    it('accepts the verb and resource type in any case, because links are typed and pasted by hand', async () => {
        await runHandler('/LOCAL/DOCUMENTDB');

        expect(mockOpenLocalQuickStart).toHaveBeenCalledTimes(1);
    });

    it.each(['/local/', '/local/documentdb/'])('tolerates a trailing slash in %s', async (path) => {
        await runHandler(path);

        expect(mockOpenLocalQuickStart).toHaveBeenCalledTimes(1);
    });

    it('rejects an unsupported local resource type before opening or confirming', async () => {
        const error = await runHandler('/local/anything');

        expect(error?.message).toContain('unsupported resource type');
        expect(lastTelemetry.failureStage).toBe('validateLocalResourceType');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(mockOpenLocalQuickStart).not.toHaveBeenCalled();
    });

    it('rejects additional local path segments before opening or confirming', async () => {
        const error = await runHandler('/local/documentdb/extra');

        expect(error?.message).toContain('invalid path');
        expect(lastTelemetry.failureStage).toBe('validateLocalResourceType');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(mockOpenLocalQuickStart).not.toHaveBeenCalled();
    });
});

describe('globalUriHandler — connect parameter validation', () => {
    const connectionQuery = 'connectionString=mongodb%3A%2F%2Fhost';
    const azureQuery = 'resourceId=%2Fsubscriptions%2Fsub%2FresourceGroups%2Frg';
    const mixedError =
        'This DocumentDB link combines arguments for different link types. Use connectionString with /connect, or resourceId and tenantId with /connect/azure.';

    it.each([
        ['/connect', `${connectionQuery}&resourceId=resource`],
        ['/connect', `${connectionQuery}&tenantId=tenant`],
        ['', `${connectionQuery}&resourceId=`],
        ['/connect/azure', `${azureQuery}&connectionString=mongodb%3A%2F%2Fhost`],
        ['/connect/azure', `${azureQuery}&connectionString=`],
    ])('refuses mixed locators for %s before confirmation', async (path, query) => {
        const error = await runHandler(path, query);

        expect(error?.message).toBe(mixedError);
        expect(lastTelemetry.mixedLocatorRefused).toBe('true');
        expect(lastTelemetry.failureStage).toBe('extractParams');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it.each([
        ['/connect', connectionQuery],
        ['/connect/azure', azureQuery],
    ])('refuses open with collection for %s before confirmation', async (path, query) => {
        const error = await runHandler(path, `${query}&database=db&collection=items&open=shell`);

        expect(error?.message).toBe(
            'This DocumentDB link cannot combine a collection with the open parameter. Remove one of them.',
        );
        expect(lastTelemetry.failureStage).toBe('extractParams');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('refuses an Azure collection without a database before confirmation', async () => {
        const error = await runHandler('/connect/azure', `${azureQuery}&collection=items`);

        expect(error?.message).toBe(
            'This DocumentDB link specifies a collection without a database. Add a database parameter.',
        );
        expect(lastTelemetry.failureStage).toBe('extractParams');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('refuses an Azure link without a resource ID before confirmation', async () => {
        const error = await runHandler('/connect/azure', 'tenantId=tenant');

        expect(error?.message).toBe(
            'A DocumentDB Azure link was opened without a resource ID. Ensure the link includes a resourceId query parameter.',
        );
        expect(lastTelemetry.failureStage).toBe('extractParams');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('keeps the existing missing connection string refusal', async () => {
        const error = await runHandler('/connect', 'database=db');

        expect(error?.message).toBe(
            'A DocumentDB deep-link was opened without a connection string. Ensure the link includes a connectionString query parameter.',
        );
        expect(lastTelemetry.failureStage).toBe('extractParams');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it.each([
        ['/connect', connectionQuery, 'Shell', 'shell'],
        ['/connect', connectionQuery, 'DASHBOARD', 'dashboard'],
        ['/connect/azure', azureQuery, 'Shell', 'shell'],
        ['/connect/azure', azureQuery, 'DASHBOARD', 'dashboard'],
    ])('accepts and records an open target on %s', async (path, query, open, expected): Promise<void> => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);
        const error = await runHandler(path, `${query}&open=${open}`);

        expect(lastTelemetry.openTarget).toBe(expected);
        expect(lastTelemetry.uriParamCount).toBe('2');
        expect(lastTelemetry.uriUnknownParamCount).toBe('0');
        if (path === '/connect/azure') {
            expect(error).toBeUndefined();
            expect(handleAzureResourceLinkRequest).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ telemetry: expect.objectContaining({ properties: lastTelemetry }) }),
                {
                    resourceId: '/subscriptions/sub/resourceGroups/rg',
                    tenantId: undefined,
                    database: undefined,
                    collection: undefined,
                    open: expected,
                },
            );
            expect(lastTelemetry.failureStage).toBe('handleAzureRequest');
        } else {
            expect(error).toBeUndefined();
            expect(lastTelemetry.hasParamResourceId).toBeUndefined();
            expect(lastTelemetry.hasParamTenantId).toBeUndefined();
            expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        }
    });

    it.each([
        ['/connect', connectionQuery, 'collection'],
        ['/connect', connectionQuery, 'script'],
        ['/connect/azure', azureQuery, 'collection'],
        ['/connect/azure', azureQuery, 'script'],
    ])('refuses an unsupported open target for %s before confirmation', async (path, query, open) => {
        const error = await runHandler(path, `${query}&open=${open}`);

        expect(error?.message).toBe(
            'This DocumentDB link asks to open something the extension does not support. Supported values for open: dashboard, shell.',
        );
        expect(lastTelemetry.failureStage).toBe('extractParams');
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it.each([
        ['/connect', connectionQuery],
        ['/connect/azure', azureQuery],
    ])('records no open target for %s when open is missing or empty', async (path, query) => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);
        await runHandler(path, query);
        expect(lastTelemetry.openTarget).toBe('none');
        await runHandler(path, `${query}&open=`);
        expect(lastTelemetry.openTarget).toBe('none');
    });

    it('records and masks Azure parameters before calling the Azure resource handler', async (): Promise<void> => {
        const error = await runHandler(
            '/connect/azure',
            `${azureQuery}&tenantId=tenant&database=sales&collection=orders&unknown=value`,
        );

        expect(error).toBeUndefined();
        expect(handleAzureResourceLinkRequest).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ telemetry: expect.objectContaining({ properties: lastTelemetry }) }),
            {
                resourceId: '/subscriptions/sub/resourceGroups/rg',
                tenantId: 'tenant',
                database: 'sales',
                collection: 'orders',
                open: undefined,
            },
        );
        expect(lastTelemetry.failureStage).toBe('handleAzureRequest');
        expect(lastTelemetry.hasParamResourceId).toBe('true');
        expect(lastTelemetry.hasParamTenantId).toBe('true');
        expect(lastTelemetry.hasParamDatabase).toBe('true');
        expect(lastTelemetry.hasParamCollection).toBe('true');
        expect(lastTelemetry.hasParamConnectionString).toBeUndefined();
        expect(lastTelemetry.openTarget).toBe('none');
        expect(lastTelemetry.uriParamCount).toBe('5');
        expect(lastTelemetry.uriUnknownParamCount).toBe('1');
        expect(lastValuesToMask).toEqual(
            expect.arrayContaining(['/subscriptions/sub/resourceGroups/rg', 'tenant', 'sales', 'orders']),
        );
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('masks Azure values before refusing an unsupported open target', async () => {
        await runHandler('/connect/azure', `${azureQuery}&tenantId=tenant&database=sales&open=script`);

        expect(lastTelemetry.failureStage).toBe('extractParams');
        expect(lastValuesToMask).toEqual(
            expect.arrayContaining(['/subscriptions/sub/resourceGroups/rg', 'tenant', 'sales']),
        );
    });

    it('masks locator and destination values before refusing a mixed link', async () => {
        await runHandler(
            '/connect/azure',
            `${azureQuery}&tenantId=tenant&database=sales&collection=orders&${connectionQuery}`,
        );

        expect(lastTelemetry.mixedLocatorRefused).toBe('true');
        expect(lastValuesToMask).toEqual(
            expect.arrayContaining([
                'mongodb://host',
                '/subscriptions/sub/resourceGroups/rg',
                'tenant',
                'sales',
                'orders',
            ]),
        );
    });
});

describe('globalUriHandler — Azure open target', () => {
    const clusterNode = {
        id: 'discoveryView/cluster',
        cluster: { name: 'Production' },
    } as DiscoveryRevealResult['clusterNode'];
    const databaseNode = { id: 'discoveryView/cluster/db' } as NonNullable<DiscoveryRevealResult['databaseNode']>;
    const result: DiscoveryRevealResult = { clusterNode, clusterId: 'stable-cluster-id' };

    it('opens the dashboard on the cluster even when automatic dashboard opening is disabled', async (): Promise<void> => {
        vi.mocked(handleAzureResourceLinkRequest).mockResolvedValue(result);
        const getSetting = vi.fn().mockReturnValue(false);
        (vscode.workspace.getConfiguration as Mock).mockReturnValue({ get: getSetting });

        const error = await runHandler('/connect/azure', 'resourceId=example&open=dashboard');

        expect(error).toBeUndefined();
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
            'vscode-documentdb.command.clusterDashboard.open',
            clusterNode,
            null,
            { activationSource: 'deepLink' },
        );
        expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
        expect(getSetting).not.toHaveBeenCalled();
        expect(lastTelemetry.failureStage).toBe('openTarget');
    });

    it('opens the dashboard on the requested database node', async (): Promise<void> => {
        vi.mocked(handleAzureResourceLinkRequest).mockResolvedValue({ ...result, databaseNode });

        const error = await runHandler('/connect/azure', 'resourceId=example&open=dashboard&database=db');

        expect(error).toBeUndefined();
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
            'vscode-documentdb.command.clusterDashboard.open',
            databaseNode,
            null,
            { activationSource: 'deepLink' },
        );
    });

    it('opens the shell with only the node as its argument', async (): Promise<void> => {
        vi.mocked(handleAzureResourceLinkRequest).mockResolvedValue(result);

        const error = await runHandler('/connect/azure', 'resourceId=example&open=shell');

        expect(error).toBeUndefined();
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
            'vscode-documentdb.command.shell.open',
            clusterNode,
        );
        expect(lastTelemetry.failureStage).toBe('openTarget');
    });

    it('opens Collection View using the revealed cluster identity and Discovery view', async (): Promise<void> => {
        vi.mocked(handleAzureResourceLinkRequest).mockResolvedValue({ ...result, databaseNode });

        const error = await runHandler('/connect/azure', 'resourceId=example&database=db&collection=items');

        expect(error).toBeUndefined();
        expect(openCollectionViewInternal).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({ telemetry: expect.objectContaining({ properties: lastTelemetry }) }),
            {
                clusterId: 'stable-cluster-id',
                clusterDisplayName: 'Production',
                viewId: Views.DiscoveryView,
                databaseName: 'db',
                collectionName: 'items',
            },
        );
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(lastTelemetry.failureStage).toBe('openTarget');
    });

    it.each(['open=dashboard', 'open=shell', 'database=db&collection=items'])(
        'opens nothing for %s when the Azure handler returns no result',
        async (target): Promise<void> => {
            const error = await runHandler('/connect/azure', `resourceId=example&${target}`);

            expect(error).toBeUndefined();
            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
            expect(openCollectionViewInternal).not.toHaveBeenCalled();
            expect(lastTelemetry.failureStage).toBe('handleAzureRequest');
        },
    );

    it('only reveals when no open target or collection is requested', async (): Promise<void> => {
        vi.mocked(handleAzureResourceLinkRequest).mockResolvedValue(result);

        const error = await runHandler('/connect/azure', 'resourceId=example');

        expect(error).toBeUndefined();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        expect(openCollectionViewInternal).not.toHaveBeenCalled();
    });
});

describe('globalUriHandler — saved connection open target', () => {
    const connectionString = 'mongodb://alpha.example:27017';

    beforeEach((): void => {
        mockGetAllConnections.mockResolvedValue([
            { id: 'existing-id', name: 'Production', secrets: { connectionString } },
        ]);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Yes, open connection');
    });

    it.each([undefined, 'db'])(
        'names the Shell in the confirmation and opens the revealed node with database %s',
        async (database): Promise<void> => {
            const node = {
                id: 'connectionsView/existing-id',
                getTreeItem: (): vscode.TreeItem => ({ label: 'Production' }),
            };
            const treePath = database ? 'connectionsView/existing-id/db' : 'connectionsView/existing-id';
            vi.mocked(buildConnectionsViewTreePath).mockReturnValue(treePath);
            vi.mocked(ext.connectionsBranchDataProvider.findNodeById).mockResolvedValue(node);

            const error = await runHandler(
                '/connect',
                `connectionString=${encodeURIComponent(connectionString)}&open=shell${database ? '&database=db' : ''}`,
            );

            expect(error).toBeUndefined();
            expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
                'Open connection?',
                {
                    modal: true,
                    detail:
                        'A link wants to open a DocumentDB connection in VS Code.\n\n' +
                        `Connection: Production\n${database ? 'Database: db\n' : ''}Opens: Shell\n\n` +
                        'You might be asked for credentials to establish the connection.\n\n' +
                        'Note: You can disable these URL handling confirmations in the extension settings.',
                },
                'Yes, open connection',
            );
            expect(revealInConnectionsView).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ telemetry: expect.objectContaining({ properties: lastTelemetry }) }),
                'existing-id',
                false,
                database,
                undefined,
            );
            expect(buildConnectionsViewTreePath).toHaveBeenCalledExactlyOnceWith('existing-id', false, database);
            expect(ext.connectionsBranchDataProvider.findNodeById).toHaveBeenCalledExactlyOnceWith(treePath, false);
            expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
                'vscode-documentdb.command.shell.open',
                node,
            );
            expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2);
            expect(openCollectionViewInternal).not.toHaveBeenCalled();
            expect(lastTelemetry.failureStage).toBe('openTarget');
        },
    );

    it.each(['shell', 'dashboard'])(
        'skips %s when the revealed connection has no client',
        async (target): Promise<void> => {
            vi.mocked(ClustersClient.exists).mockReturnValue(false);
            vi.mocked(ext.connectionsBranchDataProvider.findNodeById).mockResolvedValue({
                id: 'connectionsView/existing-id',
                getTreeItem: (): vscode.TreeItem => ({ label: 'Production' }),
            });

            const error = await runHandler(
                '/connect',
                `connectionString=${encodeURIComponent(connectionString)}&open=${target}`,
            );

            expect(error).toBeUndefined();
            expect(ClustersClient.exists).toHaveBeenCalledExactlyOnceWith('existing-id');
            expect(vi.mocked(revealInConnectionsView).mock.invocationCallOrder[0]).toBeLessThan(
                vi.mocked(ClustersClient.exists).mock.invocationCallOrder[0],
            );
            expect(buildConnectionsViewTreePath).not.toHaveBeenCalled();
            expect(ext.connectionsBranchDataProvider.findNodeById).not.toHaveBeenCalled();
            expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith('connectionsView.focus');
            expect(ext.outputChannel.trace).toHaveBeenCalledWith(
                '[DeepLink] Cluster not connected; not opening the target',
            );
            expect(lastTelemetry.openTargetResult).toBe('skippedNotConnected');
            expect(lastTelemetry.failureStage).toBe('openTarget');
        },
    );

    it.each(['shell', 'dashboard'])(
        'opens %s when the revealed connection has a client',
        async (target): Promise<void> => {
            const node = {
                id: 'connectionsView/existing-id',
                getTreeItem: (): vscode.TreeItem => ({ label: 'Production' }),
            };
            vi.mocked(buildConnectionsViewTreePath).mockReturnValue(node.id);
            vi.mocked(ext.connectionsBranchDataProvider.findNodeById).mockResolvedValue(node);

            const error = await runHandler(
                '/connect',
                `connectionString=${encodeURIComponent(connectionString)}&open=${target}`,
            );

            expect(error).toBeUndefined();
            expect(ClustersClient.exists).toHaveBeenCalledExactlyOnceWith('existing-id');
            expect(ext.connectionsBranchDataProvider.findNodeById).toHaveBeenCalledExactlyOnceWith(node.id, false);
            if (target === 'shell') {
                expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
                    'vscode-documentdb.command.shell.open',
                    node,
                );
            } else {
                expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
                    'vscode-documentdb.command.clusterDashboard.open',
                    node,
                    null,
                    { activationSource: 'deepLink' },
                );
            }
            expect(lastTelemetry.openTargetResult).toBeUndefined();
        },
    );

    it('aborts a dashboard request when its node cannot be found', async (): Promise<void> => {
        vi.mocked(buildConnectionsViewTreePath).mockReturnValue('connectionsView/existing-id');

        const error = await runHandler(
            '/connect',
            `connectionString=${encodeURIComponent(connectionString)}&open=dashboard`,
        );

        expect(error?.message).toBe(
            'URL handling aborted. Connection was unsuccessful or the specified database/collection does not exist.',
        );
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ detail: expect.stringContaining('Opens: Cluster Dashboard') }),
            'Yes, open connection',
        );
        expect(ext.connectionsBranchDataProvider.findNodeById).toHaveBeenCalledExactlyOnceWith(
            'connectionsView/existing-id',
            false,
        );
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith('connectionsView.focus');
        expect(lastTelemetry.failureStage).toBe('openTarget');
    });
});

describe('globalUriHandler — local confirmation', () => {
    it('shows one lightweight confirmation before opening the setup wizard', async () => {
        await runHandler('/local/documentdb');

        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'This link wants to open the DocumentDB Local setup in VS Code.',
            {
                modal: true,
                detail: 'Note: You can disable these URL handling confirmations in the extension settings.',
            },
            'Open setup',
        );
        expect(mockOpenLocalQuickStart).toHaveBeenCalledTimes(1);
    });

    it('does not open the setup wizard when the confirmation is dismissed', async () => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

        const error = await runHandler('/local');

        expect(error).toBeUndefined();
        expect(mockOpenLocalQuickStart).not.toHaveBeenCalled();
        expect(lastTelemetry.userCancelledAtStep).toBe('OpenLocalQuickStart');
    });

    it('opens without prompting when URL handling confirmations are disabled', async () => {
        showUrlHandlingConfirmations = false;

        await runHandler('/local');

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(mockOpenLocalQuickStart).toHaveBeenCalledTimes(1);
    });
});

describe('globalUriHandler — parameter encoding', () => {
    it.each([
        [
            'decodes double-encoded spaces, ampersands, and plus signs',
            'database=sales%20%26%20marketing&collection=orders%2B2024',
            'Database: sales & marketing\nCollection: orders+2024\n',
        ],
        [
            'shows why values must be double-encoded',
            'database=sales & marketing&collection=orders+2024',
            'Database: sales \nCollection: orders 2024\n',
        ],
        [
            'decodes Unicode and preserves safe characters',
            'database=caf%C3%A9&collection=a.b-c_d',
            'Database: café\nCollection: a.b-c_d\n',
        ],
        ['decodes a percent sign', 'database=100%25', 'Database: 100%\n'],
    ])('%s', async (_name, query, expectedDetail) => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

        const error = await runHandler('/connect', `connectionString=mongodb%3A%2F%2Fhost&${query}`);

        expect(error).toBeUndefined();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        const options = (vscode.window.showInformationMessage as Mock).mock.calls[0][1] as { detail: string };
        expect(options.detail).toContain(expectedDetail);
        expect(mockSaveConnection).not.toHaveBeenCalled();
    });

    const resourceId =
        '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/my-group/providers/Microsoft.DocumentDB/mongoClusters/my-cluster';

    it.each([resourceId, resourceId.replaceAll('/', '%2F')])(
        'passes the same Azure resource ID after decoding %s',
        async (queryResourceId) => {
            const error = await runHandler('/connect/azure', `resourceId=${queryResourceId}`);

            expect(error).toBeUndefined();
            expect(handleAzureResourceLinkRequest).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ telemetry: expect.objectContaining({ properties: lastTelemetry }) }),
                { resourceId, tenantId: undefined, database: undefined, collection: undefined, open: undefined },
            );
        },
    );
});

describe('globalUriHandler — connection confirmation', () => {
    it('identifies a new target using separate lines without exposing its password', async () => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);
        const connectionString = encodeURIComponent('mongodb://user:secret@alpha.example:27017/sales');

        await runHandler('/connect', `connectionString=${connectionString}&collection=orders`);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Add and open connection?',
            {
                modal: true,
                detail:
                    'A link wants to add this DocumentDB connection and open it in VS Code.\n\n' +
                    'Connection: user@alpha.example:27017\n' +
                    'Database: sales\n' +
                    'Collection: orders\n' +
                    'Opens: Collection View\n\n' +
                    'A new connection will be added to your Connections View.\n' +
                    'You might be asked for credentials to establish the connection.',
            },
            'Add and open',
        );
        expect(JSON.stringify((vscode.window.showInformationMessage as Mock).mock.calls)).not.toContain('secret');
    });

    it('identifies an existing connection by its saved name with destination lines', async () => {
        const connectionString = 'mongodb://user:secret@alpha.example:27017/sales';
        mockGetAllConnections.mockResolvedValue([
            {
                id: 'existing-id',
                name: 'Production',
                secrets: { connectionString },
            },
        ]);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

        await runHandler('/connect', `connectionString=${encodeURIComponent(connectionString)}&collection=orders`);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Open connection?',
            {
                modal: true,
                detail: [
                    'A link wants to open a DocumentDB connection in VS Code.',
                    '',
                    'Connection: Production',
                    'Database: sales',
                    'Collection: orders',
                    'Opens: Collection View',
                    '',
                    'You might be asked for credentials to establish the connection.',
                    '',
                    'Note: You can disable these URL handling confirmations in the extension settings.',
                ].join('\n'),
            },
            'Yes, open connection',
        );
        expect(JSON.stringify((vscode.window.showInformationMessage as Mock).mock.calls)).not.toContain('secret');
    });

    it.each([
        { saved: false, confirmations: true },
        { saved: true, confirmations: true },
        { saved: true, confirmations: false },
        { saved: false, confirmations: false },
    ])(
        'opens Collection View with saved=$saved and confirmations=$confirmations',
        async ({ saved, confirmations }): Promise<void> => {
            const connectionString = 'mongodb://alpha.example:27017';
            showUrlHandlingConfirmations = confirmations;
            if (saved) {
                mockGetAllConnections.mockResolvedValue([
                    { id: 'existing-id', name: 'Production', secrets: { connectionString } },
                ]);
            }
            (vscode.window.showInformationMessage as Mock).mockResolvedValue(
                saved ? 'Yes, open connection' : 'Add and open',
            );
            vi.mocked(buildConnectionsViewTreePath).mockReturnValue('collection-path');
            vi.mocked(ext.connectionsBranchDataProvider.findNodeById).mockResolvedValue({
                id: 'collection-node',
                getTreeItem: (): vscode.TreeItem => ({ label: 'orders' }),
            });

            const error = await runHandler(
                '/connect',
                `connectionString=${encodeURIComponent(connectionString)}&database=sales&collection=orders`,
            );

            expect(error).toBeUndefined();
            if (saved && !confirmations) {
                expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
            } else {
                expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
                    saved ? 'Open connection?' : 'Add and open connection?',
                    expect.objectContaining({ detail: expect.stringContaining('Opens: Collection View') }),
                    saved ? 'Yes, open connection' : 'Add and open',
                );
            }
            const storageId = saved ? 'existing-id' : (mockSaveConnection.mock.calls[0][1] as { id: string }).id;
            expect(buildConnectionsViewTreePath).toHaveBeenCalledExactlyOnceWith(storageId, false, 'sales', 'orders');
            expect(ext.connectionsBranchDataProvider.findNodeById).toHaveBeenCalledExactlyOnceWith(
                'collection-path',
                false,
            );
            expect(openCollectionViewInternal).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ telemetry: expect.objectContaining({ properties: lastTelemetry }) }),
                {
                    clusterId: storageId,
                    clusterDisplayName: storageId,
                    viewId: Views.ConnectionsView,
                    databaseName: 'sales',
                    collectionName: 'orders',
                },
            );
        },
    );

    it.each([
        { target: 'shell', surface: 'Shell', command: 'vscode-documentdb.command.shell.open' },
        {
            target: 'dashboard',
            surface: 'Cluster Dashboard',
            command: 'vscode-documentdb.command.clusterDashboard.open',
        },
    ])(
        'names $surface in the new-connection confirmation and opens it',
        async ({ target, surface, command }): Promise<void> => {
            (vscode.window.showInformationMessage as Mock).mockResolvedValue('Add and open');
            const node = { id: 'connection-node', getTreeItem: (): vscode.TreeItem => ({ label: 'host' }) };
            vi.mocked(buildConnectionsViewTreePath).mockReturnValue('connection-path');
            vi.mocked(ext.connectionsBranchDataProvider.findNodeById).mockResolvedValue(node);

            const error = await runHandler('/connect', `connectionString=mongodb%3A%2F%2Fhost&open=${target}`);

            expect(error).toBeUndefined();
            expect(vscode.window.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
                'Add and open connection?',
                expect.objectContaining({ detail: expect.stringContaining(`Opens: ${surface}`) }),
                'Add and open',
            );
            if (target === 'dashboard') {
                expect(vscode.commands.executeCommand).toHaveBeenCalledWith(command, node, null, {
                    activationSource: 'deepLink',
                });
            } else {
                expect(vscode.commands.executeCommand).toHaveBeenCalledWith(command, node);
            }
        },
    );

    it('stops when the saved connection confirmation is dismissed', async (): Promise<void> => {
        const connectionString = 'mongodb://alpha.example:27017/sales';
        mockGetAllConnections.mockResolvedValue([
            { id: 'existing-id', name: 'Production', secrets: { connectionString } },
        ]);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

        const error = await runHandler(
            '/connect',
            `connectionString=${encodeURIComponent(connectionString)}&collection=orders`,
        );

        expect(error).toBeUndefined();
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(lastTelemetry.userCancelledAtStep).toBe('RevealConnection');
        expect(revealInConnectionsView).not.toHaveBeenCalled();
        expect(openCollectionViewInternal).not.toHaveBeenCalled();
    });

    it('aborts when the requested collection cannot be found', async (): Promise<void> => {
        const connectionString = 'mongodb://alpha.example:27017/sales';
        mockGetAllConnections.mockResolvedValue([
            { id: 'existing-id', name: 'Production', secrets: { connectionString } },
        ]);
        (vscode.window.showInformationMessage as Mock).mockResolvedValue('Yes, open connection');
        vi.mocked(buildConnectionsViewTreePath).mockReturnValue('collection-path');

        const error = await runHandler(
            '/connect',
            `connectionString=${encodeURIComponent(connectionString)}&collection=orders`,
        );

        expect(error?.message).toBe(
            'URL handling aborted. Connection was unsuccessful or the specified database/collection does not exist.',
        );
        expect(ext.connectionsBranchDataProvider.findNodeById).toHaveBeenCalledExactlyOnceWith(
            'collection-path',
            false,
        );
        expect(openCollectionViewInternal).not.toHaveBeenCalled();
    });
});

/** The item passed to `ConnectionStorageService.save`, or `undefined` when nothing was saved. */
function savedConnection(): { properties: { emulatorConfiguration?: unknown }; secrets: { connectionString: string } } {
    return mockSaveConnection.mock.calls[0]?.[1] as {
        properties: { emulatorConfiguration?: unknown };
        secrets: { connectionString: string };
    };
}

/** Accepts the add-and-open connection prompt. */
function acceptAddConnectionOnly(): void {
    (vscode.window.showInformationMessage as Mock).mockImplementation(
        (_message: string, _options: unknown, ...items: string[]) =>
            Promise.resolve(items.includes('Add and open') ? 'Add and open' : undefined),
    );
}

describe('globalUriHandler — TLS exception requested by a link', () => {
    it.each([
        'mongodb://devbox:10260/?tls=true&tlsAllowInvalidCertificates=true',
        'mongodb://10.0.0.5:10260/?tls=true&tlsAllowInvalidCertificates=true',
        'mongodb://db.local:10260/?tls=true&tlsInsecure=true',
        'mongodb://db.example.com:10260/?tls=true&tlsAllowInvalidCertificates=true',
    ])('ignores the request for a host that is not on this machine: %s', async (connectionString) => {
        acceptAddConnectionOnly();

        await runHandler('/connect', `connectionString=${encodeURIComponent(connectionString)}`);

        expect(mockSaveConnection).toHaveBeenCalledTimes(1);
        expect(savedConnection().properties.emulatorConfiguration).toBeUndefined();
        expect(savedConnection().secrets.connectionString).not.toMatch(/tlsAllowInvalid|tlsInsecure/i);
        expect(lastTelemetry.tlsBypassRequested).toBe('true');
        expect(lastTelemetry.tlsBypassHonored).toBe('false');
    });

    const localTlsBypass = encodeURIComponent('mongodb://localhost:10260/?tls=true&tlsAllowInvalidCertificates=true');

    it('keeps the exception for a target on this machine after the user turns validation off', async () => {
        acceptAddConnectionOnly();
        (vscode.window.showWarningMessage as Mock).mockResolvedValue('Turn off validation');

        await runHandler('/connect', `connectionString=${localTlsBypass}`);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
            'Turn off certificate validation?',
            {
                modal: true,
                detail: [
                    'This link asks to turn off TLS certificate validation.',
                    '',
                    'Connection: localhost:10260',
                    '',
                    'Without certificate validation, the identity of the server is not verified. Only turn it off for a local emulator or test instance you trust.',
                ].join('\n'),
            },
            'Turn off validation',
            'Keep validation on',
        );
        expect(savedConnection().properties.emulatorConfiguration).toEqual({
            isEmulator: true,
            disableEmulatorSecurity: true,
        });
        expect(savedConnection().secrets.connectionString).not.toMatch(/tlsAllowInvalid/i);
        expect(lastTelemetry.tlsBypassHonored).toBe('true');
    });

    it('keeps certificate validation on when the user chooses to', async () => {
        acceptAddConnectionOnly();
        (vscode.window.showWarningMessage as Mock).mockResolvedValue('Keep validation on');

        await runHandler('/connect', `connectionString=${localTlsBypass}`);

        expect(savedConnection().properties.emulatorConfiguration).toEqual({
            isEmulator: true,
            disableEmulatorSecurity: false,
        });
        expect(lastTelemetry.tlsBypassHonored).toBe('false');
    });

    it('adds nothing when the TLS prompt is dismissed', async () => {
        acceptAddConnectionOnly();
        (vscode.window.showWarningMessage as Mock).mockResolvedValue(undefined);

        await runHandler('/connect', `connectionString=${localTlsBypass}`);

        expect(mockSaveConnection).not.toHaveBeenCalled();
        expect(lastTelemetry.userCancelledAtStep).toBe('TlsException');
    });

    it('asks before turning validation off even when URL handling confirmations are disabled', async () => {
        showUrlHandlingConfirmations = false;
        acceptAddConnectionOnly();
        (vscode.window.showWarningMessage as Mock).mockResolvedValue(undefined);

        await runHandler('/connect', `connectionString=${localTlsBypass}`);

        expect(vscode.window.showWarningMessage).toHaveBeenCalledTimes(1);
        expect(mockSaveConnection).not.toHaveBeenCalled();
    });

    it('tells the user when a request to turn off validation was ignored', async () => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);
        const connectionString = encodeURIComponent(
            'mongodb://db.example.com:10260/?tls=true&tlsAllowInvalidCertificates=true',
        );

        await runHandler('/connect', `connectionString=${connectionString}`);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Add and open connection?',
            expect.objectContaining({
                detail: expect.stringContaining(
                    'This link asked to turn off TLS certificate validation. The request was ignored, and certificate validation stays on.',
                ),
            }),
            'Add and open',
        );
        expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    });

    it('marks a localhost.<domain> host as neither an emulator nor eligible for the exception', async () => {
        acceptAddConnectionOnly();
        const connectionString = 'mongodb://localhost.example.com:10260/?tls=true&tlsAllowInvalidCertificates=true';

        await runHandler('/connect', `connectionString=${encodeURIComponent(connectionString)}`);

        expect(savedConnection().properties.emulatorConfiguration).toBeUndefined();
    });

    it.each(['127.0.0.1', '[::1]'])(
        'applies the accepted exception to an anonymous connection on literal loopback %s',
        async (host) => {
            acceptAddConnectionOnly();
            (vscode.window.showWarningMessage as Mock).mockResolvedValue('Turn off validation');
            const connectionString = `mongodb://${host}:10260/?tls=true&tlsAllowInvalidCertificates=true`;

            await runHandler('/connect', `connectionString=${encodeURIComponent(connectionString)}`);

            const { properties, secrets } = savedConnection();
            expect(properties.emulatorConfiguration).toEqual({ isEmulator: false, disableEmulatorSecurity: true });

            // The saved consent must reach the client, not only storage.
            const { options } = await new NoAuthHandler({
                clusterId: 'cluster-1',
                connectionString: secrets.connectionString,
                connectionStringWithPassword: secrets.connectionString,
                authMechanism: AuthMethodId.NoAuth,
                emulatorConfiguration: properties.emulatorConfiguration as EmulatorConfiguration,
            }).configureAuth();
            expect(options.tlsAllowInvalidCertificates).toBe(true);
        },
    );
});

describe('globalUriHandler — URL handling confirmations disabled', () => {
    const connectionString = 'mongodb://user@alpha.example:27017/sales';

    beforeEach(() => {
        showUrlHandlingConfirmations = false;
    });

    it('still asks before adding a new connection, and adds nothing when dismissed', async () => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

        await runHandler('/connect', `connectionString=${encodeURIComponent(connectionString)}`);

        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
            'Add and open connection?',
            expect.objectContaining({
                modal: true,
                detail: expect.stringContaining('Connection: user@alpha.example:27017\nDatabase: sales'),
            }),
            'Add and open',
        );
        expect(mockSaveConnection).not.toHaveBeenCalled();
        expect(lastTelemetry.userCancelledAtStep).toBe('CreateNewConnection');
    });

    it('does not advertise turning the add-connection prompt off', async () => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);

        await runHandler('/connect', `connectionString=${encodeURIComponent(connectionString)}`);

        const calls = JSON.stringify((vscode.window.showInformationMessage as Mock).mock.calls);
        expect(calls).not.toContain('disable these URL handling confirmations');
        expect(calls).not.toContain('Opens:');
    });

    it('adds the connection only after the user confirms', async () => {
        acceptAddConnectionOnly();

        await runHandler('/connect', `connectionString=${encodeURIComponent(connectionString)}`);

        expect(mockSaveConnection).toHaveBeenCalledTimes(1);
    });

    it('opens an already saved connection without prompting', async () => {
        mockGetAllConnections.mockResolvedValue([
            { id: 'existing-id', name: 'Production', secrets: { connectionString } },
        ]);

        await runHandler('/connect', `connectionString=${encodeURIComponent(connectionString)}`);

        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
        expect(mockSaveConnection).not.toHaveBeenCalled();
    });
});

describe('globalUriHandler — connection target validation', () => {
    it('rejects a collection without a database before storage lookup or confirmation', async () => {
        const connectionString = encodeURIComponent('mongodb://alpha.example:27017');

        const error = await runHandler('/connect', `connectionString=${connectionString}&collection=orders`);

        expect(error?.message).toContain('specifies a collection without a database');
        expect(lastTelemetry.failureStage).toBe('validateCollectionTarget');
        expect(mockGetAllConnections).not.toHaveBeenCalled();
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    it('accepts the database in the connection-string path as the collection dependency', async () => {
        (vscode.window.showInformationMessage as Mock).mockResolvedValue(undefined);
        const connectionString = encodeURIComponent('mongodb://alpha.example:27017/sales');

        const error = await runHandler('/connect', `connectionString=${connectionString}&collection=orders`);

        expect(error).toBeUndefined();
        expect(mockGetAllConnections).toHaveBeenCalledTimes(1);
    });
});

describe('globalUriHandler — the verb list is a security boundary', () => {
    // The tempting implementation of a "command switch" maps the verb onto a VS Code command id.
    // The extension has commands that delete a container and copy a password to the clipboard, so
    // any page able to produce a link would be able to reach them. These names must stay inert.
    it.each([
        ['/delete'],
        ['/localQuickStart.delete'],
        ['/vscode-documentdb.command.localQuickStart.delete'],
        ['/copyPassword'],
        ['/localQuickStart.copyPassword'],
        ['/../local'],
    ])('refuses %s instead of reaching a command', async (path) => {
        const error = await runHandler(path);

        expect(error).toBeDefined();
        expect(error?.message).toContain('does not recognize');
        expect(mockOpenLocalQuickStart).not.toHaveBeenCalled();
    });

    it('does not fall back to connect when the verb is unrecognized', async () => {
        const error = await runHandler('/nonsense', 'connectionString=mongodb%3A%2F%2Fhost');

        // Falling through to the default would make every typo a silent connection attempt, and
        // would let a mistyped link act on a connection string the user never meant to use here.
        expect(error?.message).toContain('does not recognize');
        expect(error?.message).not.toContain('connection string parameter');
        expect(lastTelemetry.deepLinkVerb).toBe('unrecognized');
    });
});

describe('globalUriHandler — telemetry shape', () => {
    it('records the verb and the failure stage for an unrecognized route', async () => {
        await runHandler('/nonsense');

        // `failureStage` and `errorName` group deep-link failures; issue #655 (URL handler error
        // rate at 100%) is why they exist, so a new branch must keep filling them in.
        expect(lastTelemetry.failureStage).toBe('parseRoute');
        expect(lastTelemetry.errorName).toBe('Error');
        expect(lastTelemetry.deepLinkVerb).toBe('unrecognized');
    });

    it('surfaces the actionable link error without an internal URI-processing prefix', async () => {
        const error = await runHandler('/nonsense');

        expect(error?.message).toBe(
            'This DocumentDB link asks for an action the extension does not recognize. It may have been written for a newer version — check for an update, or verify the link.',
        );
    });

    it('keeps recording the non-sensitive URI diagnostics on every route', async () => {
        await runHandler('/local');

        expect(lastTelemetry.uriScheme).toBe('vscode');
        expect(lastTelemetry.uriAuthority).toBe('ms-azuretools.vscode-documentdb');
        expect(lastTelemetry.uriPathLength).toBe(String('/local'.length));
    });
});
