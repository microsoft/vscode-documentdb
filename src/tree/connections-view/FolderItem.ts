/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType, ItemType, type ConnectionItem } from '../../services/connectionStorageService';
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
    private connectionType: ConnectionType;

    constructor(
        folderData: ConnectionItem,
        public readonly parentTreeId: string,
        connectionType: ConnectionType,
    ) {
        this.folderData = folderData;
        this.connectionType = connectionType;
        this.id = `${parentTreeId}/${folderData.id}`;
    }

    public get storageId(): string {
        return this.folderData.id;
    }

    public get name(): string {
        return this.folderData.name;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.folderData.name,
            iconPath: new vscode.ThemeIcon('folder'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    public async getChildren(): Promise<TreeElement[]> {
        // Get all children (both folders and connections)
        const children = await ConnectionStorageService.getChildren(this.folderData.id, this.connectionType);

        const treeElements: TreeElement[] = [];

        for (const child of children) {
            if (child.properties.type === ItemType.Folder) {
                // Create folder item
                treeElements.push(new FolderItem(child, this.id, this.connectionType));
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

                treeElements.push(new DocumentDBClusterItem(model));
            }
        }

        // Wrap in state handling
        return treeElements.map((item) => ext.state.wrapItemInStateHandling(item, () => {}) as TreeElement);
    }
}
