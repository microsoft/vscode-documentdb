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
import { MongoClustersExperience } from '../../AzureDBExperiences';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { StorageNames, StorageService } from '../../services/storageService';
import { type ClusterModel } from '../documentdb/ClusterModel';
import { type TreeElement } from '../TreeElement';
import { isTreeElementWithContextValue, type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { DocumentDBClusterItem } from './DocumentDBClusterItem';
import { LocalEmulatorsItem } from './LocalEmulators/LocalEmulatorsItem';
import { NewConnectionItemCV } from './NewConnectionItemCV';

/**
 * This class follows the same pattern as the `WorkspaceDataProvicers` does with Azure Resoruces.
 *
 * The reason is that we want to be able to use the same implementation of tree items for both,
 * the Azure Resources integration, and this extension.
 *
 * There overall architecture is simple and could be modified here, however, in order to keep the code easier to follow,
 * we are going to keep the same pattern as the `WorkspaceDataProviders` does.
 */
export class ConnectionsBranchDataProvider extends vscode.Disposable implements vscode.TreeDataProvider<TreeElement> {
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

    appendContextValue(treeItem: TreeElementWithContextValue, contextValueToAppend: string): void {
        // all items returned from this view need that context value assigned
        const contextValues: string[] = [contextValueToAppend];

        // keep original contextValues if any
        if (treeItem.contextValue) {
            contextValues.push(treeItem.contextValue);
        }

        treeItem.contextValue = createContextValue(contextValues);
    }

    async getChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = 'connections';

            if (!element) {
                context.telemetry.properties.parentNodeContext = 'root';

                const rootItems = await this.getRootItems(Views.ConnectionsView);
                if (!rootItems) {
                    return null;
                }

                for (const item of rootItems) {
                    if (isTreeElementWithContextValue(item)) {
                        this.appendContextValue(item, Views.ConnectionsView);
                    }
                }

                return rootItems;
            }

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;

            return (await element.getChildren?.())?.map((child) => {
                if (child.id) {
                    if (isTreeElementWithContextValue(child)) {
                        this.appendContextValue(child, Views.ConnectionsView);
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
                const model: ClusterModel = {
                    id: item.id,
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
     */
    refresh(element?: TreeElement): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
