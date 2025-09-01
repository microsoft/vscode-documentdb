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
                    contextValue: 'ruBranch', // This enables automatic child processing
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

            // Register item for refresh when cache loading completes
            this.metadataLoader.addItemForRefresh(resource.id, clusterItem);

            return clusterItem;
        }) as TreeElement | Thenable<TreeElement>; // Cast to ensure correct type;
    }
}
