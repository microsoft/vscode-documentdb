/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureResource, type BranchDataProvider } from '@microsoft/vscode-azureresources-api';
import { CosmosDBMongoRUExperience } from '../../../DocumentDBExperiences';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { CaseInsensitiveMap } from '../../../utils/CaseInsensitiveMap';
import { LazyMetadataLoader } from '../../../utils/LazyMetadataLoader';
import { createCosmosDBManagementClient } from '../../../utils/azureClients';
import { nonNullProp } from '../../../utils/nonNull';
import { BaseExtendedTreeDataProvider } from '../../BaseExtendedTreeDataProvider';
import { type TreeElement } from '../../TreeElement';
import { isTreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { isTreeElementWithRetryChildren } from '../../TreeElementWithRetryChildren';
import { type ClusterModel } from '../../documentdb/ClusterModel';
import { RUResourceItem } from './RUCoreResourceItem';

// export type VCoreResource = AzureResource &
//     GenericResource & {
//         readonly raw: GenericResource; // Resource object from Azure SDK
//     };

export class RUBranchDataProvider
    extends BaseExtendedTreeDataProvider<TreeElement>
    implements BranchDataProvider<AzureResource, TreeElement>
{
    /**
     * Helper for managing lazy metadata loading with proper caching and item updates.
     * This replaces the manual cache management that was previously done with
     * detailsCacheUpdateRequested, detailsCache, and itemsToUpdateInfo properties.
     */
    private readonly metadataLoader = new LazyMetadataLoader<ClusterModel, RUResourceItem>({
        cacheDuration: 5 * 60 * 1000, // 5 minutes
        loadMetadata: async (subscription, context) => {
            console.debug(
                'Loading metadata cache for %s/%s',
                context.telemetry.properties.view,
                context.telemetry.properties.branch,
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            const managementClient = await createCosmosDBManagementClient(context, subscription as any);
            let ruAccounts = await uiUtils.listAllIterator(managementClient.databaseAccounts.list());
            ruAccounts = ruAccounts.filter((account) => account.kind === 'MongoDB'); // ignore non-ru accounts

            console.debug(
                'Loaded metadata for %s/%s: %d entries',
                context.telemetry.properties.view,
                context.telemetry.properties.branch,
                ruAccounts.length,
            );

            const cache = new CaseInsensitiveMap<ClusterModel>();
            ruAccounts.forEach((ruAccount) => {
                cache.set(nonNullProp(ruAccount, 'id', 'ruAccount.id', 'RUBranchDataProvider.ts'), {
                    dbExperience: CosmosDBMongoRUExperience,
                    id: ruAccount.id!,
                    name: ruAccount.name!,
                    resourceGroup: getResourceGroupFromId(ruAccount.id!),
                    location: ruAccount.location,
                    serverVersion: ruAccount?.apiProperties?.serverVersion,
                    systemData: {
                        createdAt: ruAccount.systemData?.createdAt,
                    },
                    capabilities:
                        ruAccount.capabilities && ruAccount.capabilities.length > 0
                            ? ruAccount.capabilities
                                  .map((cap) => cap.name)
                                  .filter((name) => name !== undefined)
                                  .join(', ')
                            : undefined,
                });
            });
            return cache;
        },
        updateItem: (item, metadata) => {
            if (metadata) {
                item.cluster = { ...item.cluster, ...metadata };
                if (item.cluster.serverVersion) {
                    item.descriptionOverride = `v${item.cluster.serverVersion}`;
                }
            }
        },
        refreshCallback: (item) => this.refresh(item),
    });

    constructor() {
        super();
        this.disposables.push(this.metadataLoader);
    }

    async getChildren(element: TreeElement): Promise<TreeElement[] | null | undefined> {
        return await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.AzureResourcesView;
            context.telemetry.properties.branch = 'ru';

            // 1. Check if we have a cached error for this element
            //
            // This prevents repeated attempts to fetch children for nodes that have previously failed
            // (e.g., due to invalid credentials or connection issues).
            if (element.id && this.errorNodeCache.has(element.id)) {
                context.telemetry.properties.usedCachedErrorNode = 'true';
                return this.errorNodeCache.get(element.id);
            }

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;

            // 2. Fetch the children of the current element
            const children = await element.getChildren?.();
            context.telemetry.measurements.childrenCount = children?.length ?? 0;

            // 3. Check if the returned children contain an error node
            // This means the operation failed (eg. authentication)
            if (isTreeElementWithRetryChildren(element) && element.hasRetryNode(children)) {
                // Optional: append helpful nodes to the error node
                // Here is an example:
                // children?.push(
                //     createGenericElementWithContext({
                //         contextValue: 'error',
                //         id: `${element.id}/updateCredentials`,
                //         label: vscode.l10n.t('Click here to update credentials'),
                //         iconPath: new vscode.ThemeIcon('key'),
                //           commandId: 'vscode-documentdb.command.connectionsView.updateCredentials',
                //         commandArgs: [element],
                //     }),
                // );

                // Store the error node(s) in our cache for future refreshes
                this.errorNodeCache.set(element.id, children ?? []);
                context.telemetry.properties.cachedErrorNode = 'true';
            }

            return children?.map((child) => {
                if (child.id) {
                    if (isTreeElementWithContextValue(child)) {
                        this.appendContextValues(child, 'ruBranch');
                    }

                    // Register parent-child relationship in the cache
                    if (element.id && child.id) {
                        this.parentCache.registerRelationship(element, child);
                    }

                    return ext.state.wrapItemInStateHandling(child, () => this.refresh(child)) as TreeElement;
                }
                return child;
            });
        });
    }

    getResourceItem(resource: AzureResource): TreeElement | Thenable<TreeElement> {
        return callWithTelemetryAndErrorHandling('getResourceItem', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.AzureResourcesView;
            context.telemetry.properties.branch = 'ru';

            // Trigger cache loading if needed
            if (this.metadataLoader.needsCacheUpdate) {
                void this.metadataLoader.loadCacheAndRefreshItems(resource.subscription, context);
            }

            // Get metadata from cache (may be undefined if not yet loaded)
            const cachedMetadata = this.metadataLoader.getCachedMetadata(resource.id);

            let clusterInfo: ClusterModel = {
                ...resource,
                dbExperience: CosmosDBMongoRUExperience,
            } as ClusterModel;

            // Merge with cached metadata if available
            if (cachedMetadata) {
                clusterInfo = { ...clusterInfo, ...cachedMetadata };
            }

            const clusterItem = new RUResourceItem(resource.subscription, clusterInfo);
            ext.state.wrapItemInStateHandling(clusterItem, () => this.refresh(clusterItem));
            if (isTreeElementWithContextValue(clusterItem)) {
                this.appendContextValues(clusterItem, 'ruBranch');
            }

            if (cachedMetadata?.serverVersion) {
                clusterItem.descriptionOverride = `v${cachedMetadata.serverVersion}`;
            }

            // Register item for refresh when cache loading completes
            this.metadataLoader.addItemForRefresh(resource.id, clusterItem);

            return clusterItem;
        }) as TreeElement | Thenable<TreeElement>; // Cast to ensure correct type;
    }
}
