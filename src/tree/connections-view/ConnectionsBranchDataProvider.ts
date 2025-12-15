/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType, type ConnectionItem } from '../../services/connectionStorageService';
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
        const connectionItems = await ConnectionStorageService.getAll(ConnectionType.Clusters);
        const emulatorItems = await ConnectionStorageService.getAll(ConnectionType.Emulators);

        if (connectionItems.length === 0 && emulatorItems.length === 0) {
            /**
             * we have a special case here as we want to show a "welcome screen" in the case when no connections were found.
             */
            return null;
        }

        // Import FolderItem and ItemType
        const { FolderItem } = await import('./FolderItem');
        const { ItemType } = await import('../../services/connectionStorageService');

        // Get root-level folders from both connection types
        const rootFoldersClusters = await ConnectionStorageService.getChildren(undefined, ConnectionType.Clusters);
        const rootFoldersEmulators = await ConnectionStorageService.getChildren(undefined, ConnectionType.Emulators);

        const clusterFolderItems = rootFoldersClusters
            .filter((item) => item.properties.type === ItemType.Folder)
            .map((folder) => new FolderItem(folder, parentId, ConnectionType.Clusters));

        const emulatorFolderItems = rootFoldersEmulators
            .filter((item) => item.properties.type === ItemType.Folder)
            .map((folder) => new FolderItem(folder, parentId, ConnectionType.Emulators));

        // Filter connections to only show those not in any folder (root-level connections)
        const allConnections = [...connectionItems, ...emulatorItems];
        const rootConnections = allConnections.filter(
            (connection) => connection.properties.type === ItemType.Connection && !connection.properties.parentId,
        );

        const rootItems = [
            new LocalEmulatorsItem(parentId),
            ...clusterFolderItems,
            ...emulatorFolderItems,
            ...rootConnections.map((connection: ConnectionItem) => {
                const model: ClusterModelWithStorage = {
                    id: `${parentId}/${connection.id}`,
                    storageId: connection.id,
                    name: connection.name,
                    dbExperience: DocumentDBExperience,
                    connectionString: connection?.secrets?.connectionString ?? undefined,
                    emulatorConfiguration: connection.properties.emulatorConfiguration,
                };

                return new DocumentDBClusterItem(model);
            }),
            new NewConnectionItemCV(parentId),
        ];

        return rootItems.map(
            (item) => ext.state.wrapItemInStateHandling(item, () => this.refresh(item)) as TreeElement,
        );
    }
}
