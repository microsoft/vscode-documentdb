/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant, type VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { createGenericElementWithContext } from '../../../tree/api/createGenericElementWithContext';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import {
    isTreeElementWithContextValue,
    type TreeElementWithContextValue,
} from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { AzureMongoRUSubscriptionItem } from './AzureMongoRUSubscriptionItem';

export class AzureMongoRUServiceRootItem
    implements TreeElement, TreeElementWithContextValue, TreeElementWithRetryChildren
{
    public readonly id: string;
    public contextValue: string = 'enableRefreshCommand;enableFilterCommand;enableLearnMoreCommand;azureMongoRUService';

    constructor(
        private readonly azureSubscriptionProvider: VSCodeAzureSubscriptionProvider,
        public readonly parentId: string,
    ) {
        this.id = `${parentId}/azure-mongo-ru-discovery`;
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        /**
         * This is an important step to ensure that the user is signed in to Azure before listing subscriptions.
         */
        if (!(await this.azureSubscriptionProvider.isSignedIn())) {
            const signIn: vscode.MessageItem = { title: l10n.t('Sign In') };
            void vscode.window
                .showInformationMessage(l10n.t('You are not signed in to Azure. Sign in and retry.'), signIn)
                .then(async (input) => {
                    if (input === signIn) {
                        await this.azureSubscriptionProvider.signIn();
                        ext.discoveryBranchDataProvider.refresh();
                    }
                });

            return [
                createGenericElementWithContext({
                    contextValue: 'error', // note: keep this in sync with the `hasRetryNode` function in this file
                    id: `${this.id}/retry`,
                    label: vscode.l10n.t('Click here to retry'),
                    iconPath: new vscode.ThemeIcon('refresh'),
                    commandId: 'vscode-documentdb.command.internal.retry',
                    commandArgs: [this],
                }),
            ];
        }

        const subscriptions = await this.azureSubscriptionProvider.getSubscriptions(true);
        if (!subscriptions || subscriptions.length === 0) {
            return [];
        }

        // This information is extracted to improve the UX, that's why there are fallbacks to 'undefined'
        // Note to future maintainers: we used to run getSubscriptions and getTenants "in parallel", however
        // this lead to incorrect responses from getSubscriptions. We didn't investigate
        const tenantPromise = this.azureSubscriptionProvider.getTenants().catch(() => undefined);
        const timeoutPromise = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 5000));
        const knownTenants = await Promise.race([tenantPromise, timeoutPromise]);

        // Build tenant lookup for better performance
        const tenantMap = new Map<string, AzureTenant>();
        if (knownTenants) {
            for (const tenant of knownTenants) {
                if (tenant.tenantId) {
                    tenantMap.set(tenant.tenantId, tenant);
                }
            }
        }

        return (
            subscriptions
                // sort by name
                .sort((a, b) => a.name.localeCompare(b.name))
                // map to AzureMongoRUSubscriptionItem
                .map((sub) => {
                    return new AzureMongoRUSubscriptionItem(this.id, {
                        subscription: sub,
                        subscriptionName: sub.name,
                        subscriptionId: sub.subscriptionId,
                        tenant: tenantMap.get(sub.tenantId),
                    });
                })
        );
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return (
            children?.some((child) => isTreeElementWithContextValue(child) && child.contextValue === 'error') ?? false
        );
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Azure Cosmos DB for MongoDB (RU)'),
            iconPath: new vscode.ThemeIcon('azure'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
