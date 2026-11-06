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
import * as dashboardSuppression from '../documentdb/autoOpenDashboardSuppression';
import { type TreeCluster } from '../models/BaseClusterModel';
import { type DiscoveryRevealRequest, revealInDiscoveryView, waitForDiscoveryViewReady } from './discoveryViewHelpers';

vi.mock('../../extensionVariables', () => ({
    ext: {
        outputChannel: {
            info: vi.fn(),
            trace: vi.fn(),
            debug: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            appendLine: vi.fn(),
        },
        discoveryBranchDataProvider: {
            getChildren: vi.fn(),
            getCachedChildren: vi.fn(),
            hasNodeErrorState: vi.fn(),
            resetNodeErrorState: vi.fn(),
            refresh: vi.fn(),
            findNodeById: vi.fn(),
            findChildById: vi.fn(),
        },
        discoveryTreeView: { reveal: vi.fn() },
    },
}));

vi.mock('../../documentdb/ClustersClient', () => ({
    ClustersClient: { exists: vi.fn() },
}));

interface FakeClusterNode extends TreeElement {
    readonly cluster: TreeCluster<AzureClusterModel>;
}

const getChildren = vi.mocked(ext.discoveryBranchDataProvider.getChildren);
const getCachedChildren = vi.mocked(ext.discoveryBranchDataProvider.getCachedChildren);
const hasNodeErrorState = vi.mocked(ext.discoveryBranchDataProvider.hasNodeErrorState);
const resetNodeErrorState = vi.mocked(ext.discoveryBranchDataProvider.resetNodeErrorState);
const refresh = vi.mocked(ext.discoveryBranchDataProvider.refresh);
const findNodeById = vi.mocked(ext.discoveryBranchDataProvider.findNodeById);
const findChildById = vi.mocked(ext.discoveryBranchDataProvider.findChildById);
const reveal = vi.mocked(ext.discoveryTreeView.reveal);
const exists = vi.mocked(ClustersClient.exists);
const suppressDashboard = vi.spyOn(dashboardSuppression, 'suppressAutoOpenDashboard');

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
        getCachedChildren.mockImplementation((node: TreeElement): TreeElement[] => children.get(node) ?? []);
        findNodeById.mockImplementation(
            async (id: string): Promise<TreeElement | undefined> =>
                [databaseNode, collectionNode].find((node): boolean => node.id === id),
        );
        hasNodeErrorState.mockReturnValue(false);
        findChildById.mockResolvedValue(undefined);
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
            ): Promise<T> =>
                task({ report: vi.fn() }, { isCancellationRequested: false, onCancellationRequested: vi.fn() }),
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('suppresses only the expanding cluster reveal and releases before subsequent work', async (): Promise<void> => {
        reveal.mockImplementation(async (node, options): Promise<void> => {
            expect(dashboardSuppression.isAutoOpenDashboardSuppressed(clusterNode.cluster.clusterId)).toBe(
                node === clusterNode && options?.expand === true,
            );
            expect(dashboardSuppression.isAutoOpenDashboardSuppressed(clusterNode.id)).toBe(false);
            await Promise.resolve();
            expect(dashboardSuppression.isAutoOpenDashboardSuppressed(clusterNode.cluster.clusterId)).toBe(
                node === clusterNode && options?.expand === true,
            );
        });
        exists.mockImplementation((): boolean => {
            expect(dashboardSuppression.isAutoOpenDashboardSuppressed(clusterNode.cluster.clusterId)).toBe(false);
            return true;
        });

        await revealInDiscoveryView(context, { ...request, database: 'db', suppressAutoOpenDashboard: true });

        expect(suppressDashboard).toHaveBeenCalledExactlyOnceWith(clusterNode.cluster.clusterId);
        expect(dashboardSuppression.isAutoOpenDashboardSuppressed(clusterNode.cluster.clusterId)).toBe(false);
    });

    it('releases suppression when the expanding reveal throws', async (): Promise<void> => {
        const error = new Error('reveal failed');
        reveal.mockImplementation(async (node, options): Promise<void> => {
            if (node === clusterNode && options?.expand) {
                expect(dashboardSuppression.isAutoOpenDashboardSuppressed(clusterNode.cluster.clusterId)).toBe(true);
                throw error;
            }
        });

        await expect(revealInDiscoveryView(context, { ...request, suppressAutoOpenDashboard: true })).rejects.toBe(
            error,
        );

        expect(suppressDashboard).toHaveBeenCalledExactlyOnceWith(clusterNode.cluster.clusterId);
        expect(dashboardSuppression.isAutoOpenDashboardSuppressed(clusterNode.cluster.clusterId)).toBe(false);
    });

    it.each([undefined, false])(
        'does not suppress the dashboard when the flag is %s',
        async (suppressAutoOpenDashboard): Promise<void> => {
            reveal.mockImplementation(async (): Promise<void> => {
                expect(dashboardSuppression.isAutoOpenDashboardSuppressed(clusterNode.cluster.clusterId)).toBe(false);
            });

            await revealInDiscoveryView(context, { ...request, suppressAutoOpenDashboard });

            expect(suppressDashboard).not.toHaveBeenCalled();
        },
    );

    it('matches the ARM resource id case-insensitively and expands the cluster once', async () => {
        exists.mockImplementation((clusterId: string): boolean => {
            expect(clusterId).toBe(clusterNode.cluster.clusterId);
            expect(getChildren).not.toHaveBeenCalledWith(clusterNode);
            expect(reveal.mock.calls).toEqual([
                [rootNode, { select: false, focus: false, expand: true }],
                [subscriptionNode, { select: false, focus: false, expand: true }],
                [clusterNode, { select: true, focus: false, expand: false }],
                [clusterNode, { select: true, focus: true, expand: true }],
            ]);
            return true;
        });

        const result = await revealInDiscoveryView(context, request);

        expect(result).toEqual({ clusterNode, clusterId: clusterNode.cluster.clusterId, databaseNode: undefined });
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Discovery view ready: attempts=1');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Cluster node found');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Showing the cluster in the Discovery view');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Cluster connected');
        const logged = vi.mocked(ext.outputChannel.trace).mock.calls.flat().join(' ');
        expect(logged).not.toContain(request.subscriptionId);
        expect(logged).not.toContain(request.azureResourceId);
        expect(vscode.commands.executeCommand).toHaveBeenCalledWith('discoveryView.focus');
        expect(getChildren.mock.calls).toEqual([[undefined], [undefined]]);
        expect(getCachedChildren.mock.calls).toEqual([[rootNode], [subscriptionNode]]);
        expect(reveal.mock.calls).toEqual([
            [rootNode, { select: false, focus: false, expand: true }],
            [subscriptionNode, { select: false, focus: false, expand: true }],
            [clusterNode, { select: true, focus: false, expand: false }],
            [clusterNode, { select: true, focus: true, expand: true }],
        ]);
        expect(findNodeById).not.toHaveBeenCalled();
        expect(vscode.window.withProgress).toHaveBeenCalledExactlyOnceWith(
            { location: { viewId: Views.DiscoveryView }, cancellable: false },
            expect.any(Function),
        );
    });

    it('reads each cached level only after its expansion has completed', async (): Promise<void> => {
        const loadedChildren = new Map<TreeElement, TreeElement[]>();
        getCachedChildren.mockImplementation((node: TreeElement): TreeElement[] => loadedChildren.get(node) ?? []);
        reveal.mockImplementation(async (node): Promise<void> => {
            await Promise.resolve();
            loadedChildren.set(node, children.get(node) ?? []);
        });

        expect(await revealInDiscoveryView(context, request)).toMatchObject({ clusterNode });
        expect(getCachedChildren.mock.calls).toEqual([[rootNode], [subscriptionNode]]);
        expect(getChildren.mock.calls).toEqual([[undefined], [undefined]]);
    });

    it.each(['Provider root', 'Subscription'] as const)(
        'loads %s children directly once when an already-expanded node has no cached children',
        async (level): Promise<void> => {
            const uncachedNode = level === 'Provider root' ? rootNode : subscriptionNode;
            getCachedChildren.mockImplementation((node: TreeElement): TreeElement[] =>
                node === uncachedNode ? [] : (children.get(node) ?? []),
            );
            getChildren.mockImplementation(async (node: TreeElement): Promise<TreeElement[]> => {
                if (node === uncachedNode) {
                    expect(reveal).toHaveBeenLastCalledWith(node, { select: false, focus: false, expand: true });
                }
                return children.get(node) ?? [];
            });

            expect(await revealInDiscoveryView(context, request)).toMatchObject({ clusterNode });
            expect(getCachedChildren.mock.calls).toEqual([[rootNode], [subscriptionNode]]);
            expect(getChildren.mock.calls).toEqual([[undefined], [undefined], [uncachedNode]]);
            expect(ext.outputChannel.trace).toHaveBeenCalledWith(
                `[DeepLink] ${level} children not cached (already expanded); loading directly`,
            );
        },
    );

    it('resets only the failed provider root before revealing it and reloads stale retry children', async (): Promise<void> => {
        hasNodeErrorState.mockImplementation((id: string): boolean => id === rootNode.id);
        getCachedChildren.mockImplementation((node: TreeElement): TreeElement[] =>
            node === rootNode ? [createNode(`${rootNode.id}/retry`)] : (children.get(node) ?? []),
        );

        expect(await revealInDiscoveryView(context, request)).toMatchObject({ clusterNode });

        expect(hasNodeErrorState).toHaveBeenNthCalledWith(1, rootNode.id);
        expect(resetNodeErrorState).toHaveBeenCalledExactlyOnceWith(rootNode.id);
        expect(refresh).toHaveBeenCalledExactlyOnceWith(rootNode);
        expect(resetNodeErrorState.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
        expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(reveal.mock.invocationCallOrder[0]);
        expect(reveal).toHaveBeenNthCalledWith(1, rootNode, { select: false, focus: false, expand: true });
        expect(getChildren.mock.calls).toEqual([[undefined], [undefined], [rootNode]]);
        expect(reveal.mock.invocationCallOrder[0]).toBeLessThan(getChildren.mock.invocationCallOrder[2]);
        expect(reveal).toHaveBeenNthCalledWith(2, subscriptionNode, { select: false, focus: false, expand: true });
        expect(ext.outputChannel.trace).toHaveBeenCalledWith(
            '[DeepLink] Resetting the Discovery provider root error state',
        );
    });

    it('preserves cached subscription navigation without resetting or refreshing a healthy provider root', async (): Promise<void> => {
        expect(await revealInDiscoveryView(context, request)).toMatchObject({ clusterNode });

        expect(hasNodeErrorState).toHaveBeenNthCalledWith(1, rootNode.id);
        expect(resetNodeErrorState).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
        expect(getChildren.mock.calls).toEqual([[undefined], [undefined]]);
        expect(getCachedChildren.mock.calls).toEqual([[rootNode], [subscriptionNode]]);
        expect(reveal).toHaveBeenNthCalledWith(1, rootNode, { select: false, focus: false, expand: true });
        expect(reveal).toHaveBeenNthCalledWith(2, subscriptionNode, { select: false, focus: false, expand: true });
    });

    it('resets a failed cluster before revealing and expanding it', async (): Promise<void> => {
        hasNodeErrorState.mockImplementation(
            (id: string): boolean => id === clusterNode.id && resetNodeErrorState.mock.calls.length === 0,
        );

        expect(await revealInDiscoveryView(context, request)).toMatchObject({ clusterNode });

        expect(resetNodeErrorState).toHaveBeenCalledExactlyOnceWith(clusterNode.id);
        expect(refresh).toHaveBeenCalledExactlyOnceWith(clusterNode);
        expect(resetNodeErrorState.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0]);
        expect(refresh.mock.invocationCallOrder[0]).toBeLessThan(reveal.mock.invocationCallOrder[2]);
        expect(reveal).toHaveBeenNthCalledWith(4, clusterNode, { select: true, focus: true, expand: true });
        expect(ext.outputChannel.trace).toHaveBeenCalledWith('[DeepLink] Resetting the cluster error state');
    });

    it('does not reset or refresh a healthy cluster', async (): Promise<void> => {
        expect(await revealInDiscoveryView(context, request)).toMatchObject({ clusterNode });

        expect(hasNodeErrorState.mock.calls).toEqual([[rootNode.id], [clusterNode.id], [clusterNode.id]]);
        expect(resetNodeErrorState).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });

    it('stops without looking up the database when cluster expansion fails', async (): Promise<void> => {
        let clusterExpansionFailed = false;
        hasNodeErrorState.mockImplementation((id: string): boolean => id === clusterNode.id && clusterExpansionFailed);
        reveal.mockImplementation(async (node, options): Promise<void> => {
            if (node === clusterNode && options?.expand) {
                clusterExpansionFailed = true;
            }
        });

        expect(await revealInDiscoveryView(context, { ...request, database: 'db' })).toBeUndefined();

        expect(context.telemetry.properties.openTargetResult).toBe('skippedClusterError');
        expect(ext.outputChannel.trace).toHaveBeenCalledWith(
            '[DeepLink] Cluster expansion failed; the node already explained why',
        );
        expect(exists).not.toHaveBeenCalled();
        expect(findNodeById).not.toHaveBeenCalled();
        expect(findChildById).not.toHaveBeenCalled();
    });

    it('waits for cluster expansion before checking the client', async () => {
        exists.mockReturnValue(false);
        reveal.mockImplementation(async (_node, options): Promise<void> => {
            await Promise.resolve();
            expect(exists).not.toHaveBeenCalled();
            if (_node === clusterNode && options?.expand) {
                exists.mockReturnValue(true);
            }
        });

        expect(await revealInDiscoveryView(context, request)).toEqual({
            clusterNode,
            clusterId: clusterNode.cluster.clusterId,
            databaseNode: undefined,
        });
        expect(reveal.mock.calls).toEqual([
            [rootNode, { select: false, focus: false, expand: true }],
            [subscriptionNode, { select: false, focus: false, expand: true }],
            [clusterNode, { select: true, focus: false, expand: false }],
            [clusterNode, { select: true, focus: true, expand: true }],
        ]);
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

    it('reports a clear error when the provider root is missing', async (): Promise<void> => {
        children.set(undefined, [createNode('discoveryView/other-provider')]);

        await expect(revealInDiscoveryView(context, request)).rejects.toThrow(
            'Could not find example in the Discovery view. It may have been deleted, or a filter may still hide it. Check the filters on the provider in the Discovery view, then open the link again.',
        );
        expect(reveal).not.toHaveBeenCalled();
        expect(getCachedChildren).not.toHaveBeenCalled();
        expect(exists).not.toHaveBeenCalled();
    });

    it('reports a clear error when the subscription is missing from the cache', async (): Promise<void> => {
        children.set(rootNode, [createNode(`${rootNode.id}/other-subscription`)]);

        await expect(revealInDiscoveryView(context, request)).rejects.toThrow(
            'Could not find example in the Discovery view. It may have been deleted, or a filter may still hide it. Check the filters on the provider in the Discovery view, then open the link again.',
        );
        expect(reveal).toHaveBeenCalledExactlyOnceWith(rootNode, { select: false, focus: false, expand: true });
        expect(getCachedChildren).toHaveBeenCalledExactlyOnceWith(rootNode);
        expect(getChildren.mock.calls).toEqual([[undefined], [undefined]]);
        expect(exists).not.toHaveBeenCalled();
    });

    it('reports a clear error when the cluster resource is missing from the cache', async (): Promise<void> => {
        children.set(subscriptionNode, [createNode('not-a-cluster')]);

        await expect(revealInDiscoveryView(context, request)).rejects.toThrow(
            'Could not find example in the Discovery view. It may have been deleted, or a filter may still hide it. Check the filters on the provider in the Discovery view, then open the link again.',
        );
        expect(reveal.mock.calls).toEqual([
            [rootNode, { select: false, focus: false, expand: true }],
            [subscriptionNode, { select: false, focus: false, expand: true }],
        ]);
        expect(getCachedChildren.mock.calls).toEqual([[rootNode], [subscriptionNode]]);
        expect(getChildren.mock.calls).toEqual([[undefined], [undefined]]);
        expect(exists).not.toHaveBeenCalled();
    });

    it('records a skipped target when the cluster has no client', async (): Promise<void> => {
        exists.mockReturnValue(false);

        expect(await revealInDiscoveryView(context, request)).toBeUndefined();
        expect(exists).toHaveBeenCalledExactlyOnceWith(clusterNode.cluster.clusterId);
        expect(context.telemetry.properties.openTargetResult).toBe('skippedNotConnected');
    });

    it('returns undefined with the cluster expanded and no database lookup when no client exists', async () => {
        exists.mockReturnValue(false);

        const result = await revealInDiscoveryView(context, { ...request, database: 'db' });

        expect(result).toBeUndefined();
        expect(getChildren).not.toHaveBeenCalledWith(clusterNode);
        expect(reveal.mock.calls).toEqual([
            [rootNode, { select: false, focus: false, expand: true }],
            [subscriptionNode, { select: false, focus: false, expand: true }],
            [clusterNode, { select: true, focus: false, expand: false }],
            [clusterNode, { select: true, focus: false, expand: true }],
        ]);
        expect(getChildren).not.toHaveBeenCalledWith(databaseNode);
        expect(findNodeById).not.toHaveBeenCalled();
        expect(findChildById).not.toHaveBeenCalled();
        expect(exists).toHaveBeenCalledWith(clusterNode.cluster.clusterId);
    });

    it('finds a database by its tree id and returns the database node', async (): Promise<void> => {
        const result = await revealInDiscoveryView(context, { ...request, database: 'db' });

        expect(result).toEqual({ clusterNode, clusterId: clusterNode.cluster.clusterId, databaseNode });
        expect(findNodeById).toHaveBeenCalledExactlyOnceWith(`${clusterNode.id}/db`);
        expect(findChildById).not.toHaveBeenCalled();
        expect(reveal.mock.calls).toEqual([
            [rootNode, { select: false, focus: false, expand: true }],
            [subscriptionNode, { select: false, focus: false, expand: true }],
            [clusterNode, { select: true, focus: false, expand: false }],
            [clusterNode, { select: true, focus: false, expand: true }],
            [databaseNode, { select: true, focus: true, expand: true }],
        ]);
        expect(getChildren).not.toHaveBeenCalledWith(clusterNode);
        expect(getChildren).not.toHaveBeenCalledWith(databaseNode);
    });

    it('finds a database beneath the cluster when its cache lookup misses', async (): Promise<void> => {
        findNodeById.mockResolvedValueOnce(undefined);
        findChildById.mockResolvedValue(databaseNode);

        const result = await revealInDiscoveryView(context, { ...request, database: 'db' });

        expect(result).toEqual({ clusterNode, clusterId: clusterNode.cluster.clusterId, databaseNode });
        expect(findNodeById).toHaveBeenCalledExactlyOnceWith(databaseNode.id);
        expect(findChildById).toHaveBeenCalledExactlyOnceWith(clusterNode, databaseNode.id);
        expect(exists.mock.invocationCallOrder[0]).toBeLessThan(findChildById.mock.invocationCallOrder[0]);
        expect(findNodeById.mock.invocationCallOrder[0]).toBeLessThan(findChildById.mock.invocationCallOrder[0]);
        expect(reveal).toHaveBeenLastCalledWith(databaseNode, { select: true, focus: true, expand: true });
    });

    it('reports the existing URL error when the requested database is missing', async () => {
        await expect(revealInDiscoveryView(context, { ...request, database: 'missing-database' })).rejects.toThrow(
            'Could not find database "missing-database" on example. Check the name and your access, then open the link again.',
        );
        expect(findNodeById).toHaveBeenCalledExactlyOnceWith(`${clusterNode.id}/missing-database`);
        expect(reveal.mock.calls).toEqual([
            [rootNode, { select: false, focus: false, expand: true }],
            [subscriptionNode, { select: false, focus: false, expand: true }],
            [clusterNode, { select: true, focus: false, expand: false }],
            [clusterNode, { select: true, focus: false, expand: true }],
        ]);
    });

    it('finds a requested collection by its tree id after expanding the database', async (): Promise<void> => {
        findNodeById.mockImplementation(async (id: string): Promise<TreeElement | undefined> => {
            if (id === databaseNode.id) {
                expect(reveal.mock.calls).toEqual([
                    [rootNode, { select: false, focus: false, expand: true }],
                    [subscriptionNode, { select: false, focus: false, expand: true }],
                    [clusterNode, { select: true, focus: false, expand: false }],
                    [clusterNode, { select: true, focus: false, expand: true }],
                ]);
                return databaseNode;
            }
            expect(reveal).toHaveBeenLastCalledWith(databaseNode, { select: true, focus: false, expand: true });
            return id === collectionNode.id ? collectionNode : undefined;
        });
        const result = await revealInDiscoveryView(context, { ...request, database: 'db', collection: 'products' });
        expect(result?.databaseNode).toBe(databaseNode);
        expect(findNodeById.mock.calls).toEqual([[`${clusterNode.id}/db`], [`${databaseNode.id}/products`]]);
        expect(findChildById).not.toHaveBeenCalled();
        expect(reveal.mock.calls).toEqual([
            [rootNode, { select: false, focus: false, expand: true }],
            [subscriptionNode, { select: false, focus: false, expand: true }],
            [clusterNode, { select: true, focus: false, expand: false }],
            [clusterNode, { select: true, focus: false, expand: true }],
            [databaseNode, { select: true, focus: false, expand: true }],
            [collectionNode, { select: true, focus: true, expand: true }],
        ]);
        expect(getChildren).not.toHaveBeenCalledWith(clusterNode);
        expect(getChildren).not.toHaveBeenCalledWith(databaseNode);
    });

    it('finds a collection beneath the database when its cache lookup misses', async (): Promise<void> => {
        findNodeById.mockResolvedValueOnce(databaseNode).mockResolvedValueOnce(undefined);
        findChildById.mockResolvedValue(collectionNode);

        const result = await revealInDiscoveryView(context, { ...request, database: 'db', collection: 'products' });

        expect(result?.databaseNode).toBe(databaseNode);
        expect(findNodeById.mock.calls).toEqual([[databaseNode.id], [collectionNode.id]]);
        expect(findChildById).toHaveBeenCalledExactlyOnceWith(databaseNode, collectionNode.id);
        expect(findNodeById.mock.invocationCallOrder[1]).toBeLessThan(findChildById.mock.invocationCallOrder[0]);
        expect(reveal).toHaveBeenLastCalledWith(collectionNode, { select: true, focus: true, expand: true });
    });

    it('rejects a differently-cased collection returned by the fallback', async (): Promise<void> => {
        collectionNode = { ...createNode(`${databaseNode.id}/Products`), collectionInfo: { name: 'Products' } };
        findNodeById.mockResolvedValueOnce(databaseNode).mockResolvedValueOnce(undefined);
        findChildById.mockResolvedValue(collectionNode);

        await expect(
            revealInDiscoveryView(context, { ...request, database: 'db', collection: 'products' }),
        ).rejects.toThrow(
            'Could not find collection "products" in database "db". Check the name and your access, then open the link again.',
        );

        expect(findChildById).toHaveBeenCalledExactlyOnceWith(databaseNode, `${databaseNode.id}/products`);
        expect(reveal).not.toHaveBeenCalledWith(collectionNode, expect.anything());
    });

    it('reports the existing URL error when the requested collection is missing', async () => {
        await expect(
            revealInDiscoveryView(context, { ...request, database: 'db', collection: 'missing-collection' }),
        ).rejects.toThrow(
            'Could not find collection "missing-collection" in database "db". Check the name and your access, then open the link again.',
        );
        expect(findNodeById.mock.calls).toEqual([[`${clusterNode.id}/db`], [`${databaseNode.id}/missing-collection`]]);
        expect(reveal.mock.calls).toEqual([
            [rootNode, { select: false, focus: false, expand: true }],
            [subscriptionNode, { select: false, focus: false, expand: true }],
            [clusterNode, { select: true, focus: false, expand: false }],
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
