/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType, ItemType } from '../../services/connectionStorageService';
import { type TreeElement } from '../TreeElement';
import { DocumentDBClusterItem } from './DocumentDBClusterItem';
import { FolderItem } from './FolderItem';
import { LocalEmulatorsItem } from './LocalEmulators/LocalEmulatorsItem';

/**
 * Drag and drop controller for the Connections View.
 * Enables moving connections and folders via drag-and-drop.
 */
export class ConnectionsDragAndDropController implements vscode.TreeDragAndDropController<TreeElement> {
    dropMimeTypes = ['application/vnd.code.tree.connectionsView'];
    dragMimeTypes = ['application/vnd.code.tree.connectionsView'];

    public async handleDrag(
        source: readonly TreeElement[],
        dataTransfer: vscode.DataTransfer,
    ): Promise<void> {
        // Store the source items in the data transfer
        const items = source.filter((item) => {
            // Don't allow dragging LocalEmulatorsItem or NewConnectionItemCV
            return item instanceof FolderItem || item instanceof DocumentDBClusterItem;
        });

        if (items.length === 0) {
            return;
        }

        dataTransfer.set(
            'application/vnd.code.tree.connectionsView',
            new vscode.DataTransferItem(items.map((item) => item.id)),
        );
    }

    public async handleDrop(
        target: TreeElement | undefined,
        dataTransfer: vscode.DataTransfer,
        token: vscode.CancellationToken,
    ): Promise<void> {
        if (token.isCancellationRequested) {
            return;
        }

        const transferItem = dataTransfer.get('application/vnd.code.tree.connectionsView');
        if (!transferItem) {
            return;
        }

        const sourceIds = transferItem.value as string[];
        if (!sourceIds || sourceIds.length === 0) {
            return;
        }

        try {
            // Determine target parent ID and connection type
            let targetParentId: string | undefined;
            let targetConnectionType: ConnectionType;

            if (!target) {
                // Drop to root of Clusters
                targetParentId = undefined;
                targetConnectionType = ConnectionType.Clusters;
            } else if (target instanceof FolderItem) {
                // Drop into folder
                targetParentId = target.storageId;
                // TODO: Properly determine connection type from folder
                targetConnectionType = ConnectionType.Clusters;
            } else if (target instanceof LocalEmulatorsItem) {
                // Drop into LocalEmulators
                targetParentId = undefined;
                targetConnectionType = ConnectionType.Emulators;
            } else if (target instanceof DocumentDBClusterItem) {
                // Drop onto connection - use its parent folder
                const connection = await ConnectionStorageService.get(
                    target.storageId,
                    target.cluster.emulatorConfiguration?.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters,
                );
                targetParentId = connection?.properties.parentId;
                targetConnectionType = target.cluster.emulatorConfiguration?.isEmulator
                    ? ConnectionType.Emulators
                    : ConnectionType.Clusters;
            } else {
                return; // Can't drop here
            }

            // Process each source item
            for (const sourceId of sourceIds) {
                // Try to find the item in both connection types
                let sourceItem = await ConnectionStorageService.get(sourceId, ConnectionType.Clusters);
                let sourceConnectionType = ConnectionType.Clusters;

                if (!sourceItem) {
                    sourceItem = await ConnectionStorageService.get(sourceId, ConnectionType.Emulators);
                    sourceConnectionType = ConnectionType.Emulators;
                }

                if (!sourceItem) {
                    continue; // Item not found
                }

                // Block crossing emulator boundary
                if (sourceConnectionType !== targetConnectionType) {
                    void vscode.window.showErrorMessage(
                        l10n.t('Cannot move items between emulator and non-emulator areas.'),
                    );
                    continue;
                }

                // Check for duplicate names
                const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                    sourceItem.name,
                    targetParentId,
                    targetConnectionType,
                    sourceItem.properties.type,
                    sourceItem.id,
                );

                if (isDuplicate) {
                    void vscode.window.showErrorMessage(
                        l10n.t('An item named "{name}" already exists in the target folder.', {
                            name: sourceItem.name,
                        }),
                    );
                    continue;
                }

                // Prevent moving folder into itself or its descendants using getPath
                if (sourceItem.properties.type === ItemType.Folder && targetParentId) {
                    try {
                        const targetPath = await ConnectionStorageService.getPath(targetParentId, targetConnectionType);
                        const sourcePath = await ConnectionStorageService.getPath(sourceItem.id, sourceConnectionType);
                        
                        // Check if target path starts with source path (would be circular)
                        if (targetPath.startsWith(sourcePath + '/') || targetPath === sourcePath) {
                            void vscode.window.showErrorMessage(
                                l10n.t('Cannot move a folder into itself or its descendants.'),
                            );
                            continue;
                        }
                    } catch (error) {
                        // If path resolution fails, skip this item
                        continue;
                    }
                }

                // Update the item's parentId (simple operation, no recursion needed)
                await ConnectionStorageService.updateParentId(sourceItem.id, sourceConnectionType, targetParentId);
            }

            // Refresh the tree
            ext.connectionsBranchDataProvider.refresh();
        } catch (error) {
            void vscode.window.showErrorMessage(
                l10n.t('Failed to move items: {error}', {
                    error: error instanceof Error ? error.message : String(error),
                }),
            );
        }
    }
}
