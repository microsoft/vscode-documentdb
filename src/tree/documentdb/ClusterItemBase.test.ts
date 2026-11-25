/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import {
    callWithTelemetryAndErrorHandling,
    UserCancelledError,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { connectDisconnected, disconnect } from '../../commands/disconnect/disconnect';
import { AuthMethodId } from '../../documentdb/auth/AuthMethod';
import { EntraDestinationRejectedError } from '../../documentdb/auth/oidcAllowedHosts';
import { ClustersClient, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { teardownConnection } from '../../documentdb/connectionTeardown';
import { ConnectionUnavailableError } from '../../documentdb/ConnectionUnavailableError';
import { CredentialCache } from '../../documentdb/CredentialCache';
import { ShellCommandIds } from '../../documentdb/shell/constants';
import { Views } from '../../documentdb/Views';
import { type Experience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { containsRetryNode, RETRY_NODE_ID_SUFFIX } from '../api/retryNode';
import { BaseExtendedTreeDataProvider } from '../BaseExtendedTreeDataProvider';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElement } from '../TreeElement';
import { suppressAutoOpenDashboard } from './autoOpenDashboardSuppression';
import { ClusterItemBase, type EphemeralClusterCredentials } from './ClusterItemBase';

// Captures telemetry events emitted via callWithTelemetryAndErrorHandling when its callback throws.
const mockTelemetryEvents: Array<{ eventName: string; properties: Record<string, string>; suppressDisplay?: boolean }> =
    [];

vi.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class UserCancelledError extends Error {},
    callWithTelemetryAndErrorHandling: vi.fn(
        async (
            eventName: string,
            callback: (ctx: {
                telemetry: { properties: Record<string, string> };
                errorHandling: { suppressDisplay?: boolean };
            }) => unknown,
        ) => {
            const context = {
                telemetry: { properties: {} as Record<string, string>, measurements: {} },
                errorHandling: {} as { suppressDisplay?: boolean },
            };
            try {
                return await callback(context);
            } catch {
                // Mirrors azext: the error is recorded as telemetry rather than rethrown. azext would
                // display the error unless context.errorHandling.suppressDisplay was set.
                mockTelemetryEvents.push({
                    eventName,
                    properties: context.telemetry.properties,
                    suppressDisplay: context.errorHandling.suppressDisplay,
                });
                return undefined;
            }
        },
    ),
    createContextValue: (values: string[]) => values.join(';'),
    createGenericElement: (opts: Record<string, unknown>) => ({ id: opts.id, label: opts.label }),
}));

vi.mock('../api/createGenericElementWithContext', () => ({
    createGenericElementWithContext: (opts: Record<string, unknown>) => ({ ...opts }),
}));

const mockHasCredentials = vi.fn().mockReturnValue(false);
const mockGetSetting = vi.fn().mockReturnValue(false);
vi.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: {
        hasCredentials: (...args: unknown[]) => mockHasCredentials(...args),
        getCredentials: vi.fn(),
        deleteCredentials: vi.fn(),
    },
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    addEstablishedConnectionContext: vi.fn(),
    ClustersClient: {
        connectInteractive: vi.fn(),
        exists: vi.fn().mockReturnValue(false),
        getExistingClient: vi.fn(),
        getLatchReason: vi.fn(),
        unlatch: vi.fn(),
        getEpoch: vi.fn(() => 0),
        getLastVerifiedIdentity: vi.fn(),
        reportFailure: vi.fn(),
    },
}));

vi.mock('../../documentdb/connectionTeardown', () => ({ teardownConnection: vi.fn() }));

const notifyChildrenChanged = vi.fn();
vi.mock('../../extensionVariables', () => ({
    ext: {
        settingsKeys: {
            showDashboardOnConnect: 'documentDB.userInterface.showDashboardOnConnect',
        },
        outputChannel: {
            appendLine: vi.fn(),
            debug: vi.fn(),
        },
        state: { notifyChildrenChanged: (...args: unknown[]) => notifyChildrenChanged(...args) },
        connectionsBranchDataProvider: { resetNodeErrorState: vi.fn(), refresh: vi.fn() },
        discoveryBranchDataProvider: { resetNodeErrorState: vi.fn(), refresh: vi.fn() },
        azureResourcesRUBranchDataProvider: { resetNodeErrorState: vi.fn(), refresh: vi.fn() },
        azureResourcesVCoreBranchDataProvider: { resetNodeErrorState: vi.fn(), refresh: vi.fn() },
    },
}));

vi.mock('../../services/SettingsService', () => ({
    SettingsService: {
        getSetting: (...args: unknown[]) => mockGetSetting(...args),
    },
}));

vi.mock('./DatabaseItem', () => ({
    DatabaseItem: class {
        public id: string;
        public constructor(_cluster: unknown, database: { name: string }) {
            this.id = database.name;
        }
        public loadCollectionCount(): void {
            /* no-op for tests */
        }
    },
}));

