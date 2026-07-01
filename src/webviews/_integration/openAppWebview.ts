/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * DocumentDB preset for the framework's `openWebview` factory.
 *
 * ## Why this helper exists
 *
 * Opening any DocumentDB webview needs the exact same fixed wiring every time:
 * this extension's root tRPC router (`appRouter`), its `createCallerFactory`,
 * the bundle / dev-server layout from `WEBVIEW_CONFIG`, and `ext.context`. Only
 * a handful of values actually change from one view to the next (the title, the
 * `viewType`, the initial config, the router context, and an optional icon or
 * view column).
 *
 * Without this helper every panel factory would repeat that same boilerplate on
 * its own `openWebview(...)` call, and any change to the shared wiring (a new
 * telemetry logger, a different dev-server host, a renamed bundle file) would
 * have to be found and edited in each of them. `openAppWebview` is the single
 * place that owns the fixed wiring, so each panel factory stays a few lines long
 * and states only what is unique to its view. It is the function-shaped
 * replacement for the former `WebviewControllerBase` class: same idea, without
 * the inheritance.
 *
 * ## How it is used
 *
 * Construction-only panels (no instance state, no externally-called methods
 * beyond the handle's `panel` / `onDisposed` / `revealToForeground` / `dispose`
 * / `isDisposed`) are opened with a thin factory function (e.g.
 * `openCollectionWebview`) that derives config + context and calls this.
 */

import { openWebview, type WebviewController } from '@microsoft/vscode-ext-webview/host';
import type * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { appRouter, type AppRouter, type BaseRouterContext } from './appRouter';
import { WEBVIEW_CONFIG } from './configuration';
import { createCallerFactory } from './trpc';
import { type WebviewName } from './WebviewRegistry';

/**
 * The DocumentDB-shaped `WebviewController` handle returned by every panel
 * factory: the app router and base context are fixed; only the per-view
 * configuration varies.
 */
export type AppWebviewController<TConfiguration> = WebviewController<AppRouter, TConfiguration, BaseRouterContext>;

/**
 * Per-view options for {@link openAppWebview}. Everything the framework needs
 * that is shared across DocumentDB panels (router, caller factory, layout) is
 * supplied by `openAppWebview` itself.
 */
export interface OpenAppWebviewOptions<TConfiguration> {
    readonly title: string;
    readonly webviewName: WebviewName;
    readonly config: TConfiguration;
    readonly context: BaseRouterContext;
    readonly viewColumn?: vscode.ViewColumn;
    readonly icon?: vscode.Uri | { readonly light: vscode.Uri; readonly dark: vscode.Uri };
}

/**
 * Opens a DocumentDB webview panel through the framework `openWebview` factory.
 *
 * @param options - The per-view title, webview name, configuration, router
 *                  context, and optional view column / icon.
 * @returns The `WebviewController` handle (`panel`, `onDisposed`,
 *          `revealToForeground`, `dispose`, `isDisposed`).
 */
export function openAppWebview<TConfiguration>(
    options: OpenAppWebviewOptions<TConfiguration>,
): AppWebviewController<TConfiguration> {
    return openWebview<AppRouter, TConfiguration, BaseRouterContext>(ext.context, {
        title: options.title,
        viewType: options.webviewName,
        router: appRouter,
        createCallerFactory,
        context: options.context,
        config: options.config,
        sourceLayout: WEBVIEW_CONFIG.bundle,
        devServerHost: WEBVIEW_CONFIG.devServerHost,
        icon: options.icon,
        viewColumn: options.viewColumn,
    });
}
