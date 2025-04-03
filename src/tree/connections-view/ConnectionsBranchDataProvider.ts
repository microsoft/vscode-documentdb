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
import { MongoClustersExperience } from '../../AzureDBExperiences';
import { ext } from '../../extensionVariables';
import { type ClusterModel } from '../documentdb/ClusterModel';
import { WorkspaceResourceType } from '../workspace-api/SharedWorkspaceResourceProvider';
import { SharedWorkspaceStorage } from '../workspace-api/SharedWorkspaceStorage';
import { ClusterItem } from '../workspace-view/documentdb/ClusterItem';
import { LocalEmulatorsItem } from './LocalEmulators/LocalEmulatorsItem';
import { NewConnectionItem } from './NewConnectionItem';

/**
 * This class follows the same pattern as the `WorkspaceDataProvicers` does with Azure Resoruces.
 *
 * The reason is that we want to be able to use the same implementation of tree items for both,
 * the Azure Resources integration, and this extension.
 *
 * There overall architecture is simple and could be modified here, however, in order to keep the code easier to follow,
 * we are going to keep the same pattern as the `WorkspaceDataProviders` does.
 */
export class ConnectionsBranchDataProvider
    extends vscode.Disposable
    implements vscode.TreeDataProvider<TreeElementBase>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
        void | TreeElementBase | TreeElementBase[] | null | undefined
    >();

    /**
     * From vscode.TreeDataProvider<T>:
     *
     * An optional event to signal that an element or root has changed.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     * To signal that root has changed, do not pass any argument or pass `undefined` or `null`.
     */
    get onDidChangeTreeData(): vscode.Event<void | TreeElementBase | TreeElementBase[] | null | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    constructor() {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
        });
    }

    async getChildren(element: TreeElementBase): Promise<TreeElementBase[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = 'connections';

            if (!element) {
                context.telemetry.properties.parentNodeContext = 'root';
                return this.getRootItems();
            }

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;

            return (await element.getChildren?.())?.map((child) => {
                if (child.id) {
                    return ext.state.wrapItemInStateHandling(child as TreeElementBase & { id: string }, () =>
                        this.refresh(child),
                    );
                }
                return child;
            });
        });
    }

    /**
     * Helper function to get the root items of the connections tree.
     */
    private async getRootItems(): Promise<TreeElementBase[] | null | undefined> {
        const allItems = await SharedWorkspaceStorage.getItems(WorkspaceResourceType.MongoClusters);

        return [
            new LocalEmulatorsItem(),
            ...allItems
                .filter((item) => !item.properties?.isEmulator) // filter out emulators
                .map((item) => {
                    const model: ClusterModel = {
                        id: item.id,
                        name: item.name,
                        dbExperience: MongoClustersExperience,
                        connectionString: item?.secrets?.[0] ?? undefined,
                    };

                    return new ClusterItem(model);
                }),
            new NewConnectionItem(),
        ];
    }

    getTreeItem(element: TreeElementBase): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    /**
     * Refreshes the tree data.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     *
     * @param element The element to refresh. If not provided, the entire tree will be refreshed.
     */
    refresh(element?: TreeElementBase): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
