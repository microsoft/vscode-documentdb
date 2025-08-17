/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import path from 'path';
import { getResourcesPath, type IThemedIconPath } from '../../../constants';
import { MongoClustersExperience } from '../../../DocumentDBExperiences';
import {
    ConnectionStorageService,
    ConnectionType,
    type ConnectionItem,
} from '../../../services/connectionStorageService';
import { type EmulatorConfiguration } from '../../../utils/emulatorConfiguration';
import { type ClusterModelWithStorage } from '../../documentdb/ClusterModel';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';
import { DocumentDBClusterItem } from '../DocumentDBClusterItem';
import { NewEmulatorConnectionItemCV } from './NewEmulatorConnectionItemCV';

export class LocalEmulatorsItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public contextValue: string = 'treeItem.LocalEmulators';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/localEmulators`;
    }

    async getChildren(): Promise<TreeElement[]> {
        const emulatorItems = await ConnectionStorageService.get(ConnectionType.Emulators);
        return [
            ...emulatorItems.map((item: ConnectionItem) => {
                // we need to create the emulator configuration object from the typed properties object
                const emulatorConfiguration: EmulatorConfiguration = {
                    isEmulator: true,
                    disableEmulatorSecurity: !!item.properties?.emulatorConfiguration?.disableEmulatorSecurity,
                };

                const model: ClusterModelWithStorage = {
                    id: `${this.id}/${item.id}`,
                    storageId: item.id,
                    name: item.name,
                    dbExperience: MongoClustersExperience,
                    connectionString: item?.secrets?.connectionString,
                    emulatorConfiguration: emulatorConfiguration,
                };

                return new DocumentDBClusterItem(model);
            }),
            new NewEmulatorConnectionItemCV(this.id),
        ];
    }

    private iconPath: IThemedIconPath = {
        light: path.join(getResourcesPath(), 'icons', 'vscode-documentdb-icon-blue.svg'),
        dark: path.join(getResourcesPath(), 'icons', 'vscode-documentdb-icon.svg'),
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
