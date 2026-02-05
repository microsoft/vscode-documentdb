/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizard, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import {
    ConnectionStorageService,
    ConnectionType,
    type ConnectionItem,
} from '../../../services/connectionStorageService';
import { DocumentDBClusterItem } from '../../../tree/connections-view/DocumentDBClusterItem';
import { FolderItem } from '../../../tree/connections-view/FolderItem';
import { type TreeElement } from '../../../tree/TreeElement';
import { ConfirmMoveStep } from './ConfirmMoveStep';
import { ExecuteStep } from './ExecuteStep';
import { type MoveItemsWizardContext } from './MoveItemsWizardContext';
import { PromptTargetFolderStep } from './PromptTargetFolderStep';
import { VerifyNoConflictsStep } from './VerifyNoConflictsStep';

/**
 * Interface for tree elements that can be moved
 */
interface MovableTreeElement extends TreeElement {
    storageId: string;
    connectionType?: ConnectionType;
}

/**
 * Move selected items to a different folder.
 * Supports both connections and folders, with multi-select.
 *
 * VS Code tree view multi-select passes:
 * - clickedItem: The item that was right-clicked
 * - selectedItems: Array of all selected items (including clickedItem)
 */
export async function moveItems(
    context: IActionContext,
    clickedItem: TreeElement,
    selectedItems?: TreeElement[],
): Promise<void> {
    // Use selectedItems if provided (multi-select), otherwise use just the clicked item
    const items = selectedItems && selectedItems.length > 0 ? selectedItems : clickedItem ? [clickedItem] : [];

    if (items.length === 0) {
        void vscode.window.showWarningMessage(l10n.t('No items selected to move.'));
        return;
    }

    // Filter to only movable items (connections and folders)
    const movableItems = items.filter(
        (item): item is MovableTreeElement => item instanceof DocumentDBClusterItem || item instanceof FolderItem,
    );

    if (movableItems.length === 0) {
        void vscode.window.showWarningMessage(l10n.t('Selected items cannot be moved.'));
        return;
    }

    // Validate all items are in the same zone (Clusters or Emulators)
    const connectionType = getConnectionType(movableItems[0]);
    const allSameZone = movableItems.every((item) => getConnectionType(item) === connectionType);

    if (!allSameZone) {
        void vscode.window.showErrorMessage(
            l10n.t(
                'We can\'t move items between "DocumentDB Local" and regular connections. Please select items from only one of those areas at a time.',
            ),
        );
        return;
    }

    // Load full connection items from storage
    const itemsToMove: ConnectionItem[] = [];
    for (const item of movableItems) {
        const connectionItem = await ConnectionStorageService.get(item.storageId, connectionType);
        if (connectionItem) {
            itemsToMove.push(connectionItem);
        }
    }

    if (itemsToMove.length === 0) {
        void vscode.window.showErrorMessage(l10n.t('Failed to load selected items from storage.'));
        return;
    }

    // Determine source folder ID (for filtering from picker)
    // If all items share the same parent, use that; otherwise undefined (mixed parents)
    const sourceFolderId = getCommonParentId(itemsToMove);

    // Create wizard context - initialize arrays as [] to survive back navigation
    const wizardContext: MoveItemsWizardContext = {
        ...context,
        itemsToMove,
        connectionType,
        sourceFolderId,
        targetFolderId: undefined,
        targetFolderPath: undefined,
        cachedFolderList: [], // Initialize as [] to survive back navigation
        conflictingTasks: [], // Populated by VerifyNoConflictsStep
        conflictingNames: [], // Populated by VerifyNoConflictsStep
    };

    const wizard = new AzureWizard(wizardContext, {
        title: l10n.t('Move to Folder...'),
        promptSteps: [
            new PromptTargetFolderStep(),
            new VerifyNoConflictsStep(), // Verify no task or naming conflicts before moving
            new ConfirmMoveStep(),
        ],
        executeSteps: [new ExecuteStep()],
    });

    await wizard.prompt();
    await wizard.execute();
}

/**
 * Get the connection type for a movable tree element
 */
function getConnectionType(item: MovableTreeElement): ConnectionType {
    if (item instanceof FolderItem) {
        return item.connectionType;
    }

    if (item instanceof DocumentDBClusterItem) {
        return item.cluster.emulatorConfiguration?.isEmulator ? ConnectionType.Emulators : ConnectionType.Clusters;
    }

    // Default fallback
    return ConnectionType.Clusters;
}

/**
 * Get the common parent ID if all items share the same parent.
 * Returns undefined if items have different parents or are at root.
 */
function getCommonParentId(items: ConnectionItem[]): string | undefined {
    if (items.length === 0) {
        return undefined;
    }

    const firstParentId = items[0].properties.parentId;

    // Check if all items have the same parent
    const allSameParent = items.every((item) => item.properties.parentId === firstParentId);

    return allSameParent ? firstParentId : undefined;
}
