/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CosmosDBMongoRUExperience, DocumentDBExperience } from '../../DocumentDBExperiences';
import { ClustersClient } from '../../documentdb/ClustersClient';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { type TreeElement } from '../TreeElement';
import { type AzureClusterModel } from '../azure-views/models/AzureClusterModel';
import { type TreeCluster } from '../models/BaseClusterModel';
import {
    type DiscoveryRevealRequest,
    revealInDiscoveryView,
    waitForDiscoveryViewReady,
} from './discoveryViewHelpers';

vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: { info: vi.fn(), trace: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), appendLine: vi.fn() },
        discoveryBranchDataProvider: { getChildren: vi.fn(), findNodeById: vi.fn() },
        discoveryTreeView: { reveal: vi.fn() },
    },
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { exists: vi.fn() },
}));

interface FakeClusterNode extends TreeElement {
    readonly cluster: TreeCluster<AzureClusterModel>;
}

const missingTargetMessage =
    'URL handling aborted. Connection was unsuccessful or the specified database/collection does not exist.';
const getChildren = vi.mocked(ext.discoveryBranchDataProvider.getChildren);
const findNodeById = vi.mocked(ext.discoveryBranchDataProvider.findNodeById);
const reveal = vi.mocked(ext.discoveryTreeView.reveal);
const exists = vi.mocked(ClustersClient.exists);

function createNode(id: string): TreeElement {
    return { id, getTreeItem: (): vscode.TreeItem => ({ id }) };
}

function createContext(): IActionContext {
    return { telemetry: { properties: {}, measurements: {} } } as unknown as IActionContext;
}

