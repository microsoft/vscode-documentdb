/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { ConnectionDiagnosticsService } from '../../services/connectionDiagnosticsService';
import { ConnectionStorageService, ConnectionType, isConnection } from '../../services/connectionStorageService';
import { isLegacyEmulatorMigrationComplete } from '../../services/legacyEmulatorMigration';
import { createGenericElementWithContext } from '../api/createGenericElementWithContext';
import { BaseExtendedTreeDataProvider } from '../BaseExtendedTreeDataProvider';
import { CLUSTER_ITEM_CONTEXT_VALUE } from '../documentdb/ClusterItemBase';
import { type TreeCluster } from '../models/BaseClusterModel';
import { type TreeElement } from '../TreeElement';
import { isTreeElementWithContextValue } from '../TreeElementWithContextValue';
import { DocumentDBClusterItem } from './DocumentDBClusterItem';
import { LocalEmulatorsItem } from './LocalEmulators/LocalEmulatorsItem';
import { LocalQuickStartItem } from './LocalQuickStart/LocalQuickStartItem';
import { type ConnectionClusterModel } from './models/ConnectionClusterModel';
import { NewConnectionItemCV } from './NewConnectionItemCV';
import { resolveConnectionsClusterTreeId } from './resolveConnectionsClusterTreeId';

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

    /**
     * Drop the cached error children of the Local Quick Start subtree (review I2-17).
     *
     * `failedChildrenCache` freezes a node's children once it is classified as failed and returns
     * them without re-fetching. When the user then fixes the problem OUTSIDE the tree — typically in
     * the Quick Start webview — the row would keep rendering the stale error node until a manual
     * collapse/expand. Callers invoke this before `refresh()`, mirroring
     * `AtlasDiscoveryProvider.onDidChangeSession`, which resets before refreshing so a
     * successfully authenticated user stops seeing the "Sign in" node.
     */
    public resetLocalQuickStartErrorState(): void {
        for (const nodeId of [...this.failedChildrenCache.keys()]) {
            if (nodeId.includes('/localQuickStart')) {
                this.resetNodeErrorState(nodeId);
            }
        }
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

                // Count only real saved connections/folders, excluding the synthetic
                // structural nodes (Quick Start, Local emulators, New Connection).
                context.telemetry.measurements.savedConnections = rootItems.filter((item) => {
                    if (!isTreeElementWithContextValue(item)) {
                        return false;
                    }
                    const contextValue = item.contextValue.toLowerCase();
                    return contextValue.includes('documentdbcluster') || contextValue.includes('treeitem_folder');
                }).length;

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
            const children = await this.getChildrenWithDiagnostics(element, context);

            // Return the processed children directly - no additional processing needed
            return children;
        });
    }

    /**
     * Single point where a failed expansion below a cluster is translated into something the user
     * can act on (a stopped DocumentDB Local container, a port-forward tunnel that is no longer up,
     * an Atlas TLS rejection). Placed here rather than in each tree item so databases, collections,
     * indexes and anything added later are covered without repeating the same catch.
     *
     * The error itself is never modified: we only choose what to display, then rethrow it unchanged
     * so telemetry and every downstream identity check keep working. Cluster nodes handle their own
     * failures in `ClusterItemBase`, so they never reach this catch.
     */
    private async getChildrenWithDiagnostics(
        element: TreeElement,
        context: IActionContext,
    ): Promise<TreeElement[] | null | undefined> {
        try {
            return await this.wrapGetChildrenWithErrorAndStateHandling(
                element,
                context,
                async () => element.getChildren?.(),
                {
                    contextValue: Views.ConnectionsView, // This enables automatic child processing
                    // View-specific error-recovery action added at the provider level. The element
                    // layer (ClusterItemBase) already owns failure-type recovery nodes ("retry" and,
                    // for post-auth failures, "open shell"); here we add the Connections-view action
                    // for updating stored credentials.
                    //
                    // `forContextValues` is a whitelist matched against the FAILING element's
                    // contextValue tags. "Update credentials" only makes sense for stored cluster
                    // connections, so we gate it to CLUSTER_ITEM_CONTEXT_VALUE. Without this gate the
                    // action would also appear when a non-cluster node (a database, collection, or
                    // index) fails to load its children.
                    errorRecoveryActions: [
                        {
                            forContextValues: [CLUSTER_ITEM_CONTEXT_VALUE],
                            create: (el) => [
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
                    ],
                },
            );
        } catch (error) {
            // Cluster nodes and everything below them carry the same `cluster` model but share no
            // interface, so this is structural rather than an `instanceof`.
            const clusterId = (element as { cluster?: { clusterId?: string } }).cluster?.clusterId;
            const diagnosis = clusterId ? await ConnectionDiagnosticsService.explain({ clusterId, error }) : undefined;

            if (diagnosis) {
                context.telemetry.properties.diagnosisProviderId = diagnosis.providerId;
                context.errorHandling.suppressDisplay = true;
                void vscode.window.showErrorMessage(diagnosis.message, {
                    modal: false,
                    detail: error instanceof Error ? error.message : String(error),
                });
            }

            throw error;
        }
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
             * Even with no saved connections, the Quick Start node must render — its
             * managed instance is service-owned/in-memory (not a stored connection),
             * so it cannot depend on the stored-connection count. Returning it here
             * (instead of `null`) replaces the bare welcome screen with the Quick
             * Start entry point on a fresh machine.
             */
            const quickStartOnly = new LocalQuickStartItem(parentId);
            return [
                ext.state.wrapItemInStateHandling(quickStartOnly, () => this.refresh(quickStartOnly)) as TreeElement,
            ];
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
            const model: TreeCluster<ConnectionClusterModel> = {
                // Tree context (computed at runtime)
                treeId: `${parentId}/${connection.id}`, // Hierarchical tree path
                viewId: parentId, // View ID is the root parent

                // Connection cluster data
                clusterId: connection.id, // Stable storageId for cache lookups
                storageId: connection.id,
                storageZone: ConnectionType.Clusters,
                name: connection.name,
                dbExperience: DocumentDBExperience,
                connectionString: connection.secrets.connectionString,
                emulatorConfiguration: connection.properties.emulatorConfiguration,
                selectedAuthMethod: connection.properties.selectedAuthMethod,
                connectionUser: connection.secrets.nativeAuthConfig?.connectionUser,
            };

            ext.outputChannel.trace(
                `[ConnectionsView] Created cluster model: name="${model.name}", clusterId="${model.clusterId}", treeId="${model.treeId}"`,
            );

            return new DocumentDBClusterItem(model);
        });

        // Sort folders alphabetically by name
        clusterFolderItems.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        // Sort connections alphabetically by name
        clusterItems.sort((a, b) => a.cluster.name.localeCompare(b.cluster.name, undefined, { numeric: true }));

        // Show "New Connection" only if there are no cluster folders or connections
        // (don't count the LocalEmulatorsItem - it's always shown)
        const hasClusterItems = clusterFolderItems.length > 0 || clusterItems.length > 0;
        const newConnectionItem = hasClusterItems ? [] : [new NewConnectionItemCV(parentId)];

        const rootItems = [
            new LocalQuickStartItem(parentId),
            // The legacy emulator node is retired once its connections have been migrated
            // into a regular "Local Connections (Legacy)" folder (design §4). Until the
            // one-time migration succeeds it stays visible so nothing is hidden un-migrated.
            ...(isLegacyEmulatorMigrationComplete() ? [] : [new LocalEmulatorsItem(parentId)]),
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
     * Stored connections resolve their current folder path from storage. Feature-owned synthetic
     * clusters, such as the Quick Start managed instance, resolve through their owning feature.
     *
     * @param clusterId The stable cluster identifier
     * @param databaseName The database name
     * @param collectionName The collection name
     * @returns A Promise that resolves to the found CollectionItem or undefined if not found
     */
    async findCollectionByClusterId(
        clusterId: string,
        databaseName: string,
        collectionName: string,
    ): Promise<TreeElement | undefined> {
        const treeId = await resolveConnectionsClusterTreeId(clusterId);
        if (!treeId) {
            return undefined;
        }

        // Build the full node ID for the collection
        const nodeId = `${treeId}/${databaseName}/${collectionName}`;

        // Use the standard findNodeById with recursive search enabled
        return this.findNodeById(nodeId, true);
    }

    /**
     * Finds a cluster node by its stable cluster identifier (storageId).
     *
     * Uses the same ownership-aware resolution as collection lookup so synthetic and persisted
     * clusters remain consistent.
     *
     * @param clusterId The stable cluster identifier
     * @returns A Promise that resolves to the found cluster tree element or undefined
     */
    async findClusterNodeByClusterId(clusterId: string): Promise<TreeElement | undefined> {
        const treeId = await resolveConnectionsClusterTreeId(clusterId);
        if (!treeId) {
            return undefined;
        }

        // Use the standard findNodeById with recursive search enabled
        return this.findNodeById(treeId, true);
    }
}
