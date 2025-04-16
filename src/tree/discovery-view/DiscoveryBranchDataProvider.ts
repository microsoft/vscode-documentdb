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
import { type BaseServiceBranchDataProvider } from './BaseServiceBranchDataProvider';
import { wrapDiscoveryViewItem } from './wrapDiscoveryViewItem';

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
    private rootItems: WeakSet<TreeElement>;

    private discoveryTreeDataProviders: Map<string, BaseServiceBranchDataProvider<TreeElement>> = new Map();

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
            this.discoveryTreeDataProviders.clear();
        });

        const providers = DiscoveryService.listProviders()
            .map((info) => DiscoveryService.getProvider(info.id))
            .filter((provider) => provider !== undefined);

        for (const provider of providers) {
            this.discoveryTreeDataProviders.set(provider.id, provider.getDiscoveryTreeDataProvider());
        }
    }

    async getChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.DiscoveryView;

            if (!element) {
                /**
                 * getChildren() (no parameters) is beeing called at the root of the tree.
                 * We need to get all the registered services and return their root items.
                 */

                // Clear the rootItems set when refreshing the root level
                // Since WeakSet doesn't have a clear() method, create a new one
                this.rootItems = new WeakSet<TreeElement>();

                const activeDiscoveryProviderIds = ext.context.globalState.get<string[]>(
                    'activeDiscoveryProviderIds',
                    [],
                );

                const wrappedRootItems: TreeElement[] = [];
                for (const [providerId, provider] of this.discoveryTreeDataProviders) {
                    // only show activated discovery providers
                    if (!activeDiscoveryProviderIds.includes(providerId)) {
                        continue;
                    }

                    const wrappedItem = wrapDiscoveryViewItem(await provider.getRootItem(), providerId);

                    // Track root items in the WeakSet
                    this.rootItems.add(wrappedItem);
                    wrappedRootItems.push(wrappedItem);
                }

                if (wrappedRootItems.length === 0) {
                    return null;
                }

                return wrappedRootItems.sort((a, b) => a.id?.localeCompare(b.id ?? '') ?? 0);
            }

            /**
             * Here, element is defined:
             *
             * We're being asked to provide children for a specific element, this means that discovery providers
             * have been activated and used to process and populate the tree. Now, the tree is being explored.
             *
             * Note: the correct branch data provider has to be used.
             */

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;

            return element.getChildren ? await element.getChildren() : null;
        });
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
        if (this.rootItems.has(element)) {
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
