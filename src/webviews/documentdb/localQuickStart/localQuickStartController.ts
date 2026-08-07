/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { API } from '../../../DocumentDBExperiences';
import { ext } from '../../../extensionVariables';
import { type AppWebviewController, openAppWebview } from '../../_integration/openAppWebview';
import { type RouterContext } from './localQuickStartRouter';

export type LocalQuickStartConfigurationType = {
    id: string;
};

/**
 * Opens the Local Quick Start webview. Construction-only (no instance state, no
 * externally-called methods beyond the handle), so this is a Path B factory per
 * the webview-ext migration manual, replacing the former `WebviewControllerBase`
 * subclass.
 */
export function openLocalQuickStartWebview(
    initialData: LocalQuickStartConfigurationType,
): AppWebviewController<LocalQuickStartConfigurationType> {
    // The router context's closePanel needs the controller handle, which only
    // exists after openAppWebview returns. The closure is only invoked at
    // runtime (in response to a tRPC call), well after the handle is assigned.
    const handle: { controller?: AppWebviewController<LocalQuickStartConfigurationType> } = {};

    const trpcContext: RouterContext = {
        dbExperience: API.DocumentDB,
        webviewName: 'localQuickStart',
        // Success auto-close: dispose the PANEL (not the controller). The
        // framework deliberately does not close the panel from `dispose()`
        // (circular-chain guard); disposing the panel fires
        // `onDidDispose → dispose()`, so cleanup still runs.
        closePanel: () => {
            handle.controller?.panel.dispose();
        },
    };

    const controller = openAppWebview({
        title: vscode.l10n.t('DocumentDB Local - Quick Start'),
        webviewName: 'localQuickStart',
        config: initialData,
        context: trpcContext,
        viewColumn: vscode.ViewColumn.Active,
        icon: {
            light: vscode.Uri.joinPath(
                ext.context.extensionUri,
                'resources',
                'icons',
                'vscode-documentdb-icon-light-themes.svg',
            ),
            dark: vscode.Uri.joinPath(
                ext.context.extensionUri,
                'resources',
                'icons',
                'vscode-documentdb-icon-dark-themes.svg',
            ),
        },
    });

    handle.controller = controller;

    return controller;
}
