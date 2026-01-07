/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type IconPath } from 'vscode';

import path from 'path';
import { DocumentDBExperience } from '../../../DocumentDBExperiences';
import {
    type ConnectionItem,
    ConnectionStorageService,
    ConnectionType,
    ItemType,
} from '../../../services/connectionStorageService';
import { type EmulatorConfiguration } from '../../../utils/emulatorConfiguration';
import { getResourcesPath } from '../../../utils/icons';
import { type ClusterModelWithStorage } from '../../documentdb/ClusterModel';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { DocumentDBClusterItem } from '../DocumentDBClusterItem';
import { FolderItem } from '../FolderItem';
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

        // Create connection items
        const connectionItems = rootConnections.map((connection: ConnectionItem) => {
            // we need to create the emulator configuration object from the typed properties object
            const emulatorConfiguration: EmulatorConfiguration = {
                isEmulator: true,
                disableEmulatorSecurity: !!connection.properties?.emulatorConfiguration?.disableEmulatorSecurity,
            };

            const model: ClusterModelWithStorage = {
                id: `${this.id}/${connection.id}`,
                storageId: connection.id,
                name: connection.name,
                dbExperience: DocumentDBExperience,
                connectionString: connection?.secrets?.connectionString,
                emulatorConfiguration: emulatorConfiguration,
            };

            return new DocumentDBClusterItem(model);
        });

        // Return folders first, then connections, then the "New Emulator Connection" item
        return [...folderItems, ...connectionItems, new NewEmulatorConnectionItemCV(this.id)];
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
