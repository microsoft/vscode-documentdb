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
import { type AzureClusterModel } from '../../azure-views/models/AzureClusterModel';
import { type TreeCluster } from '../../models/BaseClusterModel';
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
    private readonly metadataLoader = new LazyMetadataLoader<TreeCluster<AzureClusterModel>, RUResourceItem>({
        cacheDuration: 5 * 60 * 1000, // 5 minutes
        loadMetadata: async (subscription, context) => {
            console.debug(
                'Loading metadata cache for %s/%s',
                context.telemetry.properties.view,
                context.telemetry.properties.branch,
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            const managementClient = await createCosmosDBManagementClient(context, subscription as any);
            const ruAccounts = (await uiUtils.listAllIterator(managementClient.databaseAccounts.list())).filter(
                (account) => account.kind === 'MongoDB',
            ); // ignore non-ru accounts

            console.debug(
                'Loaded metadata for %s/%s: %d entries',
                context.telemetry.properties.view,
                context.telemetry.properties.branch,
                ruAccounts.length,
            );

            const cache = new CaseInsensitiveMap<TreeCluster<AzureClusterModel>>();
            ruAccounts.forEach((ruAccount) => {
                const resourceId = nonNullProp(ruAccount, 'id', 'ruAccount.id', 'RUBranchDataProvider.ts');
                // For Azure Resources View: treeId === clusterId === Azure Resource ID (no sanitization)
                const cluster: TreeCluster<AzureClusterModel> = {
                    // Core cluster data
                    name: ruAccount.name!,
                    connectionString: undefined, // Loaded lazily when connecting
                    dbExperience: CosmosDBMongoRUExperience,
                    clusterId: resourceId, // Azure Resource ID - stable cache key
                    // Azure-specific data
                    id: resourceId,
                    resourceGroup: getResourceGroupFromId(resourceId),
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
                    // Tree context (treeId === clusterId for flat Azure Resources tree)
                    treeId: resourceId, // No sanitization needed
                    viewId: Views.AzureResourcesView,
                };

                ext.outputChannel.trace(
                    `[AzureResourcesView/RU/cache] Created cluster model: name="${cluster.name}", clusterId="${cluster.clusterId}", treeId="${cluster.treeId}"`,
                );

                cache.set(resourceId, cluster);
            });
            return cache;
        },
        updateItem: (item, metadata) => {
            if (metadata) {
                item.cluster = { ...item.cluster, ...metadata };
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

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;

            // Use the enhanced method with the contextValue parameter
            const children = await this.wrapGetChildrenWithErrorAndStateHandling(
                element,
                context,
                async () => element.getChildren?.(),
                {
                    contextValue: ['ruBranch', Views.AzureResourcesView], // This enables automatic child processing
                },
            );

            // Return the processed children directly - no additional processing needed
            return children;
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

            // For Azure Resources View: treeId === clusterId === Azure Resource ID (no sanitization)
            let clusterInfo: TreeCluster<AzureClusterModel> = {
                // Core cluster data
                name: resource.name ?? 'Unknown',
                connectionString: undefined, // Loaded lazily
                dbExperience: CosmosDBMongoRUExperience,
                clusterId: resource.id, // Azure Resource ID - stable cache key
                // Azure-specific data
                id: resource.id,
                resourceGroup: undefined, // Will be populated from cache
                // Tree context (treeId === clusterId for flat Azure Resources tree)
                treeId: resource.id, // No sanitization needed
                viewId: Views.AzureResourcesView,
            };

            // Merge with cached metadata if available
            if (cachedMetadata) {
                clusterInfo = { ...clusterInfo, ...cachedMetadata };
            }

            ext.outputChannel.trace(
                `[AzureResourcesView/RU] Created cluster model: name="${clusterInfo.name}", clusterId="${clusterInfo.clusterId}", treeId="${clusterInfo.treeId}", hasCachedMetadata=${!!cachedMetadata}`,
            );

            const clusterItem = new RUResourceItem(resource.subscription, clusterInfo);
            ext.state.wrapItemInStateHandling(clusterItem, () => this.refresh(clusterItem));
            if (isTreeElementWithContextValue(clusterItem)) {
                this.appendContextValues(clusterItem, 'ruBranch', Views.AzureResourcesView);
            }

            // Register item for refresh when cache loading completes
            this.metadataLoader.addItemForRefresh(resource.id, clusterItem);

            return clusterItem;
        }) as TreeElement | Thenable<TreeElement>; // Cast to ensure correct type;
    }
}
