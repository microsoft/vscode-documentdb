/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { Views } from '../../documentdb/Views';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType, ItemType } from '../../services/connectionStorageService';
import { DocumentDBClusterItem } from '../../tree/connections-view/DocumentDBClusterItem';
import { FolderItem } from '../../tree/connections-view/FolderItem';
import { LocalEmulatorsItem } from '../../tree/connections-view/LocalEmulators/LocalEmulatorsItem';
import { type TreeElement } from '../../tree/TreeElement';
import { getConfirmationAsInSettings } from '../../utils/dialogs/getConfirmation';
import { randomUtils } from '../../utils/randomUtils';
import { refreshView } from '../refreshView/refreshView';

/**
 * Paste items from clipboard to target location
 */
export async function pasteItems(context: IActionContext, targetElement?: TreeElement): Promise<void> {
    if (!ext.clipboardState || ext.clipboardState.items.length === 0) {
        void vscode.window.showWarningMessage(l10n.t('Clipboard is empty.'));
        return;
    }

    context.telemetry.properties.operation = ext.clipboardState.operation;
    context.telemetry.measurements.itemCount = ext.clipboardState.items.length;

    // Determine target parent ID and connection type
    let targetParentId: string | undefined;
    let targetConnectionType: ConnectionType;

    if (!targetElement) {
        // Paste to root of Clusters
        targetParentId = undefined;
        targetConnectionType = ConnectionType.Clusters;
    } else if (targetElement instanceof FolderItem) {
        // Paste into folder
        targetParentId = targetElement.storageId;
        targetConnectionType = ConnectionType.Clusters; // TODO: Get from folder
    } else if (targetElement instanceof LocalEmulatorsItem) {
        // Paste into LocalEmulators
        targetParentId = undefined;
        targetConnectionType = ConnectionType.Emulators;
    } else if (targetElement instanceof DocumentDBClusterItem) {
        // Paste as sibling to connection
        const connection = await ConnectionStorageService.get(
            targetElement.storageId,
            targetElement.cluster.emulatorConfiguration?.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters,
        );
        targetParentId = connection?.properties.parentId;
        targetConnectionType = targetElement.cluster.emulatorConfiguration?.isEmulator
            ? ConnectionType.Emulators
            : ConnectionType.Clusters;
    } else {
        void vscode.window.showErrorMessage(l10n.t('Cannot paste to this location.'));
        return;
    }

    // Confirm paste operation
    const confirmed = await getConfirmationAsInSettings(
        l10n.t('Confirm Paste'),
        l10n.t('Paste {count} item(s) to target location?', { count: ext.clipboardState.items.length }),
        'paste',
    );

    if (!confirmed) {
        throw new UserCancelledError();
    }

    const isCut = ext.clipboardState.operation === 'cut';
    const processedCount = {
        success: 0,
        skipped: 0,
    };

    try {
        for (const item of ext.clipboardState.items) {
            if (item instanceof FolderItem) {
                await pasteFolderItem(item, targetParentId, targetConnectionType, isCut, processedCount);
            } else if (item instanceof DocumentDBClusterItem) {
                await pasteConnectionItem(item, targetParentId, targetConnectionType, isCut, processedCount);
            }
        }

        // Clear clipboard if it was a cut operation
        if (isCut) {
            ext.clipboardState = undefined;
            await vscode.commands.executeCommand('setContext', 'documentdb.clipboardHasItems', false);
        }

        await refreshView(context, Views.ConnectionsView);

        void vscode.window.showInformationMessage(
            l10n.t(
                'Pasted {success} item(s). {skipped} item(s) skipped due to conflicts.',
                processedCount,
            ),
        );
    } catch (error) {
        void vscode.window.showErrorMessage(
            l10n.t('Failed to paste items: {error}', {
                error: error instanceof Error ? error.message : String(error),
            }),
        );
    }
}

async function pasteFolderItem(
    folderItem: FolderItem,
    targetParentId: string | undefined,
    targetConnectionType: ConnectionType,
    isCut: boolean,
    stats: { success: number; skipped: number },
): Promise<void> {
    // Get the folder from storage
    const sourceConnectionType = ConnectionType.Clusters; // TODO: Get from folder
    const folder = await ConnectionStorageService.get(folderItem.storageId, sourceConnectionType);

    if (!folder) {
        stats.skipped++;
        return;
    }

    // Check for duplicate names
    let targetName = folder.name;
    const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
        targetName,
        targetParentId,
        targetConnectionType,
        ItemType.Folder,
    );

    if (isDuplicate) {
        // Prompt for new name
        const newName = await vscode.window.showInputBox({
            prompt: l10n.t('A folder named "{name}" already exists. Enter a new name or cancel.', { name: targetName }),
            value: targetName,
            validateInput: async (value: string) => {
                if (!value || value.trim().length === 0) {
                    return l10n.t('Folder name cannot be empty');
                }

                const stillDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                    value.trim(),
                    targetParentId,
                    targetConnectionType,
                    ItemType.Folder,
                );

                if (stillDuplicate) {
                    return l10n.t('A folder with this name already exists');
                }

                return undefined;
            },
        });

        if (!newName) {
            stats.skipped++;
            return;
        }

        targetName = newName.trim();
    }

    if (isCut) {
        // Move folder
        if (sourceConnectionType === targetConnectionType) {
            // Same connection type, update parentId
            folder.properties.parentId = targetParentId;
            if (targetName !== folder.name) {
                folder.name = targetName;
            }
            await ConnectionStorageService.save(sourceConnectionType, folder, true);
        } else {
            // Different connection type, delete and recreate
            const newFolder = { ...folder };
            newFolder.properties.parentId = targetParentId;
            newFolder.name = targetName;
            await ConnectionStorageService.save(targetConnectionType, newFolder, false);
            await ConnectionStorageService.delete(sourceConnectionType, folder.id);

            // Move all descendants
            await moveDescendants(folder.id, newFolder.id, sourceConnectionType, targetConnectionType);
        }
    } else {
        // Copy folder with new ID
        const newId = randomUtils.getRandomUUID();
        const newFolder = {
            ...folder,
            id: newId,
            name: targetName,
            properties: {
                ...folder.properties,
                parentId: targetParentId,
            },
        };
        await ConnectionStorageService.save(targetConnectionType, newFolder, false);

        // Copy all descendants recursively
        await copyDescendants(folder.id, newId, sourceConnectionType, targetConnectionType);
    }

    stats.success++;
}

