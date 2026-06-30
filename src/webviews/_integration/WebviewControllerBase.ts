/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DocumentDB-flavoured `WebviewControllerBase`.
 *
 * Thin wrapper that pre-fills the framework's
 * {@link import('@microsoft/vscode-ext-webview/host').WebviewControllerOptions}
 * with this extension's bundle layout, dev-server host, root tRPC router, and
 * caller factory.
 *
 * View controllers (`CollectionViewController`, `DocumentsViewController`,
 * ...) extend this class and pass only the per-view arguments (title,
 * webview name, initial configuration, router context, view column, icon) to
 * `super(...)`.
 *
 * The `Base` suffix disambiguates this DocumentDB-specific base class from
 * the framework's `WebviewController` it extends; both appear in import
 * graphs and stack traces, and the same-name shadow used to be confusing.
 */

import { WebviewController } from '@microsoft/vscode-ext-webview/host';
import * as vscode from 'vscode';
import { appRouter, type AppRouter, type BaseRouterContext } from './appRouter';
import { WEBVIEW_CONFIG } from './configuration';
import { createCallerFactory } from './trpc';
import { type WebviewName } from './WebviewRegistry';

/**
 * DocumentDB `WebviewControllerBase`. View controllers extend this and
 * only need to forward the call-site arguments to `super(...)`.
 *
 * @template TConfiguration - The initial configuration object passed to the
 *                            webview (received in the webview via
 *                            `useConfiguration`).
 */
export abstract class WebviewControllerBase<TConfiguration> extends WebviewController<
    AppRouter,
    TConfiguration,
    BaseRouterContext
> {
    constructor(
        extensionContext: vscode.ExtensionContext,
        title: string,
        webviewName: WebviewName,
        configuration: TConfiguration,
        context: BaseRouterContext,
        viewColumn: vscode.ViewColumn = vscode.ViewColumn.One,
        iconPath?: vscode.Uri | { readonly light: vscode.Uri; readonly dark: vscode.Uri },
    ) {
        super({
            extensionContext,
            title,
            viewType: webviewName,
            router: appRouter,
            createCallerFactory,
            context,
            config: configuration,
            sourceLayout: WEBVIEW_CONFIG.bundle,
            devServerHost: WEBVIEW_CONFIG.devServerHost,
            icon: iconPath,
            viewColumn,
        });
    }
}
