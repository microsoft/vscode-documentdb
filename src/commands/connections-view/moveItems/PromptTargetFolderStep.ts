/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureWizardPromptStep } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ConnectionStorageService, ItemType, type ConnectionItem } from '../../../services/connectionStorageService';
import { type FolderPickItem, type MoveItemsWizardContext } from './MoveItemsWizardContext';

/**
 * Step to prompt user to select target folder for moving items.
 * Uses async getQuickPickItems pattern for loading indicator.
 */
export class PromptTargetFolderStep extends AzureWizardPromptStep<MoveItemsWizardContext> {
    public async prompt(context: MoveItemsWizardContext): Promise<void> {
        // Async function pattern - VS Code shows loading indicator while resolving
        const getQuickPickItems = async (): Promise<FolderPickItem[]> => {
            // Use cached list if available (survives back navigation)
            if (context.cachedFolderList.length > 0) {
                return context.cachedFolderList;
            }

            const folders = await this.getAvailableFolders(context);
            context.cachedFolderList = folders; // Cache for back navigation
            return folders;
        };

        const picked = await context.ui.showQuickPick(getQuickPickItems(), {
            placeHolder: l10n.t('Select destination folder'),
            title: l10n.t('Move to Folder...'),
        });

        context.targetFolderId = picked.data?.id;
        context.targetFolderPath = picked.label;
    }

    public shouldPrompt(): boolean {
        return true;
    }

    private async getAvailableFolders(context: MoveItemsWizardContext): Promise<FolderPickItem[]> {
        // Get all folders in this zone (we only need folders for targets and path building)
        const allFolders = (await ConnectionStorageService.getAllItems(context.connectionType)).filter(
            (item) => item.properties.type === ItemType.Folder,
        );

        // Get IDs of items being moved and their descendants
        const movingIds = new Set(context.itemsToMove.map((item) => item.id));
        const excludeDescendantIds = await this.getDescendantIds(context);

        // Get IDs of parent folders of items being moved (to exclude current location)
        const currentParentIds = new Set(
            context.itemsToMove.map((item) => item.properties.parentId).filter((id): id is string => id !== undefined),
        );

        // Filter folders to exclude:
        // 1. Folders being moved (can't move folder into itself)
        // 2. Descendants of folders being moved (prevents circular reference)
        // 3. Current parent folders (no point moving to same location)
        const folderItems = allFolders
            .filter(
                (folder) =>
                    !movingIds.has(folder.id) &&
                    !excludeDescendantIds.has(folder.id) &&
                    !currentParentIds.has(folder.id),
            )
            .map((folder) => ({
                label: this.buildFolderPath(folder, allFolders),
                description: undefined,
                iconPath: new vscode.ThemeIcon('folder-library'),
                data: folder,
            }))
            .sort((a, b) => a.label.localeCompare(b.label)); // Alphabetical sort

        // Determine if ALL source items are currently at root level
        const allItemsAtRoot = context.itemsToMove.every((item) => item.properties.parentId === undefined);

        // Build the root option with folder icon
        const rootOption: FolderPickItem = {
            label: l10n.t('/ (Root)'),
            description: l10n.t('Move to top level'),
            iconPath: new vscode.ThemeIcon('folder-library'),
            data: undefined,
        };

        // Include root option only if items are NOT all at root level already
        // (no point moving from root to root)
        return allItemsAtRoot ? folderItems : [rootOption, ...folderItems];
    }

    /**
     * Build the display path for a folder (e.g., "Development / Backend")
     */
    private buildFolderPath(folder: ConnectionItem, allFolders: ConnectionItem[]): string {
        const pathParts: string[] = [folder.name];

        let currentParentId = folder.properties.parentId;
        while (currentParentId) {
            const parent = allFolders.find((f) => f.id === currentParentId);
            if (parent) {
                pathParts.unshift(parent.name);
                currentParentId = parent.properties.parentId;
            } else {
                break;
            }
        }

        return pathParts.join(' / ');
    }

    /**
     * Get all descendant folder IDs of the items being moved.
     * This prevents moving a folder into its own children.
     */
    private async getDescendantIds(context: MoveItemsWizardContext): Promise<Set<string>> {
        const descendantIds = new Set<string>();

        // Only folders have descendants
        const foldersBeingMoved = context.itemsToMove.filter((item) => item.properties.type === ItemType.Folder);

        for (const folder of foldersBeingMoved) {
            await this.collectDescendants(folder.id, context.connectionType, descendantIds);
        }

        return descendantIds;
    }

    private async collectDescendants(
        folderId: string,
        connectionType: MoveItemsWizardContext['connectionType'],
        descendantIds: Set<string>,
    ): Promise<void> {
        const children = await ConnectionStorageService.getChildren(folderId, connectionType, ItemType.Folder);

        for (const child of children) {
            descendantIds.add(child.id);
            await this.collectDescendants(child.id, connectionType, descendantIds);
        }
    }
}
