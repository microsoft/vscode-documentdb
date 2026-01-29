/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type AzureResource, type BranchDataProvider } from '@microsoft/vscode-azureresources-api';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { Views } from '../../../documentdb/Views';
import { ext } from '../../../extensionVariables';
import { CaseInsensitiveMap } from '../../../utils/CaseInsensitiveMap';
import { LazyMetadataLoader } from '../../../utils/LazyMetadataLoader';
import { createMongoClustersManagementClient } from '../../../utils/azureClients';
import { nonNullProp } from '../../../utils/nonNull';
import { BaseExtendedTreeDataProvider } from '../../BaseExtendedTreeDataProvider';
import { type TreeElement } from '../../TreeElement';
import { isTreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { type AzureClusterModel } from '../../azure-views/models/AzureClusterModel';
import { type TreeCluster } from '../../models/BaseClusterModel';
import { VCoreResourceItem } from './VCoreResourceItem';

export class VCoreBranchDataProvider
    extends BaseExtendedTreeDataProvider<TreeElement>
    implements BranchDataProvider<AzureResource, TreeElement>
{
    /**
     * Helper for managing lazy metadata loading with proper caching and item updates.
     * This replaces the manual cache management that was previously done with
     * detailsCacheUpdateRequested, detailsCache, and itemsToUpdateInfo properties.
     */
    private readonly metadataLoader = new LazyMetadataLoader<TreeCluster<AzureClusterModel>, VCoreResourceItem>({
        cacheDuration: 5 * 60 * 1000, // 5 minutes
        loadMetadata: async (subscription, context) => {
            console.debug(
                'Loading metadata cache for %s/%s',
                context.telemetry.properties.view,
                context.telemetry.properties.branch,
            );

            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
            const managementClient = await createMongoClustersManagementClient(context, subscription as any);
            const accounts = await uiUtils.listAllIterator(managementClient.mongoClusters.list());

            console.debug(
                'Loaded metadata for %s/%s: %d entries',
                context.telemetry.properties.view,
                context.telemetry.properties.branch,
                accounts.length,
            );

            const cache = new CaseInsensitiveMap<TreeCluster<AzureClusterModel>>();
            accounts.forEach((documentDbAccount) => {
                const resourceId = nonNullProp(
                    documentDbAccount,
                    'id',
                    'vCoreAccount.id',
                    'VCoreBranchDataProvider.ts',
                );
                // For Azure Resources View: treeId === clusterId === Azure Resource ID (no sanitization)
                const cluster: TreeCluster<AzureClusterModel> = {
                    // Core cluster data
                    name: documentDbAccount.name!,
                    connectionString: undefined, // Loaded lazily when connecting
                    dbExperience: DocumentDBExperience,
                    clusterId: resourceId, // Azure Resource ID - stable cache key
                    // Azure-specific data
                    id: resourceId,
                    resourceGroup: getResourceGroupFromId(resourceId),
                    location: documentDbAccount.location,
                    serverVersion: documentDbAccount.properties?.serverVersion,
                    systemData: {
                        createdAt: documentDbAccount.systemData?.createdAt,
                    },
                    sku: documentDbAccount.properties?.compute?.tier,
                    diskSize: documentDbAccount.properties?.storage?.sizeGb,
                    nodeCount: documentDbAccount.properties?.sharding?.shardCount,
                    enableHa: documentDbAccount.properties?.highAvailability?.targetMode !== 'Disabled',
                    // Tree context (treeId === clusterId for flat Azure Resources tree)
                    treeId: resourceId, // No sanitization needed
                    viewId: Views.AzureResourcesView,
                };

                ext.outputChannel.trace(
                    `[AzureResourcesView/vCore/cache] Created cluster model: name="${cluster.name}", clusterId="${cluster.clusterId}", treeId="${cluster.treeId}"`,
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
            context.telemetry.properties.branch = 'documentdb';

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;

            // Use the enhanced method with the contextValue parameter
            const children = await this.wrapGetChildrenWithErrorAndStateHandling(
                element,
                context,
                async () => element.getChildren?.(),
                {
                    contextValue: ['documentDbBranch', Views.AzureResourcesView], // This enables automatic child processing
                },
            );

            // Return the processed children directly - no additional processing needed
            return children;
        });
    }

    getResourceItem(resource: AzureResource): TreeElement | Thenable<TreeElement> {
        return callWithTelemetryAndErrorHandling('getResourceItem', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.AzureResourcesView;
            context.telemetry.properties.branch = 'documentdb';

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
                dbExperience: DocumentDBExperience,
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
                `[AzureResourcesView/vCore] Created cluster model: name="${clusterInfo.name}", clusterId="${clusterInfo.clusterId}", treeId="${clusterInfo.treeId}", hasCachedMetadata=${!!cachedMetadata}`,
            );

            const clusterItem = new VCoreResourceItem(resource.subscription, clusterInfo);
            ext.state.wrapItemInStateHandling(clusterItem, () => this.refresh(clusterItem));

            if (isTreeElementWithContextValue(clusterItem)) {
                this.appendContextValues(clusterItem, 'documentDbBranch', Views.AzureResourcesView);
            }

            // Register item for refresh when cache loading completes
            this.metadataLoader.addItemForRefresh(resource.id, clusterItem);

            return clusterItem;
        }) as TreeElement | Thenable<TreeElement>; // Cast to ensure correct type;
    }
}
