/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './documentsViewRouter';

export type DocumentsViewWebviewConfigurationType = {
    id: string; // move to base type

    clusterId: string;
    /**
     * Identifies which tree view this cluster belongs to.
     * Required for finding the tree node if needed.
     * @see Views enum
     */
    viewId: string;
    databaseName: string;
    collectionName: string;
    documentId: string;

    mode: string; // 'add', 'view', 'edit'
};

export function openDocumentViewPanel(
    initialData: DocumentsViewWebviewConfigurationType,
): AppWebviewController<DocumentsViewWebviewConfigurationType> {
    let title: string = `${initialData.databaseName}/${initialData.collectionName}/*new*`;
    switch (initialData.mode) {
        case 'view':
        case 'edit': {
            title = `${initialData.databaseName}/${initialData.collectionName}/${initialData.documentId}`;
            break;
        }
    }

    // The router context's title setter needs the controller handle, which only
    // exists after openAppWebview returns. The setter is only invoked at runtime
    // (in response to a tRPC call), well after the handle is assigned below.
    const handle: { controller?: AppWebviewController<DocumentsViewWebviewConfigurationType> } = {};

    const trpcContext: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'documentView',
        clusterId: initialData.clusterId,
        viewId: initialData.viewId,
        databaseName: initialData.databaseName,
        collectionName: initialData.collectionName,
        documentId: initialData.documentId,
        viewPanelTitleSetter: (title: string) => {
            if (handle.controller) {
                handle.controller.panel.title = title;
            }
        },
    };

    handle.controller = openAppWebview({
        title,
        webviewName: 'documentView',
        config: initialData,
        context: trpcContext,
        viewColumn: vscode.ViewColumn.Active,
        icon: {
            light: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'document-view-light.svg'),
            dark: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'document-view-dark.svg'),
        },
    });

    return handle.controller;
}
