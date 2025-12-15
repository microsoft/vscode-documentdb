/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { DocumentDBExperience } from '../../DocumentDBExperiences';
import { ext } from '../../extensionVariables';
import { ConnectionStorageService, ConnectionType, type ConnectionItem } from '../../services/connectionStorageService';
import { FolderStorageService, type FolderItem as FolderData } from '../../services/folderStorageService';
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
    private folderData: FolderData;

    constructor(
        folderData: FolderData,
        public readonly parentId: string,
    ) {
        this.folderData = folderData;
        this.id = `${parentId}/${folderData.id}`;
    }

    public get folderId(): string {
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
        // Get child folders
        const childFolders = await FolderStorageService.getChildren(this.folderData.id);
        const folderItems = childFolders.map((folder) => new FolderItem(folder, this.id));

        // Get connections in this folder
        const clusterConnections = await ConnectionStorageService.getAll(ConnectionType.Clusters);
        const emulatorConnections = await ConnectionStorageService.getAll(ConnectionType.Emulators);
        const allConnections = [...clusterConnections, ...emulatorConnections];

        const connectionsInFolder = allConnections.filter(
            (connection) => connection.properties.folderId === this.folderData.id,
        );

        const connectionItems = connectionsInFolder.map((connection: ConnectionItem) => {
            const model: ClusterModelWithStorage = {
                id: `${this.id}/${connection.id}`,
                storageId: connection.id,
                name: connection.name,
                dbExperience: DocumentDBExperience,
                connectionString: connection?.secrets?.connectionString ?? undefined,
                emulatorConfiguration: connection.properties.emulatorConfiguration,
            };

            return new DocumentDBClusterItem(model);
        });

        // Combine folders first, then connections
        const children = [...folderItems, ...connectionItems];

        // Wrap in state handling
        return children.map((item) => ext.state.wrapItemInStateHandling(item, () => {}) as TreeElement);
    }
}
