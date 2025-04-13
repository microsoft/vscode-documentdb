/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { AzureSubscriptionItem } from './AzureSubscriptionItem';

export class AzureServiceRootItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'discovery.azureService';

    constructor(
        private readonly azureSubscriptionProvider: VSCodeAzureSubscriptionProvider,
        public readonly parentId?: string,
    ) {
        this.id = `${parentId}/azureService`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        /**
         * This is an important step to ensure that the user is signed in to Azure before listing subscriptions.
         */
        if (!(await this.azureSubscriptionProvider.isSignedIn())) {
            void ext.state.runWithTemporaryDescription(this.id, 'Signing in to Azure...', async () => {
                await this.azureSubscriptionProvider.signIn();
            });
        }

        const subscriptions = await ext.state.runWithTemporaryDescription(this.id, 'Working...', async () => {
            return this.azureSubscriptionProvider.getSubscriptions(false); // TODO: add filter support, but it has to be a filter that works without Azure Resource installed.
        });

        return subscriptions.map((sub) => {
            return new AzureSubscriptionItem(this.id, {
                subscription: sub,
                subscriptionName: sub.name,
                subscriptionId: sub.subscriptionId,
            });
        });
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Azure Cosmos DB for MongoDB (vCore)'),
            iconPath: new vscode.ThemeIcon('azure'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
