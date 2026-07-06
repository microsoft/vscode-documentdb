/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type ClustersClient, type DatabaseItemModel } from '../../documentdb/ClustersClient';
import { ShellCommandIds } from '../../documentdb/shell/constants';
import { type Experience } from '../../DocumentDBExperiences';
import { type BaseClusterModel, type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElement } from '../TreeElement';
import { ClusterItemBase, type EphemeralClusterCredentials } from './ClusterItemBase';

// Captures telemetry events emitted via callWithTelemetryAndErrorHandling when its callback throws.
const mockTelemetryEvents: Array<{ eventName: string; properties: Record<string, string>; suppressDisplay?: boolean }> =
    [];

jest.mock('@microsoft/vscode-azext-utils', () => ({
    UserCancelledError: class UserCancelledError extends Error {},
    callWithTelemetryAndErrorHandling: jest.fn(
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

jest.mock('../api/createGenericElementWithContext', () => ({
    createGenericElementWithContext: (opts: Record<string, unknown>) => ({ ...opts }),
}));

const mockHasCredentials = jest.fn().mockReturnValue(false);
jest.mock('../../documentdb/CredentialCache', () => ({
    CredentialCache: {
        hasCredentials: (...args: unknown[]) => mockHasCredentials(...args),
    },
}));

jest.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { getClient: jest.fn() },
}));

jest.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: jest.fn(),
            debug: jest.fn(),
        },
    },
}));

jest.mock('./DatabaseItem', () => ({
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

function makeCluster(): TreeCluster<BaseClusterModel> {
    return {
        treeId: 'cluster-1',
        clusterId: 'cluster-1',
        name: 'My Cluster',
        dbExperience: { api: 'MongoDB' } as unknown as Experience,
    } as unknown as TreeCluster<BaseClusterModel>;
}

function makeClient(listDatabases: jest.Mock): ClustersClient {
    return { listDatabases } as unknown as ClustersClient;
}

describe('ClusterItemBase.getChildren — listDatabases failure handling', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockTelemetryEvents.length = 0;
        mockHasCredentials.mockReturnValue(false);
    });

    it('returns a retry node (and records telemetry) when listDatabases is rejected', async () => {
        const listDatabases = jest
            .fn()
            .mockRejectedValue(
                new Error('Command listDatabases is not allowed as the connection is not authenticated yet'),
            );
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        const children = (await item.getChildren()) as Array<TreeElement & Record<string, unknown>>;

        expect(children).toHaveLength(2);
        expect(children[0].id).toBe('cluster-1/retry');
        expect(children[0].contextValue).toBe('error');
        expect(children[0].commandId).toBe('vscode-documentdb.command.internal.retry');
        expect(children[0].commandArgs).toEqual([item]);

        expect(children[1].id).toBe('cluster-1/open-shell');
        expect(children[1].contextValue).toBe('error');
        expect(children[1].label).toBe('Click here to open the shell');
        expect(children[1].commandId).toBe(ShellCommandIds.open);
        expect(children[1].commandArgs).toEqual([item]);

        // The branch data provider detects (and caches) the error state via hasRetryNode().
        expect(item.hasRetryNode(children)).toBe(true);
    });

    it('surfaces the failure as a modal dialog and suppresses the default non-modal notification', async () => {
        const listDatabases = jest.fn().mockRejectedValue(new Error('not authenticated'));
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
        const listDatabases = jest.fn().mockRejectedValue(new Error('not authenticated'));
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
        const listDatabases = jest.fn().mockResolvedValue([{ name: 'beta' }, { name: 'alpha' }] as DatabaseItemModel[]);
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        const children = (await item.getChildren()) as Array<TreeElement & Record<string, unknown>>;

        expect(children).toHaveLength(2);
        // Sorted alphabetically by name.
        expect(children.map((c) => c.id)).toEqual(['alpha', 'beta']);
        expect(item.hasRetryNode(children)).toBe(false);
        expect(mockTelemetryEvents).toHaveLength(0);
    });

    it('returns the "Create Database…" node when the cluster has no databases', async () => {
        const listDatabases = jest.fn().mockResolvedValue([] as DatabaseItemModel[]);
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
        jest.clearAllMocks();
        mockTelemetryEvents.length = 0;
        // Simulate cached credentials so getChildren() takes the "reuse cached client" path.
        mockHasCredentials.mockReturnValue(true);

        // jest-mock-vscode's withProgress is a no-op jest.fn(); make it actually run the task so
        // getClientWithProgress() exercises ClustersClient.getClient() and surfaces its rejection.
        (vscode.window.withProgress as unknown as jest.Mock).mockImplementation(
            (
                _options: unknown,
                task: (
                    progress: unknown,
                    token: { isCancellationRequested: boolean; onCancellationRequested: jest.Mock },
                ) => unknown,
            ) => task({ report: jest.fn() }, { isCancellationRequested: false, onCancellationRequested: jest.fn() }),
        );
    });

    it('returns a retry node when reusing the cached client fails (without listing databases)', async () => {
        const { ClustersClient: ClustersClientMock } = jest.requireMock('../../documentdb/ClustersClient');
        (ClustersClientMock.getClient as jest.Mock).mockRejectedValue(new Error('server down'));

        // listDatabases must never be reached when the cached client cannot connect.
        const listDatabases = jest.fn();
        const item = new TestClusterItem(makeCluster(), makeClient(listDatabases));

        const children = (await item.getChildren()) as Array<TreeElement & Record<string, unknown>>;

        expect(children).toHaveLength(1);
        expect(children[0].id).toBe('cluster-1/retry');
        expect(children[0].contextValue).toBe('error');
        expect(children[0].commandId).toBe('vscode-documentdb.command.internal.retry');
        expect(children[0].commandArgs).toEqual([item]);
        expect(item.hasRetryNode(children)).toBe(true);
        expect(listDatabases).not.toHaveBeenCalled();
    });

    it('surfaces a modal and records telemetry with failurePhase=cachedClientConnect', async () => {
        const { ClustersClient: ClustersClientMock } = jest.requireMock('../../documentdb/ClustersClient');
        (ClustersClientMock.getClient as jest.Mock).mockRejectedValue(new Error('server down'));

        const item = new TestClusterItem(makeCluster(), makeClient(jest.fn()));

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
        const { UserCancelledError } = jest.requireMock('@microsoft/vscode-azext-utils');
        const { ClustersClient: ClustersClientMock } = jest.requireMock('../../documentdb/ClustersClient');
        (ClustersClientMock.getClient as jest.Mock).mockRejectedValue(new UserCancelledError());

        const item = new TestClusterItem(makeCluster(), makeClient(jest.fn()));

        const children = await item.getChildren();

        expect(children).toEqual([]);
        expect(item.hasRetryNode(children)).toBe(false);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
        expect(mockTelemetryEvents).toHaveLength(1);
        expect(mockTelemetryEvents[0].properties.connectionResult).toBe('cancelled');
    });
});
