/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType, isConnection } from '../../services/connectionStorageService';
import { createGenericElementWithContext } from '../api/createGenericElementWithContext';
import { BaseExtendedTreeDataProvider } from '../BaseExtendedTreeDataProvider';
import { type ClusterModelWithStorage } from '../documentdb/ClusterModel';
import { type TreeElement } from '../TreeElement';
import { isTreeElementWithContextValue } from '../TreeElementWithContextValue';
import { DocumentDBClusterItem } from './DocumentDBClusterItem';
import { LocalEmulatorsItem } from './LocalEmulators/LocalEmulatorsItem';
import { NewConnectionItemCV } from './NewConnectionItemCV';

/**
 * Tree data provider for the Connections view.
 *
 * This provider manages the display of database connections, including clusters and local emulators.
 *
 * ## Integration with TreeParentCache
 *
 * This class uses TreeParentCache to implement the getParent and findNodeById methods required by
 * the ExtendedTreeDataProvider interface. The caching mechanism enables:
 *
 * 1. Efficient implementation of tree.reveal() functionality to navigate to specific nodes
 * 2. Finding nodes by ID without traversing the entire tree each time
 * 3. Proper cleanup when refreshing parts of the tree
 *
 * When building the tree:
 * - Root items are registered directly with registerNode
 * - Child-parent relationships are registered with registerRelationship during getChildren
 * - The cache is selectively cleared during refresh operations
 */
export class ConnectionsBranchDataProvider extends BaseExtendedTreeDataProvider<TreeElement> {
    constructor() {
        super();
    }

    async getChildren(element?: TreeElement): Promise<TreeElement[] | null | undefined> {
        return callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.view = Views.ConnectionsView;

            if (!element) {
                context.telemetry.properties.parentNodeContext = 'root';

                // For root-level items, we should clear any existing cache first
                this.clearParentCache();

                const rootItems = await this.getRootItems(Views.ConnectionsView);
                if (!rootItems) {
                    return null;
                }

                context.telemetry.measurements.savedConnections = rootItems.length - 2; // count - 'DocumentDB Local' and 'New Connection'

                // Now process and add each root item to the cache
                for (const item of rootItems) {
                    if (isTreeElementWithContextValue(item)) {
                        this.appendContextValues(item, Views.ConnectionsView);
                    }

                    // Add root items to the cache
                    this.registerNodeInCache(item);
                }

                return rootItems;
            }

            context.telemetry.properties.parentNodeContext = (await element.getTreeItem()).contextValue;

            // Use the enhanced method with the contextValue parameter
            const children = await this.wrapGetChildrenWithErrorAndStateHandling(
                element,
                context,
                async () => element.getChildren?.(),
                {
                    contextValue: Views.ConnectionsView, // This enables automatic child processing
                    createHelperNodes: (el) => [
                        createGenericElementWithContext({
                            contextValue: 'error',
                            id: `${el.id}/updateCredentials`,
                            label: vscode.l10n.t('Click here to update credentials'),
                            iconPath: new vscode.ThemeIcon('key'),
                            commandId: 'vscode-documentdb.command.connectionsView.updateCredentials',
                            commandArgs: [el],
                        }) as TreeElement,
                    ],
                },
            );

            // Return the processed children directly - no additional processing needed
            return children;
        });
    }

    /**
     * Helper function to get the root items of the connections tree.
     */
    private async getRootItems(parentId: string): Promise<TreeElement[] | null | undefined> {
        // Check if there are any connections at all (for welcome screen logic)
        const allConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);
        const allEmulators = await ConnectionStorageService.getAll(ConnectionType.Emulators);

        if (allConnections.length === 0 && allEmulators.length === 0) {
            /**
             * we have a special case here as we want to show a "welcome screen" in the case when no connections were found.
             */
            return null;
        }

        // Import FolderItem and ItemType
        const { FolderItem } = await import('./FolderItem');
        const { ItemType } = await import('../../services/connectionStorageService');

        // Get root-level items (parentId = undefined) for clusters only
        // Emulators are handled by LocalEmulatorsItem and should not be at root
        const rootFoldersClusters = await ConnectionStorageService.getChildren(
            undefined,
            ConnectionType.Clusters,
            ItemType.Folder,
        );
        const rootConnectionsClusters = await ConnectionStorageService.getChildren(
            undefined,
            ConnectionType.Clusters,
            ItemType.Connection,
        );

        const clusterFolderItems = rootFoldersClusters.map(
            (folder) => new FolderItem(folder, parentId, ConnectionType.Clusters),
        );

        // Filter with type guard to ensure type safety for connection-specific properties
        const clusterItems = rootConnectionsClusters.filter(isConnection).map((connection) => {
            const model: ClusterModelWithStorage = {
                treeId: `${parentId}/${connection.id}`, // Hierarchical tree path
                clusterId: connection.id, // Stable storageId for cache lookups
                id: `${parentId}/${connection.id}`,
                storageId: connection.id,
                name: connection.name,
                dbExperience: DocumentDBExperience,
                connectionString: connection.secrets.connectionString,
                emulatorConfiguration: connection.properties.emulatorConfiguration,
            };

            return new DocumentDBClusterItem(model);
        });

        // Sort folders alphabetically by name
        clusterFolderItems.sort((a, b) => a.name.localeCompare(b.name));

        // Sort connections alphabetically by name
        clusterItems.sort((a, b) => a.cluster.name.localeCompare(b.cluster.name));

        // Show "New Connection" only if there are no cluster folders or connections
        // (don't count the LocalEmulatorsItem - it's always shown)
        const hasClusterItems = clusterFolderItems.length > 0 || clusterItems.length > 0;
        const newConnectionItem = hasClusterItems ? [] : [new NewConnectionItemCV(parentId)];

        const rootItems = [
            new LocalEmulatorsItem(parentId),
            ...clusterFolderItems,
            ...clusterItems,
            ...newConnectionItem,
        ];

        return rootItems.map(
            (item) => ext.state.wrapItemInStateHandling(item, () => this.refresh(item)) as TreeElement,
        );
    }

    /**
     * Finds a collection node by its cluster's stable identifier (storageId).
     *
     * For Connections View, the clusterId is the storageId (UUID like 'storageId-xxx').
     * This method resolves the current tree path from storage, handling folder moves.
     *
     * @param clusterId The stable cluster identifier (storageId)
     * @param databaseName The database name
     * @param collectionName The collection name
     * @returns A Promise that resolves to the found CollectionItem or undefined if not found
     */
    async findCollectionByClusterId(
        clusterId: string,
        databaseName: string,
        collectionName: string,
    ): Promise<TreeElement | undefined> {
        // Resolve the current tree path from storage - this handles folder moves
        const { buildFullTreePath } = await import('./connectionsViewHelpers');
        const treeId = await buildFullTreePath(clusterId, ConnectionType.Clusters);

        // Build the full node ID for the collection
        const nodeId = `${treeId}/${databaseName}/${collectionName}`;

        // Use the standard findNodeById with recursive search enabled
        return this.findNodeById(nodeId, true);
    }
}
