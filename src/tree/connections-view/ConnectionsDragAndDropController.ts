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

                // Check if crossing emulator boundary
                if (sourceConnectionType !== targetConnectionType) {
                    const crossBoundary = await vscode.window.showWarningMessage(
                        l10n.t(
                            'You are moving items between emulator and non-emulator areas. This may cause issues. Continue?',
                        ),
                        { modal: true },
                        l10n.t('Continue'),
                        l10n.t('Cancel'),
                    );

                    if (crossBoundary !== l10n.t('Continue')) {
                        continue;
                    }
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

                // Prevent moving folder into itself or its descendants
                if (sourceItem.properties.type === ItemType.Folder && targetParentId) {
                    const descendants = await ConnectionStorageService.getDescendants(
                        sourceItem.id,
                        sourceConnectionType,
                    );
                    if (descendants.some((d) => d.id === targetParentId) || sourceItem.id === targetParentId) {
                        void vscode.window.showErrorMessage(
                            l10n.t('Cannot move a folder into itself or its descendants.'),
                        );
                        continue;
                    }
                }

                // If crossing boundaries, we need to delete from old and create in new
                if (sourceConnectionType !== targetConnectionType) {
                    // Create in target
                    const newItem = { ...sourceItem };
                    newItem.properties.parentId = targetParentId;
                    await ConnectionStorageService.save(targetConnectionType, newItem, false);

                    // Delete from source
                    await ConnectionStorageService.delete(sourceConnectionType, sourceItem.id);

                    // If it's a folder, move all descendants too
                    if (sourceItem.properties.type === ItemType.Folder) {
                        await this.moveDescendantsAcrossBoundaries(
                            sourceItem.id,
                            newItem.id,
                            sourceConnectionType,
                            targetConnectionType,
                        );
                    }
                } else {
                    // Same connection type, just update parentId
                    await ConnectionStorageService.updateParentId(sourceItem.id, sourceConnectionType, targetParentId);
                }
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

    /**
     * Helper to move folder descendants when crossing connection type boundaries
     */
    private async moveDescendantsAcrossBoundaries(
        oldParentId: string,
        newParentId: string,
        sourceType: ConnectionType,
        targetType: ConnectionType,
    ): Promise<void> {
        const descendants = await ConnectionStorageService.getDescendants(oldParentId, sourceType);

        for (const descendant of descendants) {
            // Update parentId reference
            const newItem = { ...descendant };
            if (newItem.properties.parentId === oldParentId) {
                newItem.properties.parentId = newParentId;
            }

            // Create in target
            await ConnectionStorageService.save(targetType, newItem, false);

            // Delete from source
            await ConnectionStorageService.delete(sourceType, descendant.id);
        }
    }
}
