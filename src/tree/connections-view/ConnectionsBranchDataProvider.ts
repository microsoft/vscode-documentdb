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
import { isTreeElementWithRetryChildren } from '../TreeElementWithRetryChildren';
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
                this.parentCache.clear();

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
                    if (item.id) {
                        this.parentCache.registerNode(item);
                    }
                }

                return rootItems;
            }

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
                // append helpful nodes to the error node
                children?.push(
                    createGenericElementWithContext({
                        contextValue: 'error',
                        id: `${element.id}/updateCredentials`,
                        label: vscode.l10n.t('Click here to update credentials'),
                        iconPath: new vscode.ThemeIcon('key'),
                        commandId: 'vscode-documentdb.command.connectionsView.updateCredentials',
                        commandArgs: [element],
                    }),
                );
                // Store the error node(s) in our cache for future refreshes
                this.errorNodeCache.set(element.id, children ?? []);
                context.telemetry.properties.cachedErrorNode = 'true';
            }

            return children?.map((child) => {
                if (child.id) {
                    if (isTreeElementWithContextValue(child)) {
                        this.appendContextValues(child, Views.ConnectionsView);
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

    /**
     * Helper function to get the root items of the connections tree.
     */
    private async getRootItems(parentId: string): Promise<TreeElement[] | null | undefined> {
        const connectionItems = await ConnectionStorageService.getAll(ConnectionType.Clusters);

        if (connectionItems.length === 0) {
            /**
             * we have a special case here as we want to show a "welcome screen" in the case when no connections were found.
             * However, we need to lookup the emulator items as well, so we need to check if there are any emulators.
             */
            const emulatorItems = await ConnectionStorageService.getAll(ConnectionType.Emulators);
            if (emulatorItems.length === 0) {
                return null;
            }
        }

        const rootItems = [
            new LocalEmulatorsItem(parentId),
            ...connectionItems.map((connection: ConnectionItem) => {
                const model: ClusterModelWithStorage = {
                    id: `${parentId}/${connection.id}`,
                    storageId: connection.id,
                    name: connection.name,
                    dbExperience: DocumentDBExperience,
                    connectionString: connection?.secrets?.connectionString ?? undefined,
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
