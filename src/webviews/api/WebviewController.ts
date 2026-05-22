/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DocumentDB-flavoured `WebviewController`.
 *
 * Thin wrapper that pre-fills the framework's
 * {@link import('@microsoft/vscode-ext-react-webview').WebviewControllerOptions}
 * with this extension's bundle layout, dev-server host, and root tRPC router.
 *
 * View controllers (`CollectionViewController`, `DocumentsViewController`,
 * ...) extend this class and pass only the per-view arguments (title,
 * webview name, initial configuration, view column, icon) to `super(...)`.
 */

import { WebviewController as FrameworkWebviewController } from '@microsoft/vscode-ext-react-webview/server';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { appRouter, type AppRouter, type BaseRouterContext } from './appRouter';
import { type WebviewName } from './WebviewRegistry';

/**
 * Layout describing where the extension's webview JavaScript lives on disk.
 *
 * - `bundled` is used when the extension runs from its webpack output
 *   (production: `dist/views.js`).
 * - `dev` is used when running from `tsc` output during development
 *   (`out/src/webviews/index.js`).
 *
 * These paths are joined with `extensionPath` by the framework at runtime.
 */
const DOCUMENTDB_WEBVIEW_SOURCE_LAYOUT = {
    bundled: { dir: '', file: 'views.js' },
    dev: { dir: 'out/src/webviews', file: 'index.js' },
};

const DOCUMENTDB_DEV_SERVER_HOST = 'http://localhost:18080';

/**
 * DocumentDB `WebviewController` base class. View controllers extend this and
 * only need to forward the call-site arguments to `super(...)`.
 *
 * @template TConfiguration - The initial configuration object passed to the
 *                            webview (received in the webview via
 *                            `useConfiguration`).
 */
export abstract class WebviewController<TConfiguration> extends FrameworkWebviewController<
    AppRouter,
    TConfiguration,
    BaseRouterContext
> {
    constructor(
        extensionContext: vscode.ExtensionContext,
        title: string,
        webviewName: WebviewName,
        configuration: TConfiguration,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
        iconPath?: vscode.Uri | { readonly light: vscode.Uri; readonly dark: vscode.Uri },
    ) {
        super(
            extensionContext,
            title,
            webviewName,
            configuration,
            {
                appRouter,
                // `ext.isBundle` is assigned in `activate()`; controllers are
                // only instantiated in response to user commands, which always
                // run after activation, so the value is safe to read here.
                isBundled: !!ext.isBundle,
                sourceLayout: DOCUMENTDB_WEBVIEW_SOURCE_LAYOUT,
                devServerHost: DOCUMENTDB_DEV_SERVER_HOST,
            },
            viewColumn,
            iconPath,
        );
    }
}
