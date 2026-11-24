/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type ConnectionBinding } from '../../../documentdb/ClustersClient';
import { registerConnectionSurface } from '../../../documentdb/connectionSurfaces';
import { type ConnectionUnavailableReason } from '../../../documentdb/ConnectionUnavailableError';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type ConnectionUnavailableMessage } from '../../_integration/connectionUnavailable';
import { describeUnavailableConnection } from '../../_integration/describeUnavailableConnection';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { recoverBoundView } from '../boundViewOperations';
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
    documentId?: string;

    mode: string; // 'add', 'view', 'edit'
};

export function openDocumentWebview(
    initialData: DocumentsViewWebviewConfigurationType,
    binding: ConnectionBinding,
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

    const postUnavailable = (reason: ConnectionUnavailableReason): void => {
        const message: ConnectionUnavailableMessage = {
            type: 'documentView.connectionUnavailable',
            unavailable: describeUnavailableConnection(reason).unavailable,
        };
        if (!controller.isDisposed) {
            void controller.panel.webview.postMessage(message);
        }
    };

    const trpcContext: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'documentView',
        clusterId: initialData.clusterId,
        viewId: initialData.viewId,
        databaseName: initialData.databaseName,
        collectionName: initialData.collectionName,
        documentId: initialData.documentId,
        binding,
        describeUnavailable: describeUnavailableConnection,
        recoverUnavailable: (request) => recoverBoundView(binding, 'documentView', () => controller.dispose(), request),
        viewPanelTitleSetter: (title: string) => {
            if (handle.controller && !handle.controller.isDisposed) {
                handle.controller.panel.title = title;
            }
        },
    };

    const controller: AppWebviewController<DocumentsViewWebviewConfigurationType> = openAppWebview({
        title,
        webviewName: 'documentView',
        panelViewType: 'vscode-documentdb-document-view',
        config: initialData,
        context: trpcContext,
        // A new document has nothing to load, so only opened documents report their load time.
        viewLoad:
            initialData.mode === 'add'
                ? undefined
                : {
                      kind: 'documentView',
                      correlation: {
                          viewId: initialData.viewId,
                          documentMode: initialData.mode === 'edit' ? 'edit' : 'view',
                      },
                  },
        viewColumn: vscode.ViewColumn.Active,
        icon: {
            light: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'document-view-light.svg'),
            dark: vscode.Uri.joinPath(ext.context.extensionUri, 'resources', 'icons', 'document-view-dark.svg'),
        },
    });

    // Assign into the deferred handle so the title-setter closure above can reach
    // the controller, then return the local `const` (never the optional
    // `handle.controller`), so the return path is obviously non-nullable.
    handle.controller = controller;

    const registration = registerConnectionSurface({
        clusterId: initialData.clusterId,
        kind: 'documentView',
        disable: postUnavailable,
        dispose: () => controller.dispose(),
    });
    controller.onDisposed(() => registration.dispose());

    return controller;
}