/** Minimal concrete subclass so we can exercise the abstract base's getChildren(). */
class TestClusterItem extends ClusterItemBase {
    public constructor(
        cluster: TreeCluster<BaseClusterModel>,
        private readonly client: ClustersClient | null,
    ) {
        super(cluster);
    }

    protected authenticateAndConnect(): Promise<ClustersClient | null> {
        return Promise.resolve(this.client);
    }

    public getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
        return Promise.resolve(undefined);
    }
}

class TestRecoveryProvider extends BaseExtendedTreeDataProvider<TreeElement> {
    public readonly context = {
        telemetry: { properties: {}, measurements: {} },
        errorHandling: {},
    } as IActionContext;

    public getChildren(element?: TreeElement): Promise<TreeElement[] | null | undefined> {
        if (!element) {
            return Promise.resolve([]);
        }
        return this.wrapGetChildrenWithErrorAndStateHandling(element, this.context, async () =>
            element.getChildren?.(),
        );
    }

    public async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }
}

function makeCluster(): TreeCluster<BaseClusterModel> {
    return {
        treeId: 'cluster-1',
        clusterId: 'cluster-1',
        name: 'My Cluster',
        dbExperience: { api: 'MongoDB' } as unknown as Experience,
    } as unknown as TreeCluster<BaseClusterModel>;
}

const ClustersClientMock = vi.mocked(ClustersClient);

function makeClient(listDatabases: Mock): ClustersClient {
    return { listDatabases } as unknown as ClustersClient;
}