describe('Discovery view helpers', () => {
    let context: IActionContext;
    let request: DiscoveryRevealRequest;
    let rootNode: TreeElement;
    let subscriptionNode: TreeElement;
    let clusterNode: FakeClusterNode;
    let databaseNode: TreeElement & { readonly databaseInfo: { readonly name: string } };
    let collectionNode: TreeElement & { readonly collectionInfo: { readonly name: string } };
    let children: Map<TreeElement | undefined, TreeElement[]>;

    beforeEach(() => {
        vi.clearAllMocks();
        context = createContext();
        request = {
            providerId: 'azure-mongo-vcore-discovery',
            subscriptionId: 'subscription-a',
            azureResourceId:
                '/subscriptions/subscription-a/resourceGroups/dev-rg/providers/Microsoft.DocumentDB/mongoClusters/example',
            displayName: 'example',
        };
        rootNode = createNode('discoveryView/azure-mongo-vcore-discovery');
        subscriptionNode = createNode(`${rootNode.id}/SUBSCRIPTION-A`);
        clusterNode = {
            ...createNode('discoveryView/opaque-cluster-tree-id'),
            cluster: {
                name: request.displayName,
                clusterId: 'azure-mongo-vcore-discovery_stable-cache-key',
                treeId: 'discoveryView/opaque-cluster-tree-id',
                viewId: Views.DiscoveryView,
                dbExperience: DocumentDBExperience,
                azureResourceId: request.azureResourceId.replace('dev-rg', 'Dev-RG'),
            },
        };
        databaseNode = { ...createNode(`${clusterNode.id}/db`), databaseInfo: { name: 'db' } };
        collectionNode = { ...createNode(`${databaseNode.id}/products`), collectionInfo: { name: 'products' } };
        children = new Map([
            [undefined, [createNode('discoveryView/other-provider'), rootNode]],
            [rootNode, [createNode(`${rootNode.id}/other-subscription`), subscriptionNode]],
            [subscriptionNode, [createNode('not-a-cluster'), clusterNode]],
        ]);
        getChildren.mockImplementation(async (node: TreeElement): Promise<TreeElement[]> => children.get(node) ?? []);
        findNodeById.mockImplementation(async (id: string): Promise<TreeElement | undefined> =>
            [databaseNode, collectionNode].find((node): boolean => node.id === id),
        );
        reveal.mockResolvedValue(undefined);
        exists.mockReturnValue(true);
        vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
        vi.mocked(vscode.window.withProgress).mockImplementation(
            async <T>(
                _options: vscode.ProgressOptions,
                task: (
                    progress: vscode.Progress<{ message?: string; increment?: number }>,
                    token: vscode.CancellationToken,
                ) => Thenable<T>,
            ): Promise<T> => task({ report: vi.fn() }, new vscode.CancellationTokenSource().token),
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('matches the ARM resource id case-insensitively and expands the cluster once', async () => {
        exists.mockImplementation((clusterId: string): boolean => {
            expect(clusterId).toBe(clusterNode.cluster.clusterId);
            expect(getChildren).not.toHaveBeenCalledWith(clusterNode);
            expect(reveal.mock.calls).toEqual([[clusterNode, { select: true, focus: true, expand: true }]]);
            return true;
        });

        const result = await revealInDiscoveryView(context, request);

        expect(result).toEqual({ clusterNode, clusterId: clusterNode.cluster.clusterId, databaseNode: undefined });
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Discovery view ready: attempts=1');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Cluster node found');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Cluster connected');
        const logged = vi.mocked(ext.outputChannel.trace).mock.calls.flat().join(' ');
        expect(logged).not.toContain(request.subscriptionId);
        expect(logged).not.toContain(request.azureResourceId);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('discoveryView.focus');
        expect(getChildren.mock.calls.map(([node]) => node)).toEqual([
            undefined,
            undefined,
            rootNode,
            subscriptionNode,
        ]);
        expect(reveal.mock.calls).toEqual([[clusterNode, { select: true, focus: true, expand: true }]]);
        expect(findNodeById).not.toHaveBeenCalled();
        expect(vscode.window.withProgress).toHaveBeenNthCalledWith(
            1,
            { location: vscode.ProgressLocation.Notification, title: 'Opening example…', cancellable: false },
            expect.any(Function),
        );
        expect(vscode.window.withProgress).toHaveBeenNthCalledWith(
            2,
            { location: { viewId: Views.DiscoveryView }, cancellable: false },
            expect.any(Function),
        );
    });

    it('waits for cluster expansion before checking the client', async () => {
        exists.mockReturnValue(false);
        reveal.mockImplementation(async (): Promise<void> => {
            await Promise.resolve();
            expect(exists).not.toHaveBeenCalled();
            exists.mockReturnValue(true);
        });

        expect(await revealInDiscoveryView(context, request)).toEqual({
            clusterNode,
            clusterId: clusterNode.cluster.clusterId,
            databaseNode: undefined,
        });
        expect(reveal).toHaveBeenCalledExactlyOnceWith(clusterNode, { select: true, focus: true, expand: true });
        expect(getChildren).not.toHaveBeenCalledWith(clusterNode);
    });

    it('also resolves an Azure Cosmos DB for MongoDB RU cluster', async () => {
        request = {
            ...request,
            providerId: 'azure-mongo-ru-discovery',
            azureResourceId:
                '/subscriptions/subscription-a/resourceGroups/dev-rg/providers/Microsoft.DocumentDB/databaseAccounts/example',
        };
        rootNode = createNode('discoveryView/azure-mongo-ru-discovery');
        subscriptionNode = createNode(`${rootNode.id}/SUBSCRIPTION-A`);
        children.set(undefined, [rootNode]);
        children.set(rootNode, [subscriptionNode]);
        children.set(subscriptionNode, [clusterNode]);
        clusterNode.cluster.azureResourceId = request.azureResourceId.replace('dev-rg', 'Dev-RG');
        clusterNode.cluster.clusterId = 'azure-mongo-ru-discovery_stable-cache-key';
        clusterNode.cluster.dbExperience = CosmosDBMongoRUExperience;

        expect(await revealInDiscoveryView(context, request)).toMatchObject({
            clusterNode,
            clusterId: clusterNode.cluster.clusterId,
        });
    });

    it('reports a clear error when the cluster resource is missing', async () => {
        children.set(subscriptionNode, [createNode('not-a-cluster')]);

        await expect(revealInDiscoveryView(context, request)).rejects.toThrow(
            'Could not find example in the Discovery view. It may have been deleted, or a filter may still hide it.',
        );
        expect(reveal).not.toHaveBeenCalled();
        expect(exists).not.toHaveBeenCalled();
    });

    it('returns undefined with the cluster expanded and no database lookup when no client exists', async () => {
        exists.mockReturnValue(false);

        const result = await revealInDiscoveryView(context, { ...request, database: 'db' });

        expect(result).toBeUndefined();
        expect(getChildren).not.toHaveBeenCalledWith(clusterNode);
        expect(reveal.mock.calls).toEqual([[clusterNode, { select: true, focus: false, expand: true }]]);
        expect(getChildren).not.toHaveBeenCalledWith(databaseNode);
        expect(findNodeById).not.toHaveBeenCalled();
        expect(exists).toHaveBeenCalledWith(clusterNode.cluster.clusterId);
    });

    it('finds a database by its tree id and returns the database node', async () => {
        const result = await revealInDiscoveryView(context, { ...request, database: 'db' });

        expect(result).toEqual({ clusterNode, clusterId: clusterNode.cluster.clusterId, databaseNode });
        expect(findNodeById).toHaveBeenCalledExactlyOnceWith(`${clusterNode.id}/db`);
        expect(reveal.mock.calls).toEqual([
            [clusterNode, { select: true, focus: false, expand: true }],
            [databaseNode, { select: true, focus: true, expand: true }],
        ]);
        expect(getChildren).not.toHaveBeenCalledWith(clusterNode);
        expect(getChildren).not.toHaveBeenCalledWith(databaseNode);
    });

    it('reports the existing URL error when the requested database is missing', async () => {
        await expect(
            revealInDiscoveryView(context, { ...request, database: 'missing-database' }),
        ).rejects.toThrow(missingTargetMessage);
        expect(findNodeById).toHaveBeenCalledExactlyOnceWith(`${clusterNode.id}/missing-database`);
        expect(reveal).toHaveBeenCalledExactlyOnceWith(clusterNode, { select: true, focus: false, expand: true });
    });

    it('finds a requested collection by its tree id after expanding the database', async () => {
        findNodeById.mockImplementation(async (id: string): Promise<TreeElement | undefined> => {
            if (id === databaseNode.id) {
                expect(reveal.mock.calls).toEqual([[clusterNode, { select: true, focus: false, expand: true }]]);
                return databaseNode;
            }
            expect(reveal).toHaveBeenLastCalledWith(databaseNode, { select: true, focus: false, expand: true });
            return id === collectionNode.id ? collectionNode : undefined;
        });
        const result = await revealInDiscoveryView(context, {
            ...request,
            database: 'db',
            collection: 'products',
        });

        expect(result?.databaseNode).toBe(databaseNode);
        expect(findNodeById.mock.calls).toEqual([[`${clusterNode.id}/db`], [`${databaseNode.id}/products`]]);
        expect(reveal.mock.calls).toEqual([
            [clusterNode, { select: true, focus: false, expand: true }],
            [databaseNode, { select: true, focus: false, expand: true }],
            [collectionNode, { select: true, focus: true, expand: true }],
        ]);
        expect(getChildren).not.toHaveBeenCalledWith(clusterNode);
        expect(getChildren).not.toHaveBeenCalledWith(databaseNode);
    });

    it('reports the existing URL error when the requested collection is missing', async () => {
        await expect(
            revealInDiscoveryView(context, { ...request, database: 'db', collection: 'missing-collection' }),
        ).rejects.toThrow(missingTargetMessage);
        expect(findNodeById.mock.calls).toEqual([[`${clusterNode.id}/db`], [`${databaseNode.id}/missing-collection`]]);
        expect(reveal.mock.calls).toEqual([
            [clusterNode, { select: true, focus: false, expand: true }],
            [databaseNode, { select: true, focus: false, expand: true }],
        ]);
    });

    it('records readiness telemetry when the root is available, even when empty', async () => {
        getChildren.mockResolvedValue(null);

        await waitForDiscoveryViewReady(context);

        expect(getChildren).toHaveBeenCalledWith(undefined);
        expect(context.telemetry.measurements.discoveryViewActivationTimeMs).toBeGreaterThanOrEqual(0);
        expect(context.telemetry.measurements.discoveryViewActivationAttempts).toBe(1);
        expect(context.telemetry.properties.discoveryViewActivationResult).toBe('success');
    });

    it('retries unavailable roots and records the successful attempt', async () => {
        vi.useFakeTimers();
        getChildren.mockRejectedValueOnce(new Error('Not ready')).mockResolvedValueOnce(undefined);

        const ready = waitForDiscoveryViewReady(context);
        await vi.runAllTimersAsync();
        await ready;

        expect(context.telemetry.measurements.discoveryViewActivationTimeMs).toBe(1250);
        expect(context.telemetry.measurements.discoveryViewActivationAttempts).toBe(3);
        expect(context.telemetry.properties.discoveryViewActivationResult).toBe('success');
    });

    it('records a timeout and continues optimistically after the maximum attempts', async () => {
        vi.useFakeTimers();
        getChildren.mockResolvedValue(undefined);

        const ready = waitForDiscoveryViewReady(context, 2);
        await vi.runAllTimersAsync();
        await ready;

        expect(getChildren).toHaveBeenCalledTimes(2);
        expect(context.telemetry.measurements.discoveryViewActivationTimeMs).toBe(1250);
        expect(context.telemetry.measurements.discoveryViewActivationAttempts).toBe(2);
        expect(context.telemetry.properties.discoveryViewActivationResult).toBe('timeout');
    });
});
