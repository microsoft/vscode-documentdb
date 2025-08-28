/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import {
    callWithTelemetryAndErrorHandling,
    createContextValue,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import {
    type AzureResource,
    type AzureSubscription,
    type BranchDataProvider,
} from '@microsoft/vscode-azureresources-api';
import { API, MongoClustersExperience } from '../../../DocumentDBExperiences';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { createMongoClustersManagementClient } from '../../../utils/azureClients';
import { nonNullProp } from '../../../utils/nonNull';
import { type ExtendedTreeDataProvider } from '../../ExtendedTreeDataProvider';
import { type TreeElement } from '../../TreeElement';
import { isTreeElementWithContextValue, type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { isTreeElementWithRetryChildren } from '../../TreeElementWithRetryChildren';
import { TreeParentCache } from '../../TreeParentCache';
import { type ClusterModel } from '../../documentdb/ClusterModel';
import { VCoreResourceItem } from './VCoreResourceItem';

export class VCoreBranchDataProvider
    extends vscode.Disposable
    implements BranchDataProvider<AzureResource, TreeElement>, ExtendedTreeDataProvider<TreeElement>
{
    // these three properties support lazy detail information loading
    private detailsCacheUpdateRequested = false; // Current arm-mongoclusters beta fails on detail loading
    private detailsCache: Map<string, ClusterModel> = new Map<string, ClusterModel>();
    private itemsToUpdateInfo: Map<string, VCoreResourceItem> = new Map<string, VCoreResourceItem>();

    /**
     * Cache for tracking parent-child relationships to support the getParent method.
     */
    private readonly parentCache = new TreeParentCache<TreeElement>();

    /**
     * Caches nodes whose getChildren() call has failed.
     *
     * This cache prevents repeated attempts to fetch children for nodes that have previously failed,
     * such as when a user enters invalid credentials. By storing the failed nodes, we avoid unnecessary
     * repeated calls until the error state is explicitly cleared.
     *
     * Key: Node ID (parent)
     * Value: Array of TreeElement representing the failed children (usually an error node)
     */
    private readonly errorNodeCache = new Map<string, TreeElement[]>();

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
        void | TreeElement | TreeElement[] | null | undefined
    >();

    /**
     * From vscode.TreeDataProvider<T>:
     *
     * An optional event to signal that an element or root has changed.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     * To signal that root has changed, do not pass any argument or pass `undefined` or `null`.
     */
    get onDidChangeTreeData(): vscode.Event<void | TreeElement | TreeElement[] | null | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    /**
     * Removes a node's error state from the failed node cache.
     * This allows the node to be refreshed and its children to be re-fetched on the next refresh call.
     * If not reset, the cached error children will always be returned for this node.
     * @param nodeId The ID of the node to clear from the failed node cache.
     */
    resetNodeErrorState(nodeId: string): void {
        this.errorNodeCache.delete(nodeId);
    }

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
    }

    async getChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.AzureResourcesView;
            context.telemetry.properties.branch = 'documentdb';

            // 1. Check if we have a cached error for this element
            //
            // This prevents repeated attempts to fetch children for nodes that have previously failed
            // (e.g., due to invalid credentials or connection issues).
            if (element.id && this.errorNodeCache.has(element.id)) {
                context.telemetry.properties.usedCachedErrorNode = 'true';
                return this.errorNodeCache.get(element.id);
            }

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;

            // 2. Fetch the children of the current element
            const children = await element.getChildren?.();
            context.telemetry.measurements.childrenCount = children?.length ?? 0;

            // 3. Check if the returned children contain an error node
            // This means the operation failed (eg. authentication)
            if (isTreeElementWithRetryChildren(element) && element.hasRetryNode(children)) {
                // Optional: append helpful nodes to the error node
                // Here is an example:
                // children?.push(
                //     createGenericElementWithContext({
                //         contextValue: 'error',
                //         id: `${element.id}/updateCredentials`,
                //         label: vscode.l10n.t('Click here to update credentials'),
                //         iconPath: new vscode.ThemeIcon('key'),
                //           commandId: 'vscode-documentdb.command.connectionsView.updateCredentials',
                //         commandArgs: [element],
                //     }),
                // );

                // Store the error node(s) in our cache for future refreshes
                this.errorNodeCache.set(element.id, children ?? []);
                context.telemetry.properties.cachedErrorNode = 'true';
            }

            return children?.map((child) => {
                if (child.id) {
                    if (isTreeElementWithContextValue(child)) {
                        this.appendContextValues(child, Views.AzureResourcesView, 'documentdbBranch');
                    }

                    // Register parent-child relationship in the cache
                    if (element.id && child.id) {
                        this.parentCache.registerRelationship(element, child);
                    }

                    return ext.state.wrapItemInStateHandling(child, () => this.refresh(child)) as TreeElement;
                }
                return child;
            });
        });
    }

    /**
     * Gets the parent of a tree element. Required for TreeView.reveal functionality.
     *
     * @param element The element for which to find the parent
     * @returns The parent element, or undefined if the element is a root item
     */
    getParent(element: TreeElement): TreeElement | null | undefined {
        return this.parentCache.getParent(element);
    }

    /**
     * Finds a node in the tree by its ID.
     *
     * @param id The ID of the node to find
     * @returns A Promise that resolves to the found node or undefined if not found
     */
    async findNodeById(id: string): Promise<TreeElement | undefined> {
        return this.parentCache.findNodeById(id, async (element) => {
            if (!element.getChildren) {
                return undefined;
            }
            return element.getChildren();
        });
    }

    /**
     * Refreshes the tree data.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     *
     * @param element The element to refresh. If not provided, the entire tree will be refreshed.
     *
     * Note: This implementation handles both current and stale element references.
     * If a stale reference is provided but has an ID, it will attempt to find the current
     * reference in the tree before refreshing.
     */
    refresh(element?: TreeElement): void {
        if (element?.id) {
            // We have an element with an ID

            // Handle potential stale reference issue:
            // VS Code's TreeView API relies on object identity (reference equality),
            // not just ID equality. Find the current reference before clearing the cache.
            void this.findAndRefreshCurrentElement(element);
        } else {
            // No element or no ID, refresh the entire tree
            this.parentCache.clear();
            this.onDidChangeTreeDataEmitter.fire(element);
        }
    }

    /**
     * Helper method to find the current instance of an element by ID and refresh it.
     * This addresses the issue where stale references won't properly refresh the tree.
     *
     * @param element Potentially stale element reference
     */
    private async findAndRefreshCurrentElement(element: TreeElement): Promise<void> {
        try {
            // First try to find the current instance with this ID
            const currentElement = await this.findNodeById(element.id!);

            // AFTER finding the element, update the cache:
            // 1. Clear the cache for this ID to remove any stale references
            // (drops the element and its children)
            this.parentCache.clear(element.id!);
            // 2. Re-register the node (but not its children)
            if (currentElement?.id) {
                this.parentCache.registerNode(currentElement);
            }

            if (currentElement) {
                // We found the current instance, use it for refresh
                this.onDidChangeTreeDataEmitter.fire(currentElement);
            } else {
                // Current instance not found, fallback to using the provided element
                // This may not work if it's truly a stale reference, but we've tried our best
                this.onDidChangeTreeDataEmitter.fire(element);
            }
        } catch (error) {
            // If anything goes wrong during the lookup, still attempt the refresh with the original element
            // and clear the cache for this ID
            console.log(`Error finding current element for refresh: ${error}`);
            this.parentCache.clear(element.id!);
            this.onDidChangeTreeDataEmitter.fire(element);
        }
    }

    getResourceItem(resource: AzureResource): TreeElement | Thenable<TreeElement> {
        return callWithTelemetryAndErrorHandling('getResourceItem', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.AzureResourcesView;
            context.telemetry.properties.branch = 'documentdb';

            if (this.detailsCacheUpdateRequested) {
                void this.updateMetadataCache(context, resource.subscription, 1000 * 60 * 5).then(() => {
                    /**
                     * Instances of MongoClusterItem were  stored in the itemsToUpdateInfo map,
                     * so that when the cache is updated, the items can be refreshed.
                     * I had to keep all of them in the map becasuse refresh requires the actual MongoClusterItem instance.
                     */
                    this.itemsToUpdateInfo.forEach((value: VCoreResourceItem) => {
                        value.cluster = {
                            ...value.cluster,
                            ...this.detailsCache.get(value.cluster.id),
                        };
                        this.refresh(value);
                    });

                    this.itemsToUpdateInfo.clear();
                });
            }

            // 1. extract the basic info from the element (subscription, resource group, etc., provided by Azure Resources)
            let clusterInfo: ClusterModel = {
                ...resource,
                dbExperience: MongoClustersExperience,
            } as ClusterModel;

            // 2. lookup the details in the cache, on subsequent refreshes, the details will be available in the cache
            if (this.detailsCache.has(clusterInfo.id)) {
                clusterInfo = {
                    ...clusterInfo,
                    ...this.detailsCache.get(clusterInfo.id),
                };
            }

            const clusterItem = new VCoreResourceItem(resource.subscription, clusterInfo);
            ext.state.wrapItemInStateHandling(clusterItem, () => this.refresh(clusterItem));

            // 3. store the item in the update queue, so that when the cache is updated, the item can be refreshed
            this.itemsToUpdateInfo.set(clusterItem.id, clusterItem);

            return clusterItem;
        }) as TreeElement | Thenable<TreeElement>; // Cast to ensure correct type;
    }

    async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        /**
         * Note that due to caching done by the TreeElementStateManager,
         * changes to the TreeItem added here might get lost
         */
        return element.getTreeItem();
    }

    appendContextValues(treeItem: TreeElementWithContextValue, ...contextValuesToAppend: string[]): void {
        // all items returned from this view need that context value assigned
        const contextValues: string[] = contextValuesToAppend;

        // keep original contextValues if any
        if (treeItem.contextValue) {
            contextValues.push(treeItem.contextValue);
        }

        treeItem.contextValue = createContextValue(contextValues);
    }

    async updateMetadataCache(
        _context: IActionContext,
        subscription: AzureSubscription,
        cacheDuration: number,
    ): Promise<void> {
        return callWithTelemetryAndErrorHandling(
            'getResourceItem.updateMetadataCache',
            async (context: IActionContext) => {
                context.telemetry.properties.view = Views.AzureResourcesView;
                context.telemetry.properties.branch = 'documentdb';

                try {
                    context.telemetry.properties.experience = API.MongoClusters;
                    console.debug(
                        'Loading metadata cache for %s/%s',
                        context.telemetry.properties.view,
                        context.telemetry.properties.branch,
                    );

                    this.detailsCacheUpdateRequested = false;

                    setTimeout(() => {
                        this.detailsCache.clear();
                        this.detailsCacheUpdateRequested = true;
                        console.debug(
                            'Cleared metadata cache for %s/%s',
                            context.telemetry.properties.view,
                            context.telemetry.properties.branch,
                        );
                    }, cacheDuration); // clear cache when the it expires

                    // subscription comes from different azure packages in callers; cast here intentionally
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
                    const managementClient = await createMongoClustersManagementClient(context, subscription as any);
                    const accounts = await uiUtils.listAllIterator(managementClient.mongoClusters.list());

                    console.debug(
                        'Loaded metadata for %s/%s: %d entries',
                        context.telemetry.properties.view,
                        context.telemetry.properties.branch,
                        accounts.length,
                    );

                    accounts.map((mongoClusterAccount) => {
                        this.detailsCache.set(
                            nonNullProp(
                                mongoClusterAccount,
                                'id',
                                'mongoClusterAccount.id',
                                'MongoVCoreBranchDataProvider.ts',
                            ),
                            {
                                dbExperience: MongoClustersExperience,
                                id: mongoClusterAccount.id!,
                                name: mongoClusterAccount.name!,
                                resourceGroup: getResourceGroupFromId(mongoClusterAccount.id!),

                                location: mongoClusterAccount.location,
                                serverVersion: mongoClusterAccount.properties?.serverVersion,

                                systemData: {
                                    createdAt: mongoClusterAccount.systemData?.createdAt,
                                },

                                sku: mongoClusterAccount.properties?.compute?.tier,
                                diskSize: mongoClusterAccount.properties?.storage?.sizeGb,
                                nodeCount: mongoClusterAccount.properties?.sharding?.shardCount,
                                enableHa: mongoClusterAccount.properties?.highAvailability?.targetMode !== 'Disabled',
                            },
                        );
                    });
                } catch (e) {
                    console.debug(
                        'Failed to load metadata for %s/%s',
                        context.telemetry.properties.view,
                        context.telemetry.properties.branch,
                    );
                    console.debug({ ...context, ...subscription });
                    throw e;
                }
            },
        );
    }
}
