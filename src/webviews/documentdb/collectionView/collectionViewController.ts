/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

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
    enableAIQueryGeneration: boolean;
    /** Pre-populated query from cross-feature navigation (e.g., Playground → Collection View). */
    initialQuery?: {
        filter?: string;
        project?: string;
        sort?: string;
    };
};

export class CollectionViewController extends WebviewController<CollectionViewWebviewConfigurationType> {
    constructor(
        initialData: Omit<CollectionViewWebviewConfigurationType, 'defaultPageSize' | 'enableAIQueryGeneration'>,
    ) {
        // ext.context here is the vscode.ExtensionContext required by the ReactWebviewPanelController's original implementation
        // we're not modifying it here in order to be ready for future updates of the webview API.

        const title: string = `${initialData.databaseName}/${initialData.collectionName}`;

        // Get the default page size from settings
        const defaultPageSize =
            SettingsService.getSetting<number>(ext.settingsKeys.collectionViewDefaultPageSize) ?? 50;

        // Get the experimental AI query generation setting
        const enableAIQueryGeneration =
            SettingsService.getSetting<boolean>(ext.settingsKeys.enableAIQueryGeneration) ?? false;

        const fullInitialData: CollectionViewWebviewConfigurationType = {
            ...initialData,
            defaultPageSize,
            enableAIQueryGeneration,
        };

        super(ext.context, title, 'collectionView', fullInitialData, vscode.ViewColumn.One, {
            light: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'collection-view-light.svg'),
            dark: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'collection-view-dark.svg'),
        });

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
