/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { SettingsService } from '../../../services/SettingsService';
import { WebviewController } from '../../api/extension-server/WebviewController';
import { type RouterContext } from './collectionViewRouter';

export type CollectionViewWebviewConfigurationType = {
    sessionId: string;
    clusterId: string;
    /**
     * Identifies which tree view this cluster belongs to.
     * Required for finding the tree node during import/export operations.
     * @see Views enum
     */
    viewId: string;
    databaseName: string;
    collectionName: string;
    defaultPageSize: number;
    feedbackSignalsEnabled: boolean;
};

export class CollectionViewController extends WebviewController<CollectionViewWebviewConfigurationType> {
    constructor(initialData: Omit<CollectionViewWebviewConfigurationType, 'defaultPageSize'>) {
        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.

        const title: string = `${initialData.databaseName}/${initialData.collectionName}`;

        // Get the default page size from settings
        const defaultPageSize =
            SettingsService.getSetting<number>(ext.settingsKeys.collectionViewDefaultPageSize) ?? 50;

        const fullInitialData: CollectionViewWebviewConfigurationType = {
            ...initialData,
            defaultPageSize,
        };

        super(ext.context, title, 'collectionView', fullInitialData);

        const trpcContext: RouterContext = {
            dbExperience: API.DocumentDB,
            webviewName: 'collectionView',
            sessionId: initialData.sessionId,
            clusterId: initialData.clusterId,
            viewId: initialData.viewId,
            databaseName: initialData.databaseName,
            collectionName: initialData.collectionName,
        };

        this.setupTrpc(trpcContext);
    }
}