describe('ClusterItemBase.getChildren — listDatabases failure handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTelemetryEvents.length = 0;
        mockHasCredentials.mockReturnValue(false);
        mockGetSetting.mockReturnValue(false);
        ClustersClientMock.exists.mockReturnValue(false);
    });

    it('returns a retry node (and records telemetry) when listDatabases is rejected', async () => {
        const listDatabases = vi
            .fn()
            .mockRejectedValue(
                new Error('Command listDatabases is not allowed as the connection is not authenticated yet'),
            );
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        const children = (await item.getChildren()) as Array<TreeElement & Record<string, unknown>>;

        expect(children).toHaveLength(3);
        expect(children[2].id).toBe('cluster-1/retry');
        expect(children[2].contextValue).toBe('error');
        expect(children[2].label).toBe('Retry');
        expect(children[2].commandId).toBe('vscode-documentdb.command.internal.retry');
        expect(children[2].commandArgs).toEqual([item]);

        expect(children[0]).toMatchObject({
            id: 'cluster-1/diagnose',
            contextValue: 'error',
            label: 'Diagnose connection…',
            iconPath: new vscode.ThemeIcon('debug-alt'),
            commandId: 'vscode-documentdb.command.diagnoseConnection',
            commandArgs: [item, undefined, 'errorNode'],
        });
        expect(children[0].id.endsWith(RETRY_NODE_ID_SUFFIX)).toBe(false);
        expect(containsRetryNode([children[0]])).toBe(false);
        expect(containsRetryNode(children)).toBe(true);
        expect(children.filter((child) => child.id.endsWith(RETRY_NODE_ID_SUFFIX))).toHaveLength(1);

        expect(children[1].id).toBe('cluster-1/open-shell');
        expect(children[1].contextValue).toBe('error');
        expect(children[1].label).toBe('Open shell');
        expect(children[1].commandId).toBe(ShellCommandIds.open);
        expect(children[1].commandArgs).toEqual([item]);

        // The branch data provider detects (and caches) the error state via hasRetryNode().
        expect(item.hasRetryNode(children)).toBe(true);
    });

    it('offers the shell when connecting or signing in fails, not only after sign-in', async () => {
        const item = new TestClusterItem(makeCluster(), null);

        const children = (await item.getChildren()) as Array<TreeElement & Record<string, unknown>>;

        expect(children.map((child) => child.id)).toEqual([
            'cluster-1/diagnose',
            'cluster-1/open-shell',
            'cluster-1/retry',
        ]);
        expect(children[1]).toMatchObject({ commandId: ShellCommandIds.open, commandArgs: [item] });
    });

    it.each(['authentication', 'listDatabases'] as const)(
        'keeps %s failures cached with the diagnosis child until an explicit retry',
        async (failurePhase) => {
            const listDatabases = vi.fn().mockRejectedValue(new Error('not authenticated'));
            const cluster = { ...makeCluster(), treeId: 'connectionsView/folder/cluster-1' };
            const item = new TestClusterItem(
                cluster,
                failurePhase === 'authentication' ? null : makeClient(listDatabases),
            );
            const fetchChildren = vi.spyOn(item, 'getChildren');
            const provider = new TestRecoveryProvider();

            const children = await provider.getChildren(item);
            expect(children?.map((child) => child.id)).toContain(`${cluster.treeId}/diagnose`);
            expect(containsRetryNode(children)).toBe(true);
            expect(provider.hasNodeErrorState(item.id)).toBe(true);
            expect(await provider.getChildren(item)).toBe(children);
            expect(fetchChildren).toHaveBeenCalledTimes(1);
            expect(provider.context.telemetry.properties.usedCachedErrorNode).toBe('true');

            provider.resetNodeErrorState(item.id);
            await provider.getChildren(item);
            expect(fetchChildren).toHaveBeenCalledTimes(2);
            provider.dispose();
        },
    );

    it('surfaces the failure as a modal dialog and suppresses the default non-modal notification', async () => {
        const listDatabases = vi.fn().mockRejectedValue(new Error('not authenticated'));
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        await item.getChildren();

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'Failed to load databases for "My Cluster"',
            expect.objectContaining({ modal: true, detail: 'not authenticated' }),
        );
        // azext's own (non-modal) display is suppressed so the user only sees the modal.
        expect(mockTelemetryEvents[0].suppressDisplay).toBe(true);
    });

    it('records failure telemetry with the expected properties', async () => {
        const listDatabases = vi.fn().mockRejectedValue(new Error('not authenticated'));
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        await item.getChildren();

        expect(mockTelemetryEvents).toHaveLength(1);
        expect(mockTelemetryEvents[0].eventName).toBe('connect');
        expect(mockTelemetryEvents[0].properties).toMatchObject({
            connectionResult: 'failed',
            source: 'treeExpansion',
            experience: 'MongoDB',
            failurePhase: 'listDatabases',
        });
    });

    it('returns database items and no telemetry/retry node on success', async () => {
        const listDatabases = vi.fn().mockResolvedValue([{ name: 'beta' }, { name: 'alpha' }] as DatabaseItemModel[]);
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        const children = (await item.getChildren()) as Array<TreeElement & Record<string, unknown>>;

        expect(children).toHaveLength(2);
        // Sorted alphabetically by name.
        expect(children.map((c) => c.id)).toEqual(['alpha', 'beta']);
        expect(item.hasRetryNode(children)).toBe(false);
        expect(mockTelemetryEvents).toHaveLength(0);
    });

    it('opens the dashboard after connecting through tree expansion when enabled', async () => {
        mockGetSetting.mockReturnValue(true);
        const listDatabases = vi.fn().mockResolvedValue([{ name: 'database' }] as DatabaseItemModel[]);
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        await item.getChildren();

        expect(mockGetSetting).toHaveBeenCalledWith('documentDB.userInterface.showDashboardOnConnect');
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.clusterDashboard.open',
            item,
            null,
            { activationSource: 'autoOpenOnConnect' },
        );
        expect(callWithTelemetryAndErrorHandling).not.toHaveBeenCalledWith(
            'clusterDashboard.autoOpenSkipped',
            expect.anything(),
        );
    });

    it('does not auto-open the dashboard while the stable cluster id is suppressed', async (): Promise<void> => {
        mockGetSetting.mockReturnValue(true);
        const cluster = { ...makeCluster(), treeId: 'connectionsView/folder/cluster-1' };
        const item = new TestClusterItem(cluster, makeClient(vi.fn().mockResolvedValue([{ name: 'database' }])));
        const release = suppressAutoOpenDashboard(cluster.clusterId);
        try {
            await item.getChildren();
            expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        } finally {
            release();
        }

        await item.getChildren();
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
            'vscode-documentdb.command.clusterDashboard.open',
            item,
            null,
            { activationSource: 'autoOpenOnConnect' },
        );
    });

    it('opens the dashboard by default when the setting is unavailable', async () => {
        mockGetSetting.mockReturnValue(undefined);
        const listDatabases = vi.fn().mockResolvedValue([{ name: 'database' }] as DatabaseItemModel[]);
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        await item.getChildren();

        expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
            'vscode-documentdb.command.clusterDashboard.open',
            item,
            null,
            { activationSource: 'autoOpenOnConnect' },
        );
    });

    it('does not reopen the dashboard on refresh or when the tree node is recreated', async () => {
        mockGetSetting.mockReturnValue(true);
        const client = makeClient(vi.fn().mockResolvedValue([{ name: 'database' }]));
        ClustersClientMock.connectInteractive.mockResolvedValue(client);
        const item = new TestClusterItem(makeCluster(), client);

        await item.getChildren();
        mockHasCredentials.mockReturnValue(true);
        ClustersClientMock.exists.mockReturnValue(true);
        await item.getChildren();
        await new TestClusterItem(makeCluster(), client).getChildren();

        expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
        expect(ClustersClientMock.exists).toHaveBeenCalledWith('cluster-1');
    });

    it('opens the dashboard again after the cached client is removed', async () => {
        mockGetSetting.mockReturnValue(true);
        mockHasCredentials.mockReturnValue(true);
        const client = makeClient(vi.fn().mockResolvedValue([{ name: 'database' }]));
        ClustersClientMock.connectInteractive.mockResolvedValue(client);
        ClustersClientMock.exists.mockReturnValueOnce(true).mockReturnValueOnce(false);
        const item = new TestClusterItem(makeCluster(), client);

        await item.getChildren();
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
        await item.getChildren();

        expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
    });

    it('does not open the dashboard when connecting through tree expansion is disabled', async () => {
        mockGetSetting.mockReturnValue(false);
        const listDatabases = vi.fn().mockResolvedValue([{ name: 'database' }] as DatabaseItemModel[]);
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        await item.getChildren();

        expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
            'vscode-documentdb.command.clusterDashboard.open',
            item,
            null,
            { activationSource: 'autoOpenOnConnect' },
        );
        // Reports that automatic opening was skipped, so people who turned it off are countable.
        const skipped = (callWithTelemetryAndErrorHandling as Mock).mock.calls.find(
            ([eventName]) => eventName === 'clusterDashboard.autoOpenSkipped',
        );
        expect(skipped).toBeDefined();
        const context = {
            telemetry: { properties: {} as Record<string, string>, measurements: {} },
            errorHandling: {},
        };
        await (skipped?.[1] as (ctx: typeof context) => unknown)(context);
        expect(context.telemetry.properties).toMatchObject({ reason: 'settingDisabled' });
        expect(mockTelemetryEvents).toHaveLength(0);
    });

    it('returns the "Create Database…" node when the cluster has no databases', async () => {
        const listDatabases = vi.fn().mockResolvedValue([] as DatabaseItemModel[]);
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        const children = (await item.getChildren()) as Array<TreeElement & Record<string, unknown>>;

        expect(children).toHaveLength(1);
        expect(children[0].id).toBe('cluster-1/no-databases');
        expect(item.hasRetryNode(children)).toBe(false);
        expect(mockTelemetryEvents).toHaveLength(0);
    });
});

