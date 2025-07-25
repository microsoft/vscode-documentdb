/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createContextValue,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { MongoClustersExperience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { StorageNames, StorageService } from '../../services/storageService';
import { createGenericElementWithContext } from '../api/createGenericElementWithContext';
import { type ClusterModelWithStorage } from '../documentdb/ClusterModel';
import { type ExtendedTreeDataProvider } from '../ExtendedTreeDataProvider';
import { type TreeElement } from '../TreeElement';
import { isTreeElementWithContextValue, type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { isTreeElementWithRetryChildren } from '../TreeElementWithRetryChildren';
import { TreeParentCache } from '../TreeParentCache';
import { DocumentDBClusterItem } from './DocumentDBClusterItem';
import { LocalEmulatorsItem } from './LocalEmulators/LocalEmulatorsItem';
import { NewConnectionItemCV } from './NewConnectionItemCV';

/**
 * Tree data provider for the Connections view.
 *
 * This provider manages the display of database connections, including clusters and local emulators.
 *
 * ## Integration with TreeParentCache
 *
 * This class uses TreeParentCache to implement the getParent and findNodeById methods required by
 * the ExtendedTreeDataProvider interface. The caching mechanism enables:
 *
 * 1. Efficient implementation of tree.reveal() functionality to navigate to specific nodes
 * 2. Finding nodes by ID without traversing the entire tree each time
 * 3. Proper cleanup when refreshing parts of the tree
 *
 * When building the tree:
 * - Root items are registered directly with registerNode
 * - Child-parent relationships are registered with registerRelationship during getChildren
 * - The cache is selectively cleared during refresh operations
 */
export class ConnectionsBranchDataProvider extends vscode.Disposable implements ExtendedTreeDataProvider<TreeElement> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
        void | TreeElement | TreeElement[] | null | undefined
    >();
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

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
    }

    appendContextValue(treeItem: TreeElementWithContextValue, contextValueToAppend: string): void {
        // all items returned from this view need that context value assigned
        const contextValues: string[] = [contextValueToAppend];

        // keep original contextValues if any
        if (treeItem.contextValue) {
            contextValues.push(treeItem.contextValue);
        }

        treeItem.contextValue = createContextValue(contextValues);
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

    async getChildren(element?: TreeElement): Promise<TreeElement[] | null | undefined> {
        return callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.ConnectionsView;

            if (!element) {
                context.telemetry.properties.parentNodeContext = 'root';

                // For root-level items, we should clear any existing cache first
                this.parentCache.clear();

                const rootItems = await this.getRootItems(Views.ConnectionsView);
                if (!rootItems) {
                    return null;
                }

                context.telemetry.measurements.savedConnections = rootItems.length - 2; // count - 'DocumentDB Local' and 'New Connection'

                // Now process and add each root item to the cache
                for (const item of rootItems) {
                    if (isTreeElementWithContextValue(item)) {
                        this.appendContextValue(item, Views.ConnectionsView);
                    }

                    // Add root items to the cache
                    if (item.id) {
                        this.parentCache.registerNode(item);
                    }
                }

                return rootItems;
            }

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
                // append helpful nodes to the error node
                children?.push(
                    createGenericElementWithContext({
                        contextValue: 'error',
                        id: `${element.id}/updateCredentials`,
                        label: vscode.l10n.t('Click here to update credentials'),
                        iconPath: new vscode.ThemeIcon('key'),
                        commandId: 'vscode-documentdb.command.connectionsView.updateCredentials',
                        commandArgs: [element],
                    }),
                );
                // Store the error node(s) in our cache for future refreshes
                this.errorNodeCache.set(element.id, children ?? []);
                context.telemetry.properties.cachedErrorNode = 'true';
            }

            return children?.map((child) => {
                if (child.id) {
                    if (isTreeElementWithContextValue(child)) {
                        this.appendContextValue(child, Views.ConnectionsView);
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
     * Helper function to get the root items of the connections tree.
     */
    private async getRootItems(parentId: string): Promise<TreeElement[] | null | undefined> {
        const connectionItems = await StorageService.get(StorageNames.Connections).getItems('clusters');

        if (connectionItems.length === 0) {
            /**
             * we have a special case here as we want to show a "welcome screen" in the case when no connections were found.
             * However, we need to lookup the emulator items as well, so we need to check if there are any emulators.
             */
            const emulatorItems = await StorageService.get(StorageNames.Connections).getItems('emulators');
            if (emulatorItems.length === 0) {
                return null;
            }
        }

        const rootItems = [
            new LocalEmulatorsItem(parentId),
            ...connectionItems.map((item) => {
                const model: ClusterModelWithStorage = {
                    id: `${parentId}/${item.id}`,
                    storageId: item.id,
                    name: item.name,
                    dbExperience: MongoClustersExperience,
                    connectionString: item?.secrets?.[0] ?? undefined,
                };

                return new DocumentDBClusterItem(model);
            }),
            new NewConnectionItemCV(parentId),
        ];

        return rootItems.map(
            (item) => ext.state.wrapItemInStateHandling(item, () => this.refresh(item)) as TreeElement,
        );
    }

    async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        return element.getTreeItem();
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

    // Implement getParent using the cache
    getParent(element: TreeElement): TreeElement | null | undefined {
        return this.parentCache.getParent(element);
    }

    async findNodeById(id: string, enableRecursiveSearch?: boolean): Promise<TreeElement | undefined> {
        if (enableRecursiveSearch) {
            // Pass this.getChildren as the second parameter to enable recursive search
            return this.parentCache.findNodeById(
                id,
                this.getChildren.bind(this) as (element: TreeElement) => Promise<TreeElement[] | null | undefined>,
            );
        } else {
            // If recursive search is not enabled, we only search in the known nodes
            return this.parentCache.findNodeById(id);
        }
    }
}
