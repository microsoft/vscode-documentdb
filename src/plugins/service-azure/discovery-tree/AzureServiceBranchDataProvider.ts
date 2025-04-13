/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import { type TreeElementBase } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { type BaseServiceBranchDataProvider } from '../../../tree/discovery-view/api/BaseServiceBranchDataProvider';
import { AzureServiceRootItem } from '../../../tree/discovery-view/azure/AzureServiceRootItem';

/**
 * This class follows the same pattern as the `WorkspaceDataProvicers` does with Azure Resoruces.
 *
 * The reason is that we want to be able to use the same implementation of tree items for both,
 * the Azure Resources integration, and this extension.
 *
 * There overall architecture is simple and could be modified here, however, in order to keep the code easier to follow,
 * we are going to keep the same pattern as the `WorkspaceDataProviders` does.
 */
export class AzureServiceBranchDataProvider
    extends vscode.Disposable
    implements BaseServiceBranchDataProvider<TreeElementBase>
{
    id = 'azure-provider';
    label = ' Azure Label';
    icon = new vscode.ThemeIcon('azure');

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
        if (!ext.azureSubscriptionProvider) {
            ext.azureSubscriptionProvider = new VSCodeAzureSubscriptionProvider();
        }

        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
            ext.azureSubscriptionProvider.dispose();
        });
    }

    getRootItem(): Promise<TreeElementBase> {
        const rootItem = new AzureServiceRootItem();
        if (rootItem.id) {
            return Promise.resolve(
                ext.state.wrapItemInStateHandling(rootItem as TreeElementBase & { id: string }, () =>
                    this.refresh(rootItem),
                ),
            );
        }

        return Promise.resolve(new AzureServiceRootItem());
    }

    async getChildren(element: TreeElementBase): Promise<TreeElementBase[] | null | undefined> {
        return (await element.getChildren?.())
            ?.sort((a, b) => a.id!.localeCompare(b.id!))
            .map((child) => {
                if (child.id) {
                    return ext.state.wrapItemInStateHandling(child as TreeElementBase & { id: string }, () =>
                        this.refresh(child),
                    );
                }
                return child;
            });
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
        console.log('Refreshing.. ' + element?.id);
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