describe('ClusterItemBase.getChildren — cached client connection failure handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockTelemetryEvents.length = 0;
        // Simulate cached credentials so getChildren() takes the "reuse cached client" path.
        mockHasCredentials.mockReturnValue(true);

        // jest-mock-vscode's withProgress is a no-op vi.fn(); make it actually run the task so
        // getClientWithProgress() exercises ClustersClient.connectInteractive() and surfaces its rejection.
        (vscode.window.withProgress as unknown as Mock).mockImplementation(
            (
                _options: unknown,
                task: (
                    progress: unknown,
                    token: { isCancellationRequested: boolean; onCancellationRequested: Mock },
                ) => unknown,
            ) => task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
        );
    });

    it('shows only Connect while user-disconnected and uses cached settings on the same node after the click', async () => {
        const node = new TestClusterItem({ ...makeCluster(), treeId: 'connectionsView/folder/cluster-1' }, null);
        const context = {} as IActionContext;
        const stableId = node.cluster.clusterId;
        const treeId = node.id;
        ClustersClientMock.exists.mockReturnValue(true);
        expect(node.getTreeItem().contextValue?.split(';')).toContain('connected');
        ClustersClientMock.exists.mockReturnValue(false);
        ClustersClientMock.getLatchReason.mockReturnValue('userDisconnected');

        try {
            expect(await node.getChildren()).toEqual([
                expect.objectContaining({ label: 'Reconnect', id: `${treeId}/connect`, commandArgs: [node] }),
            ]);
            expect(node.getTreeItem().contextValue?.split(';')).not.toContain('connected');
            expect(mockHasCredentials).not.toHaveBeenCalled();
            expect(ClustersClientMock.connectInteractive).not.toHaveBeenCalled();
            expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();

            connectDisconnected(context, node);
            expect(ClustersClientMock.unlatch).toHaveBeenCalledExactlyOnceWith(stableId);
            expect(notifyChildrenChanged).toHaveBeenCalledExactlyOnceWith(treeId);

            ClustersClientMock.getLatchReason.mockReturnValue(undefined);
            ClustersClientMock.connectInteractive.mockResolvedValueOnce(
                makeClient(vi.fn().mockResolvedValue([{ name: 'database' }])),
            );
            expect(await node.getChildren()).toEqual([expect.objectContaining({ id: 'database' })]);
            expect(ClustersClientMock.connectInteractive).toHaveBeenCalledExactlyOnceWith(
                stableId,
                expect.any(AbortSignal),
                expect.any(Function),
                'treeConnect',
            );
            expect(node.getTreeItem().id).toBe(treeId);

            ClustersClientMock.getLatchReason.mockReturnValue('connectionRemoved');
            connectDisconnected(context, node);
            expect(ClustersClientMock.unlatch).toHaveBeenCalledOnce();
        } finally {
            ClustersClientMock.getLatchReason.mockReturnValue(undefined);
        }
    });

    it('clears and refreshes only the owning discovery provider after Disconnect', async () => {
        const node = new TestClusterItem({ ...makeCluster(), treeId: 'discoveryView/custom-source/cluster-1' }, null);
        const context = { telemetry: { suppressAll: false } } as IActionContext;
        ClustersClientMock.exists.mockReturnValue(true);
        ClustersClientMock.getLatchReason.mockReturnValue(undefined);

        await disconnect(context, node);

        expect(teardownConnection).toHaveBeenCalledExactlyOnceWith(
            node.cluster.clusterId,
            'userDisconnected',
            expect.any(Function),
        );
        const refreshTree = vi.mocked(teardownConnection).mock.calls[0][2];
        refreshTree();

        expect(ext.discoveryBranchDataProvider.resetNodeErrorState).toHaveBeenCalledExactlyOnceWith(node.id);
        expect(ext.discoveryBranchDataProvider.refresh).toHaveBeenCalledExactlyOnceWith(node);
        expect(ext.connectionsBranchDataProvider.resetNodeErrorState).not.toHaveBeenCalled();
        expect(ext.connectionsBranchDataProvider.refresh).not.toHaveBeenCalled();
    });

    it.each(['signInRequired', 'credentialsRejected'] as const)(
        'offers Retry sign-in instead of Retry for %s and keeps the failed-expansion marker',
        async (reason): Promise<void> => {
            if (reason === 'credentialsRejected') {
                ClustersClientMock.getLatchReason.mockReturnValueOnce(reason);
            }
            ClustersClientMock.connectInteractive.mockRejectedValueOnce(new ConnectionUnavailableError(reason));
            vi.mocked(CredentialCache.getCredentials).mockReturnValue({
                clusterId: 'cluster-1',
                connectionString: 'mongodb://example.test',
                authMechanism: AuthMethodId.MicrosoftEntraID,
            });
            ClustersClientMock.getLastVerifiedIdentity.mockReturnValue({
                kind: 'entra',
                providerId: 'microsoft',
                accountLabel: 'test',
                accountId: 'id',
            });
            const item = new TestClusterItem(makeCluster(), null);

            const children = await item.getChildren();

            expect(children.map(({ id }) => id)).toEqual([
                'cluster-1/sign-in-again',
                'cluster-1/diagnose',
                'cluster-1/open-shell',
            ]);
            expect(children[0]).toMatchObject({ label: 'Retry sign-in' });
            if (reason === 'credentialsRejected') {
                expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.any(String), {
                    modal: true,
                    detail: 'The database rejected the credentials. Choose Retry sign-in to continue.',
                });
            }
            expect(item.hasRetryNode(children)).toBe(true);
            expect(ClustersClientMock.reportFailure).not.toHaveBeenCalled();
            expect(CredentialCache.deleteCredentials).not.toHaveBeenCalled();
            vi.mocked(CredentialCache.getCredentials).mockReset();
            ClustersClientMock.getLastVerifiedIdentity.mockReset();
        },
    );

    it('does not publish a database listing from a different identity', async (): Promise<void> => {
        const binding = { clusterId: 'cluster-1', fingerprint: 'old', generation: 1 };
        const client = {
            ...makeClient(vi.fn().mockResolvedValue([{ name: 'old-database' }])),
            binding,
        } as ClustersClient;
        const replacement = { ...client, fingerprint: 'new' } as ClustersClient;
        ClustersClientMock.connectInteractive.mockResolvedValueOnce(client);
        ClustersClientMock.getExistingClient.mockReturnValueOnce(replacement);

        expect(await new TestClusterItem(makeCluster(), null).getChildren()).toEqual([]);
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it.each(['diagnose', 'sign-in-again'])(
        'does not mistake a database named %s for a recovery action',
        (name): void => {
            const item = new TestClusterItem(makeCluster(), null);
            const child = {
                id: `cluster-1/${name}`,
                contextValue: 'treeItem_documentdbdatabase',
                getTreeItem: (): vscode.TreeItem => ({ label: name }),
            };

            expect(item.hasRetryNode([child])).toBe(false);
        },
    );

    it('keeps actionable recovery children without an inert Retry for stored credentials', async (): Promise<void> => {
        ClustersClientMock.getLatchReason.mockReturnValue('credentialsRejected');
        ClustersClientMock.connectInteractive.mockRejectedValueOnce(
            new ConnectionUnavailableError('credentialsRejected'),
        );
        const item = new TestClusterItem({ ...makeCluster(), viewId: Views.ConnectionsView }, null);
        try {
            const children = await item.getChildren();

            expect(children.map(({ id }) => id)).toEqual(['cluster-1/diagnose', 'cluster-1/open-shell']);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.any(String), {
                modal: true,
                detail: 'The database rejected the credentials. Choose Update credentials to continue.',
            });
            expect(item.hasRetryNode(children)).toBe(true);
        } finally {
            ClustersClientMock.getLatchReason.mockReset();
        }
    });

    it('keeps Retry for a synthetic Connections view item without a credential editor', async (): Promise<void> => {
        ClustersClientMock.getLatchReason.mockReturnValue('credentialsRejected');
        ClustersClientMock.connectInteractive.mockRejectedValueOnce(
            new ConnectionUnavailableError('credentialsRejected'),
        );
        const item = new TestClusterItem({ ...makeCluster(), viewId: Views.ConnectionsView }, null);
        item.contextValue = 'treeItem_quickStartInstance';
        try {
            expect((await item.getChildren()).map(({ id }) => id)).toEqual([
                'cluster-1/diagnose',
                'cluster-1/open-shell',
                'cluster-1/retry',
            ]);
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.any(String), {
                modal: true,
                detail: 'The database rejected the credentials. Choose Retry to reload them.',
            });
        } finally {
            ClustersClientMock.getLatchReason.mockReset();
        }
    });

    it('explains how to reload a rejected Azure key', async (): Promise<void> => {
        ClustersClientMock.getLatchReason.mockReturnValue('credentialsRejected');
        ClustersClientMock.connectInteractive.mockRejectedValueOnce(
            new ConnectionUnavailableError('credentialsRejected'),
        );
        const item = new TestClusterItem({ ...makeCluster(), viewId: Views.AzureResourcesView }, null);
        item.readReplacementKey = vi.fn();
        try {
            await item.getChildren();
            expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.any(String), {
                modal: true,
                detail: 'The database rejected the key. Choose Retry to read the key from Azure again.',
            });
        } finally {
            ClustersClientMock.getLatchReason.mockReset();
        }
    });

    it('reports the binding that executed listDatabases, not the current cache entry', async (): Promise<void> => {
        const error = new Error('deprecated generation');
        const binding = { clusterId: 'cluster-1', fingerprint: 'old', generation: 1 };
        const client = { ...makeClient(vi.fn().mockRejectedValue(error)), binding } as ClustersClient;
        ClustersClientMock.connectInteractive.mockResolvedValueOnce(client);
        ClustersClientMock.reportFailure.mockReturnValueOnce(undefined);

        expect(await new TestClusterItem(makeCluster(), null).getChildren()).toEqual([]);
        expect(ClustersClientMock.reportFailure).toHaveBeenCalledExactlyOnceWith(binding, error);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('returns a retry node when reusing the cached client fails (without listing databases)', async () => {
        (ClustersClientMock.connectInteractive as Mock).mockRejectedValue(new Error('server down'));

        // listDatabases must never be reached when the cached client cannot connect.
        const listDatabases = vi.fn();
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        const children = (await item.getChildren()) as Array<TreeElement & Record<string, unknown>>;

        expect(children).toHaveLength(3);
        expect(children[2].id).toBe('cluster-1/retry');
        expect(children[2].contextValue).toBe('error');
        expect(children[2].commandId).toBe('vscode-documentdb.command.internal.retry');
        expect(children[2].commandArgs).toEqual([item]);
        expect(children[1].id).toBe('cluster-1/open-shell');
        expect(item.hasRetryNode(children)).toBe(true);
        expect(listDatabases).not.toHaveBeenCalled();
    });

    it('uses the trusted-server modal and preserves action-only recovery for a cached rejection', async (): Promise<void> => {
        ClustersClientMock.connectInteractive.mockRejectedValue(
            new EntraDestinationRejectedError({ firstHost: 'other.example.com:27017', hostCount: 2 }),
        );
        const cluster = makeCluster();
        cluster.treeId = 'connectionsView/folder/cluster-1';
        const item = new TestClusterItem(cluster, null);

        const children = await item.getChildren();

        expect(ClustersClientMock.connectInteractive).toHaveBeenCalledWith(
            'cluster-1',
            expect.anything(),
            expect.any(Function),
            'treeConnect',
        );
        expect(vscode.window.showErrorMessage).toHaveBeenCalledExactlyOnceWith(
            "Microsoft Entra ID isn't allowed for this server.",
            {
                modal: true,
                detail: 'Microsoft Entra ID is available only for Azure DocumentDB\nor servers allowed by the trusted-server setting.\nServer: other.example.com and 1 more',
            },
            'Learn More',
        );
        expect(item.lastConnectionFailureReason).toBe('entraDestinationRejected');
        expect(children).toHaveLength(3);
        expect(children[2].id).toBe('connectionsView/folder/cluster-1/retry');
        expect((children[2] as TreeElement & { commandId: string }).commandId).toBe(
            'vscode-documentdb.command.internal.retry',
        );
        expect(children.map((child) => child.id)).toEqual([
            'connectionsView/folder/cluster-1/diagnose',
            'connectionsView/folder/cluster-1/open-shell',
            'connectionsView/folder/cluster-1/retry',
        ]);
        expect(children.map((child) => (child as TreeElement & { commandId: string }).commandId)).toEqual([
            'vscode-documentdb.command.diagnoseConnection',
            'vscode-documentdb.command.shell.open',
            'vscode-documentdb.command.internal.retry',
        ]);
    });

    it('clears the destination rejection reason after a successful cached retry', async (): Promise<void> => {
        const item = new TestClusterItem(makeCluster(), null);
        ClustersClientMock.connectInteractive.mockRejectedValueOnce(
            new EntraDestinationRejectedError({ firstHost: 'other.example.com', hostCount: 1 }),
        );
        await item.getChildren();
        expect(item.lastConnectionFailureReason).toBe('entraDestinationRejected');
        ClustersClientMock.connectInteractive.mockResolvedValueOnce(makeClient(vi.fn().mockResolvedValue([])));

        await item.getChildren();

        expect(item.lastConnectionFailureReason).toBeUndefined();
        expect(item.lastConnectionOutcome).toBe('connected');
    });

    it('surfaces a modal and records telemetry with failurePhase=cachedClientConnect', async () => {
        (ClustersClientMock.connectInteractive as Mock).mockRejectedValue(new Error('server down'));

        const item = new TestClusterItem(makeCluster(), makeClient(vi.fn()));

        await item.getChildren();

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            'Failed to connect to "My Cluster"',
            expect.objectContaining({ modal: true, detail: 'server down' }),
        );
        expect(mockTelemetryEvents).toHaveLength(1);
        expect(mockTelemetryEvents[0].eventName).toBe('connect');
        // azext's own (non-modal) display is suppressed so the user only sees the modal.
        expect(mockTelemetryEvents[0].suppressDisplay).toBe(true);
        expect(mockTelemetryEvents[0].properties).toMatchObject({
            connectionResult: 'failed',
            source: 'treeExpansion',
            experience: 'MongoDB',
            failurePhase: 'cachedClientConnect',
        });
    });

    it('returns an empty array (no retry node) when the user cancels the cached connection', async () => {
        (ClustersClientMock.connectInteractive as Mock).mockRejectedValue(new UserCancelledError());

        const item = new TestClusterItem(makeCluster(), makeClient(vi.fn()));

        const children = await item.getChildren();

        expect(children).toEqual([]);
        expect(item.hasRetryNode(children)).toBe(false);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(mockTelemetryEvents).toHaveLength(1);
        expect(mockTelemetryEvents[0].properties.connectionResult).toBe('cancelled');
    });
});

