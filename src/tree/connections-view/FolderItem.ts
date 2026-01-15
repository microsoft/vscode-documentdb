/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import {
    ConnectionStorageService,
    ItemType,
    type ConnectionItem,
    type ConnectionType,
} from '../../services/connectionStorageService';
import { createGenericElementWithContext } from '../api/createGenericElementWithContext';
import { type ClusterModelWithStorage } from '../documentdb/ClusterModel';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { DocumentDBClusterItem } from './DocumentDBClusterItem';

/**
 * Tree item representing a folder in the Connections View.
 * Folders can contain connections and other folders (nested hierarchy).
 */
export class FolderItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'treeItem_folder';
    private folderData: ConnectionItem;
    private _connectionType: ConnectionType;

    constructor(
        folderData: ConnectionItem,
        public readonly parentTreeId: string,
        connectionType: ConnectionType,
    ) {
        this.folderData = folderData;
        this._connectionType = connectionType;
        this.id = `${parentTreeId}/${folderData.id}`;
    }

    public get storageId(): string {
        return this.folderData.id;
    }

    public get name(): string {
        return this.folderData.name;
    }

    public get connectionType(): ConnectionType {
        return this._connectionType;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.folderData.name,
            // IMPORTANT: Icon choice affects tree item alignment in VS Code!
            //
            // We use 'folder-library' instead of 'folder' due to VS Code's internal alignment logic.
            // VS Code's TreeRenderer uses an Aligner class (in src/vs/workbench/browser/parts/views/treeView.ts)
            // that determines whether to add spacing before non-collapsible items to align them with
            // collapsible siblings (which have a twistie/expand arrow).
            //
            // The Aligner.hasIcon() method treats ThemeIcon('folder') and ThemeIcon('file') specially:
            //   - For these "file kind" icons, it checks if the user's file icon theme has folder/file
            //     icons enabled via: `fileIconTheme.hasFileIcons && fileIconTheme.hasFolderIcons`
            //   - If the theme doesn't have folder icons, hasIcon() returns FALSE even though the icon exists
            //
            // This breaks the alignIconWithTwisty() calculation, which decides whether non-collapsible
            // siblings (like "New Connection..." action items) need extra padding. When hasIcon() returns
            // false for folders but true for action items, the alignment logic produces incorrect results,
            // causing visual misalignment in the tree.
            //
            // By using 'folder-library' (or any non-file-kind icon), hasIcon() always returns true,
            // ensuring consistent alignment between collapsible folders and non-collapsible action items.
            //
            // Reference: VS Code source - src/vs/workbench/browser/parts/views/treeView.ts, Aligner class
            iconPath: new vscode.ThemeIcon('folder-library'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    public async getChildren(): Promise<TreeElement[]> {
        // Get all children (both folders and connections)
        const children = await ConnectionStorageService.getChildren(this.folderData.id, this._connectionType);

        const folderElements: TreeElement[] = [];
        const connectionElements: TreeElement[] = [];

        for (const child of children) {
            if (child.properties.type === ItemType.Folder) {
                // Create folder item
                folderElements.push(new FolderItem(child, this.id, this._connectionType));
            } else {
                // Create connection item
                const model: ClusterModelWithStorage = {
                    id: `${this.id}/${child.id}`,
                    storageId: child.id,
                    name: child.name,
                    dbExperience: DocumentDBExperience,
                    connectionString: child?.secrets?.connectionString ?? undefined,
                    emulatorConfiguration: child.properties.emulatorConfiguration,
                };

                connectionElements.push(new DocumentDBClusterItem(model));
            }
        }

        // Sort folders alphabetically by name
        folderElements.sort((a, b) => {
            const aName = (a as FolderItem).name;
            const bName = (b as FolderItem).name;
            return aName.localeCompare(bName);
        });

        // Sort connections alphabetically by name
        connectionElements.sort((a, b) => {
            const aName = (a as DocumentDBClusterItem).cluster.name;
            const bName = (b as DocumentDBClusterItem).cluster.name;
            return aName.localeCompare(bName);
        });

        // Return folders first, then connections
        const result = [...folderElements, ...connectionElements];

        // If folder is empty, return a placeholder element with context menu
        if (result.length === 0) {
            return [
                createGenericElementWithContext({
                    id: `${this.id}/emptyFolderPlaceholder`,
                    contextValue: 'treeItem_emptyFolderPlaceholder',
                    label: vscode.l10n.t('empty'),
                    iconPath: new vscode.ThemeIcon('indent'),
                }),
            ];
        }

        return result;
    }
}
