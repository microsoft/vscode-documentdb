/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureTenant } from '@microsoft/vscode-azext-azureauth';
import * as l10n from '@vscode/l10n';
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import { containsRetryNode, createRetryNode } from '../../../tree/api/retryNode';
import { type ExtTreeElementBase, type TreeElement } from '../../../tree/TreeElement';
import { type TreeElementWithContextValue } from '../../../tree/TreeElementWithContextValue';
import { type TreeElementWithExplicitReload } from '../../../tree/TreeElementWithExplicitReload';
import { type TreeElementWithRetryChildren } from '../../../tree/TreeElementWithRetryChildren';
import { meterSilentCatch } from '../../../utils/accumulatingTelemetry';
import { askToConfigureCredentials } from '../../api-shared/azure/askToConfigureCredentials';
import {
    getUnfilteredAzureTenants,
    type AzureSubscriptionProviderWithFilters,
} from '../../api-shared/azure/AzureSubscriptionProviderWithFilters';
import { getTenantFilteredSubscriptions } from '../../api-shared/azure/subscriptionFiltering/subscriptionFilteringHelpers';
import { AzureSubscriptionItem } from './AzureSubscriptionItem';

export class AzureServiceRootItem
    implements TreeElement, TreeElementWithContextValue, TreeElementWithExplicitReload, TreeElementWithRetryChildren
{
    public readonly id: string;
    public contextValue: string =
        'enableRefreshCommand;enableManageCredentialsCommand;enableFilterCommand;enableLearnMoreCommand;discoveryAzureServiceRootItem';

    constructor(
        private readonly azureSubscriptionProvider: AzureSubscriptionProviderWithFilters,
        public readonly parentId: string,
    ) {
        this.id = `${parentId}/azure-mongo-vcore-discovery`;
    }

    public prepareExplicitReload(): void {
        this.azureSubscriptionProvider.requestFreshListing();
    }

    async getChildren(): Promise<ExtTreeElementBase[]> {
        // Generate a new journey correlation ID for telemetry funnel analysis
        // This ID is passed to all child items and included in their telemetry events
        const journeyCorrelationId = randomUUID();

        const allSubscriptions = await this.azureSubscriptionProvider.getAvailableSubscriptions({
            filter: true,
            maximumTenants: Number.POSITIVE_INFINITY,
        });
        const subscriptions = getTenantFilteredSubscriptions(allSubscriptions);

        if (!subscriptions || subscriptions.length === 0) {
            // Show modal dialog for empty state
            const configureResult = await askToConfigureCredentials();
            // Note to future maintainers: 'void' is important here so that the return below returns the error node.
            // Otherwise, the /retry node might be duplicated as we're inside of tree node with a loading state (the node items are being swapped etc.)
            if (configureResult === 'configure') {
                void vscode.commands.executeCommand('vscode-documentdb.command.discoveryView.manageCredentials', this);
            } else if (configureResult === 'filter') {
                void vscode.commands.executeCommand(
                    'vscode-documentdb.command.discoveryView.filterProviderContent',
                    this,
                );
            }

            return [createRetryNode(this.id, this)];
        }

        // This information is extracted to improve the UX, that's why there are fallbacks to 'undefined'
        const tenantPromise = getUnfilteredAzureTenants(this.azureSubscriptionProvider).catch(() => {
            meterSilentCatch('AzureMongoVCoreServiceRootItem_getUnfilteredAzureTenants');
            return undefined;
        });
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
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
                // map to AzureSubscriptionItem
                .map((sub) => {
                    return new AzureSubscriptionItem(
                        this.id,
                        {
                            subscription: sub,
                            subscriptionName: sub.name,
                            subscriptionId: sub.subscriptionId,
                            tenant: tenantMap.get(sub.tenantId),
                        },
                        journeyCorrelationId,
                    );
                })
        );
    }

    public hasRetryNode(children: TreeElement[] | null | undefined): boolean {
        return containsRetryNode(children);
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Azure DocumentDB'),
            iconPath: new vscode.ThemeIcon('azure'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
