/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    createContextValue,
    type IActionContext,
    type TreeElementBase,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { DiscoveryService } from '../../services/discoveryServices';
import { type BaseServiceBranchDataProvider } from './BaseServiceBranchDataProvider';
import { wrapServiceItem, type ServiceItemWrapper } from './ServiceItemWrapper';

/**
 * This class follows the same pattern as the `WorkspaceDataProvicers` does with Azure Resoruces.
 *
 * The reason is that we want to be able to use the same implementation of tree items for both,
 * the Azure Resources integration, and this extension.
 *
 * There overall architecture is simple and could be modified here, however, in order to keep the code easier to follow,
 * we are going to keep the same pattern as the `WorkspaceDataProviders` does.
 */
export class DiscoveryBranchDataProvider
    extends vscode.Disposable
    implements vscode.TreeDataProvider<ServiceItemWrapper>
{
    private discoveryProviders: Map<string, BaseServiceBranchDataProvider<TreeElementBase>> = new Map();

    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
        void | ServiceItemWrapper | ServiceItemWrapper[] | null | undefined
    >();

    /**
     * From vscode.TreeDataProvider<T>:
     *
     * An optional event to signal that an element or root has changed.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     * To signal that root has changed, do not pass any argument or pass `undefined` or `null`.
     */
    get onDidChangeTreeData(): vscode.Event<void | ServiceItemWrapper | ServiceItemWrapper[] | null | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });

        const providers = DiscoveryService.listProviders()
            .map((info) => DiscoveryService.getProvider(info.id))
            .filter((provider) => provider !== undefined);

        for (const provider of providers) {
            this.discoveryProviders.set(provider.id, provider.getDiscoveryTreeDataProvider());
        }
    }

    async getChildren(element: ServiceItemWrapper): Promise<ServiceItemWrapper[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = 'discovery';

            if (!element) {
                /**
                 * getChildren() (no parameters) is beeing called at the root of the tree.
                 * We need to get all the registered services and return their root items.
                 */
                const activeDiscoveryProviderIds = ext.context.globalState.get<string[]>(
                    'activeDiscoveryProviderIds',
                    [],
                );

                const wrappedRootItems: ServiceItemWrapper[] = [];
                for (const [providerId, provider] of this.discoveryProviders) {
                    // only show activated discovery providers
                    if (!activeDiscoveryProviderIds.includes(providerId)) {
                        continue;
                    }

                    const wrappedItem = wrapServiceItem(provider, await provider.getRootItem());
                    wrappedItem.isRootItem = true;

                    wrappedRootItems.push(wrappedItem);
                }

                if (wrappedRootItems.length === 0) {
                    return null;
                }

                return wrappedRootItems.sort((a, b) => a.wrappedItem.id?.localeCompare(b.wrappedItem.id ?? '') ?? 0);
            }

            /**
             * We're being asked to provide children for a specific element, this means that discovery providers
             * have been activated and used to process and populate the tree. Now, the tree is being explored.
             *
             * Note: the correct branch data provider has to be used.
             */

            context.telemetry.properties.parentNodeContext = (await element.wrappedItem.getTreeItem()).contextValue;

            return (await element.provider.getChildren(element.wrappedItem))?.map((child) => {
                return wrapServiceItem(element.provider, child);
            });
        });
    }

    async getTreeItem(element: ServiceItemWrapper): Promise<vscode.TreeItem> {
        const treeItem: vscode.TreeItem = await element.provider.getTreeItem(element.wrappedItem);

        if (element.isRootItem) {
            const contextValues = ['discoveryRootItem'];
            if (treeItem.contextValue) {
                contextValues.push(treeItem.contextValue);
            }
            treeItem.contextValue = createContextValue(contextValues);
        }

        return treeItem;
    }

    /**
     * Refreshes the tree data.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     *
     * @param element The element to refresh. If not provided, the entire tree will be refreshed.
     */
    refresh(element?: ServiceItemWrapper): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
