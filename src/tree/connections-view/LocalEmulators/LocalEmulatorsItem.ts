/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type IconPath } from 'vscode';

import path from 'path';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import {
    ConnectionStorageService,
    ConnectionType,
    isConnection,
    ItemType,
} from '../../../services/connectionStorageService';
import { type EmulatorConfiguration } from '../../../utils/emulatorConfiguration';
import { getResourcesPath } from '../../../utils/icons';
import { type TreeCluster } from '../../models/BaseClusterModel';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { DocumentDBClusterItem } from '../DocumentDBClusterItem';
import { FolderItem } from '../FolderItem';
import { type ConnectionClusterModel } from '../models/ConnectionClusterModel';
import { NewEmulatorConnectionItemCV } from './NewEmulatorConnectionItemCV';

export class LocalEmulatorsItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'treeItem_LocalEmulators';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/localEmulators`;
    }

    async getChildren(): Promise<TreeElement[]> {
        // Get root-level folders and connections for emulators
        const rootFolders = await ConnectionStorageService.getChildren(
            undefined,
            ConnectionType.Emulators,
            ItemType.Folder,
        );
        const rootConnections = await ConnectionStorageService.getChildren(
            undefined,
            ConnectionType.Emulators,
            ItemType.Connection,
        );

        // Create folder items
        const folderItems = rootFolders.map((folder) => new FolderItem(folder, this.id, ConnectionType.Emulators));

        // Create connection items (filter with type guard to ensure type safety)
        const connectionItems = rootConnections.filter(isConnection).map((connection) => {
            const emulatorConfiguration: EmulatorConfiguration = {
                isEmulator: true,
                disableEmulatorSecurity: !!connection.properties.emulatorConfiguration?.disableEmulatorSecurity,
            };

            const model: TreeCluster<ConnectionClusterModel> = {
                // Tree context (computed at runtime)
                treeId: `${this.id}/${connection.id}`, // Hierarchical tree path
                viewId: this.parentId, // View ID is the root parent

                // Connection cluster data
                clusterId: connection.id, // Stable storageId for cache lookups
                storageId: connection.id,
                name: connection.name,
                dbExperience: DocumentDBExperience,
                connectionString: connection.secrets.connectionString,
                emulatorConfiguration: emulatorConfiguration,
            };

            ext.outputChannel.trace(
                `[ConnectionsView/Emulators] Created cluster model: name="${model.name}", clusterId="${model.clusterId}", treeId="${model.treeId}"`,
            );

            return new DocumentDBClusterItem(model);
        });

        // Sort folders alphabetically by name
        folderItems.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        // Sort connections alphabetically by name
        connectionItems.sort((a, b) => a.cluster.name.localeCompare(b.cluster.name, undefined, { numeric: true }));

        // Show "New Local Connection" only if there are no folders or connections
        const hasItems = folderItems.length > 0 || connectionItems.length > 0;
        const newConnectionItem = hasItems ? [] : [new NewEmulatorConnectionItemCV(this.id)];

        // Return folders first, then connections, then the "New Emulator Connection" item (if no other items)
        return [...folderItems, ...connectionItems, ...newConnectionItem];
    }

    private iconPath: IconPath = {
        light: vscode.Uri.file(path.join(getResourcesPath(), 'icons', 'vscode-documentdb-icon-light-themes.svg')),
        dark: vscode.Uri.file(path.join(getResourcesPath(), 'icons', 'vscode-documentdb-icon-dark-themes.svg')),
    };

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('DocumentDB Local'),
            iconPath: this.iconPath,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
