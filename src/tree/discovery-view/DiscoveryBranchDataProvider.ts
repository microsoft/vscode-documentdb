/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    type IActionContext,
    type TreeElementBase,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
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
                 * we're at the root of the tree, so we need to get all the registered services
                 * and get their root items.
                 */
                const wrappedRootItems: ServiceItemWrapper[] = [];
                for (const provider of this.discoveryProviders.values()) {
                    wrappedRootItems.push(wrapServiceItem(provider, await provider.getRootItem()));
                }

                return wrappedRootItems.sort((a, b) => {
                    return a.wrappedItem.id!.localeCompare(b.wrappedItem.id!);
                });
            }

            /**
             * We're at a child element, so we need to get the children of the actual item.
             */

            context.telemetry.properties.parentNodeContext = (await element.wrappedItem.getTreeItem()).contextValue;

            return (await element.provider.getChildren(element.wrappedItem))?.map((child) => {
                return wrapServiceItem(element.provider, child);
            });
        });
    }

    getTreeItem(element: ServiceItemWrapper): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.provider.getTreeItem(element.wrappedItem);
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