async function pasteConnectionItem(
    connectionItem: DocumentDBClusterItem,
    targetParentId: string | undefined,
    targetConnectionType: ConnectionType,
    isCut: boolean,
    stats: { success: number; skipped: number },
): Promise<void> {
    const sourceConnectionType = connectionItem.cluster.emulatorConfiguration?.isEmulator
        ? ConnectionType.Emulators
        : ConnectionType.Clusters;

    const connection = await ConnectionStorageService.get(connectionItem.storageId, sourceConnectionType);

    if (!connection) {
        stats.skipped++;
        return;
    }

    // Check for duplicate names
    let targetName = connection.name;
    const isDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
        targetName,
        targetParentId,
        targetConnectionType,
        ItemType.Connection,
    );

    if (isDuplicate) {
        // Prompt for new name
        const newName = await vscode.window.showInputBox({
            prompt: l10n.t('A connection named "{name}" already exists. Enter a new name or cancel.', {
                name: targetName,
            }),
            value: targetName,
            validateInput: async (value: string) => {
                if (!value || value.trim().length === 0) {
                    return l10n.t('Connection name cannot be empty');
                }

                const stillDuplicate = await ConnectionStorageService.isNameDuplicateInParent(
                    value.trim(),
                    targetParentId,
                    targetConnectionType,
                    ItemType.Connection,
                );

                if (stillDuplicate) {
                    return l10n.t('A connection with this name already exists');
                }

                return undefined;
            },
        });

        if (!newName) {
            stats.skipped++;
            return;
        }

        targetName = newName.trim();
    }

    if (isCut) {
        // Move connection
        if (sourceConnectionType === targetConnectionType) {
            connection.properties.parentId = targetParentId;
            if (targetName !== connection.name) {
                connection.name = targetName;
            }
            await ConnectionStorageService.save(sourceConnectionType, connection, true);
        } else {
            // Different connection type, delete and recreate
            const newConnection = { ...connection };
            newConnection.properties.parentId = targetParentId;
            newConnection.name = targetName;
            await ConnectionStorageService.save(targetConnectionType, newConnection, false);
            await ConnectionStorageService.delete(sourceConnectionType, connection.id);
        }
    } else {
        // Copy connection with new ID
        const newId = randomUtils.getRandomUUID();
        const newConnection = {
            ...connection,
            id: newId,
            name: targetName,
            properties: {
                ...connection.properties,
                parentId: targetParentId,
            },
        };
        await ConnectionStorageService.save(targetConnectionType, newConnection, false);
    }

    stats.success++;
}

async function moveDescendants(
    oldParentId: string,
    newParentId: string,
    sourceType: ConnectionType,
    targetType: ConnectionType,
): Promise<void> {
    const descendants = await ConnectionStorageService.getDescendants(oldParentId, sourceType);

    for (const descendant of descendants) {
        // Update parentId reference if it points to the old parent
        if (descendant.properties.parentId === oldParentId) {
            descendant.properties.parentId = newParentId;
        }

        // Create in target
        await ConnectionStorageService.save(targetType, descendant, false);

        // Delete from source
        await ConnectionStorageService.delete(sourceType, descendant.id);
    }
}

async function copyDescendants(
    sourceParentId: string,
    targetParentId: string,
    sourceType: ConnectionType,
    targetType: ConnectionType,
): Promise<void> {
    const children = await ConnectionStorageService.getChildren(sourceParentId, sourceType);

    for (const child of children) {
        const newId = randomUtils.getRandomUUID();
        const newItem = {
            ...child,
            id: newId,
            properties: {
                ...child.properties,
                parentId: targetParentId,
            },
        };

        await ConnectionStorageService.save(targetType, newItem, false);

        // Recursively copy descendants if it's a folder
        if (child.properties.type === ItemType.Folder) {
            await copyDescendants(child.id, newId, sourceType, targetType);
        }
    }
}
