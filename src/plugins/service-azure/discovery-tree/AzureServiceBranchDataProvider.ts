/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { type BaseServiceBranchDataProvider } from '../../../tree/discovery-view/BaseServiceBranchDataProvider';
import { type TreeElement } from '../../../tree/TreeElement';
import { AzureServiceRootItem } from './AzureServiceRootItem';

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
    implements BaseServiceBranchDataProvider<TreeElement>
{
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

    constructor(private readonly azureSubscriptionProvider: VSCodeAzureSubscriptionProvider) {
        super(() => {
            this.onDidChangeTreeDataEmitter.dispose();
            this.azureSubscriptionProvider.dispose();
        });
    }

    getRootItem(): Promise<TreeElement> {
        const rootItem = new AzureServiceRootItem(this.azureSubscriptionProvider);

        if (rootItem.id) {
            return Promise.resolve(
                ext.state.wrapItemInStateHandling(rootItem, () => this.refresh(rootItem)) as TreeElement,
            );
        }

        return Promise.resolve(rootItem);
    }

    async getChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        return (await element.getChildren?.())
            ?.sort((a, b) => a.id!.localeCompare(b.id!))
            .map((child) => {
                if (child.id) {
                    return ext.state.wrapItemInStateHandling(child, () => this.refresh(child)) as TreeElement;
                }
                return child;
            });
    }

    getTreeItem(element: TreeElement): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element.getTreeItem();
    }

    /**
     * Refreshes the tree data.
     * This will trigger the view to update the changed element/root and its children recursively (if shown).
     *
     * @param element The element to refresh. If not provided, the entire tree will be refreshed.
     */
    refresh(element?: TreeElement): void {
        console.log('Refreshing.. ' + element?.id);
        this.onDidChangeTreeDataEmitter.fire(element);
    }
}