/**
 * `connect()` is the entry point for commands invoked straight from a context menu, where the
 * node may never have been expanded. It is shared base behaviour, so it is covered here rather
 * than in any one command's tests.
 */
describe('ClusterItemBase.connect', () => {
    /** Records the base hooks so we can assert which path `connect()` took. */
    class ConnectTestClusterItem extends ClusterItemBase {
        public authenticateCalls = 0;
        public beforeCachedCalls = 0;

        public constructor(
            cluster: TreeCluster<BaseClusterModel>,
            private readonly authResult: ClustersClient | null,
        ) {
            super(cluster);
        }

        protected authenticateAndConnect(): Promise<ClustersClient | null> {
            this.authenticateCalls += 1;
            return Promise.resolve(this.authResult);
        }

        protected override async beforeCachedClientConnect(): Promise<void> {
            this.beforeCachedCalls += 1;
        }

        public getCredentials(): Promise<EphemeralClusterCredentials | undefined> {
            return Promise.resolve(undefined);
        }
    }

    /**
     * A cluster whose tree position differs from its stable identity — the shape produced by a
     * connection that lives inside a folder. The two ids are deliberately different so that a
     * regression to `this.id` cannot pass.
     */
    function makeMovedCluster(): TreeCluster<BaseClusterModel> {
        return {
            treeId: 'connections/folder-a/cluster-1',
            clusterId: 'cluster-1',
            name: 'My Cluster',
            dbExperience: { api: 'MongoDB' } as unknown as Experience,
        } as unknown as TreeCluster<BaseClusterModel>;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockTelemetryEvents.length = 0;

        // jest-mock-vscode's withProgress is a no-op vi.fn(); make it run the task so the
        // cached path actually reaches ClustersClient.connectInteractive().
        (vscode.window.withProgress as unknown as Mock).mockImplementation(
            (
                _options: unknown,
                task: (
                    progress: unknown,
                    token: { isCancellationRequested: boolean; onCancellationRequested: Mock },
                ) => unknown,
            ) => task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
        );
    });

    it('reuses the cached client, and does not re-authenticate, when credentials are cached', async () => {
        mockHasCredentials.mockReturnValue(true);
        const cached = makeClient(vi.fn());
        const item = new ConnectTestClusterItem(makeCluster(), null);
        item.lastConnectionOutcome = 'canceled';
        item.lastConnectionCorrelationId = 'previous-attempt';
        ClustersClientMock.connectInteractive.mockImplementationOnce(
            async (_clusterId, _signal, onAttempt): Promise<ClustersClient> => {
                expect(item.lastConnectionOutcome).toBeUndefined();
                expect(item.lastConnectionCorrelationId).toBeUndefined();
                onAttempt?.('current-attempt');
                return cached;
            },
        );

        await expect(item.connect()).resolves.toBe(cached);
        expect(item.lastConnectionOutcome).toBe('connected');
        expect(item.lastConnectionCorrelationId).toBe('current-attempt');
        expect(item.authenticateCalls).toBe(0);
        // Subclasses such as Kubernetes restore a tunnel here; skipping it would reuse a dead client.
        expect(item.beforeCachedCalls).toBe(1);
        expect(vscode.window.withProgress).not.toHaveBeenCalled();
    });

    it('keys the credential cache and the client on clusterId, never on the tree position', async () => {
        mockHasCredentials.mockReturnValue(true);
        const cached = makeClient(vi.fn());
        (ClustersClientMock.connectInteractive as Mock).mockResolvedValue(cached);

        const cluster = makeMovedCluster();
        const item = new ConnectTestClusterItem(cluster, null);

        await item.connect();

        // `treeId` changes when a connection is dragged into a folder; `clusterId` does not.
        // Keying either lookup on the tree position opens a second, duplicate connection.
        expect(mockHasCredentials).toHaveBeenCalledWith(cluster.clusterId);
        expect(mockHasCredentials).not.toHaveBeenCalledWith(cluster.treeId);
        expect(ClustersClientMock.connectInteractive).toHaveBeenCalledWith(
            cluster.clusterId,
            expect.anything(),
            expect.any(Function),
            'treeConnect',
        );
    });

    it('authenticates when no credentials are cached, without preparing a cached client', async () => {
        mockHasCredentials.mockReturnValue(false);
        const fresh = makeClient(vi.fn());
        const item = new ConnectTestClusterItem(makeCluster(), fresh);

        await expect(item.connect()).resolves.toBe(fresh);
        expect(item.authenticateCalls).toBe(1);
        expect(item.beforeCachedCalls).toBe(0);
        expect(ClustersClientMock.connectInteractive).not.toHaveBeenCalled();
    });

    it('returns null when the user cancels the progress notification on the cached path', async () => {
        mockHasCredentials.mockReturnValue(true);
        (ClustersClientMock.connectInteractive as Mock).mockRejectedValue(new UserCancelledError());

        const item = new ConnectTestClusterItem(makeCluster(), null);

        // Dismissing "Connecting to …" is a request for nothing to happen. Letting it escape
        // would report the user's own cancellation back to them as a command failure.
        await expect(item.connect()).resolves.toBeNull();
        expect(item.lastConnectionOutcome).toBe('canceled');
    });

    it('propagates a genuine failure on the cached path so the command can report it', async () => {
        mockHasCredentials.mockReturnValue(true);
        (ClustersClientMock.connectInteractive as Mock).mockRejectedValue(new Error('server down'));

        const item = new ConnectTestClusterItem(makeCluster(), null);

        // Only cancellation is swallowed; a real failure must not look like a quiet abort.
        await expect(item.connect()).rejects.toThrow('server down');
    });

    it('reports a cached destination rejection through the same modal without reauthenticating', async (): Promise<void> => {
        mockHasCredentials.mockReturnValue(true);
        ClustersClientMock.connectInteractive.mockRejectedValue(
            new EntraDestinationRejectedError({ firstHost: 'other.example.com', hostCount: 1 }),
        );
        const item = new ConnectTestClusterItem(makeMovedCluster(), null);

        await expect(item.connect()).resolves.toBeNull();

        expect(item.lastConnectionFailureReason).toBe('entraDestinationRejected');
        expect(item.authenticateCalls).toBe(0);
        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
            "Microsoft Entra ID isn't allowed for this server.",
            expect.objectContaining({ modal: true }),
            'Learn More',
        );
        expect(mockTelemetryEvents).toEqual([
            {
                eventName: 'connect',
                suppressDisplay: true,
                properties: {
                    connectionResult: 'failed',
                    experience: item.experience.api,
                    failurePhase: 'cachedClientConnect',
                    diagnosisProviderId: 'none',
                },
            },
        ]);
    });

    it.each(['connected', 'canceled', 'failed'] as const)(
        'clears stale %s outcome and correlation before an unclassified authentication result',
        async (previousOutcome): Promise<void> => {
            mockHasCredentials.mockReturnValue(false);
            const item = new ConnectTestClusterItem(makeCluster(), null);
            item.lastConnectionOutcome = previousOutcome;
            item.lastConnectionCorrelationId = 'previous-attempt';
            mockHasCredentials.mockImplementationOnce((): boolean => {
                expect(item.lastConnectionOutcome).toBeUndefined();
                expect(item.lastConnectionCorrelationId).toBeUndefined();
                return false;
            });

            await expect(item.connect()).resolves.toBeNull();

            expect(item.authenticateCalls).toBe(1);
            expect(item.lastConnectionOutcome).toBeUndefined();
            expect(item.lastConnectionCorrelationId).toBeUndefined();
        },
    );

    it('returns null when authentication fails or the user cancels the prompt', async () => {
        mockHasCredentials.mockReturnValue(false);

        const item = new ConnectTestClusterItem(makeCluster(), null);

        // Callers abort quietly on null: the authentication flow has already reported the reason.
        await expect(item.connect()).resolves.toBeNull();
        expect(item.authenticateCalls).toBe(1);
    });
});
