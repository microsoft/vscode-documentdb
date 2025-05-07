/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { AzureSubscriptionItem } from './AzureSubscriptionItem';

export class AzureServiceRootItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;enableFilterCommand;discoveryAzureVMRootItem';

    constructor(
        private readonly azureSubscriptionProvider: VSCodeAzureSubscriptionProvider,
        public readonly parentId: string,
    ) {
        this.id = `${parentId}/rootItem-azure-vm`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        /**
         * This is an important step to ensure that the user is signed in to Azure before listing subscriptions.
         */
        if (!(await this.azureSubscriptionProvider.isSignedIn())) {
            const signIn: vscode.MessageItem = { title: l10n.t('Sign In') };
            void vscode.window
                .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in to continue.'), signIn)
                .then((input) => {
                    if (input === signIn) {
                        void this.azureSubscriptionProvider.signIn();
                    }
                });
        }

        const subscriptions = await this.azureSubscriptionProvider.getSubscriptions(true);
        if (!subscriptions || subscriptions.length === 0) {
            return [];
        }

        return (
            subscriptions
                // sort by name
                .sort((a, b) => a.name.localeCompare(b.name))
                // map to AzureSubscriptionItem
                .map((sub) => {
                    return new AzureSubscriptionItem(this.id, {
                        subscription: sub,
                        subscriptionName: sub.name,
                        subscriptionId: sub.subscriptionId,
                    });
                })
        );
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Azure VMs (DocumentDB)'),
            iconPath: new vscode.ThemeIcon('vm'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
