/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Public entry point for `@microsoft/vscode-ext-react-webview` — the webview-client
 * (browser) surface.
 *
 * The webview side never needs the extension-server APIs, and pulling them in
 * would drag Node / VS Code imports (`fs`, `path`, `vscode`) into the webview
 * bundle. Keep this entry browser-only.
 *
 * Extension-host code imports the server surface from the `/server` subpath:
 *
 * ```ts
 * import { WebviewController, router } from '@microsoft/vscode-ext-react-webview/server';
 * ```
 */

export * from './webview-client';
