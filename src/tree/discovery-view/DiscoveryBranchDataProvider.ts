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
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { type TreeElement } from '../TreeElement';

/**
 * This class follows the same pattern as the `WorkspaceDataProvicers` does with Azure Resoruces.
 *
 * The reason is that we want to be able to use the same implementation of tree items for both,
 * the Azure Resources integration, and this extension.
 *
 * There overall architecture is simple and could be modified here, however, in order to keep the code easier to follow,
 * we are going to keep the same pattern as the `WorkspaceDataProviders` does.
 */
export class DiscoveryBranchDataProvider extends vscode.Disposable implements vscode.TreeDataProvider<TreeElement> {
    /**
     * Tracks the current root items in the tree.
     *
     * Why is this needed?
     * We need to be able to attach a certain `contextValue` to root items so that context menus can be shown correctly.
     * This WeakSet allows us to efficiently check if a given element is a root item when building its TreeItem.
     * This was the easiest way to achieve this without modifying the tree item structure itself.
     */
    private currentRootItems: WeakSet<TreeElement>;

    /**
     * Tracks in-flight promises for getChildren calls.
     *
     * Why is this needed?
     * Discovery branch providers can take a long time to load their children (e.g., network calls).
     * To avoid issuing multiple concurrent calls for the same element while a previous call is still executing,
     * we store the in-flight promise here. If another request comes in for the same element, we return the same promise.
     * This avoids duplicate work and ensures only one request is in progress per element at a time.
     */
    private getChildrenPromises = new Map<TreeElement, Promise<TreeElement[] | null | undefined>>();

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

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
    }

    async getChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;

            if (!element) {
                return this.getRootItems();
            }

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;
            return this.getElementChildren(element);
        });
    }

    /**
     * Helper to get root items for the tree.
     */
    // eslint-disable-next-line @typescript-eslint/require-await
    private async getRootItems(): Promise<TreeElement[] | null | undefined> {
        // Reset the set of root items
        this.currentRootItems = new WeakSet<TreeElement>();

        // Get the list of active discovery provider IDs from global state
        const activeDiscoveryProviderIds = ext.context.globalState.get<string[]>('activeDiscoveryProviderIds', []);

        const rootItems: TreeElement[] = [];

        // Iterate through all registered discovery providers
        for (const { id } of DiscoveryService.listProviders()) {
            // Only include providers that are currently activated
            if (!activeDiscoveryProviderIds.includes(id)) {
                continue;
            }

            // Retrieve the provider instance
            const discoveryProvider = DiscoveryService.getProvider(id);

            if (!discoveryProvider) {
                throw new Error(`Discovery provider with id ${id} not found`);
            }

            // Get the root item for this provider
            const rootItem = discoveryProvider.getDiscoveryTreeRootItem(`${Views.DiscoveryView}/${id}`);

            // Wrap the root item with state handling for refresh support
            const wrappedInStateHandling = ext.state.wrapItemInStateHandling(rootItem, () =>
                this.refresh(rootItem),
            ) as TreeElement;

            // Track this as a root item for context menu support (see getTreeItem)
            this.currentRootItems.add(wrappedInStateHandling);

            rootItems.push(wrappedInStateHandling);
        }

        // If there are no root items, return null to indicate an empty tree
        if (rootItems.length === 0) {
            return null;
        }

        // Sort root items by their id for consistent ordering
        return rootItems.sort((a, b) => a.id?.localeCompare(b.id ?? '') ?? 0);
    }

    /**
     * Helper to get children for a given element.
     */
    private async getElementChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        // If the element can provide children
        if (element.getChildren) {
            // Avoid duplicate concurrent calls for the same element by caching in-flight promises
            if (this.getChildrenPromises.has(element)) {
                return this.getChildrenPromises.get(element);
            }

            // Start fetching children
            const promise = (async () => {
                const children = await element.getChildren!();
                if (!children) {
                    return null;
                }
                // Wrap each child with state handling for refresh support
                return children.map((child) =>
                    ext.state.wrapItemInStateHandling(child, () => this.refresh(child)),
                ) as TreeElement[];
            })();

            // Store the in-flight promise
            this.getChildrenPromises.set(element, promise);

            try {
                // Await and return the result
                return await promise;
            } finally {
                // Clean up the promise cache
                this.getChildrenPromises.delete(element);
            }
        }

        // If the element does not have children, return null
        return null;
    }

    async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
        const treeItem: vscode.TreeItem = await element.getTreeItem();

        // all items returned from this view need that context value assigned
        const contextValues: string[] = [Views.DiscoveryView];

        // keep original contextValues if any
        if (treeItem.contextValue) {
            contextValues.push(treeItem.contextValue);
        }

        // mark root items with a special context value
        if (this.currentRootItems.has(element)) {
            contextValues.push('rootItem');
        }

        treeItem.contextValue = createContextValue(contextValues);

        return treeItem;
    }

    /**
     * Refreshes the tree data.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     *
     * @param element The element to refresh. If not provided, the entire tree will be refreshed.
     */
    refresh(element?: TreeElement): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
